/**
 * Reads the synthetic-traffic tag that the Playwright suite injects at runtime
 * (see e2e/fixtures.ts). A static-export build bakes NEXT_PUBLIC_* at build
 * time, so the tag must be a runtime window flag, not an env var.
 */

declare global {
  interface Window {
    __T3RMINAL_E2E_TAG?: string;
  }
}

export function getE2eTag(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const tag = window.__T3RMINAL_E2E_TAG;
  return typeof tag === "string" && tag.length > 0 ? tag : undefined;
}
