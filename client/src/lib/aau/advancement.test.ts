import { describe, it, expect } from "vitest";
import { computeAdvancement, circuitConfig, CIRCUITS, type TeamStanding } from "./advancement";

// minimal team stub — only the fields the engine reads
const team = (id: string, wins: number, losses: number, o: Partial<TeamStanding> = {}): TeamStanding => ({
  id, wins, losses, cappedPointDiff: 0, pointsFor: 0, pointsAgainst: 0, isForfeit: false, ...o,
});

describe("circuit config — grounded, never cross-applied", () => {
  it("ZG and BBallshootout differ on cap, cascade, forfeit, exhibition", () => {
    const zg = circuitConfig("AAU Zero Gravity")!;
    const bb = circuitConfig("BBallshootout")!;
    expect(zg.pointDiffCap).toBe(20);
    expect(bb.pointDiffCap).toBe(25);
    expect(zg.cascade).toContain("points_allowed"); // ZG has it
    expect(bb.cascade).not.toContain("points_allowed"); // BBallshootout does NOT
    expect(bb.cascade).toContain("coin_flip"); // BBallshootout ends in a coin flip
    expect(zg.cascade).not.toContain("coin_flip"); // ZG never does
    expect(zg.forfeitMode).toBe("hard_out");
    expect(bb.forfeitMode).toBe("recorded_loss");
    expect(zg.hasExhibition).toBe(true);
    expect(bb.hasExhibition).toBe(false);
  });
  it("League Play is uncapped; unknown circuit resolves to null", () => {
    expect(CIRCUITS["League Play"].pointDiffCap).toBeNull();
    expect(circuitConfig("Nonexistent")).toBeNull();
    expect(circuitConfig(null)).toBeNull();
  });
});

describe("exact terminal states (record alone)", () => {
  const teams = [team("A", 3, 0), team("B", 2, 1), team("C", 1, 2), team("D", 0, 3)];
  it("top-N clinch and the rest are out when the pool is complete", () => {
    const r = computeAdvancement({ teams, games: [], remaining: [], advanceCount: 2, circuit: "AAU Zero Gravity" });
    expect(r.get("A")!.state).toBe("clinched");
    expect(r.get("B")!.state).toBe("clinched");
    expect(r.get("C")!.state).toBe("out");
    expect(r.get("D")!.state).toBe("out");
  });
  it("a leader with games left is not yet clinched if it can be caught", () => {
    // A 2-0, B 2-0, C 0-2, advance 1, one game left between A and B → neither clinched yet
    const t2 = [team("A", 2, 0), team("B", 2, 0), team("C", 0, 2)];
    const r = computeAdvancement({ teams: t2, games: [], remaining: [{ aId: "A", bId: "B" }], advanceCount: 1, circuit: "AAU Zero Gravity" });
    expect(r.get("A")!.state).toBe("in_play");
    expect(r.get("B")!.state).toBe("in_play");
    expect(r.get("C")!.state).toBe("out"); // C can't reach top 1
  });
});

describe("forfeit branches by circuit (same word, opposite math)", () => {
  const teams = [team("A", 3, 0, { isForfeit: true }), team("B", 2, 1), team("C", 1, 2), team("D", 0, 3)];
  it("ZG: forfeit is a hard OUT, overriding a qualifying record", () => {
    const r = computeAdvancement({ teams, games: [], remaining: [], advanceCount: 2, circuit: "AAU Zero Gravity" });
    expect(r.get("A")!.state).toBe("out");
    expect(r.get("A")!.note).toMatch(/forfeit/i);
  });
  it("BBallshootout: forfeit is a recorded loss, NOT an auto-out — A still clinches", () => {
    const r = computeAdvancement({ teams, games: [], remaining: [], advanceCount: 2, circuit: "BBallshootout" });
    expect(r.get("A")!.state).toBe("clinched");
  });
});

describe("coin flip — BBallshootout states it, ZG never does", () => {
  // A and B dead-even on record + capped PD + points; advance 1 → the last spot is a true tie.
  const even = [
    team("A", 2, 0, { cappedPointDiff: 10, pointsFor: 80, pointsAgainst: 70 }),
    team("B", 2, 0, { cappedPointDiff: 10, pointsFor: 80, pointsAgainst: 70 }),
    team("C", 0, 2),
  ];
  it("BBallshootout flags coinFlip with an honest note", () => {
    const r = computeAdvancement({ teams: even, games: [], remaining: [], advanceCount: 1, circuit: "BBallshootout" });
    expect(r.get("A")!.state).toBe("in_play");
    expect(r.get("A")!.coinFlip).toBe(true);
    expect(r.get("A")!.note).toMatch(/coin flip/i);
  });
  it("ZG resolves the same tie without a coin flip (just by tiebreaker)", () => {
    const r = computeAdvancement({ teams: even, games: [], remaining: [], advanceCount: 1, circuit: "AAU Zero Gravity" });
    expect(r.get("A")!.coinFlip).toBeUndefined();
    expect(r.get("A")!.byTiebreaker).toBe(true);
  });
});

describe("head-to-head breaks a two-team tie", () => {
  it("the team that won head-to-head ranks ahead in the cut read", () => {
    // A and B both 1-1, A beat B head-to-head, advance 1
    const teams = [team("A", 1, 1, { cappedPointDiff: 5 }), team("B", 1, 1, { cappedPointDiff: 5 })];
    const games = [{ aId: "A", bId: "B", aScore: 50, bScore: 40 }];
    const r = computeAdvancement({ teams, games, remaining: [], advanceCount: 1, circuit: "AAU Zero Gravity" });
    // both in_play (tie at the single cut spot), but A is in_the_cut by H2H
    expect(r.get("A")!.position).toBe("in_the_cut");
  });
});
