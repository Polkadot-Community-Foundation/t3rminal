/**
 * Host environment detection — thin wrapper around `@parity/product-sdk/host`.
 *
 * We delegate to the SDK rather than maintaining our own iframe / webview-mark
 * heuristics so t3rminal stays consistent with merchant-terminal and w3spay
 * (both use the same SDK detection) and picks up additional signals like
 * `__HOST_API_PORT__` and the product-sdk sandbox handshake.
 *
 * The `HostEnvironment` distinction (desktop-webview vs web-iframe vs
 * standalone) is kept locally because the SDK only exposes a boolean.
 */

import { isInsideContainerSync } from "@parity/product-sdk/host"

export type HostEnvironment = "desktop-webview" | "web-iframe" | "standalone"

export function detectHostEnvironment(): HostEnvironment {
  if (typeof window === "undefined") return "standalone"

  if (!isInsideContainerSync()) return "standalone"

  // Inside a container — disambiguate desktop webview vs web iframe.
  if ((window as { __HOST_WEBVIEW_MARK__?: boolean }).__HOST_WEBVIEW_MARK__ === true) {
    return "desktop-webview"
  }
  return "web-iframe"
}

export function isInHost(): boolean {
  return isInsideContainerSync()
}

/**
 * Async variant — also performs the product-sdk sandbox handshake. Use this
 * when you can afford an await and need the strongest detection (e.g., during
 * app boot before triggering host-only flows).
 */
export { isInsideContainer as isInHostAsync } from "@parity/product-sdk/host"
