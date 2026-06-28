import { useEffect, useMemo, useState } from "react";
import { Car, Bell, Navigation, Check } from "lucide-react";
import { ColorfulWeatherIcon } from "@aster/weather/icons";
import { getWeatherForEvent, type EventWeather } from "@aster/weather";
import { type TeamGame } from "@/lib/aster";
import { buildDirections } from "@/lib/aau/buildDirections";
import { pickNextGame, countdownLabel } from "@/lib/aau/nextGame";
import { getOrigin, estimateDrive, leaveByLabel } from "@/lib/aau/driveTime";
import { addLeaveReminder } from "@/lib/aau/calendar";

// Killer #2 — "Next game + travel" (render set, screen 02). The soonest upcoming game
// across the tracked teams, rendered exactly to the design: eyebrow → countdown hero card
// (big gradient countdown, who, venue, drive + "leave by" + game-time weather) → Apple/
// Google/Waze directions → "Remind me to leave" (drops a calendar event at leave-by) →
// provenance footnote. Pure read over get_public_aau_team_schedule; self-hides when nothing
// is upcoming. No fabrication — drive/weather/leave-by each render only when their real
// source resolves; "Remind me" appears only once a leave-by time exists.

/** One short, honest weather nudge — null when there's nothing to add beyond the condition itself,
 *  so the caller never renders "overcast — overcast" (the descriptor was duplicating). */
function weatherAdvice(w: EventWeather): string | null {
  if (w.isSevereWarning) return "severe weather — check before you go";
  if (w.isRainWarning) return "rain likely — bring an umbrella";
  if (w.temperature >= 85) return "bring water + shade";
  if (w.temperature <= 38) return "bundle up — it's cold";
  return null;
}

export default function NextGame({ games }: { games: TeamGame[] }) {
  const [tick, setTick] = useState(Date.now());
  const [weather, setWeather] = useState<EventWeather | null>(null);
  const [driveMin, setDriveMin] = useState<number | null>(null);
  const [reminded, setReminded] = useState(false); // optimistic "Reminder set ✓" feedback

  const game = useMemo(() => pickNextGame(games), [games]);

  // live countdown — minute granularity is enough
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // a reminder belongs to ONE game — reset the optimistic flag whenever the chosen next
  // game changes, so the button doesn't stay disabled (with a stale leave-by) for the next.
  useEffect(() => { setReminded(false); }, [game?.gameId]);

  // weather + drive for the chosen game
  const venue = game?.venue;
  const hasCoords = typeof venue?.lat === "number" && typeof venue?.lng === "number";
  useEffect(() => {
    setWeather(null);
    setDriveMin(null);
    if (!game?.startAt || !hasCoords || !venue) return;
    let live = true;
    getWeatherForEvent({ lat: venue.lat as number, lon: venue.lng as number }, game.startAt)
      .then((w) => live && setWeather(w))
      .catch(() => {});
    getOrigin()
      .then((o) => estimateDrive({ lat: venue.lat as number, lon: venue.lng as number }, o))
      .then((d) => live && setDriveMin(d?.minutes ?? null))
      .catch(() => {});
    return () => { live = false; };
  }, [game?.gameId, hasCoords]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!game || !game.startAt) return null;
  const startMs = new Date(game.startAt).getTime();
  const cd = countdownLabel(startMs, tick);
  // urgency: tip is within the hour — emphasize the countdown so families don't miss it
  const minsToTip = Math.floor((startMs - tick) / 60000);
  const soon = cd !== null && minsToTip <= 60;
  const who = game.trackedTeamName;
  const dirs = buildDirections(venue ?? null);
  const venueLine = [game.court, venue?.name].filter(Boolean).join(" · ");

  const leaveBy = driveMin !== null ? leaveByLabel(startMs, driveMin) : null;
  const advice = weather ? weatherAdvice(weather) : null; // computed once (Copilot #159)
  const remind = () => {
    if (driveMin === null) return;
    // Honest optimistic UI: only announce "Reminder set" when the calendar drop actually
    // happened. addLeaveReminder returns false with no DOM (SSR) and can throw in rare envs —
    // on either, keep the button actionable and stay silent.
    let ok = false;
    try {
      ok = addLeaveReminder({
        title: `Leave for ${who} vs ${game.opponent || "TBD"}`,
        leaveAtMs: startMs - (driveMin + 10) * 60_000, // mirror leaveByLabel's 10-min buffer
        gameStartMs: startMs,
        location: venueLine || venue?.name || null,
        url: dirs?.google ?? null,
      });
    } catch {
      ok = false;
    }
    if (ok) setReminded(true);
  };

  return (
    <div className="mx-[18px] mb-4">
      {/* eyebrow */}
      <div className="flex items-center gap-2 font-[var(--font-mono)] text-[11.5px] uppercase tracking-[0.12em] text-[#8F6708]">
        <span>Up next · {who}</span>
        {game.isBracket && (
          <span className="rounded-full bg-[rgba(124,58,237,0.10)] px-[7px] py-[1px] text-[10px] font-bold tracking-[0.08em] text-[#7C3AED]">BRACKET</span>
        )}
      </div>

      {/* countdown hero card */}
      <div className="mt-1 overflow-hidden rounded-[20px] border border-[rgba(0,0,0,0.06)] border-t-[rgba(0,0,0,0.10)] bg-[radial-gradient(280px_160px_at_50%_-10%,rgba(232,144,42,0.12),transparent),linear-gradient(180deg,#F9FAFB,#FFFFFF)] px-4 pb-4 pt-[18px] text-center">
        <div className="font-[var(--font-mono)] text-[11.5px] uppercase tracking-[0.14em] text-[#8F6708]">
          {cd ? (soon ? `${who} tips soon · in` : `${who} plays in`) : "playing now"}
        </div>
        <div
          role="img"
          aria-label={cd ? `${who} plays in ${cd}` : "playing now"}
          className={`mt-1.5 mb-0.5 bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)] bg-clip-text font-[var(--font-mono)] text-[52px] font-bold leading-none tracking-[-2px] text-transparent ${soon ? "as-pulse" : ""}`}
        >
          {cd ?? "LIVE"}
        </div>
        <div className="text-[17.3px] font-semibold text-[#1A1D23]">
          {who} <span className="font-normal text-[#4B5563]">vs</span> {game.opponent || "TBD"}
        </div>
        <div className="mt-1 font-[var(--font-mono)] text-[13.8px] text-[#374151]">
          {venueLine || "Venue TBD"}
        </div>

        {(driveMin !== null || weather) && (
          <div className="mt-[13px] flex flex-col items-center gap-[9px] border-t border-[rgba(0,0,0,0.06)] pt-[13px]">
            {driveMin !== null && (
              <div className="flex items-center gap-2 text-[15px] text-[#374151]">
                <Car className="h-[15px] w-[15px] text-[#4B5563]" />
                ~{driveMin} min drive · <span className="font-semibold text-[#ffb648]">leave by {leaveBy}</span>
              </div>
            )}
            {weather && (
              <div className="flex items-center gap-1.5 text-[13.2px] text-[#374151]">
                <ColorfulWeatherIcon icon={weather.icon} isDay={weather.isDay} className="h-[14px] w-[14px]" />
                {Math.round(weather.temperature)}°F · {weather.description.toLowerCase()}{advice ? ` — ${advice}` : ""}
              </div>
            )}
          </div>
        )}
      </div>

      {/* directions — Apple / Google / Waze */}
      {dirs && (
        <div className="mt-[13px] flex gap-[9px]">
          <a href={dirs.apple} target="_blank" rel="noopener noreferrer"
            className="as-press flex flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-[#E2E8F0] bg-[#F9FAFB] py-[9px] text-[13.2px] font-semibold text-[#374151]">
            <Navigation className="h-[14px] w-[14px]" /> Apple
          </a>
          <a href={dirs.google} target="_blank" rel="noopener noreferrer"
            className="as-press flex flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-[#E2E8F0] bg-[#F9FAFB] py-[9px] text-[13.2px] font-semibold text-[#6ea2ff]">
            <Navigation className="h-[14px] w-[14px]" /> Google
          </a>
          <a href={dirs.waze} target="_blank" rel="noopener noreferrer"
            className="as-press flex flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-[#E2E8F0] bg-[#F9FAFB] py-[9px] text-[13.2px] font-semibold text-[#2fd0ff]">
            <Navigation className="h-[14px] w-[14px]" /> Waze
          </a>
        </div>
      )}

      {/* remind me to leave — drops a calendar event at the leave-by time */}
      {leaveBy && (
        <button type="button" onClick={remind} disabled={reminded}
          aria-label={reminded ? `Reminder set to leave by ${leaveBy}` : `Remind me to leave by ${leaveBy}`}
          className={`as-press mt-[11px] flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[13px] border py-[13px] font-[var(--font-display)] text-[14.1px] font-semibold transition-colors ${reminded ? "border-[rgba(22,163,74,0.35)] bg-[rgba(22,163,74,0.06)] text-[#16A34A]" : "border-[#E2E8F0] bg-[#F9FAFB] text-[#1A1D23]"}`}>
          {reminded ? (
            <><Check className="h-[16px] w-[16px]" aria-hidden="true" /> Reminder set</>
          ) : (
            <><Bell className="h-[16px] w-[16px] text-[#8F6708]" aria-hidden="true" /> Remind me to leave</>
          )}
        </button>
      )}
      {reminded && <span role="status" aria-live="polite" className="sr-only">Reminder set to leave by {leaveBy}</span>}

      <div className="px-[18px] pb-1 pt-[11px] text-center font-[var(--font-mono)] text-[12.1px] leading-[1.5] text-[#4B5563]">
        Countdown + drive time from venue lat/lng. Weather via aster-weather.
      </div>
    </div>
  );
}
