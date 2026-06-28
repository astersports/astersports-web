import { describe, it, expect } from "vitest";
import { sliceStandings } from "./sliceStandings";
import type { RankedRow } from "./computeStandings";

function row(id: string, name: string, rank: number, advances: boolean | null): RankedRow {
  return { id, name, wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, diff: 0, winPct: 0, rank, advances } as RankedRow;
}
// 5-team division, top 2 advance
const ROWS: RankedRow[] = [
  row("a", "High Rise", 1, true),
  row("b", "Empire", 2, true),
  row("c", "Titans", 3, false),
  row("d", "Wave", 4, false),
  row("e", "Storm", 5, false),
];

describe("sliceStandings (shared-source slice)", () => {
  it("returns a SUBSET of the full rows (same source, never re-ranked)", () => {
    const slice = sliceStandings(ROWS, "a", 2);
    expect(slice.every((r) => ROWS.includes(r))).toBe(true); // identity — same row objects, no recompute
    expect(slice.length).toBeLessThan(ROWS.length);
  });

  it("includes the focus team + its neighbours + the cut-bracketing pair, in rank order", () => {
    const slice = sliceStandings(ROWS, "a", 2).map((r) => r.id);
    expect(slice).toContain("a"); // focus (rank 1)
    expect(slice).toContain("b"); // last-in (rank 2)
    expect(slice).toContain("c"); // first-out (rank 3) — the cut-line context
    // strictly ascending by rank
    const ranks = sliceStandings(ROWS, "a", 2).map((r) => r.rank);
    expect(ranks).toEqual([...ranks].sort((x, y) => x - y));
  });

  it("matches the focus team by name when the id space differs", () => {
    const slice = sliceStandings(ROWS, "not-an-id", 2, "titans").map((r) => r.id);
    expect(slice).toContain("c"); // matched "Titans" by normalized name
  });

  it("advanceCount=null → no cut pair, just focus + neighbours", () => {
    const slice = sliceStandings(ROWS, "d", null).map((r) => r.id);
    expect(slice).toEqual(["c", "d", "e"]); // focus d + neighbours, no cut injection
  });

  it("empty rows → empty slice", () => {
    expect(sliceStandings([], "a", 2)).toEqual([]);
  });
});
