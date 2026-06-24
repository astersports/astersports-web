/**
 * garmentSilhouetteFromInstances — the instance-derived garment outline that
 * densityRedistribute (v2) uses for layout + clip, replacing SAM2's combined_mask
 * (which unions background segments and let motifs land off-garment).
 *
 * It morphologically CLOSES the motif union: bridges the gaps BETWEEN clusters (even
 * spread, not bunched) while leaving the OPEN backdrop beside the garment excluded
 * (keeps survivors on the garment — the convex-hull failure mode), and drops strays.
 */
import { describe, it, expect } from "vitest";
import { garmentSilhouetteFromInstances } from "./_core/studio/ops/garmentSilhouette";
import type { InstanceMask, RasterMask } from "./_core/masking/types";

const W = 200, H = 200;

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

  it("bridges the gap BETWEEN nearby motif clusters so redistribution spreads evenly", () => {
    // two clusters with a modest bare gap — the close must bridge them into one region
    const a = [motif(70, 100, 4), motif(80, 90, 4), motif(80, 110, 4)];
    const b = [motif(130, 100, 4), motif(120, 90, 4), motif(120, 110, 4)];
    const sil = garmentSilhouetteFromInstances([...a, ...b], W, H)!;
    expect(sil).not.toBeNull();
    expect(on(sil, 100, 100)).toBe(true); // the bridged gap between clusters is inside the silhouette
  });

  it("excludes the open backdrop far from any motif", () => {
    const cluster = [motif(95, 95, 4), motif(105, 95, 4), motif(95, 105, 4), motif(105, 105, 4)];
    const sil = garmentSilhouetteFromInstances(cluster, W, H)!;
    expect(on(sil, 100, 100)).toBe(true); // inside the print region
    expect(on(sil, 10, 10)).toBe(false);  // far backdrop corner, excluded
    expect(on(sil, 190, 10)).toBe(false); // far backdrop corner, excluded
  });

  it("drops a far-flung stray detection (keeps the largest component)", () => {
    // a solid 3x3 cluster (clearly the largest region) plus one isolated stray
    const cluster: InstanceMask[] = [];
    for (const cy of [85, 100, 115]) for (const cx of [85, 100, 115]) cluster.push(motif(cx, cy, 4));
    const stray = motif(160, 40, 3); // isolated, away from the borders, far beyond the close bridge
    const sil = garmentSilhouetteFromInstances([...cluster, stray], W, H)!;
    expect(on(sil, 100, 100)).toBe(true); // garment cluster kept
    expect(on(sil, 160, 40)).toBe(false); // off-garment stray dropped
  });
});
