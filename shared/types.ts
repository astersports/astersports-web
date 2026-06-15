/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";

// ─── AAU Basketball Types ───

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
