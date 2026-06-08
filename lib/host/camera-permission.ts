/**
 * Host-side camera permission gate for scanner pages.
 *
 * In dot.li / host containers, `getUserMedia` is still blocked until the
 * host has granted the product iframe camera access. The product-sdk call is
 * what opens that host permission modal; browser `getUserMedia` can only run
 * after the host has either granted access or we are outside a host entirely.
 */

import { requestDevicePermission } from "@novasamatech/host-api-wrapper";

export type HostCameraPermissionOutcome =
  | { readonly kind: "granted" }
  | { readonly kind: "denied" }
  | { readonly kind: "no-host" };

export interface CameraPermissionRequestResult {
  match<Ok, Err>(
    ok: (granted: boolean) => Ok,
    err: (err: unknown) => Err,
  ): Promise<Ok | Err>;
}

export type RequestCameraPermission = (
  permission: "Camera",
) => CameraPermissionRequestResult;

export async function resolveHostCameraPermission(
  requestPermission: RequestCameraPermission = requestDevicePermission,
): Promise<HostCameraPermissionOutcome> {
  const result = await requestPermission("Camera").match(
    (granted) => ({ ok: true as const, granted }),
    () => ({ ok: false as const }),
  );

  if (!result.ok) return { kind: "no-host" };
  return result.granted ? { kind: "granted" } : { kind: "denied" };
}
