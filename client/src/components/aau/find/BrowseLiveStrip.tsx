import { useEffect, useState } from "react";
import { getPublicLiveNow, type LiveNowGame } from "@/lib/aster";
import { isPlausiblyLive } from "../LiveScores";
import { C } from "./findUi";

// "Live now" section for Browse (North Star §1: Live is a section in Browse + a strip in Home, not
// its own tab). Compact list of currently-live public games across tournaments, polled every 30s.
// Self-hides when nothing is plausibly live — never a fake tick. Reuses the get_public_live_now feed
// + the stale-row guard from LiveScores.

export default function BrowseLiveStrip() {
  const [games, setGames] = useState<LiveNowGame[]>([]);

  useEffect(() => {
    let active = true;
    const load = () =>
      getPublicLiveNow(8)
        .then((g) => active && setGames((g ?? []).filter((x) => isPlausiblyLive(x, Date.now()))))
        .catch(() => active && setGames([]));
    load();
    const t = setInterval(load, 30_000);
    return () => { active = false; clearInterval(t); };
  }, []);

  if (games.length === 0) return null;

  return (
    <div className="mb-[6px]">
      <div className="mx-[18px] mb-[9px] flex items-center gap-[9px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.1em]" style={{ color: C.live }}>
        <span className="as-pulse inline-block h-[6px] w-[6px] rounded-full" style={{ background: C.live, boxShadow: `0 0 8px ${C.live}` }} aria-hidden />
        Live now
        <span className="h-px flex-1" style={{ background: C.hair }} />
      </div>
      <div className="space-y-[8px] px-[18px]">
        {games.map((g) => {
          const homeWon = g.homeScore != null && g.awayScore != null && g.homeScore > g.awayScore;
          return (
            <div key={g.gameId} className="flex items-center gap-[10px] rounded-[12px] px-[11px] py-[9px]" style={{ border: "1px solid rgba(52,224,164,.22)", background: "rgba(52,224,164,.04)" }}>
              <span className="as-pulse inline-block h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: C.live }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-[var(--font-display)] text-[12.5px] font-semibold" style={{ color: C.ink }}>
                  {g.awayName} <span style={{ color: C.mut, fontWeight: 400 }}>vs</span> {g.homeName}
                </span>
                <span className="mt-[1px] block truncate font-[var(--font-mono)] text-[9.5px]" style={{ color: C.mut }}>
                  {[g.divisionLabel, g.tournamentName].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="shrink-0 font-[var(--font-mono)] text-[14px] font-bold" style={{ color: C.live }}>
                <span style={{ opacity: homeWon ? 0.6 : 1 }}>{g.awayScore ?? "—"}</span>
                <span style={{ color: C.mut }}>–</span>
                <span style={{ opacity: g.homeScore != null && g.awayScore != null && !homeWon ? 0.6 : 1 }}>{g.homeScore ?? "—"}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
