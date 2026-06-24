/**
 * garmentSilhouetteFromInstances — the instance-derived garment outline that
 * densityRedistribute (v2) uses for layout + clip, replacing SAM2's combined_mask
 * (which unions background segments and let motifs land off-garment).
 */
import { describe, it, expect } from "vitest";
import { garmentSilhouetteFromInstances } from "./_core/studio/ops/garmentSilhouette";
import type { InstanceMask, RasterMask } from "./_core/masking/types";

const W = 120, H = 120;

/** A filled square motif of half-size `r` centred at (cx,cy), as a full-dim raster instance. */
function motif(cx: number, cy: number, r: number): InstanceMask {
  const data = new Uint8Array(W * H);
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if (x >= 0 && x < W && y >= 0 && y < H) data[y * W + x] = 255;
  return {
    bbox: { x: (cx - r) / W, y: (cy - r) / H, w: (2 * r + 1) / W, h: (2 * r + 1) / H },
    raster: { width: W, height: H, data },
  };
}
const on = (m: RasterMask, x: number, y: number) => m.data[y * W + x] > 127;

describe("garmentSilhouetteFromInstances", () => {
  it("returns null when there are no instances", () => {
    expect(garmentSilhouetteFromInstances([], W, H)).toBeNull();
  });

  it("returns null for zero-area dimensions", () => {
    expect(garmentSilhouetteFromInstances([motif(50, 50, 4)], 0, H)).toBeNull();
  });

  it("bridges a ring of motifs into one solid region (interior gap filled)", () => {
    // four motifs around an empty centre — the centre is bare ground, not a motif
    const insts = [motif(50, 50, 4), motif(70, 50, 4), motif(50, 70, 4), motif(70, 70, 4)];
    const sil = garmentSilhouetteFromInstances(insts, W, H)!;
    expect(sil).not.toBeNull();
    expect(on(sil, 60, 60)).toBe(true); // enclosed bare-ground gap is inside the silhouette
    expect(on(sil, 5, 5)).toBe(false);  // a far corner with no motifs is excluded
  });

  it("drops a far-flung stray detection (keeps only the largest component)", () => {
    const cluster = [motif(55, 55, 4), motif(65, 55, 4), motif(55, 65, 4), motif(65, 65, 4), motif(60, 60, 4)];
    const stray = motif(8, 8, 2); // far corner, beyond the close bridge
    const sil = garmentSilhouetteFromInstances([...cluster, stray], W, H)!;
    expect(on(sil, 60, 60)).toBe(true); // garment cluster kept
    expect(on(sil, 8, 8)).toBe(false);  // off-garment stray dropped
  });
});
