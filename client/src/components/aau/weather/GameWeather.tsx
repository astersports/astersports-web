import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import WeatherIcon, { describeWeather } from "./WeatherIcon";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/** Venue-local "YYYY-MM-DDTHH:mm" for an instant, in the forecast's timezone. */
function localStamp(date: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date).replace(" ", "T");
  } catch {
    return date.toISOString().slice(0, 16);
  }
}

/**
 * Compact forecast for a single game. Renders only when the game is within the
 * next 7 days (Open-Meteo's forecast horizon) — past games and games further
 * out show nothing.
 */
export default function GameWeather({ latitude, longitude, gameTime, compact = true }: {
  latitude?: number;
  longitude?: number;
  gameTime: string;
  compact?: boolean;
}) {
  const hasCoords = typeof latitude === "number" && typeof longitude === "number";
  const ts = new Date(gameTime).getTime();
  const fromNow = ts - Date.now();
  const inWindow = hasCoords && fromNow > -3 * 60 * 60 * 1000 && fromNow < SEVEN_DAYS_MS;

  const { data } = trpc.weather.get.useQuery(
    { latitude: latitude as number, longitude: longitude as number },
    { enabled: inWindow, staleTime: 5 * 60 * 1000, refetchInterval: 15 * 60 * 1000 },
  );

  const slot = useMemo(() => {
    if (!data) return null;
    const stamp = localStamp(new Date(gameTime), data.timezone);
    const day = stamp.slice(0, 10);
    const daily = data.daily.find((d) => d.date === day) ?? null;
    // nearest hour at/after tip-off, else last hour of that day
    const hours = data.hourly.filter((h) => h.time.slice(0, 10) === day);
    const hour = hours.find((h) => h.time >= stamp) ?? hours[hours.length - 1] ?? null;
    if (!daily && !hour) return null;
    return {
      code: hour?.weatherCode ?? daily!.weatherCode,
      isDay: hour?.isDay ?? true,
      temp: hour?.temperatureF ?? daily!.tempMaxF,
      precip: Math.max(hour?.precipProbPct ?? 0, daily?.precipProbPct ?? 0),
    };
  }, [data, gameTime]);

  if (!inWindow || !slot) return null;

  const label = `Game-time forecast: ${describeWeather(slot.code)}, ${slot.temp}°F${slot.precip >= 10 ? `, ${slot.precip}% chance of precipitation` : ""}`;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: compact ? "2px 7px" : "4px 9px", borderRadius: 999,
        backgroundColor: "var(--as-bg-tertiary)", border: "1px solid var(--as-border-subtle)",
      }}
    >
      <span aria-hidden="true" style={{ display: "inline-flex" }}>
        <WeatherIcon code={slot.code} isDay={slot.isDay} size={compact ? 16 : 20} animate={false} />
      </span>
      <span aria-hidden="true" style={{ fontSize: compact ? 11 : 12, fontWeight: 700, color: "var(--as-text-primary)" }}>{slot.temp}°</span>
      {slot.precip >= 10 && (
        <span aria-hidden="true" style={{ fontSize: 9, fontWeight: 600, color: "var(--as-accent)" }}>{slot.precip}%</span>
      )}
    </span>
  );
}
