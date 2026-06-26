// AAU family hub — kid-view PILOT data (operator-directed 2026-06-26).
//
// Curated pilot for Frank's two kids across two programs — the cross-program
// family hub in one place. This is presentation-only seed data (no child PII in
// the backbone, no held trust tables touched); the June 15–16 tournament and
// Rowan's Chris Ward program aren't ingested yet, so the facts the operator gave
// are encoded here directly. When those tournaments land in the backbone, the
// kid view swaps to the public RPCs (same shape as the Standings hub).
//
// Charlie's film is filtered to ONLY her jersey (#5) — a parent's view shows
// their own child, never another family's kid (the per-jersey privacy model).

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
  // Match keys into the backbone (get_public_team_season): the team's display_name
  // as it appears in TourneyMachine + a division ILIKE narrowing to this kid's team
  // (a club fields several teams under one name — Legacy Hoopers has boys + girls).
  teamName: string;
  divisionLike: string | null;
  tournament: {
    name: string;
    dates: string;
    result: string;       // "Champions" / "3rd Place" / "Pool Play" ...
    champion: boolean;
    blurb: string;
  };
  reels: KidReel[];       // empty = "film coming soon"
}

// Charlie's reels: ported from the team film, FILTERED to #5 only — every play
// is Charlie's, and no other child's jersey number appears (privacy clean-up).
const CHARLIE_REELS: KidReel[] = [
  {
    id: "c1",
    title: "Scoring Clinic",
    opponent: "vs Castle",
    duration: "2:22",
    statLine: "9 pts · 2 reb · 1 stl · 4 FT",
    aiSummary:
      "#5 is the star with nine plays — three-pointers from the wing, aggressive on-ball defense leading to a steal-and-score, multiple free throws, and key defensive rebounds.",
    plays: [
      { time: "0:12", seconds: 12, description: "Receives a pass on the right wing, sets her feet, sinks a three-pointer", type: "score" },
      { time: "0:35", seconds: 35, description: "Secures a defensive rebound after a miss and pushes the ball up court", type: "rebound" },
      { time: "0:41", seconds: 41, description: "Drives aggressively to the basket down the left side, scores the layup", type: "score" },
      { time: "0:49", seconds: 49, description: "Knocks down a free throw", type: "free-throw" },
      { time: "0:58", seconds: 58, description: "Knocks down another free throw", type: "free-throw" },
      { time: "1:04", seconds: 64, description: "Pokes the ball loose for a steal, takes it coast-to-coast for a fast-break layup", type: "steal" },
      { time: "1:18", seconds: 78, description: "Drains a three-pointer from the right wing", type: "score" },
      { time: "1:25", seconds: 85, description: "Dribbles left and hits a jump shot from just inside the arc", type: "score" },
      { time: "1:44", seconds: 104, description: "Grabs another defensive rebound in the paint", type: "rebound" },
      { time: "1:56", seconds: 116, description: "Knocks down a free throw", type: "free-throw" },
      { time: "2:13", seconds: 133, description: "Knocks down a free throw", type: "free-throw" },
    ],
  },
  {
    id: "c2",
    title: "Fast-Break Masterclass",
    opponent: "vs Teal",
    duration: "1:45",
    statLine: "8 pts · 2 ast · 1 stl",
    aiSummary:
      "#5 is the engine — leading fast breaks, scoring in transition, and creating for teammates. She pushes the pace, records a steal, and finishes multiple coast-to-coast drives.",
    plays: [
      { time: "0:12", seconds: 12, description: "Drives from the left wing into the paint, scores a right-handed layup", type: "score" },
      { time: "0:22", seconds: 22, description: "Catches on the right wing, takes a dribble, sinks the jump shot", type: "score" },
      { time: "0:30", seconds: 30, description: "Leads the fast break up the middle and dishes the assist to a cutting teammate", type: "assist" },
      { time: "0:41", seconds: 41, description: "Takes it coast-to-coast on the break, finishes a left-handed layup", type: "score" },
      { time: "0:50", seconds: 50, description: "Pushes the ball up the right side, scores a right-handed layup", type: "score" },
      { time: "1:04", seconds: 64, description: "Leads another break and feeds a teammate cutting down the middle for the score", type: "assist" },
      { time: "1:14", seconds: 74, description: "Intercepts a pass in the paint for the steal", type: "steal" },
      { time: "1:20", seconds: 80, description: "Drives the right side on the break, scores the layup", type: "score" },
      { time: "1:30", seconds: 90, description: "Splits the middle on the fast break for another layup", type: "score" },
      { time: "1:37", seconds: 97, description: "Drives the right side again and finishes", type: "score" },
    ],
  },
  {
    id: "c3",
    title: "Three-Point Shooting",
    opponent: "vs New Paltz",
    duration: "1:38",
    statLine: "3 threes · 1 putback",
    aiSummary:
      "#5 showcases elite shooting — hitting three-pointers off kick-outs and grabbing an offensive rebound for a putback.",
    plays: [
      { time: "0:05", seconds: 5, description: "Spots up on the kick-out and drains a three-pointer", type: "score" },
      { time: "0:18", seconds: 18, description: "Grabs an offensive rebound in the paint and scores the putback", type: "rebound" },
      { time: "0:26", seconds: 26, description: "Catches on the wing and sinks another three", type: "score" },
    ],
  },
];

export const PILOT_KIDS: PilotKid[] = [
  {
    id: "charlie",
    name: "Charlie",
    jersey: "#5",
    program: "Legacy Hoopers",
    team: "11U Girls",
    gradeNow: "5th Grade",
    gradeNext: "6th in the fall",
    accent: "var(--as-team-primary)",
    teamName: "Legacy Hoopers",
    divisionLike: "%Girls%",
    tournament: {
      name: "ZG NY Hoop Festival",
      dates: "Jun 15–16, 2026",
      result: "Pool Play",
      champion: false,
      blurb: "Charlie ran the floor — scoring clinics, fast breaks, and threes across the weekend.",
    },
    reels: CHARLIE_REELS,
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
    teamName: "Chris Ward Basketball Green",
    divisionLike: "%8th%",   // spring = 8th grade only (the team also appears in 9th divisions, not his spring team)
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
