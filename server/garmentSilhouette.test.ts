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
import { garmentSilhouetteFromInstances, garmentMaskFromImage } from "./_core/studio/ops/garmentSilhouette";
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

  it("drops a far-flung stray detection (below the substantial-region threshold)", () => {
    // a solid 3x3 cluster (clearly the largest region) plus one isolated stray (~3% of it)
    const cluster: InstanceMask[] = [];
    for (const cy of [85, 100, 115]) for (const cx of [85, 100, 115]) cluster.push(motif(cx, cy, 4));
    const stray = motif(160, 40, 3); // isolated, away from the borders, far beyond the close bridge
    const sil = garmentSilhouetteFromInstances([...cluster, stray], W, H)!;
    expect(on(sil, 100, 100)).toBe(true); // garment cluster kept
    expect(on(sil, 160, 40)).toBe(false); // off-garment stray dropped
  });

  it("keeps SEPARATE substantial print regions (e.g. a blazer body + sleeve), not just the largest", () => {
    // big "body" cluster (4x4) + a smaller, well-separated "sleeve" cluster (2x2). The
    // gap exceeds the close bridge, so they stay separate components; the sleeve is ~20%
    // of the body, above the 10% keep threshold, so it must NOT be dropped as non-largest.
    const body: InstanceMask[] = [];
    for (const cy of [85, 97, 109, 121]) for (const cx of [50, 62, 74, 86]) body.push(motif(cx, cy, 5));
    const sleeve = [motif(160, 97, 5), motif(172, 97, 5), motif(160, 109, 5), motif(172, 109, 5)];
    const sil = garmentSilhouetteFromInstances([...body, ...sleeve], W, H)!;
    expect(on(sil, 68, 103)).toBe(true);  // body region kept
    expect(on(sil, 166, 103)).toBe(true); // separate sleeve region ALSO kept
  });
});

describe("garmentMaskFromImage (border background removal)", () => {
  const rgba = (r: number, g: number, b: number): Buffer => {
    const buf = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) { const p = i * 4; buf[p] = r; buf[p + 1] = g; buf[p + 2] = b; buf[p + 3] = 255; }
    return buf;
  };

  it("keeps the central garment and excludes the plain backdrop corners", () => {
    const buf = rgba(220, 220, 220); // light backdrop
    for (let y = 60; y < 140; y++) for (let x = 60; x < 140; x++) { const p = (y * W + x) * 4; buf[p] = 30; buf[p + 1] = 30; buf[p + 2] = 30; } // dark garment
    const m = garmentMaskFromImage(buf, W, H)!;
    expect(m).not.toBeNull();
    expect(m.data[100 * W + 100] > 127).toBe(true);  // garment centre
    expect(m.data[10 * W + 10] > 127).toBe(false);   // backdrop corner excluded
  });

  it("returns null for a uniform image (no separable backdrop -> caller keeps the silhouette)", () => {
    expect(garmentMaskFromImage(rgba(200, 200, 200), W, H)).toBeNull();
  });
});
