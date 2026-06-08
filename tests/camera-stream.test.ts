/**
 * Unit tests for the shared rear-camera primitive (`lib/scan/camera-stream.ts`).
 *
 * These cover the hardware-facing edges that took device testing to get right
 * and would silently regress: the bare (no-tier) getUserMedia request, the
 * transient busy-window retry back-off, and the DOMException → ScannerError
 * classification the scan UI branches on.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acquireRearStream,
  acquireRearStreamWithRetry,
  classifyStartError,
  isTransientCameraError,
} from "@/lib/scan/camera-stream";
import { ScannerError } from "@/lib/scan/scanner-types";

type GetUserMediaImpl = (
  constraints?: MediaStreamConstraints,
) => Promise<MediaStream>;

function namedError(name: string, message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

function fakeStream(): MediaStream {
  // Minimal MediaStream stand-in — acquireRearStream only ever passes the
  // value through, so any non-null reference is fine.
  return {
    id: "fake-stream",
    active: true,
    getTracks: () => [],
    getVideoTracks: () => [],
    getAudioTracks: () => [],
  } as unknown as MediaStream;
}

/**
 * Install a fake `navigator.mediaDevices` for the duration of one test.
 * Returns the `getUserMedia` spy so the test can assert call counts and
 * constraint shapes.
 */
function installFakeMediaDevices(impl: GetUserMediaImpl) {
  const spy = vi.fn(impl);
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: spy } },
  });
  return spy;
}

const originalNavigator = (globalThis as { navigator?: unknown }).navigator;

afterEach(() => {
  vi.restoreAllMocks();
  if (originalNavigator === undefined) {
    delete (globalThis as { navigator?: unknown }).navigator;
  } else {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  }
});

describe("acquireRearStream", () => {
  it("returns the stream from a single bare facingMode:environment request", async () => {
    const stream = fakeStream();
    const getUserMedia = installFakeMediaDevices(() => Promise.resolve(stream));
    const result = await acquireRearStream();
    expect(result).toEqual({ ok: true, stream });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    // No tiers, no `{ ideal: ... }` widths. Just rear camera, no audio.
    expect(getUserMedia.mock.calls[0]?.[0]).toEqual({
      audio: false,
      video: { facingMode: "environment" },
    });
  });

  it("returns the raw error verbatim on rejection", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const getUserMedia = installFakeMediaDevices(() =>
      Promise.reject(namedError("NotAllowedError", "denied")),
    );
    const result = await acquireRearStream();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.name).toBe("NotAllowedError");
      expect(result.error?.message).toBe("denied");
    }
    // Single attempt — no tier cascade to walk through.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("wraps a thrown non-Error into a real Error", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    installFakeMediaDevices(() => Promise.reject("camera fell off") as Promise<MediaStream>);
    const result = await acquireRearStream();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error?.message).toBe("camera fell off");
    }
  });

  it("returns a typed failure when navigator.mediaDevices is unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });
    const result = await acquireRearStream();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error?.message).toMatch(/getUserMedia is not available/);
    }
  });
});

describe("isTransientCameraError", () => {
  it("flags NotReadableError as transient (post-stop busy window)", () => {
    expect(isTransientCameraError(namedError("NotReadableError", "busy"))).toBe(true);
  });
  it("flags AbortError as transient (older-WebKit spelling of the same race)", () => {
    expect(isTransientCameraError(namedError("AbortError", "aborted"))).toBe(true);
  });
  it("does not flag terminal failures as transient", () => {
    expect(isTransientCameraError(namedError("NotAllowedError", "denied"))).toBe(false);
    expect(isTransientCameraError(namedError("NotFoundError", "no camera"))).toBe(false);
    expect(isTransientCameraError(namedError("OverconstrainedError", "no"))).toBe(false);
    expect(isTransientCameraError(new Error("anything else"))).toBe(false);
    expect(isTransientCameraError("not even an error")).toBe(false);
    expect(isTransientCameraError(null)).toBe(false);
  });
});

describe("acquireRearStreamWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries NotReadableError up to the back-off schedule's length", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stream = fakeStream();
    let calls = 0;
    const getUserMedia = installFakeMediaDevices(() => {
      calls += 1;
      // First three calls hit NotReadableError; the fourth resolves. The
      // back-off schedule has 3 steps, so 3 retries drive us to the resolving
      // 4th call. (One getUserMedia per acquire pass — no tier cascade.)
      if (calls < 4) {
        return Promise.reject(namedError("NotReadableError", `busy attempt ${calls}`));
      }
      return Promise.resolve(stream);
    });
    const promise = acquireRearStreamWithRetry();
    // Drive the 3-step back-off schedule. Fake timers need an `await` between
    // each tick to let the promise microtasks settle.
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result).toEqual({ ok: true, stream });
    // Initial + 3 retries = 4 calls.
    expect(getUserMedia).toHaveBeenCalledTimes(4);
  });

  it("does NOT retry NotAllowedError — permission denial is terminal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const getUserMedia = installFakeMediaDevices(() =>
      Promise.reject(namedError("NotAllowedError", "denied")),
    );
    const result = await acquireRearStreamWithRetry();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error?.name).toBe("NotAllowedError");
    // One call: NotAllowedError isn't transient, so the retry wrapper returns
    // immediately.
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("returns immediately on success without burning any back-off", async () => {
    const stream = fakeStream();
    const getUserMedia = installFakeMediaDevices(() => Promise.resolve(stream));
    const result = await acquireRearStreamWithRetry();
    expect(result).toEqual({ ok: true, stream });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("gives up after exhausting the back-off schedule", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const getUserMedia = installFakeMediaDevices(() =>
      Promise.reject(namedError("NotReadableError", "still busy")),
    );
    const promise = acquireRearStreamWithRetry();
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error?.name).toBe("NotReadableError");
    // Initial + 3 retries = 4 calls.
    expect(getUserMedia).toHaveBeenCalledTimes(4);
  });
});

describe("classifyStartError", () => {
  it("maps NotAllowedError to permissionDenied", () => {
    const err = classifyStartError(namedError("NotAllowedError", "denied"));
    expect(err).toBeInstanceOf(ScannerError);
    expect(err.code).toBe("permissionDenied");
  });

  it("maps NotFoundError / OverconstrainedError / NotReadableError to cameraUnavailable", () => {
    expect(classifyStartError(namedError("NotFoundError", "no")).code).toBe(
      "cameraUnavailable",
    );
    expect(classifyStartError(namedError("OverconstrainedError", "no")).code).toBe(
      "cameraUnavailable",
    );
    expect(classifyStartError(namedError("NotReadableError", "busy")).code).toBe(
      "cameraUnavailable",
    );
  });

  it("maps a bare 'Camera not found.' string to cameraUnavailable", () => {
    expect(classifyStartError("Camera not found.").code).toBe("cameraUnavailable");
  });

  it("falls back to startFailed for unrecognised errors", () => {
    expect(classifyStartError(new Error("something else entirely")).code).toBe(
      "startFailed",
    );
  });

  it("preserves the original cause for debugging", () => {
    const cause = namedError("NotAllowedError", "denied");
    expect(classifyStartError(cause).cause).toBe(cause);
  });

  it("returns a ScannerError unchanged (idempotent)", () => {
    const original = new ScannerError("cameraUnavailable", "held");
    expect(classifyStartError(original)).toBe(original);
  });
});
