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

  it("fills the gap BETWEEN motif clusters so redistribution can spread evenly", () => {
    // two clusters separated by a wide bare gap — the hull must bridge them
    const left = [motif(25, 60, 4), motif(30, 50, 4), motif(30, 70, 4)];
    const right = [motif(95, 60, 4), motif(90, 50, 4), motif(90, 70, 4)];
    const sil = garmentSilhouetteFromInstances([...left, ...right], W, H)!;
    expect(sil).not.toBeNull();
    expect(on(sil, 60, 60)).toBe(true); // the gap between the clusters is inside the silhouette
  });

  it("excludes regions outside the motif span (e.g. background corners)", () => {
    const cluster = [motif(55, 55, 4), motif(65, 55, 4), motif(55, 65, 4), motif(65, 65, 4)];
    const sil = garmentSilhouetteFromInstances(cluster, W, H)!;
    expect(on(sil, 60, 60)).toBe(true);   // inside the motif span
    expect(on(sil, 5, 5)).toBe(false);    // far corner, outside the hull
    expect(on(sil, 115, 10)).toBe(false); // far corner, outside the hull
  });
});
