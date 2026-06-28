import { useMemo } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import type { TeamGame } from "@/lib/aster";
import { findConflicts } from "@/lib/aau/conflicts";
import type { TrackedTeam } from "@/lib/aau/trackingStore";

// Killer #3 — Conflict radar + split-up. "Two kids, two courts, overlapping. We catch it
// — and tell you who covers whom." Pure read over get_public_aau_team_schedule; renders
// ONLY when a real overlap exists across two tracked teams on the same day (an alert
// surface, not a permanent card). No fabrication, no held flip.
interface Props {
  tracked: TrackedTeam[];
  games: TeamGame[];
}

export default function ConflictRadar({ tracked, games }: Props) {
  // Derived, not fetched — MyTeams owns the single schedule read and passes games down.
  const days = useMemo(
    () => (tracked.length < 2 ? [] : findConflicts(tracked, games, new Date())),
    [tracked, games],
  );

  if (!days.length) return null;

  return (
    <div className="mx-[18px] mb-4 space-y-3" role="region" aria-label="Schedule conflicts across your tracked teams">
      {days.map((day) => (
        <div
          key={day.dayKey}
          className="overflow-hidden rounded-[16px] border border-[rgba(255,107,94,0.28)] bg-[radial-gradient(280px_120px_at_18%_0%,rgba(255,107,94,0.10),transparent),linear-gradient(180deg,#F9FAFB,#FFFFFF)]"
        >
          {/* header: day · "your day" + overlap count */}
          <div className="flex items-center justify-between border-b border-[rgba(0,0,0,0.06)] px-[15px] py-[11px]">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-[15px] w-[15px] text-[#DC2626]" aria-hidden="true" />
              <span className="text-[20px] font-semibold text-[#1A1D23]">{day.dayLabel}</span>
              <span className="font-[var(--font-mono)] text-[16px] text-[#4B5563]">· your day</span>
            </div>
            <span className="rounded-full border border-[rgba(255,107,94,0.4)] bg-[rgba(255,107,94,0.12)] px-[9px] py-[3px] font-[var(--font-mono)] text-[16px] font-semibold text-[#DC2626]">
              {day.overlaps.length} game{day.overlaps.length === 1 ? "" : "s"} overlap
            </span>
          </div>

          {/* the involved games */}
          <div className="px-[15px] py-[10px]">
            {day.games.map((g) => (
              <div key={g.teamKey + g.timeLabel} className="flex items-center gap-3 py-[7px]">
                <span className="font-[var(--font-mono)] text-[19.2px] font-semibold tabular-nums text-[#1A1D23] w-[58px] shrink-0">
                  {g.timeLabel}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[20.8px] font-semibold text-[#1A1D23]">{g.label}</span>
                  <small className="mt-0.5 block truncate font-[var(--font-mono)] text-[16px] text-[#4B5563]">
                    {[g.court, g.venue, g.opponent ? `vs ${g.opponent}` : null].filter(Boolean).join(" · ")}
                  </small>
                </span>
              </div>
            ))}
          </div>

          {/* overlap callout(s) — who runs at the same time */}
          {day.overlaps.map((o, i) => {
            // honest tip-off gap: the minutes between the two starts (real math, both Dates).
            // When the tips are staggered, one parent can catch the start of A then cross to B —
            // we surface the exact gap so the split plan is concrete, not vague.
            const gapMin = Math.round(Math.abs(o.b.start.getTime() - o.a.start.getTime()) / 60_000);
            const earlier = o.a.start.getTime() <= o.b.start.getTime() ? o.a : o.b;
            const later = earlier === o.a ? o.b : o.a;
            return (
            <div
              key={i}
              className="flex items-start gap-2 border-t border-[rgba(0,0,0,0.06)] bg-[rgba(255,107,94,0.06)] px-[15px] py-[10px]"
            >
              <Clock className="mt-px h-[13px] w-[13px] shrink-0 text-[#DC2626]" aria-hidden="true" />
              <div className="text-[19.2px] leading-[1.5] text-[#1A1D23]">
                <span className="font-semibold text-[#DC2626]">Overlap · {o.windowLabel}</span>
                {" — "}
                {o.a.label} ({o.a.court ?? "court TBD"}, {o.a.timeLabel}) and {o.b.label} ({o.b.court ?? "court TBD"},{" "}
                {o.b.timeLabel}) run at the same time. Split up?
                {gapMin > 0 && (
                  <span className="mt-1 block font-[var(--font-mono)] text-[16.8px] text-[#374151]">
                    Tips stagger {gapMin} min — one of you can catch {earlier.label}&apos;s start, then cross to {later.label}.
                  </span>
                )}
                {(!o.a.court || !o.b.court) && (
                  <span className="text-[#374151]"> Leave-by pending venue — the drive plan firms up once courts post.</span>
                )}
              </div>
            </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
