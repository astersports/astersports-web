/**
 * A1-EVAL metrics (PHASE A1-EVAL).
 *
 * Pure functions over raw RGBA buffers — no I/O, fully unit-testable.
 *
 * Set definition (op-agnostic): the harness splits pixels by the SOURCE color's
 * perceptual distance to `fromColor`, NOT by whether the op changed them — so it
 * can measure bleed (off-target pixels that changed) independently of the op.
 * Three bands by source distance to fromColor, plus the fabric/background split:
 *   - target        = fabric & ΔE2000(s, fromColor) <= near        (the separation)
 *   - excluded band = fabric & near < ΔE2000 <= far                (the op's intended
 *                     soft antialiased edge — scored by NEITHER metric)
 *   - off-target    = (fabric & ΔE2000 > far)  OR  background
 *
 * off-target is split because only one half is raster-fixable:
 *   - offTargetBackgroundDeltaE (membership==0): bleed into pixels a precise
 *     fabric mask would exclude. THIS drives RASTER-NEEDED (the D1 signal).
 *   - offTargetFabricDeltaE (fabric & far): a nearby separation getting pulled
 *     (e.g. pink dragging the red rims). A mask cannot fix this — both are inside
 *     the fabric. It's an OP-TUNING signal (reduce radius at high coverage).
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
  /** Mean ΔE2000 (source vs out) over background pixels. Raster signal -> RASTER-NEEDED. */
  offTargetBackgroundDeltaE: number;
  /** Mean ΔE2000 (source vs out) over far-from-source fabric pixels. Op-tuning signal. */
  offTargetFabricDeltaE: number;
  targetCount: number;
  /** Pixels in the excluded soft-edge band (diagnostic). */
  bandCount: number;
  offBackgroundCount: number;
  offFabricCount: number;
  fabricCount: number;
}

export interface MetricThresholds {
  /** ΔE2000 radius around fromColor that counts a source pixel as "the target separation". */
  near?: number;
  /** ΔE2000 above which a fabric pixel is a distinct separation (beyond the op's soft reach). */
  far?: number;
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
  const far = thresholds.far ?? 40;
  const fromLab = hexToLab(fromColor);
  const toLab = hexToLab(toColor);

  let targetSum = 0, targetCount = 0;
  let bandCount = 0;
  let offBgSum = 0, offBgCount = 0;
  let offFabSum = 0, offFabCount = 0;
  let fabricCount = 0;
  const srcL: number[] = [];
  const outL: number[] = [];

  const n = width * height;
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const s = rgb255ToLab(source[p], source[p + 1], source[p + 2]);
    const o = rgb255ToLab(out[p], out[p + 1], out[p + 2]);
    const inFabric = membership[i] === 1;

    if (inFabric) {
      fabricCount++;
      const dFrom = deltaE2000(s, fromLab);
      if (dFrom <= near) {
        // Target separation: measure chroma/hue match at the pixel's own L.
        targetSum += deltaE2000({ l: o.l, a: o.a, b: o.b }, { l: o.l, a: toLab.a, b: toLab.b });
        targetCount++;
        srcL.push(s.l);
        outL.push(o.l);
      } else if (dFrom <= far) {
        // Intended soft-edge band — the op antialiases here. Score nothing.
        bandCount++;
      } else {
        // Distinct separation inside the fabric — nearby-separation pull (op-tuning).
        offFabSum += deltaE2000(s, o);
        offFabCount++;
      }
    } else {
      // Background — a precise fabric mask would exclude it (raster signal).
      offBgSum += deltaE2000(s, o);
      offBgCount++;
    }
  }

  return {
    targetDeltaE: targetCount > 0 ? targetSum / targetCount : 0,
    lumSSIM: ssim(srcL, outL),
    offTargetBackgroundDeltaE: offBgCount > 0 ? offBgSum / offBgCount : 0,
    offTargetFabricDeltaE: offFabCount > 0 ? offFabSum / offFabCount : 0,
    targetCount,
    bandCount,
    offBackgroundCount: offBgCount,
    offFabricCount: offFabCount,
    fabricCount,
  };
}

/**
 * A1 acceptance verdict per the spec thresholds.
 * - offBackgroundPass: raster-fixable bleed -> drives RASTER-NEEDED.
 * - offFabricPass: nearby-separation pull -> op-tuning (reduce radius), NOT raster.
 */
export function verdict(m: RecolorMetrics): {
  targetPass: boolean;
  lumPass: boolean;
  offBackgroundPass: boolean;
  offFabricPass: boolean;
  pass: boolean;
} {
  const targetPass = m.targetDeltaE <= 5;
  const lumPass = m.lumSSIM >= 0.95;
  const offBackgroundPass = m.offTargetBackgroundDeltaE <= 2;
  const offFabricPass = m.offTargetFabricDeltaE <= 2;
  return {
    targetPass,
    lumPass,
    offBackgroundPass,
    offFabricPass,
    pass: targetPass && lumPass && offBackgroundPass && offFabricPass,
  };
}
