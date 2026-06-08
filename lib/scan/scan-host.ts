/**
 * Guard that decides whether a scanner host element is a *live* surface worth
 * opening the camera for — or a detached/hidden node that should be left alone.
 *
 * ## The problem this solves
 *
 * An async camera start can resolve after its host element has already been
 * unmounted (fast cancel, route change) or while a copy of the screen is still
 * fading out inside an `aria-hidden="true"` subtree. On iOS/WKWebView a second
 * `getUserMedia` issued against such a node races the live one for the single
 * camera session and rejects with `NotReadableError` ("Could not start video
 * source"), bouncing the user to a camera-error screen even though the camera
 * came up fine.
 *
 * ## The rule
 *
 * A host is live, and we should open the camera, only when it is:
 *   - **connected** to the document (not a detached node left over from an
 *     unmount whose async start resolved late), and
 *   - **not inside an `aria-hidden="true"` subtree** (a decorative, fading-out
 *     ghost the user is no longer interacting with).
 *
 * We deliberately do NOT gate on the host's box size. A zero-size host is only
 * ever a layout bug, never the ghost-vs-live signal — and gating on it is a
 * footgun: a transiently-collapsed-but-live box (an `aspect-ratio` reflow timing
 * quirk) would make the guard silently refuse to start the camera and hang the
 * spinner. The WASM backend captures from the video's source dimensions, not
 * the rendered box, so it does not need a sized host anyway.
 */
export function isLiveScanHost(host: HTMLElement | null): host is HTMLElement {
  if (host == null) return false;
  if (!host.isConnected) return false;
  return host.closest('[aria-hidden="true"]') == null;
}
