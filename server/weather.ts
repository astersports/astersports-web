/**
 * Open-Meteo weather client.
 * - Keyless, free forecast API (no secret to manage).
 * - Current conditions + hourly + 7-day daily, in imperial units.
 * - Routed through the SSRF-safe fetch boundary (host is fixed, but redirects
 *   must still be re-validated per CLAUDE.md net guards).
 * - 10-minute cache per rounded coordinate, with stale-on-failure retention.
 */

import type {
  WeatherForecast,
  WeatherCurrent,
  WeatherDay,
  WeatherHour,
} from "../shared/types";
import { safeFetch } from "./_core/net/safeFetch";

const API_BASE = "https://api.open-meteo.com/v1/forecast";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const FORECAST_DAYS = 7;

interface CacheEntry {
  forecast: WeatherForecast;
  timestamp: number;
}
const cache: Map<string, CacheEntry> = new Map();

/** Round to 3 decimals (~110 m) so nearby callers share a cache entry. */
function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`;
}

function buildUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    timezone: "auto",
    forecast_days: String(FORECAST_DAYS),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m",
    hourly: "temperature_2m,weather_code,precipitation_probability,is_day",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max",
  });
  return `${API_BASE}?${params.toString()}`;
}

interface OpenMeteoResponse {
  timezone: string;
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    is_day: number;
    precipitation: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
  };
  hourly: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
    precipitation_probability: (number | null)[];
    is_day: number[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: (number | null)[];
    wind_speed_10m_max: number[];
    sunrise: string[];
    sunset: string[];
    uv_index_max: (number | null)[];
  };
}

function r(n: number): number {
  return Math.round(n);
}

function normalize(
  lat: number,
  lon: number,
  data: OpenMeteoResponse,
): Omit<WeatherForecast, "cached"> {
  const c = data.current;
  const current: WeatherCurrent = {
    temperatureF: r(c.temperature_2m),
    apparentTemperatureF: r(c.apparent_temperature),
    weatherCode: c.weather_code,
    windSpeedMph: r(c.wind_speed_10m),
    windDirectionDeg: r(c.wind_direction_10m),
    humidityPct: r(c.relative_humidity_2m),
    precipitationIn: Number(c.precipitation.toFixed(2)),
    isDay: c.is_day === 1,
  };

  const daily: WeatherDay[] = data.daily.time.map((date, i) => ({
    date,
    weatherCode: data.daily.weather_code[i],
    tempMaxF: r(data.daily.temperature_2m_max[i]),
    tempMinF: r(data.daily.temperature_2m_min[i]),
    precipProbPct: data.daily.precipitation_probability_max[i] ?? 0,
    windMaxMph: r(data.daily.wind_speed_10m_max[i]),
    sunrise: data.daily.sunrise[i],
    sunset: data.daily.sunset[i],
    uvIndexMax: Math.round(data.daily.uv_index_max[i] ?? 0),
  }));

  const hourly: WeatherHour[] = data.hourly.time.map((time, i) => ({
    time,
    temperatureF: r(data.hourly.temperature_2m[i]),
    weatherCode: data.hourly.weather_code[i],
    precipProbPct: data.hourly.precipitation_probability[i] ?? 0,
    isDay: data.hourly.is_day[i] === 1,
  }));

  return {
    latitude: lat,
    longitude: lon,
    timezone: data.timezone,
    current,
    daily,
    hourly,
    fetchedAt: new Date().toISOString(),
  };
}

export function isValidCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/**
 * Fetch a 7-day forecast for a coordinate. Returns cached data within the TTL,
 * and falls back to stale cache if a refresh fails.
 */
export async function fetchForecast(
  lat: number,
  lon: number,
): Promise<WeatherForecast> {
  if (!isValidCoord(lat, lon)) {
    throw new Error("Invalid coordinates");
  }

  const key = coordKey(lat, lon);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { ...cached.forecast, cached: true };
  }

  try {
    const res = await safeFetch(buildUrl(lat, lon), {
      timeoutMs: 12_000,
      init: { headers: { Accept: "application/json" } },
    });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const data = (await res.json()) as OpenMeteoResponse;
    if (!data.current || !data.daily || !data.hourly) {
      throw new Error("Open-Meteo: malformed response");
    }
    const forecast = { ...normalize(lat, lon, data), cached: false };
    cache.set(key, { forecast, timestamp: Date.now() });
    return forecast;
  } catch (error) {
    console.error("[Weather] fetch failed:", (error as Error).message);
    if (cached) return { ...cached.forecast, cached: true };
    throw error;
  }
}
