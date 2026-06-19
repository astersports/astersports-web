/**
 * A1-EVAL metrics (PHASE A1-EVAL).
 *
 * Pure functions over raw RGBA buffers — no I/O, fully unit-testable.
 *
 * Set definition (op-agnostic): the harness splits pixels by the SOURCE color's
 * perceptual distance to `fromColor`, NOT by whether the op changed them — so it
 * can measure bleed (off-target pixels that changed) independently of the op.
 *   - target set  = fabric pixels whose source is NEAR fromColor (ΔE2000 <= near)
 *   - off-target  = fabric pixels FAR from fromColor  +  all background pixels
 *
 * target metric is CHROMA/HUE at the pixel's OWN luminance (A1 preserves L by
 * design, so a flat ΔE to the target color would falsely fail correct output —
 * a navy rose keeps the rose's bright highlights).
 */
import { rgb255ToLab, hexToLab, deltaE2000 } from "../ops/color";

export interface RecolorMetrics {
  /** Mean ΔE2000 of the remapped separation vs the target, at each pixel's own L. */
  targetDeltaE: number;
  /** SSIM of the L channel (source vs out) over the target set. ~1.0 when L is held. */
  lumSSIM: number;
  /** Mean ΔE2000 (source vs out) over off-target + background. The bleed metric. */
  offTargetDeltaE: number;
  targetCount: number;
  offTargetCount: number;
  fabricCount: number;
}

export interface MetricThresholds {
  /** ΔE2000 radius around fromColor that counts a source pixel as "the target separation". */
  near?: number;
}

/** Single-window SSIM over two equal-length signals (L channel, range 0..100). */
export function ssim(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 1;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let vx = 0, vy = 0, cxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    vx += dx * dx; vy += dy * dy; cxy += dx * dy;
  }
  vx /= n; vy /= n; cxy /= n;
  const L = 100; // dynamic range of CIELAB L
  const c1 = (0.01 * L) ** 2;
  const c2 = (0.03 * L) ** 2;
  return ((2 * mx * my + c1) * (2 * cxy + c2)) / ((mx * mx + my * my + c1) * (vx + vy + c2));
}

export function computeRecolorMetrics(
  source: Buffer,
  out: Buffer,
  width: number,
  height: number,
  membership: Uint8Array,
  fromColor: string,
  toColor: string,
  thresholds: MetricThresholds = {}
): RecolorMetrics {
  const near = thresholds.near ?? 15;
  const fromLab = hexToLab(fromColor);
  const toLab = hexToLab(toColor);

  let targetSum = 0, targetCount = 0;
  let offSum = 0, offCount = 0;
  let fabricCount = 0;
  const srcL: number[] = [];
  const outL: number[] = [];

  const n = width * height;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const s = rgb255ToLab(source[p], source[p + 1], source[p + 2]);
    const o = rgb255ToLab(out[p], out[p + 1], out[p + 2]);
    const inFabric = membership[i] === 1;
    if (inFabric) fabricCount++;

    if (inFabric && deltaE2000(s, fromLab) <= near) {
      // Target separation: measure chroma/hue match at the pixel's own L.
      targetSum += deltaE2000({ l: o.l, a: o.a, b: o.b }, { l: o.l, a: toLab.a, b: toLab.b });
      targetCount++;
      srcL.push(s.l);
      outL.push(o.l);
    } else {
      // Off-target (far-from-source fabric) or background: any change here is bleed.
      offSum += deltaE2000(s, o);
      offCount++;
    }
  }

  return {
    targetDeltaE: targetCount > 0 ? targetSum / targetCount : 0,
    lumSSIM: ssim(srcL, outL),
    offTargetDeltaE: offCount > 0 ? offSum / offCount : 0,
    targetCount,
    offTargetCount: offCount,
    fabricCount,
  };
}

/** A1 acceptance verdict per the spec thresholds. */
export function verdict(m: RecolorMetrics): {
  targetPass: boolean;
  lumPass: boolean;
  offPass: boolean;
  pass: boolean;
} {
  const targetPass = m.targetDeltaE <= 5;
  const lumPass = m.lumSSIM >= 0.95;
  const offPass = m.offTargetDeltaE <= 2;
  return { targetPass, lumPass, offPass, pass: targetPass && lumPass && offPass };
}
