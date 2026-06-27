import { describe, it, expect } from "vitest";
import { predictBracket } from "./predictBracket";
import { effectiveRatings } from "@/lib/aau/gradePrior";

// A 4-team, top-2-advance division with NO games played and one remaining round-robin pair
// per team. Pure projection territory — exactly the pre-tournament state.
const teams = [
  { id: "strong", name: "Strong Co" },
  { id: "weak", name: "Weak Co" },
  { id: "mid1", name: "Mid One" },
  { id: "mid2", name: "Mid Two" },
];
const remaining = [
  { aId: "strong", bId: "weak" },
  { aId: "mid1", bId: "mid2" },
  { aId: "strong", bId: "mid1" },
  { aId: "weak", bId: "mid2" },
];

describe("predictBracket strength weighting", () => {
  it("gives a stronger team better odds than a weaker one (same bracket position)", () => {
    const eff = { strong: 12, weak: -12, mid1: 0, mid2: 0 };
    const strong = predictBracket({ teams, remaining, advanceCount: 2, focusId: "strong", eff });
    const weak = predictBracket({ teams, remaining, advanceCount: 2, focusId: "weak", eff });
    expect(strong.oddsPct!).toBeGreaterThan(weak.oddsPct!);
    expect(strong.basis).toBe("ratings"); // no games played, but ratings differentiate
  });

  it("reports basis 'even' with no signal, and weighting moves the number", () => {
    const uniform = predictBracket({ teams, remaining, advanceCount: 2, focusId: "strong" });
    expect(uniform.basis).toBe("even"); // nothing differentiates → caller gates to "—"
    const eff = { strong: 12, weak: -12, mid1: 0, mid2: 0 };
    const weighted = predictBracket({ teams, remaining, advanceCount: 2, focusId: "strong", eff });
    expect(weighted.oddsPct!).toBeGreaterThan(uniform.oddsPct!); // strength lifts the favorite
  });
});

describe("predictBracket grade prior (the 4th-grade anomaly)", () => {
  it("keeps a 4th-grade team from out-projecting a 5/6 team with no head-to-head data", () => {
    const gradeTeams = [
      { id: "ecs4", name: "East Coast Storm 4th" },
      { id: "ecs5", name: "East Coast Storm 5th" },
      { id: "titans", name: "NYC Titans" },
      { id: "highrise", name: "High Rise - Brie" },
    ];
    const gradeRemaining = [
      { aId: "ecs4", bId: "ecs5" },
      { aId: "titans", bId: "highrise" },
      { aId: "ecs4", bId: "titans" },
      { aId: "ecs5", bId: "highrise" },
    ];
    const eff = effectiveRatings(
      gradeTeams.map((t) => ({ ...t, rating: null })), // no game history for any of them
      "Girls - 5th/6th",
    );
    const fourth = predictBracket({ teams: gradeTeams, remaining: gradeRemaining, advanceCount: 2, focusId: "ecs4", eff });
    const fifth = predictBracket({ teams: gradeTeams, remaining: gradeRemaining, advanceCount: 2, focusId: "ecs5", eff });
    const titans = predictBracket({ teams: gradeTeams, remaining: gradeRemaining, advanceCount: 2, focusId: "titans", eff });
    expect(fourth.oddsPct!).toBeLessThan(fifth.oddsPct!);
    expect(fourth.oddsPct!).toBeLessThan(titans.oddsPct!);
  });
});

describe("predictBracket gate", () => {
  it("marks a decided bracket with no games as even (caller shows —)", () => {
    const p = predictBracket({ teams, remaining: [], advanceCount: 2, focusId: "strong" });
    expect(p.basis).toBe("even");
  });
  it("reports results basis once games are played", () => {
    const p = predictBracket({
      teams, remaining, advanceCount: 2, focusId: "strong",
      games: [{ aId: "strong", bId: "weak", aScore: 50, bScore: 30 }],
    });
    expect(p.basis).toBe("results");
  });
});
