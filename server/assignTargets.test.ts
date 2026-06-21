/**
 * assignTargets tests (Density v2 / Option B). Unbalanced min-displacement
 * assignment of N source centroids -> M<=N even targets: M survive (relocate),
 * N-M are removed. Deterministic, tie-broken by index.
 */
import { describe, it, expect } from "vitest";
import { assignTargets, type Point } from "./_core/studio/ops/assignTargets";

describe("assignTargets", () => {
  it("matches every target to a distinct source; the rest are removed", () => {
    const sources: Point[] = [[0, 0], [10, 0], [20, 0], [30, 0]];
    const targets: Point[] = [[1, 0], [29, 0]]; // nearest: src0 and src3
    const r = assignTargets(sources, targets);
    expect(r.assignments.length).toBe(2);
    expect(r.survivors.length).toBe(2);
    expect(r.removed.length).toBe(2);
    // Each target gets a distinct source.
    expect(new Set(r.assignments.map((a) => a.source)).size).toBe(2);
    expect(new Set(r.assignments.map((a) => a.target)).size).toBe(2);
    // survivors ∪ removed = all sources, disjoint.
    expect([...r.survivors, ...r.removed].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("greedily minimises displacement (nearest source wins each target)", () => {
    const sources: Point[] = [[0, 0], [10, 0], [20, 0], [30, 0]];
    const targets: Point[] = [[1, 0], [29, 0]];
    const r = assignTargets(sources, targets);
    const byTarget = new Map(r.assignments.map((a) => [a.target, a.source]));
    expect(byTarget.get(0)).toBe(0); // target (1,0) -> source 0
    expect(byTarget.get(1)).toBe(3); // target (29,0) -> source 3
    expect(r.removed.sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it("is deterministic and breaks ties by index", () => {
    const sources: Point[] = [[0, 0], [0, 0], [0, 0]]; // all equidistant
    const targets: Point[] = [[0, 0]];
    const a = assignTargets(sources, targets);
    const b = assignTargets(sources, targets);
    expect(a).toEqual(b);
    expect(a.assignments[0].source).toBe(0); // lowest index wins the tie
  });

  it("M === N: everyone survives, nothing removed", () => {
    const sources: Point[] = [[0, 0], [5, 5]];
    const targets: Point[] = [[1, 1], [6, 6]];
    const r = assignTargets(sources, targets);
    expect(r.survivors.length).toBe(2);
    expect(r.removed.length).toBe(0);
  });
});
