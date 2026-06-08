/**
 * Rear-camera acquisition primitive for the QR scanner.
 *
 * This is intentionally NOT a scanner: it owns no `<video>`, no decode loop, no
 * React lifecycle. It is the one place that talks to
 * `navigator.mediaDevices.getUserMedia`, rides out the post-`track.stop()` busy
 * window, and classifies the raw `DOMException` shapes into stable
 * `ScannerError` codes. Ported from the w3spay scanner so both terminals open
 * the camera and classify failures identically.
 */

import { ScannerError } from "@/lib/scan/scanner-types";

/**
 * Result of a camera acquisition attempt.
 *
 * On success the caller binds the stream to its `<video>`. On failure the
 * caller passes `error` to `classifyStartError` to decide intent: a denied
 * permission, a missing/held camera, or a transient busy-window race that the
 * retry wrapper rides out. Tracking the last raw error is the point of this
 * type — it preserves the `DOMException.name` distinction (denied vs no-device
 * vs busy) that a flattened error string would obliterate.
 */
export type AcquireResult =
  | { ok: true; stream: MediaStream }
  | { ok: false; error: Error | null };

/**
 * Ask the browser for the rear camera with no resolution constraints.
 *
 * Just `facingMode: "environment"` — let the WebView/browser pick whatever
 * resolution and frame rate the device wants to give us. A resolution cascade
 * (1080p → 720p → bare) was tried and removed: tiers got rejected for reasons
 * the loop couldn't always recover from, and the "more source pixels" promise
 * was illusory anyway — the decoder downscales to `DECODE_CANVAS_CAP` (2048px)
 * after the central-square crop, so anything above ~2K source is binned before
 * it reaches ZXing. The bare request is the one every device supports.
 *
 * Returns the live stream or the raw `getUserMedia` error so the caller can
 * classify it (permission denied → typed error, transient busy-window → retry,
 * anything else → surface).
 *
 * @internal exported for testing — see camera-stream.test.ts
 */
export async function acquireRearStream(): Promise<AcquireResult> {
  if (typeof navigator === "undefined" || navigator.mediaDevices?.getUserMedia == null) {
    return {
      ok: false,
      error: new Error("getUserMedia is not available in this runtime"),
    };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "environment" },
    });
    return { ok: true, stream };
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    console.warn(`[t3rminal/scanner] getUserMedia rejected: ${error.name}: ${error.message}`);
    return { ok: false, error };
  }
}

/**
 * Camera errors that mean "try again in a moment", not "give up".
 *
 * iOS / WKWebView releases the camera ASYNCHRONOUSLY after `track.stop()`.
 * Android Chrome WebViews behave similarly when the host has just relinquished
 * a stream (e.g. the host shell's own permission-validation probe). A
 * `getUserMedia` issued before that teardown completes rejects with
 * `NotReadableError` ("Could not start video source") — older WebKit spells the
 * same condition `AbortError`. This is the "comes back for a moment, then fails
 * again" loop users hit on retry: the camera IS available, we just asked a beat
 * too early.
 *
 * @internal exported for testing — see camera-stream.test.ts
 */
export function isTransientCameraError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "NotReadableError" || error.name === "AbortError")
  );
}

/**
 * Back-off schedule (ms) for riding out the post-stop busy window.
 *
 * Kept short on purpose — the scan page retries `cameraUnavailable` itself, so
 * this inner budget only needs to cover the typical iOS WKWebView async-release
 * race (a few hundred ms after `track.stop()`). Stretching it to multiple
 * seconds made the user stare at a frozen "Starting camera…" spinner.
 */
const CAMERA_BUSY_RETRY_DELAYS_MS = [250, 500, 1000] as const;

/**
 * `acquireRearStream` wrapped in a transient-retry back-off.
 *
 * The host's camera-permission grant can open a brief validation stream before
 * returning; the release of that stream races our `getUserMedia` and the latter
 * rejects with `NotReadableError`. On iOS WKWebView the same race shows up after
 * a scanner remount (the previous stream's `track.stop()` settles
 * asynchronously). We ride it out with a short back-off and re-acquire.
 *
 * We deliberately open exactly ONE `MediaStream` per attempt and never a second
 * overlapping `getUserMedia`. Opening a second stream to "upgrade" lenses while
 * the first is live wedges the camera on iOS into a `NotReadableError` that only
 * a full reload clears. We take whatever lens `facingMode: environment`
 * resolves to.
 *
 * Non-transient failures (permission denied, no camera) return immediately so
 * the permission UI isn't delayed.
 *
 * @internal exported for testing — see camera-stream.test.ts
 */
export async function acquireRearStreamWithRetry(): Promise<AcquireResult> {
  let result = await acquireRearStream();
  for (const backoffMs of CAMERA_BUSY_RETRY_DELAYS_MS) {
    if (
      result.ok ||
      result.error == null ||
      !isTransientCameraError(result.error)
    ) {
      return result;
    }
    console.warn(
      `[t3rminal/scanner] transient camera error; backing off ${backoffMs}ms`,
    );
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, backoffMs);
    await promise;
    result = await acquireRearStream();
  }
  return result;
}

/** Stop every track on `stream`, swallowing per-track teardown errors. */
export function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Map a raw camera-acquisition error onto a stable `ScannerError` code so the UI
 * can branch on intent (permission denied vs no camera vs generic failure)
 * without inspecting the raw message.
 *
 * Both shapes are handled: a `DOMException` (when `getUserMedia` fails:
 * NotAllowedError, NotFoundError, OverconstrainedError, NotReadableError) and a
 * flattened error string a library might re-throw.
 *
 * @internal exported for testing — see camera-stream.test.ts
 */
export function classifyStartError(caught: unknown): ScannerError {
  if (caught instanceof ScannerError) return caught;
  if (caught instanceof Error && caught.name === "NotAllowedError") {
    return new ScannerError("permissionDenied", caught.message, caught);
  }
  if (
    caught instanceof Error &&
    (caught.name === "NotFoundError" ||
      caught.name === "OverconstrainedError" ||
      caught.name === "NotReadableError")
  ) {
    return new ScannerError("cameraUnavailable", caught.message, caught);
  }
  const message = caught instanceof Error ? caught.message : String(caught);
  if (/NotAllowedError|Permission/i.test(message)) {
    return new ScannerError("permissionDenied", message, caught);
  }
  if (/NotFoundError|OverconstrainedError|Camera not found/i.test(message)) {
    return new ScannerError("cameraUnavailable", message, caught);
  }
  return new ScannerError("startFailed", message, caught);
}
