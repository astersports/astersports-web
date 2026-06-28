/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// ─── AAU Hub Types ───

export type GameStatus = 'live' | 'countdown' | 'upcoming' | 'completed';

export interface Game {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  gameTime: string; // ISO 8601 UTC
  court: string;
  division: string;
  status: GameStatus;
  isLegacyHome: boolean;
  pointDifferential: number | null;
  legacyWon: boolean | null;
}

export interface TournamentResult {
  tournamentName: string;
  date: string;
  wins: number;
  losses: number;
  games: Game[];
}

export interface LeaderboardEntry {
  teamName: string;
  division: string;
  wins: number;
  losses: number;
  avgPointDifferential: number;
  winStreak: number;
  currentStreak: number;
  games: Game[];
}

export interface Location {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  notes?: string;
}

export interface ScraperResponse {
  games: Game[];
  lastUpdated: string;
  source: string;
  cached: boolean;
}

export interface GameCheckNotification {
  gameId: string;
  type: 'game_starting' | 'game_live' | 'game_completed';
  message: string;
  timestamp: string;
}

// ─── Weather Types (Open-Meteo) ───

/** A geocoded venue used to resolve a forecast. */
export interface WeatherVenue {
  name: string;
  city: string;
  latitude: number;
  longitude: number;
}

export interface WeatherCurrent {
  temperatureF: number;
  apparentTemperatureF: number;
  weatherCode: number; // WMO code
  windSpeedMph: number;
  windDirectionDeg: number;
  humidityPct: number;
  precipitationIn: number;
  isDay: boolean;
}

export interface WeatherDay {
  date: string; // YYYY-MM-DD (venue-local)
  weatherCode: number;
  tempMaxF: number;
  tempMinF: number;
  precipProbPct: number;
  windMaxMph: number;
  sunrise: string; // ISO (venue-local)
  sunset: string; // ISO (venue-local)
  uvIndexMax: number;
}

export interface WeatherHour {
  time: string; // ISO (venue-local)
  temperatureF: number;
  weatherCode: number;
  precipProbPct: number;
  isDay: boolean;
}

export interface WeatherForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  current: WeatherCurrent;
  daily: WeatherDay[];
  hourly: WeatherHour[];
  fetchedAt: string; // ISO
  cached: boolean;
}
