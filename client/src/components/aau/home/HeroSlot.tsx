import { Search, CalendarClock, Check } from "lucide-react";
import type { TeamUrgency } from "@/lib/aau/hubHome/urgency";
import NextGame from "../NextGame";

// Hub Home V2 — Zone 1 hero (§4). ONE state, auto-selected by urgency precedence (the `u` passed in
// is already the most-urgent team across all tracked teams):
//   live → live score line (H2: "score posts at final" when final-only ingest has no score yet)
//   has a next game → the game-day / next-up composition (countdown · drive · weather · maps), via
//     the SINGLE NextGame composition so drive-time + weather never contradict another card (H5)
//   teams but nothing upcoming → honest "no upcoming game" rest state
//   no teams → first-run search prompt
// No fabrication: every branch is real data or an honest absent state (H6/H7).

export default function HeroSlot({ u, posture, onSearch }: { u: TeamUrgency | null; posture?: string; onSearch: () => void }) {
  if (!u) {
    return (
      <button type="button" onClick={onSearch}
        className="as-press flex w-full items-center gap-3 rounded-[18px] border border-[rgba(232,144,42,0.3)] bg-[radial-gradient(280px_130px_at_18%_0%,rgba(232,144,42,0.10),transparent),linear-gradient(180deg,#FFFFFF,#F9FAFB)] px-[16px] py-[18px] text-left">
        <span className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full border border-[#E2C98A] bg-[rgba(246,204,85,0.12)] text-[#8F6708]"><Search className="h-[18px] w-[18px]" aria-hidden="true" /></span>
        <span>
          <span className="block font-[var(--font-display)] text-[16px] font-bold text-[#1A1D23]">Track a team to build your dashboard</span>
          <span className="mt-0.5 block font-[var(--font-mono)] text-[12.1px] text-[#4B5563]">Search any AAU team — scores, schedule, and bracket path land here.</span>
        </span>
      </button>
    );
  }

  // LIVE — score line (H2: never a bare dash when final-only ingest has no score yet)
  if (u.liveGame) {
    const g = u.liveGame;
    const lit = g.myScore != null && g.oppScore != null;
    const courtVenue = [g.court, g.venue?.name].filter(Boolean).join(" · ");
    return (
      <div className="overflow-hidden rounded-[18px] border border-[rgba(22,163,74,0.32)] bg-[radial-gradient(300px_130px_at_20%_0%,rgba(22,163,74,0.12),transparent),linear-gradient(180deg,#F1F3F5,#FFFFFF)] shadow-[0_16px_40px_-26px_rgba(22,163,74,0.4)]">
        <div className="flex items-center justify-between border-b border-[rgba(0,0,0,0.06)] px-[15px] py-[10px] font-[var(--font-mono)] text-[11.5px] text-[#16A34A]">
          <span className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-[#16A34A]" /> LIVE{g.isBracket ? " · BRACKET" : ""}{g.court ? ` · ${g.court}` : ""}</span>
          <span className="truncate pl-2 text-[#4B5563]">{u.team.name}</span>
        </div>
        {lit ? (
          <div className="flex items-center justify-between px-4 py-[15px]" role="group" aria-label={`Live: ${u.team.name} ${g.myScore}, ${g.opponent} ${g.oppScore}`}>
            <div className="min-w-0 flex-1"><div className="truncate font-[var(--font-display)] text-[16px] font-semibold text-[#166534]">{u.team.name}</div></div>
            <div className="px-3 font-[var(--font-mono)] text-[30px] font-bold tracking-[-1px] text-[#8F6708]">{g.myScore}</div>
            <div className="font-[var(--font-mono)] text-[12.6px] text-[#9CA3AF]">–</div>
            <div className="px-3 font-[var(--font-mono)] text-[30px] font-bold tracking-[-1px] text-[#1A1D23]">{g.oppScore}</div>
            <div className="min-w-0 flex-1 text-right"><div className="truncate font-[var(--font-display)] text-[16px] font-semibold text-[#1A1D23]">{g.opponent || "TBD"}</div></div>
          </div>
        ) : (
          <div className="px-4 py-[15px] text-center">
            <div className="font-[var(--font-display)] text-[16px] font-semibold text-[#1A1D23]">{u.team.name} <span className="font-normal text-[#4B5563]">vs</span> {g.opponent || "TBD"}</div>
            <div className="mt-1 font-[var(--font-mono)] text-[12.6px] text-[#4B5563]">{courtVenue || "in progress"} · score posts at final</div>
          </div>
        )}
      </div>
    );
  }

  // Has a next game (today or next-up) → the single game-day composition.
  if (u.nextGame) return <div className="-mt-1"><NextGame games={u.games} /></div>;

  // No next game in our data. Reframe by the team's bracket posture so a clinched team doesn't read
  // like an error (architect review): clinched/alive but the championship game isn't posted to the
  // schedule feed yet — say "waiting on the bracket", not "no game". (Root fix: surface bracket games.)
  const clinchedAlive = posture === "clinched" || posture === "win_and_in" || posture === "in_control" || posture === "must_win" || posture === "needs_help";
  const done = posture === "eliminated";
  const title = posture === "clinched" ? "Clinched a bracket spot" : clinchedAlive ? "Still alive — pool play wrapped" : done ? "Season complete" : "No upcoming game on the board";
  const sub = clinchedAlive
    ? "Your bracket game posts here the moment the matchup + tip time are set."
    : done
      ? "A great run. Browse the bracket to see how the rest plays out."
      : "The moment your next game posts, the countdown lands here.";
  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-[rgba(246,204,85,0.30)] bg-[radial-gradient(280px_120px_at_18%_0%,rgba(246,204,85,0.08),transparent),linear-gradient(180deg,#FFFFFF,#F9FAFB)] px-[16px] py-[16px]">
      <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border border-[#E2C98A] bg-[rgba(246,204,85,0.10)] text-[#8F6708]">
        {posture === "clinched" ? <Check className="h-[18px] w-[18px]" aria-hidden="true" /> : <CalendarClock className="h-[17px] w-[17px]" aria-hidden="true" />}
      </span>
      <span>
        <span className="block font-[var(--font-display)] text-[15.5px] font-bold text-[#1A1D23]">{title}</span>
        <span className="mt-0.5 block font-[var(--font-mono)] text-[12.1px] text-[#4B5563]">{sub}</span>
      </span>
    </div>
  );
}
