/**
 * A1-EVAL metrics (PHASE A1-EVAL).
 *
 * Pure functions over raw RGBA buffers — no I/O, fully unit-testable.
 *
 * Set definition:
 *   - target set  = pixels the op ACTUALLY REMAPPED (change-based: ΔE(source,out) > delta)
 *   - off-target background = background pixels (membership==0) — bleed into non-fabric
 *   - off-target fabric     = fabric pixels FAR from fromColor (ΔE2000 > far) — bleed
 *                             into other separations
 *   - near..far band        = excluded from off-target (transition zone)
 *
 * Target metric is CHROMA/HUE at the pixel's OWN luminance (A1 preserves L by
 * design, so a flat ΔE to the target color would falsely fail correct output —
 * a navy rose keeps the rose's bright highlights).
 *
 * Coverage-independent: because the target set is change-based, it measures only
 * what the op committed to remapping, not a fixed source-distance band.
 */
import { rgb255ToLab, hexToLab, deltaE2000 } from "../ops/color";

export interface RecolorMetrics {
  /** Mean ΔE2000 of the remapped separation vs the target, at each pixel's own L. */
  targetDeltaE: number;
  /** SSIM of the L channel (source vs out) over the target set. ~1.0 when L is held. */
  lumSSIM: number;
  /** Mean ΔE2000 (source vs out) over off-target background pixels (membership==0). */
  offTargetBackgroundDeltaE: number;
  /** Mean ΔE2000 (source vs out) over off-target fabric pixels (dFrom > far). */
  offTargetFabricDeltaE: number;
  /** Legacy combined off-target (max of background and fabric). */
  offTargetDeltaE: number;
  targetCount: number;
  offTargetBackgroundCount: number;
  offTargetFabricCount: number;
  offTargetCount: number;
  fabricCount: number;
}

export interface MetricThresholds {
  /** ΔE2000 change threshold: pixels with ΔE(source,out) > delta are "remapped". Default 3. */
  delta?: number;
  /** ΔE2000 distance from fromColor beyond which fabric pixels count as off-target. Default 30. */
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
  const delta = thresholds.delta ?? 3;
  const far = thresholds.far ?? 30;
  const fromLab = hexToLab(fromColor);
  const toLab = hexToLab(toColor);

  let targetSum = 0, targetCount = 0;
  let offBgSum = 0, offBgCount = 0;
  let offFabricSum = 0, offFabricCount = 0;
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

    // TARGET set: pixels the op actually remapped (change-based).
    const changed = deltaE2000(s, o) > delta;
    if (changed && inFabric) {
      // Measure chroma/hue match at the pixel's own L.
      targetSum += deltaE2000({ l: o.l, a: o.a, b: o.b }, { l: o.l, a: toLab.a, b: toLab.b });
      targetCount++;
      srcL.push(s.l);
      outL.push(o.l);
    }

    // OFF-TARGET BACKGROUND: membership==0, any change is bleed into non-fabric.
    if (!inFabric) {
      offBgSum += deltaE2000(s, o);
      offBgCount++;
    }

    // OFF-TARGET FABRIC: fabric pixels far from fromColor — bleed into other separations.
    if (inFabric) {
      const dFrom = deltaE2000(s, fromLab);
      if (dFrom > far) {
        offFabricSum += deltaE2000(s, o);
        offFabricCount++;
      }
      // near..far band: excluded from off-target (transition zone)
    }
  }

  const offTargetBackgroundDeltaE = offBgCount > 0 ? offBgSum / offBgCount : 0;
  const offTargetFabricDeltaE = offFabricCount > 0 ? offFabricSum / offFabricCount : 0;
  const offTargetCount = offBgCount + offFabricCount;
  const offTargetDeltaE = Math.max(offTargetBackgroundDeltaE, offTargetFabricDeltaE);

  return {
    targetDeltaE: targetCount > 0 ? targetSum / targetCount : 0,
    lumSSIM: ssim(srcL, outL),
    offTargetBackgroundDeltaE,
    offTargetFabricDeltaE,
    offTargetDeltaE,
    targetCount,
    offTargetBackgroundCount: offBgCount,
    offTargetFabricCount: offFabricCount,
    offTargetCount,
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
