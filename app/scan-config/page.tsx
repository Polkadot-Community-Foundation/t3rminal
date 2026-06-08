/**
 * Standalone admin-QR inspector.
 *
 * Reads a BCTS UR QR (single-frame or multipart) from the device camera
 * and renders every field of the decoded v2 payload. This page is
 * intentionally a read-only inspector — it does NOT mutate the catalog
 * or persist any binding. That keeps the surface area off the team's
 * `settings/` page entirely; if/when binding is wanted, it can be added
 * here without touching their work.
 *
 * Lifetimes:
 *   - QR decoding runs the ZXing-C++ WASM scanner in a Web Worker
 *     (`@/lib/scan/backend-zxing-wasm`) — ported from w3spay so both
 *     terminals share the same off-main-thread decode, central-square ROI
 *     cropping, 8fps frame throttling, and transient-camera-error retries.
 *     The worker is created lazily on first scan, keeping the page's first
 *     render SSR-safe.
 *   - Multipart UR frames stream through a single accumulator that
 *     resets every time the user re-arms the scanner.
 *   - On unmount we always stop the scanner so a backgrounded page
 *     doesn't keep the camera awake.
 */

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, AlertTriangle, Camera, CheckCircle2, ScanLine } from "lucide-react";

import {
  encodeT3rminalConfigQrV2,
  type QrItem,
  type T3rminalConfigQrPayloadV1,
  type T3rminalConfigQrPayloadV2,
} from "@/lib/config/t3rminal-config-qr";

import {
  createAdminQrScanAccumulator,
  importAdminQrConfig,
  tryDecodeAdminQrFrame,
} from "@/lib/config/admin-qr";
import { resolveHostCameraPermission } from "@/lib/host/camera-permission";
import { setManualPassphrase } from "@/lib/crypto/manual-key";
import { startZxingWasmScanner } from "@/lib/scan/backend-zxing-wasm";
import { ScannerError, type ScannerHandle } from "@/lib/scan/scanner-types";

type ScanState =
  | { readonly kind: "idle" }
  | { readonly kind: "requesting-permission" }
  | { readonly kind: "scanning" }
  | { readonly kind: "decoded-v2"; readonly payload: T3rminalConfigQrPayloadV2 }
  | { readonly kind: "decoded-v1"; readonly payload: T3rminalConfigQrPayloadV1 }
  | { readonly kind: "permission-denied"; readonly source: "host" | "browser" }
  | { readonly kind: "error"; readonly message: string };

export default function ScanConfigPage() {
  // useSearchParams needs Suspense in app-router static builds.
  return (
    <Suspense fallback={null}>
      <ScanConfigPageInner />
    </Suspense>
  );
}

function ScanConfigPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // `?return=/settings/admin-config` lets the Settings entry point bring
  // the merchant back to the populated fields after a successful scan.
  const returnTo = searchParams.get("return");
  const [scanState, setScanState] = useState<ScanState>({ kind: "idle" });
  const accumulatorRef = useRef(createAdminQrScanAccumulator());
  const scannerRef = useRef<ScannerHandle | null>(null);
  // Host element the WASM backend mounts its <video> into.
  const scanHostRef = useRef<HTMLDivElement>(null);
  // Latch that aborts an in-flight start() (Cancel / unmount) before a
  // ScannerHandle exists to stop.
  const cancelStartRef = useRef(false);

  // Always release the camera on unmount — even if the user navigated
  // away mid-scan.
  const stopScanner = useCallback(async () => {
    // Abort any in-flight start() that has not produced a handle yet, then
    // stop the live scanner if one exists.
    cancelStartRef.current = true;
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (!scanner) return;
    try {
      await scanner.stop();
    } catch {
      // already stopped / stop may have raced; safe to swallow.
    }
  }, []);

  useEffect(() => {
    return () => {
      void stopScanner();
    };
  }, [stopScanner]);

  // Persist a successful v2 decode and (if we were invoked from a Settings
  // page via `?return=...`) bounce back so the fields populate in place.
  // The QR's `reportPassword` is also pushed into the manual-key store so
  // the encryption flow doesn't need a second manual step.
  const acceptV2 = useCallback(
    async (payload: T3rminalConfigQrPayloadV2) => {
      try {
        // Re-encode to a canonical single-frame UR so the persisted "raw"
        // is the same whether the original QR was single- or multi-frame.
        const { qrString } = encodeT3rminalConfigQrV2(payload);
        await importAdminQrConfig(payload, qrString);
        try {
          setManualPassphrase(payload.reportPassword);
        } catch {
          // Empty / malformed password — surface as a soft warning rather
          // than failing the whole import; the merchant can still set a
          // passphrase manually in Settings → Report Encryption.
          console.warn(
            "[ScanConfig] reportPassword from QR could not be installed as the manual encryption key",
          );
        }
      } catch (err) {
        setScanState({
          kind: "error",
          message:
            err instanceof Error
              ? `Saved scan failed: ${err.message}`
              : "Saved scan failed.",
        });
        return;
      }
      setScanState({ kind: "decoded-v2", payload });
      if (returnTo) {
        // Short pause so the merchant sees the success state before nav.
        window.setTimeout(() => router.push(returnTo), 600);
      }
    },
    [returnTo, router],
  );

  const handleFrame = useCallback(
    (raw: string) => {
      // Try the cheap single-frame path first; multipart only kicks in
      // when the QR doesn't decode standalone.
      const single = tryDecodeAdminQrFrame(raw);
      if (single?.kind === "v2-ur") {
        void stopScanner();
        void acceptV2(single.payload);
        return;
      }
      if (single?.kind === "v1-json") {
        void stopScanner();
        setScanState({ kind: "decoded-v1", payload: single.payload });
        return;
      }
      const multi = accumulatorRef.current.receive(raw);
      if (multi?.kind === "v2-ur") {
        void stopScanner();
        void acceptV2(multi.payload);
        return;
      }
      if (multi?.kind === "v1-json") {
        void stopScanner();
        setScanState({ kind: "decoded-v1", payload: multi.payload });
      }
    },
    [acceptV2, stopScanner],
  );

  const startScanning = useCallback(async () => {
    cancelStartRef.current = false;
    setScanState({ kind: "requesting-permission" });

    // Host permission gate: inside a Polkadot host iframe, getUserMedia stays
    // blocked until the host grants the product camera access. This flips
    // `allow="camera"` before the WASM backend touches getUserMedia.
    const hostPermission = await resolveHostCameraPermission();
    if (cancelStartRef.current) return;
    if (hostPermission.kind === "denied") {
      setScanState({ kind: "permission-denied", source: "host" });
      return;
    }

    // Cheap synchronous guards before mounting the viewfinder. We no longer
    // pre-flight getUserMedia here: the WASM backend classifies real
    // acquisition failures into typed ScannerError codes (unlike html5-qrcode,
    // which flattened them to a string), and that extra open/close was itself a
    // source of the post-stop camera-busy race the backend now rides out.
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setScanState({
        kind: "error",
        message:
          "This browser does not expose a camera API. Try Chrome, Safari, or Firefox on a device with a camera.",
      });
      return;
    }
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      setScanState({
        kind: "error",
        message:
          "Camera access requires HTTPS (or localhost). The page is loaded over an insecure context.",
      });
      return;
    }

    // Fresh accumulator per attempt — stale fragments from an earlier session
    // could otherwise corrupt the multipart fountain decode.
    accumulatorRef.current = createAdminQrScanAccumulator();
    setScanState({ kind: "scanning" });
    // Yield once so React flushes the render that mounts the scan host before
    // the backend appends its <video> into it.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    if (cancelStartRef.current) return;

    const host = scanHostRef.current;
    if (!host) {
      setScanState({ kind: "error", message: "Scanner failed to mount. Try again." });
      return;
    }

    // Transparent auto-retry on transient "camera unavailable" (the OS still
    // holding the camera from a prior scan). The backend's own busy-window
    // back-off covers the common iOS WKWebView async-release race; these outer
    // retries cover the longer-tail case where the OS holds the camera for a
    // few extra seconds (scan → confirm → scan-again in quick succession).
    const MAX_CAMERA_UNAVAILABLE_RETRIES = 5;
    const RETRY_DELAY_MS = 800;
    for (
      let attempt = 0;
      attempt <= MAX_CAMERA_UNAVAILABLE_RETRIES && !cancelStartRef.current;
      attempt += 1
    ) {
      try {
        const handle = await startZxingWasmScanner(host, {
          onDecoded: (text) => handleFrame(text),
          onError: (err) => {
            if (err.code === "permissionDenied") {
              setScanState({ kind: "permission-denied", source: "browser" });
            }
          },
        });
        if (cancelStartRef.current) {
          await handle.stop();
          return;
        }
        scannerRef.current = handle;
        return;
      } catch (caught) {
        if (cancelStartRef.current) return;
        const isScannerErr = caught instanceof ScannerError;

        // Permission denial is terminal — re-prompting won't help.
        if (isScannerErr && caught.code === "permissionDenied") {
          setScanState({ kind: "permission-denied", source: "browser" });
          return;
        }

        // `cameraUnavailable` is usually the OS still holding the camera from
        // the previous scan; the busy window almost always clears within a few
        // seconds without any user action.
        if (
          isScannerErr &&
          caught.code === "cameraUnavailable" &&
          attempt < MAX_CAMERA_UNAVAILABLE_RETRIES
        ) {
          console.info(
            `[t3rminal/scanner] cameraUnavailable on attempt ${attempt + 1}; auto-retrying in ${RETRY_DELAY_MS}ms`,
          );
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, RETRY_DELAY_MS),
          );
          continue;
        }

        // Any other failure, or cameraUnavailable after exhausting retries.
        setScanState({
          kind: "error",
          message: caught instanceof Error ? caught.message : String(caught),
        });
        return;
      }
    }
  }, [handleFrame]);

  const reset = useCallback(() => {
    void stopScanner();
    setScanState({ kind: "idle" });
  }, [stopScanner]);

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-neutral-800">
        <Link href="/" className="text-neutral-400 hover:text-white" aria-label="Back to home">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-lg font-semibold">Scan admin config</h1>
      </header>

      <main className="px-5 py-6 space-y-6 max-w-md mx-auto">
        {scanState.kind === "idle" || scanState.kind === "error" ? (
          <section className="space-y-3">
            <p className="text-sm text-neutral-400">
              Point the camera at the QR generated by the W3sPay admin to see
              every field encoded in the payload. This is a read-only
              inspector — nothing is saved on the terminal.
            </p>
            <button
              type="button"
              onClick={startScanning}
              className="w-full flex items-center justify-center gap-2 bg-white text-black font-semibold py-3 rounded-xl"
            >
              <ScanLine className="w-5 h-5" /> Start camera scan
            </button>
            {scanState.kind === "error" ? (
              <div className="flex items-start gap-2 text-sm text-amber-300">
                <AlertTriangle className="w-4 h-4 mt-0.5" />
                <span>{scanState.message}</span>
              </div>
            ) : null}
          </section>
        ) : null}

        {scanState.kind === "scanning" ? (
          <section className="space-y-3">
            <div className="rounded-xl overflow-hidden border border-neutral-800 bg-black">
              <div ref={scanHostRef} className="w-full aspect-square" />
            </div>
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Camera className="w-4 h-4" /> Hold the QR in the frame…
            </div>
            <button
              type="button"
              onClick={reset}
              className="w-full border border-neutral-700 text-neutral-200 py-3 rounded-xl"
            >
              Cancel
            </button>
          </section>
        ) : null}

        {scanState.kind === "requesting-permission" ? (
          <section className="space-y-3">
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-300 flex items-center gap-2">
              <Camera className="w-4 h-4 shrink-0 animate-pulse" />
              <span>Allow camera access in the prompt to start the scan…</span>
            </div>
          </section>
        ) : null}

        {scanState.kind === "permission-denied" ? (
          <section className="space-y-3">
            <div className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="space-y-2">
                  <p className="font-medium">Camera permission denied.</p>
                  {scanState.source === "host" ? (
                    <p>
                      The Polkadot host has not granted camera access to this
                      product. Open the host permission settings, allow Camera,
                      then tap <span className="font-semibold">Try again</span>.
                    </p>
                  ) : (
                    <>
                      <p>
                        The browser will not re-prompt until you re-enable camera
                        access for this site. After granting it, tap{" "}
                        <span className="font-semibold">Try again</span>.
                      </p>
                      <ul className="list-disc pl-5 space-y-1 text-amber-200/90">
                        <li>
                          Chrome / Edge: tap the camera (or lock) icon in the
                          address bar → set Camera to <em>Allow</em> → reload.
                        </li>
                        <li>
                          Safari (iOS): open <em>Settings → Safari → Camera</em>{" "}
                          and set this site to <em>Allow</em>.
                        </li>
                        <li>
                          Safari (macOS): <em>Safari → Settings for This Website
                          → Camera → Allow</em>, then reload.
                        </li>
                        <li>
                          Firefox: tap the lock icon → <em>Clear permissions</em>{" "}
                          and reload, then tap Try again.
                        </li>
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={startScanning}
              className="w-full bg-white text-black font-semibold py-3 rounded-xl"
            >
              Try again
            </button>
          </section>
        ) : null}

        {scanState.kind === "decoded-v2" ? (
          <DecodedV2View payload={scanState.payload} onScanAgain={reset} />
        ) : null}

        {scanState.kind === "decoded-v1" ? (
          <DecodedV1View payload={scanState.payload} onScanAgain={reset} />
        ) : null}
      </main>
    </div>
  );
}

/* ── field-display components ─────────────────────────────────────── */

interface DecodedV2ViewProps {
  readonly payload: T3rminalConfigQrPayloadV2;
  readonly onScanAgain: () => void;
}

function DecodedV2View({ payload, onScanAgain }: DecodedV2ViewProps) {
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-green-700/60 bg-green-950/30 p-4">
        <div className="flex items-center gap-2 text-green-300 text-sm font-medium">
          <CheckCircle2 className="w-4 h-4" /> v2 UR payload decoded
        </div>
      </div>

      <FieldGroup title="Merchant">
        <Field label="Display name" value={payload.displayName} />
        <Field label="Merchant id" value={payload.merchantId} mono />
        <Field label="Merchant key" value={payload.merchantKey} mono />
        <Field label="Receiving address" value={payload.receivingAddress} mono />
      </FieldGroup>

      <FieldGroup title="Terminal">
        <Field label="Terminal id" value={payload.terminalId} mono />
        <Field label="Issued at" value={payload.issuedAt} />
      </FieldGroup>

      <FieldGroup title="Report password">
        <Field label="Scheme" value={payload.passwordScheme} />
        <Field label="Password" value={payload.reportPassword} mono />
      </FieldGroup>

      <FieldGroup title={`Item config — ${payload.config.name}`}>
        <Field label="Config id" value={payload.config.id} mono />
        <Field label="Updated at" value={payload.config.updatedAt} />
        <Field
          label="Price decimals"
          value={String(payload.priceDecimals)}
        />
        <Field
          label="Item count"
          value={String(payload.config.items.length)}
        />
      </FieldGroup>

      <FieldGroup title="Items">
        {payload.config.items.length === 0 ? (
          <p className="text-sm text-neutral-500">No items in this config.</p>
        ) : (
          <ul className="space-y-2">
            {payload.config.items.map((item) => (
              <ItemRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </FieldGroup>

      <button
        type="button"
        onClick={onScanAgain}
        className="w-full border border-neutral-700 text-neutral-200 py-3 rounded-xl"
      >
        Scan another QR
      </button>
    </section>
  );
}

interface DecodedV1ViewProps {
  readonly payload: T3rminalConfigQrPayloadV1;
  readonly onScanAgain: () => void;
}

function DecodedV1View({ payload, onScanAgain }: DecodedV1ViewProps) {
  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-amber-700/60 bg-amber-950/30 p-4 text-sm text-amber-200 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5" />
        <span>
          Legacy v1 JSON QR detected. v1 only carries a pointer to the item
          config (CID), not the items themselves — the fields below are all
          that the QR encodes.
        </span>
      </div>

      <FieldGroup title="Merchant">
        <Field label="Display name" value={payload.displayName} />
        <Field label="Merchant id" value={payload.merchantId} mono />
        <Field label="Merchant key" value={payload.merchantKey} mono />
        <Field label="Receiving address" value={payload.receivingAddress} mono />
      </FieldGroup>

      <FieldGroup title="Terminal">
        <Field label="Terminal id" value={payload.terminalId} mono />
        <Field label="Issued at" value={payload.issuedAt} />
      </FieldGroup>

      <FieldGroup title="Report password">
        <Field label="Scheme" value={payload.passwordScheme} />
        <Field label="Password" value={payload.reportPassword} mono />
      </FieldGroup>

      <FieldGroup title="Item config pointer">
        <Field label="Config id" value={payload.itemConfigId} mono />
        <Field label="Config CID" value={payload.itemConfigCid} mono />
        <Field label="Registry address" value={payload.registryAddress} mono />
      </FieldGroup>

      <button
        type="button"
        onClick={onScanAgain}
        className="w-full border border-neutral-700 text-neutral-200 py-3 rounded-xl"
      >
        Scan another QR
      </button>
    </section>
  );
}

interface FieldGroupProps {
  readonly title: string;
  readonly children: React.ReactNode;
}

function FieldGroup({ title, children }: FieldGroupProps) {
  return (
    <div className="space-y-2">
      <h2 className="text-xs uppercase tracking-wider text-neutral-500">{title}</h2>
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-2">
        {children}
      </div>
    </div>
  );
}

interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}

function Field({ label, value, mono }: FieldProps) {
  return (
    <div className="text-sm">
      <div className="text-neutral-500">{label}</div>
      <div
        className={`text-neutral-200 break-all ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function ItemRow({ item }: { readonly item: QrItem }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-neutral-800 last:border-b-0 pb-2 last:pb-0">
      <div className="min-w-0">
        <div className="text-neutral-200 text-sm truncate">{item.name}</div>
        <div className="text-neutral-500 text-[11px] font-mono break-all">
          {item.id}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-neutral-200 text-sm tabular-nums">
          {item.price}
        </div>
        <div className="text-neutral-500 text-[11px] font-mono">
          {item.pricePlancks} plancks
        </div>
      </div>
    </li>
  );
}
