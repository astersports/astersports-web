import { useEffect, useState } from "react";
import { getPublicLiveNow, type LiveNowGame } from "@/lib/aster";
import { C } from "./findUi";

// Render state 01 — "Live right now" strip. Reads get_public_live_now ON LOAD (the realtime
// tick is TECH-1, deferred — spec §R5/§7). NO fabricated tick: if nothing is live the strip
// hides entirely (never a fake card). Horizontal scroll of compact score cards.

function scoreLabel(g: LiveNowGame): string {
  if (g.homeScore == null || g.awayScore == null) return "—";
  return `${g.homeScore}–${g.awayScore}`;
}

function timeLabel(g: LiveNowGame): string {
  if (!g.startAt) return "Live";
  const d = new Date(g.startAt);
  if (Number.isNaN(d.getTime())) return "Live";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function LiveStrip() {
  const [games, setGames] = useState<LiveNowGame[] | null>(null);

  useEffect(() => {
    let live = true;
    getPublicLiveNow(12)
      .then((g) => live && setGames(g))
      .catch(() => live && setGames([]));
    return () => {
      live = false;
    };
  }, []);

  // Hide the strip until we know there's something live — never fake a pulse on empty/load.
  if (!games || games.length === 0) return null;

  return (
    <section aria-label="Live right now">
      <div
        className="mx-[18px] mb-[9px] mt-[18px] flex items-center gap-[9px] font-[var(--font-mono)] text-[10px] uppercase tracking-[0.1em]"
        style={{ color: C.mut }}
      >
        <span
          className="as-pulse inline-block h-[7px] w-[7px] rounded-full"
          style={{ background: C.live, boxShadow: `0 0 8px ${C.live}` }}
          aria-hidden
        />
        Live right now
        <span className="h-px flex-1" style={{ background: C.hair }} />
      </div>
      <div
        className="flex gap-[10px] overflow-x-auto px-[18px] pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-live="polite"
      >
        {games.map((g) => {
          const lit = g.homeScore != null && g.awayScore != null;
          return (
            <div
              key={g.gameId}
              className="flex-[0_0_154px] rounded-[13px] p-[11px_12px]"
              style={{
                border: `1px solid ${lit ? "rgba(52,224,164,.22)" : C.hair}`,
                background:
                  "radial-gradient(120px 60px at 20% 0,rgba(52,224,164,.1),transparent),linear-gradient(180deg,#151b29,#10141f)",
              }}
            >
              <div className="flex items-center gap-[5px] font-[var(--font-mono)] text-[9px]" style={{ color: lit ? C.live : C.mut }}>
                {lit && (
                  <span
                    className="as-pulse inline-block h-[6px] w-[6px] rounded-full"
                    style={{ background: C.live, boxShadow: `0 0 6px ${C.live}` }}
                    aria-hidden
                  />
                )}
                {timeLabel(g)}
              </div>
              <div className="mt-[6px] truncate font-[var(--font-display)] text-[13px] font-semibold" style={{ color: C.ink }}>
                {g.homeName} <small style={{ color: C.mut, fontWeight: 400 }}>vs {g.awayName}</small>
              </div>
              <div
                className="mt-[2px] font-[var(--font-mono)] text-[18px] font-bold"
                style={lit ? { background: C.grad, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" } : { color: C.mut }}
              >
                {scoreLabel(g)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
