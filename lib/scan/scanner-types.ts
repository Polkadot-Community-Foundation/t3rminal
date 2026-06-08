/**
 * Shared scanner contract — the small surface the scan UI agrees on so the
 * page never has to reach into WebRTC / decoder internals.
 *
 * The implementation underneath is the ZXing-C++ WASM decoder running in a
 * Web Worker (`backend-zxing-wasm.ts` + `zxing-wasm-worker.ts`), driven by the
 * shared rear-camera primitive in `camera-stream.ts`. This contract is ported
 * verbatim from the w3spay scanner so both terminals classify camera failures
 * identically.
 */

/** Stable error codes the UI branches on (permission vs hardware vs other). */
export type ScannerErrorCode =
  | "cameraUnavailable"
  | "permissionDenied"
  | "startFailed"
  | "scanFailed";

/**
 * Domain error surfaced by the scanner backend. The raw underlying
 * `DOMException` (when one exists) is preserved on `cause` so logging can show
 * the real failure (`NotReadableError`, `OverconstrainedError`, …) without the
 * UI having to know about WebRTC primitives.
 */
export class ScannerError extends Error {
  constructor(
    public readonly code: ScannerErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ScannerError";
  }
}

/** Caller-provided callbacks. `onError` is a best-effort live-scan signal. */
export interface ScannerCallbacks {
  onDecoded(text: string): void;
  onError?(error: ScannerError): void;
}

/** Handle returned by a backend start; `stop()` is idempotent and never throws. */
export interface ScannerHandle {
  stop(): Promise<void>;
}
