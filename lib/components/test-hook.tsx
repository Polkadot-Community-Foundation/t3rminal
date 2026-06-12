"use client";

/**
 * Exposes `window.__T3R_TEST__` with the same two functions
 * `scan-config/page.tsx` calls after a successful camera decode:
 *
 *   - `tryDecodeAdminQrFrame(rawUrString)` → DecodedT3rminalConfigQr | null
 *   - `importAdminQrConfig(payload, rawUrString)` → Promise<void>
 *
 * Lets end-to-end suites (e.g. triangle-e2e's `t3rminal-android` Playwright
 * project) seed an admin-config without driving a real camera — a path
 * that doesn't work on the Android emulator today (the virtualscene image
 * swap is broken, Android WebView ignores Chromium's fake-device flag,
 * and the in-WebView getUserMedia override trips on the browse-tab's
 * duplicate-click reentrancy).
 *
 * Tests target the deployed `t3rminal.dot` bundle directly; the hook
 * lives in every build so the test surface and the prod surface are the
 * same. Surface is intentionally tiny — only the two functions the
 * scan-config page calls. Anything added here is a new test-driven entry
 * point and should be a deliberate review decision.
 *
 * Usage:
 *   const { tryDecodeAdminQrFrame, importAdminQrConfig } = window.__T3R_TEST__!;
 *   const decoded = tryDecodeAdminQrFrame(rawUrString);
 *   if (decoded?.kind === "v2-ur") {
 *     await importAdminQrConfig(decoded.payload, rawUrString);
 *   }
 */

import { useEffect } from "react";

import {
  importAdminQrConfig,
  tryDecodeAdminQrFrame,
} from "@/lib/config/admin-qr";

declare global {
  interface Window {
    __T3R_TEST__?: {
      version: number;
      importAdminQrConfig: typeof importAdminQrConfig;
      tryDecodeAdminQrFrame: typeof tryDecodeAdminQrFrame;
    };
  }
}

export function TestHook() {
  useEffect(() => {
    window.__T3R_TEST__ = {
      version: 1,
      importAdminQrConfig,
      tryDecodeAdminQrFrame,
    };
    return () => {
      delete window.__T3R_TEST__;
    };
  }, []);
  return null;
}
