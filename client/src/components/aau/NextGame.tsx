import { useEffect, useMemo, useState } from "react";
import { Car } from "lucide-react";
import { ColorfulWeatherIcon } from "@aster/weather/icons";
import { getWeatherForEvent, type EventWeather } from "@aster/weather";
import { type TeamGame } from "@/lib/aster";
import { buildDirections } from "@/lib/aau/buildDirections";
import { pickNextGame, countdownLabel } from "@/lib/aau/nextGame";
import { getOrigin, estimateDrive, leaveByLabel } from "@/lib/aau/driveTime";

// Killer #2 — "Next game + travel". The soonest upcoming game across the tracked teams,
// with a live countdown, the venue, an honest (no-traffic) drive estimate + "leave by",
// game-time weather (@aster/weather / Open-Meteo), and Apple/Google directions. Pure read
// over get_public_aau_team_schedule; self-hides when nothing is upcoming. No fabrication —
// drive/weather/leave-by each render only when their real source resolves.

/** One short, honest weather nudge from the game-time forecast. */
function weatherAdvice(w: EventWeather): string {
  if (w.isSevereWarning) return "severe weather — check before you go";
  if (w.isRainWarning) return "rain likely — bring an umbrella";
  if (w.temperature >= 85) return "bring water + shade";
  if (w.temperature <= 38) return "bundle up — it's cold";
  return w.description.toLowerCase();
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    weekday: "short", hour: "numeric", minute: "2-digit",
  });
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

  return (
    <div className="mx-[18px] mb-4 overflow-hidden rounded-[20px] border border-[rgba(255,255,255,0.06)] bg-[radial-gradient(280px_160px_at_50%_-10%,rgba(232,144,42,0.12),transparent),linear-gradient(180deg,#151b29,#10141f)] px-4 pb-4 pt-[18px] text-center">
      <div className="font-[var(--font-mono)] text-[10px] uppercase tracking-[0.14em] text-[#cdb98c]">
        Up next · {who}
      </div>
      <div className="mt-2 font-[var(--font-mono)] text-[10.5px] text-[#5f6981]">
        {cd ? `${who} plays in` : "playing now"}
      </div>
      <div className="bg-[linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)] bg-clip-text font-[var(--font-display)] text-[40px] font-bold leading-[1.05] tracking-[-1px] text-transparent">
        {cd ?? "LIVE"}
      </div>
      <div className="mt-1 text-[14px] font-semibold text-[#f0f3fa]">
        {game.trackedTeamName} <span className="text-[#5f6981]">vs</span> {game.opponent || "TBD"}
      </div>
      <div className="mt-0.5 text-[11.5px] text-[#9aa4ba]">
        {venueLine || "Venue TBD"} · <span className="text-[#5f6981]">{timeLabel(startMs)}</span>
      </div>

      {(driveMin !== null || weather) && (
        <div className="mt-3 flex flex-col items-center gap-1.5">
          {driveMin !== null && (
            <div className="flex items-center gap-1.5 text-[12px] text-[#9aa4ba]">
              <Car className="h-[14px] w-[14px] text-[#5f6981]" />
              ~{driveMin} min drive · <span className="font-semibold text-[#cdb98c]">leave by {leaveByLabel(startMs, driveMin)}</span>
            </div>
          )}
          {weather && (
            <div className="flex items-center gap-1.5 text-[12px] text-[#9aa4ba]">
              <ColorfulWeatherIcon icon={weather.icon} isDay={weather.isDay} className="h-[15px] w-[15px]" />
              {Math.round(weather.temperature)}°F & {weather.description.toLowerCase()} — {weatherAdvice(weather)}
            </div>
          )}
        </div>
      )}

      {dirs && (
        <div className="mt-3 flex gap-2">
          <a href={dirs.apple} target="_blank" rel="noopener noreferrer"
            className="as-press flex-1 rounded-[12px] border border-[#212939] bg-[#10141f] py-[9px] text-[12px] font-semibold text-[#f0f3fa]">
            Apple Maps
          </a>
          <a href={dirs.google} target="_blank" rel="noopener noreferrer"
            className="as-press flex-1 rounded-[12px] border border-[#212939] bg-[#10141f] py-[9px] text-[12px] font-semibold text-[#f0f3fa]">
            Google Maps
          </a>
        </div>
      )}
    </div>
  );
}
