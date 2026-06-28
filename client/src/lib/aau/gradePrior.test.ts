import { describe, it, expect } from "vitest";
import { parseTeamGrade, parseDivisionGradeFloor, effectiveRatings } from "./gradePrior";

describe("grade parsing", () => {
  it("reads a team's grade ordinal from its name", () => {
    expect(parseTeamGrade("East Coast Storm 4th")).toBe(4);
    expect(parseTeamGrade("East Coast Storm 5th")).toBe(5);
  });
  it("does not treat age bands (11U) or plain names as grades", () => {
    expect(parseTeamGrade("Aster 11U")).toBeNull();
    expect(parseTeamGrade("High Rise - Brie")).toBeNull();
    expect(parseTeamGrade("NYC Titans")).toBeNull();
  });
  it("takes the lowest grade as the division floor", () => {
    expect(parseDivisionGradeFloor("Girls - 5th/6th")).toBe(5);
    expect(parseDivisionGradeFloor("Boys · 7th grade")).toBe(7);
    expect(parseDivisionGradeFloor("Coed")).toBeNull();
  });
});

describe("effectiveRatings", () => {
  const division = "Girls - 5th/6th"; // floor 5
  const teams = [
    { id: "empire", name: "Empire State Storm", rating: 2.08 },
    { id: "highrise", name: "High Rise - Brie", rating: -1.32 },
    { id: "ecs4", name: "East Coast Storm 4th", rating: null }, // plays up a grade, no history
    { id: "ecs5", name: "East Coast Storm 5th", rating: null }, // at the floor
    { id: "titans", name: "NYC Titans", rating: null }, // no grade, no history
  ];

  it("keeps real ratings and omits teams with no signal at all", () => {
    const eff = effectiveRatings(teams, division);
    expect(eff.empire).toBe(2.08);
    expect(eff.highrise).toBe(-1.32);
    expect(eff.ecs5).toBeUndefined(); // at floor, no rating → no signal → omitted (neutral)
    expect(eff.titans).toBeUndefined();
  });

  it("penalizes a team playing up a grade even with no game history", () => {
    const eff = effectiveRatings(teams, division);
    // 4th grade in a 5/6 division → one grade up → 12-point penalty off a 0 baseline
    expect(eff.ecs4).toBe(-12);
    // and that drops it below every other team in the field
    expect(eff.ecs4).toBeLessThan(eff.highrise);
    expect(eff.ecs4! < (eff.ecs5 ?? 0)).toBe(true);
    expect(eff.ecs4! < (eff.titans ?? 0)).toBe(true);
  });
});
