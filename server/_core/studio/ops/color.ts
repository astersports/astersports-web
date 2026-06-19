/**
 * Color math for deterministic recolor — thin wrappers over culori so the op
 * code and the test assertions share one implementation (no drift). All LAB is
 * CIELAB; ΔE is CIEDE2000.
 */
import { converter, differenceCiede2000, type Color } from "culori";

export interface Lab {
  l: number; // 0..100
  a: number; // ~ -128..127
  b: number; // ~ -128..127
}

const toLab = converter("lab");
const toRgb = converter("rgb");
const ciede2000 = differenceCiede2000();

const clamp255 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

/** sRGB 0..255 -> CIELAB. */
export function rgb255ToLab(r: number, g: number, b: number): Lab {
  const c = toLab({ mode: "rgb", r: r / 255, g: g / 255, b: b / 255 });
  return { l: c.l ?? 0, a: c.a ?? 0, b: c.b ?? 0 };
}

/** CIELAB -> sRGB 0..255 (clamped). */
export function labToRgb255(lab: Lab): { r: number; g: number; b: number } {
  const c = toRgb({ mode: "lab", l: lab.l, a: lab.a, b: lab.b });
  return { r: clamp255((c.r ?? 0) * 255), g: clamp255((c.g ?? 0) * 255), b: clamp255((c.b ?? 0) * 255) };
}

/** Parse a hex/CSS-named color to CIELAB. Throws on unparseable input. */
export function hexToLab(input: string): Lab {
  const c = toLab(input);
  if (!c) throw new Error(`Unparseable color: "${input}"`);
  return { l: c.l ?? 0, a: c.a ?? 0, b: c.b ?? 0 };
}

/** CIEDE2000 distance between two CIELAB colors. */
export function deltaE2000(x: Lab, y: Lab): number {
  const a: Color = { mode: "lab", l: x.l, a: x.a, b: x.b };
  const b: Color = { mode: "lab", l: y.l, a: y.a, b: y.b };
  return ciede2000(a, b);
}
