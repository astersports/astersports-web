import { useEffect, useMemo, useState } from "react";
import { Car, Bell, Navigation } from "lucide-react";
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

/** One short, honest weather nudge from the game-time forecast. */
function weatherAdvice(w: EventWeather): string {
  if (w.isSevereWarning) return "severe weather — check before you go";
  if (w.isRainWarning) return "rain likely — bring an umbrella";
  if (w.temperature >= 85) return "bring water + shade";
  if (w.temperature <= 38) return "bundle up — it's cold";
  return w.description.toLowerCase();
}

export default function NextGame({ games }: { games: TeamGame[] }) {
  const [tick, setTick] = useState(Date.now());
  const [weather, setWeather] = useState<EventWeather | null>(null);
  const [driveMin, setDriveMin] = useState<number | null>(null);

  const game = useMemo(() => pickNextGame(games), [games]);

  // live countdown — minute granularity is enough
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

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
  const who = game.trackedTeamName;
  const dirs = buildDirections(venue ?? null);
  const venueLine = [game.court, venue?.name].filter(Boolean).join(" · ");

  const leaveBy = driveMin !== null ? leaveByLabel(startMs, driveMin) : null;
  const remind = () => {
    if (driveMin === null) return;
    addLeaveReminder({
      title: `Leave for ${who} vs ${game.opponent || "TBD"}`,
      leaveAtMs: startMs - (driveMin + 10) * 60_000, // mirror leaveByLabel's 10-min buffer
      gameStartMs: startMs,
      location: venueLine || venue?.name || null,
      url: dirs?.google ?? null,
    });
  };

  return (
    <div className="mx-[18px] mb-4">
      {/* eyebrow */}
      <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[#cdb98c]">
        Up next · {who}
      </div>

      {/* countdown hero card */}
      <div className="mt-1 overflow-hidden rounded-[20px] border border-[rgba(255,255,255,0.055)] border-t-[rgba(255,255,255,0.09)] bg-[radial-gradient(280px_160px_at_50%_-10%,rgba(232,144,42,0.12),transparent),linear-gradient(180deg,#151b29,#10141f)] px-4 pb-4 pt-[18px] text-center">
        <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.14em] text-[#cdb98c]">
          {cd ? `${who} plays in` : "playing now"}
        </div>
        <div className="mt-1.5 mb-0.5 bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)] bg-clip-text font-[var(--font-mono)] text-[52px] font-bold leading-none tracking-[-2px] text-transparent">
          {cd ?? "LIVE"}
        </div>
        <div className="text-[15px] font-semibold text-[#f0f3fa]">
          {who} <span className="font-normal text-[#5f6981]">vs</span> {game.opponent || "TBD"}
        </div>
        <div className="mt-1 font-[var(--font-mono)] text-[12px] text-[#9aa4ba]">
          {venueLine || "Venue TBD"}
        </div>

        {(driveMin !== null || weather) && (
          <div className="mt-[13px] flex flex-col items-center gap-[9px] border-t border-[rgba(255,255,255,0.055)] pt-[13px]">
            {driveMin !== null && (
              <div className="flex items-center gap-2 text-[13px] text-[#9aa4ba]">
                <Car className="h-[15px] w-[15px] text-[#5f6981]" />
                ~{driveMin} min drive · <span className="font-semibold text-[#ffb648]">leave by {leaveBy}</span>
              </div>
            )}
            {weather && (
              <div className="flex items-center gap-1.5 text-[11.5px] text-[#9aa4ba]">
                <ColorfulWeatherIcon icon={weather.icon} isDay={weather.isDay} className="h-[14px] w-[14px]" />
                {Math.round(weather.temperature)}°F & {weather.description.toLowerCase()} — {weatherAdvice(weather)}
              </div>
            )}
          </div>
        )}
      </div>

      {/* directions — Apple / Google / Waze */}
      {dirs && (
        <div className="mt-[13px] flex gap-[9px]">
          <a href={dirs.apple} target="_blank" rel="noopener noreferrer"
            className="as-press flex flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-[#212939] bg-[#151b29] py-[9px] text-[11.5px] font-semibold text-[#e3e7ef]">
            <Navigation className="h-[14px] w-[14px]" /> Apple
          </a>
          <a href={dirs.google} target="_blank" rel="noopener noreferrer"
            className="as-press flex flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-[#212939] bg-[#151b29] py-[9px] text-[11.5px] font-semibold text-[#6ea2ff]">
            <Navigation className="h-[14px] w-[14px]" /> Google
          </a>
          <a href={dirs.waze} target="_blank" rel="noopener noreferrer"
            className="as-press flex flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-[#212939] bg-[#151b29] py-[9px] text-[11.5px] font-semibold text-[#2fd0ff]">
            <Navigation className="h-[14px] w-[14px]" /> Waze
          </a>
        </div>
      )}

      {/* remind me to leave — drops a calendar event at the leave-by time */}
      {leaveBy && (
        <button type="button" onClick={remind}
          className="as-press mt-[11px] flex w-full items-center justify-center gap-2 rounded-[13px] border border-[#212939] bg-[#151b29] py-[13px] font-[var(--font-display)] text-[13.5px] font-semibold text-[#f0f3fa]">
          <Bell className="h-[16px] w-[16px] text-[#F6CC55]" /> Remind me to leave
        </button>
      )}

      <div className="px-[18px] pb-1 pt-[11px] text-center font-[var(--font-mono)] text-[10.5px] leading-[1.5] text-[#5f6981]">
        Countdown + drive time from venue lat/lng. Weather via aster-weather.
      </div>
    </div>
  );
}
