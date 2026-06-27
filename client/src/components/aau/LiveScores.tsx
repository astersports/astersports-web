import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { getPublicLiveNow, type LiveNowGame } from "@/lib/aster";
import { C } from "./find/findUi";

// "Live" tab — currently-live public games across every public tournament (operator IA 2026-06-27:
// Find · Live scores · My Teams · Film). Reads get_public_live_now on the structured backbone, polls
// every 30s so the live-score poll cron's updates surface here. No fabricated data; honest empty
// state. The scrape can leave a game marked 'live' after it ended with no score advance —
// isPlausiblyLive drops those stale rows (started within the last 3h, ≤30m in the future) so a
// finished game never shows as live. Replaces the orphaned legacy single-program LiveScores
// (hardcoded TOURNAMENT_META / tRPC) per the no-hardcoded-data constitution.

const ET = "America/New_York";
const timeET = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ET }) : "");

/** A 'live'-flagged row is plausibly live only within [-3h, +30m] of its start — guards stale scrape rows. */
export function isPlausiblyLive(g: LiveNowGame, nowMs: number): boolean {
  if (!g.startAt) return true; // no start → can't disprove; let it through
  const t = new Date(g.startAt).getTime();
  if (Number.isNaN(t)) return true;
  return t <= nowMs + 30 * 60_000 && t >= nowMs - 3 * 60 * 60_000;
}

function LiveRow({ g }: { g: LiveNowGame }) {
  const lit = g.homeScore != null && g.awayScore != null;
  const homeWon = lit && (g.homeScore ?? 0) > (g.awayScore ?? 0);
  const awayWon = lit && (g.awayScore ?? 0) > (g.homeScore ?? 0);
  const side = (name: string, score: number | null, won: boolean) => (
    <div className="flex items-center justify-between gap-2 py-[3px]">
      <span className="truncate font-[var(--font-display)] text-[13.5px]" style={{ color: won ? C.ink : C.dim, fontWeight: 600 }}>{name}</span>
      <span className="shrink-0 font-[var(--font-mono)] text-[17px] font-bold" style={{ color: C.live }}>{score ?? "—"}</span>
    </div>
  );
  return (
    <div className="mb-[9px] rounded-[14px] p-[11px_12px]" style={{ border: "1px solid rgba(52,224,164,.28)", background: "linear-gradient(160deg,rgba(52,224,164,.05),#121a2e)" }}>
      <div className="mb-[9px] flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-[6px] font-[var(--font-mono)] text-[10px] font-bold tracking-[0.06em]" style={{ color: C.live }}>
          <span className="as-pulse inline-block h-[6px] w-[6px] rounded-full" style={{ background: C.live, boxShadow: `0 0 6px ${C.live}` }} aria-hidden /> LIVE
          {g.startAt && <span style={{ color: C.mut }}>· {timeET(g.startAt)}</span>}
        </span>
        <span className="shrink-0 truncate font-[var(--font-mono)] text-[9.5px]" style={{ color: C.mut, border: `1px solid ${C.hair}`, background: "rgba(255,255,255,.04)", padding: "2px 7px", borderRadius: 6 }}>
          {[g.divisionLabel, g.tournamentName].filter(Boolean).join(" · ")}
        </span>
      </div>
      {side(g.awayName, g.awayScore, awayWon)}
      {side(g.homeName, g.homeScore, homeWon)}
    </div>
  );
}

export default function LiveScores() {
  const [games, setGames] = useState<LiveNowGame[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      getPublicLiveNow(40)
        .then((g) => active && (setGames((g ?? []).filter((x) => isPlausiblyLive(x, Date.now()))), setError(null)))
        .catch((e) => active && setError(e as Error));
    load();
    const t = setInterval(load, 30_000);
    return () => { active = false; clearInterval(t); };
  }, []);

  return (
    <div className="as-fade-in">
      <div className="px-[18px] pt-[8px]">
        <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em]" style={{ color: "#cdb98c" }}>Happening now</div>
        <h2 className="mt-1 font-[var(--font-display)] text-[23px] font-bold tracking-[-0.3px]" style={{ color: C.ink }}>Live scores</h2>
        <div className="mt-[5px] text-[12.5px]" style={{ color: C.dim }}>Every public game in progress, refreshing live.</div>
      </div>

      <div className="mt-[16px] px-[18px]">
        {error && (
          <div className="rounded-[15px] p-6 text-center text-[12px]" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#151b29,#10141f)", color: C.mut }}>
            Couldn&apos;t reach live scores. Try again in a moment.
          </div>
        )}
        {!games && !error && (
          <div className="space-y-[9px]">{[0, 1, 2].map((i) => <div key={i} className="h-[74px] animate-pulse rounded-[14px]" style={{ border: `1px solid ${C.hair}`, background: "rgba(16,20,31,.6)" }} />)}</div>
        )}
        {games && games.length > 0 && games.map((g) => <LiveRow key={g.gameId} g={g} />)}
        {games && games.length === 0 && !error && (
          <div className="rounded-[15px] p-8 text-center" style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#151b29,#10141f)" }}>
            <Radio className="mx-auto mb-3 h-7 w-7" style={{ color: C.mut }} />
            <div className="text-[13px] font-semibold" style={{ color: C.ink }}>No games are live right now</div>
            <div className="mt-1 text-[12px]" style={{ color: C.mut }}>Check <span style={{ color: C.g3 }}>Find</span> for what&apos;s live &amp; upcoming this weekend.</div>
          </div>
        )}
      </div>
    </div>
  );
}
