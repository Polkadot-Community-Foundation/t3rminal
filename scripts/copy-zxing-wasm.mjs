#!/usr/bin/env node
/**
 * Stage the ZXing reader `.wasm` into `public/` so the QR scanner can load
 * it from the deployment's own origin instead of the default jsDelivr CDN.
 *
 * Why bundle it ourselves:
 *   - The terminal runs inside a Polkadot host iframe whose CSP can block a
 *     third-party CDN fetch, and a point-of-sale device must not depend on
 *     reaching `cdn.jsdelivr.net` mid-scan. Serving the binary from our own
 *     `public/` keeps the fetch same-origin (see `lib/scan/zxing-wasm-worker.ts`,
 *     which points zxing-wasm's `locateFile` at `/zxing_reader.wasm`).
 *   - Vite can do `import wasmUrl from "...wasm?url"`; Next/Turbopack can't, so
 *     we copy the asset explicitly and let `output: 'export'` ship `public/`
 *     into `out/` at the deployment root.
 *
 * This runs from `predev` / `prebuild` / `preexport` (same lifecycle slot as the
 * PAPI descriptor generation), so the copied file is a build artifact and is
 * git-ignored. The source is resolved through node's package resolver so it
 * always matches the installed `zxing-wasm` version — the README warns the
 * `.wasm` MUST match the library version, and resolving (instead of pinning a
 * path) makes a version bump copy the right binary automatically.
 */
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, "..");
const DEST = resolve(APP_ROOT, "public", "zxing_reader.wasm");

function sizeOf(path) {
  try {
    return statSync(path).size;
  } catch {
    return -1;
  }
}

let src;
try {
  // Honors zxing-wasm's package `exports` → dist/reader/zxing_reader.wasm,
  // resolved from this script upward so npm-workspace hoisting doesn't matter.
  src = require.resolve("zxing-wasm/reader/zxing_reader.wasm");
} catch (error) {
  console.error(
    "[copy-zxing-wasm] could not resolve zxing-wasm/reader/zxing_reader.wasm. " +
      "Is `zxing-wasm` installed? Run `npm install`.",
  );
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// Skip the copy when the destination already matches by size — keeps `next dev`
// fast and avoids needless file churn on every restart.
if (sizeOf(src) === sizeOf(DEST)) {
  console.log("[copy-zxing-wasm] public/zxing_reader.wasm is up to date");
  process.exit(0);
}

mkdirSync(dirname(DEST), { recursive: true });
copyFileSync(src, DEST);
console.log(`[copy-zxing-wasm] copied ${src} -> ${DEST}`);
