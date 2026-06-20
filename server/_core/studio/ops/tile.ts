/**
 * Deterministic reflect (mirror) tiling. Repeats a patch to fill a target size,
 * flipping alternate columns/rows so tile boundaries reflect instead of producing
 * a hard seam. Used by scalePrintRepeat to refill the fabric bbox after a shrink.
 */
import sharp, { type OverlayOptions } from "sharp";

export async function mirrorTileToSize(
  patch: Buffer,
  pw: number,
  ph: number,
  targetW: number,
  targetH: number
): Promise<Buffer> {
  // Four oriented variants (patch is an encoded image buffer).
  const nn = patch;
  const hn = await sharp(patch).flop().toBuffer(); // horizontal mirror
  const nv = await sharp(patch).flip().toBuffer(); // vertical mirror
  const hv = await sharp(patch).flip().flop().toBuffer();

  // Tile onto an exact-multiple canvas (every tile fits), then crop to target.
  const cols = Math.ceil(targetW / pw);
  const rows = Math.ceil(targetH / ph);
  const composites: OverlayOptions[] = [];
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const input = gx % 2 ? (gy % 2 ? hv : hn) : gy % 2 ? nv : nn;
      composites.push({ input, left: gx * pw, top: gy * ph });
    }
  }
  return sharp({
    create: { width: cols * pw, height: rows * ph, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .extract({ left: 0, top: 0, width: targetW, height: targetH })
    .png()
    .toBuffer();
}
