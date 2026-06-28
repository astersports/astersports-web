import type { StandingsGame } from "@/lib/aster";

// The team's real game scores — the leaf of the division-first IA (architect IA review 2026-06-27:
// "scores live UNDER a team you care about," with the REAL score, not the capped seeding diff). Shows
// the games the focus team actually played, won/lost, real points. No fabrication: renders nothing
// until the team has a completed game.
interface Props {
  focusId: string;
  games: StandingsGame[];
  nameById: Map<string, string>;
}

export default function TeamScores({ focusId, games, nameById }: Props) {
  const mine = games.filter((g) => g.aId === focusId || g.bId === focusId);
  if (mine.length === 0) return null;

  return (
    <div className="rounded-[16px] border border-[#E2E8F0] bg-[#FFFFFF] p-4">
      <div className="mb-2 font-[var(--font-mono)] text-[10px] uppercase tracking-[0.14em] text-[#6B7280]">Their games</div>
      <div className="space-y-1.5">
        {mine.map((g, i) => {
          const isA = g.aId === focusId;
          const my = isA ? g.aScore : g.bScore;
          const opp = isA ? g.bScore : g.aScore;
          const oppName = nameById.get(isA ? g.bId : g.aId) ?? "—";
          const won = my > opp;
          const tied = my === opp;
          return (
            <div key={i} className="flex items-center justify-between gap-3 border-b border-[#EDF2F7] py-1.5 last:border-0">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className="shrink-0 rounded-[5px] px-[6px] py-[1px] font-[var(--font-mono)] text-[10px] font-bold"
                  style={won ? { color: "#16A34A", background: "rgba(22,163,74,0.10)" } : tied ? { color: "#6B7280", background: "#F3F4F6" } : { color: "#DC2626", background: "rgba(220,38,38,0.08)" }}
                >
                  {won ? "W" : tied ? "T" : "L"}
                </span>
                <span className="truncate text-[13px] text-[#4A5568]">
                  <span className="text-[#9CA3AF]">vs</span> {oppName}
                </span>
              </span>
              <span className="shrink-0 font-[var(--font-mono)] text-[14px] font-bold text-[#1A1D23]">
                {my}<span className="text-[#9CA3AF]">–</span>{opp}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
