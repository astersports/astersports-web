// AAU family hub — kid-view PILOT data (operator-directed 2026-06-26).
//
// Curated pilot for Frank's two kids across two programs — the cross-program
// family hub in one place. This is presentation-only seed data (no child PII in
// the backbone, no held trust tables touched); the June 15–16 tournament and
// Rowan's Chris Ward program aren't ingested yet, so the facts the operator gave
// are encoded here directly. When those tournaments land in the backbone, the
// kid view swaps to the public RPCs (same shape as the Standings hub).
//
// Per-child film stays empty until a real, consented, box-score-reconciled film
// pipeline is built (it is not yet). The per-jersey privacy model (a parent sees
// only their own child) governs that pipeline when it ships.

export interface KidPlay {
  time: string;
  seconds: number;
  description: string;
  type: "score" | "rebound" | "assist" | "steal" | "free-throw";
}

export interface KidReel {
  id: string;
  title: string;
  opponent: string;
  duration: string;
  statLine: string;
  aiSummary: string;
  videoUrl?: string;   // optional — clips stream from the team's shared storage
  plays: KidPlay[];
}

export interface PilotKid {
  id: string;
  name: string;
  jersey: string;
  program: string;        // the program/org the kid plays in (cross-program)
  team: string;
  gradeNow: string;
  gradeNext: string;
  accent: string;         // kid card accent (kept distinct per child)
  tournament: {
    name: string;
    dates: string;
    result: string;       // "Champions" / "3rd Place" / "Pool Play" ...
    champion: boolean;
    blurb: string;
  };
  reels: KidReel[];       // empty = "film coming soon"
}

// Per-child film is GATED (verified-guardian + entitled + consent) and DERIVED from
// real footage that reconciles to the box score. That pipeline is not built yet, so
// until real consented film exists every kid shows "film coming soon" (reels: []).
// No fabricated opponents or invented play-by-play ever ship — least of all about a
// minor. (De-fabrication: the prior hardcoded reels invented opponent matchups the
// kid never played; removed 2026-06-26.)

export const PILOT_KIDS: PilotKid[] = [
  {
    id: "charlie",
    name: "Charlie",
    jersey: "#5",
    program: "Aster AAU",
    team: "11U Girls",
    gradeNow: "5th Grade",
    gradeNext: "6th in the fall",
    accent: "var(--as-team-primary)",
    tournament: {
      name: "ZG NY Hoop Festival",
      dates: "Jun 15–16, 2026",
      result: "Pool Play",
      champion: false,
      blurb: "Charlie ran the floor at the ZG NY Hoop Festival across the weekend.",
    },
    reels: [],
  },
  {
    id: "rowan",
    name: "Rowan",
    jersey: "#21",
    program: "Chris Ward",
    team: "Green",
    gradeNow: "8th Grade",
    gradeNext: "9th next year",
    accent: "var(--as-success)",
    tournament: {
      name: "ZG NY Hoop Festival",
      dates: "Jun 15–16, 2026",
      result: "Champions",
      champion: true,
      blurb: "Rowan's Chris Ward Green team won the tournament — champions on the weekend.",
    },
    reels: [],
  },
];
