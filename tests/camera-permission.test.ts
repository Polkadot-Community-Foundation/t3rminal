import { describe, expect, it } from "vitest";

import {
  resolveHostCameraPermission,
  type RequestCameraPermission,
} from "@/lib/host/camera-permission";

function hostResponse(granted: boolean): RequestCameraPermission {
  return () => ({
    match: async <Ok, Err>(ok: (granted: boolean) => Ok): Promise<Ok | Err> =>
      ok(granted),
  });
}

function hostUnavailable(): RequestCameraPermission {
  return () => ({
    match: async <Ok, Err>(
      _ok: (granted: boolean) => Ok,
      err: (err: unknown) => Err,
    ): Promise<Ok | Err> => err(new Error("no host transport")),
  });
}

describe("resolveHostCameraPermission", () => {
  it("requests the host Camera permission", async () => {
    let requested: string | null = null;
    const request: RequestCameraPermission = (permission) => {
      requested = permission;
      return hostResponse(true)(permission);
    };

    await resolveHostCameraPermission(request);

    expect(requested).toBe("Camera");
  });

  it("maps a granted host result to granted", async () => {
    await expect(resolveHostCameraPermission(hostResponse(true))).resolves.toEqual({
      kind: "granted",
    });
  });

  it("maps a denied host result to denied", async () => {
    await expect(resolveHostCameraPermission(hostResponse(false))).resolves.toEqual({
      kind: "denied",
    });
  });

  it("lets standalone browsers fall through to native getUserMedia", async () => {
    await expect(resolveHostCameraPermission(hostUnavailable())).resolves.toEqual({
      kind: "no-host",
    });
  });
});
