import { describe, it, expect } from "vitest";
import { groupByProgram, hasProgramHeader } from "./programGroups";
import type { AauTeamVariant } from "@/lib/aster";

function v(over: Partial<AauTeamVariant>): AauTeamVariant {
  return {
    teamKey: "k", name: "Team", programGroup: null,
    tournamentId: "t", tournamentName: "T", divisionId: "d", divisionName: "Boys - 5th",
    gender: "M", gradeLabel: "5th", tier: null, day: null,
    record: { w: 0, l: 0 }, rating: null, basis: false, isLive: false, ...over,
  };
}

describe("groupByProgram", () => {
  it("clusters variants sharing a programGroup hint under one group (the §2.E win)", () => {
    const groups = groupByProgram([
      v({ teamKey: "a", name: "High Rise — Brie", programGroup: "High Rise" }),
      v({ teamKey: "b", name: "High Rise — Will", programGroup: "High Rise" }),
      v({ teamKey: "c", name: "High Rise — Ayo", programGroup: "High Rise" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].program).toBe("High Rise");
    expect(groups[0].variants.map((x) => x.teamKey)).toEqual(["a", "b", "c"]);
    expect(hasProgramHeader(groups[0])).toBe(true);
  });

  it("keeps a null-hint team standalone — never merged on a guess (conservative)", () => {
    const groups = groupByProgram([
      v({ teamKey: "a", name: "NY Court Kings", programGroup: null }),
      v({ teamKey: "b", name: "NYC Titans", programGroup: null }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.program === null)).toBe(true);
    expect(groups.every((g) => !hasProgramHeader(g))).toBe(true);
  });

  it("matches the hint case-insensitively", () => {
    const groups = groupByProgram([
      v({ teamKey: "a", programGroup: "BSNY 5 Elite" }),
      v({ teamKey: "b", programGroup: "bsny 5 elite" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].variants).toHaveLength(2);
  });

  it("does NOT merge distinct hints", () => {
    const groups = groupByProgram([
      v({ teamKey: "a", programGroup: "Heat Elite" }),
      v({ teamKey: "b", programGroup: "BSNY 5 Elite" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("renders a single-variant program as a flat row (no header chrome for one)", () => {
    const groups = groupByProgram([v({ teamKey: "a", name: "Elite - Solo", programGroup: "Elite" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].program).toBe("Elite");
    expect(hasProgramHeader(groups[0])).toBe(false); // 1 variant → no program header
  });

  it("preserves input order; a group sorts to its first variant", () => {
    const groups = groupByProgram([
      v({ teamKey: "solo1", programGroup: null }),
      v({ teamKey: "p1", programGroup: "Pack" }),
      v({ teamKey: "solo2", programGroup: null }),
      v({ teamKey: "p2", programGroup: "Pack" }),
    ]);
    expect(groups.map((g) => g.program)).toEqual([null, "Pack", null]);
    expect(groups[1].variants.map((x) => x.teamKey)).toEqual(["p1", "p2"]);
  });
});
