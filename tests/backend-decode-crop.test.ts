/**
 * Unit tests for `computeDecodeCrop` — the centered-square ROI math the WASM
 * decode loop feeds ZXing.
 *
 * The scanner crops a centered square out of the (usually widescreen) camera
 * frame, then downscales it to a canvas capped at `DECODE_CANVAS_CAP` (2048px)
 * before handing it to the worker. Getting the centering or the cap wrong shows
 * up as "QR in view but never decodes", so the geometry is worth pinning.
 */

import { describe, expect, it } from "vitest";

import { computeDecodeCrop } from "@/lib/scan/backend-zxing-wasm";

describe("computeDecodeCrop", () => {
  it("centers a full-scale square crop on a landscape frame", () => {
    // 1920x1080, scale 1 → square is the 1080 short side, centered horizontally.
    expect(computeDecodeCrop(1920, 1080, 1)).toEqual({
      sx: 420,
      sy: 0,
      sourceSide: 1080,
      targetSide: 1080,
    });
  });

  it("centers the crop vertically on a portrait frame", () => {
    expect(computeDecodeCrop(1080, 1920, 1)).toEqual({
      sx: 0,
      sy: 420,
      sourceSide: 1080,
      targetSide: 1080,
    });
  });

  it("shrinks and recenters for a sub-1 source scale (center-82 region)", () => {
    // round(1080 * 0.82) = 886; centered in 1920x1080.
    expect(computeDecodeCrop(1920, 1080, 0.82)).toEqual({
      sx: 517,
      sy: 97,
      sourceSide: 886,
      targetSide: 886,
    });
  });

  it("caps the decode canvas at DECODE_CANVAS_CAP while keeping the source square", () => {
    // 4096px square source is captured at full source size but downscaled to the
    // 2048 cap for the canvas handed to ZXing.
    expect(computeDecodeCrop(4096, 4096, 1)).toEqual({
      sx: 0,
      sy: 0,
      sourceSide: 4096,
      targetSide: 2048,
    });
  });

  it("honors an explicit canvasCap override", () => {
    expect(computeDecodeCrop(1000, 1000, 1, 512)).toEqual({
      sx: 0,
      sy: 0,
      sourceSide: 1000,
      targetSide: 512,
    });
  });

  it("never produces a zero-width source square", () => {
    // A degenerate scale must still yield at least a 1px source side so the
    // canvas/getImageData calls downstream stay valid.
    expect(computeDecodeCrop(2, 2, 0.0001)).toMatchObject({
      sourceSide: 1,
      targetSide: 1,
    });
  });
});
