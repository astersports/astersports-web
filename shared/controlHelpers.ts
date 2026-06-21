/**
 * Shared control predicates — used by both server and client to determine
 * which generation path a set of controls will take.
 */
import type { ControlSettings } from "./controls";

export function isDensityOnly(c: ControlSettings): boolean {
  return c.density.enabled && !c.scale.enabled;
}

export function isScaleOnly(c: ControlSettings): boolean {
  return c.scale.enabled && c.scale.percent !== 0 && !c.density.enabled;
}

/**
 * Returns true if the controls will use the deterministic (long-running) path
 * that requires SSE streaming to keep the container alive.
 *
 * Note: On the server, this is further gated by ENV flags and provider readiness.
 * On the client, we use this as a heuristic — if the server doesn't support SSE
 * for this particular request, it will return a JSON error and the client falls
 * back to the tRPC mutation.
 */
export function shouldUseStream(c: ControlSettings): boolean {
  return isDensityOnly(c) || isScaleOnly(c);
}
