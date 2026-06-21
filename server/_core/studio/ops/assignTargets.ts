/**
 * Survivor selection + target assignment in one step for Density v2 (Option B).
 *
 * Given N source motif centroids and M <= N even target positions
 * (blueNoiseLayout.ts), match each target to a distinct source so that total
 * squared displacement is minimised. The M matched motifs SURVIVE (they relocate
 * to their target); the N−M unmatched motifs are REMOVED. Minimising displacement
 * keeps the redistributed print close to the original composition.
 *
 * Strategy: deterministic greedy over all (target, source) pairs sorted by
 * squared distance — the spec's "auction/greedy-nearest" branch (a full Hungarian
 * is the exact-optimal alternative; greedy is within tolerance for blue-noise
 * targets and far simpler). Ties are broken by instance index, then target index,
 * so the result is byte-stable.
 *
 * Pure + deterministic: no RNG, no I/O.
 */
export type Point = [number, number];

export interface Assignment {
  /** Index into the source centroids array (the surviving motif). */
  source: number;
  /** Index into the targets array (where it relocates to). */
  target: number;
}

export interface AssignResult {
  /** One per target: which source survives and where it goes. length === targets.length. */
  assignments: Assignment[];
  /** Source indices that survive (relocate). Sorted ascending. */
  survivors: number[];
  /** Source indices that are removed (unmatched). Sorted ascending. */
  removed: number[];
}

interface Pair {
  t: number;
  s: number;
  d2: number;
}

export function assignTargets(sources: Point[], targets: Point[]): AssignResult {
  const N = sources.length;
  const M = targets.length;

  // Build every (target, source) pair with its squared displacement.
  const pairs: Pair[] = [];
  for (let t = 0; t < M; t++) {
    for (let s = 0; s < N; s++) {
      const dx = targets[t][0] - sources[s][0];
      const dy = targets[t][1] - sources[s][1];
      pairs.push({ t, s, d2: dx * dx + dy * dy });
    }
  }

  // Deterministic order: nearest first; ties by source index, then target index.
  pairs.sort((a, b) => a.d2 - b.d2 || a.s - b.s || a.t - b.t);

  const targetTaken = new Uint8Array(M);
  const sourceTaken = new Uint8Array(N);
  const assignedSource = new Int32Array(M).fill(-1);
  let made = 0;
  for (const p of pairs) {
    if (made === M) break;
    if (targetTaken[p.t] || sourceTaken[p.s]) continue;
    targetTaken[p.t] = 1;
    sourceTaken[p.s] = 1;
    assignedSource[p.t] = p.s;
    made++;
  }

  const assignments: Assignment[] = [];
  for (let t = 0; t < M; t++) {
    if (assignedSource[t] >= 0) assignments.push({ source: assignedSource[t], target: t });
  }
  const survivors: number[] = [];
  const removed: number[] = [];
  for (let s = 0; s < N; s++) (sourceTaken[s] ? survivors : removed).push(s);

  return { assignments, survivors, removed };
}
