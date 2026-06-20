/**
 * Tourney Machine Multi-Tournament Scraper
 * - Targets all 5 tournament division URLs for 11U Girls
 * - 45-second cache TTL with stale-data retention on failure
 * - Eastern time zone parsing
 * - Game status detection: LIVE (75-min window), countdown (24h), upcoming, completed
 * - Team filter: "Legacy" string match
 * - Game ID regex: /^[PBG]\d+/
 */

import type { Game, GameStatus } from '../shared/types';

// ─── Tournament Registry ───
export const TOURNAMENT_REGISTRY = [
  {
    name: 'ZG NY Hoop Festival',
    dates: 'Jun 13–14, 2026',
    status: 'live' as const,
    tournamentId: 'h202602231534241950edcf7493d244b',
    divisionId: 'h202606101618262527126b329099740',
  },
  {
    name: 'ZG Girls National Finals',
    dates: 'May 30–31, 2026',
    status: 'completed' as const,
    result: 'Final Four',
    tournamentId: 'h20260526140601851c836df307c9e44',
    divisionId: 'h202605270300452052df7ec3ccbdc47',
  },
  {
    name: 'ZG Rumble for the Ring CT',
    dates: 'May 16–17, 2026',
    status: 'completed' as const,
    result: 'Finalists',
    tournamentId: 'h202602201707185454debbe82de994b',
    divisionId: 'h2026051318153444911a7018c855a44',
  },
  {
    name: 'ZG NY Metro Showdown',
    dates: 'Apr 18–19, 2026',
    status: 'completed' as const,
    result: '1–2',
    tournamentId: 'h2026021919164101401c8a60f40584c',
    divisionId: 'h202604151437169228f774d0fba4a4f',
  },
  {
    name: 'ZG Chase for the Chain NY',
    dates: 'Apr 11–12, 2026',
    status: 'completed' as const,
    result: 'Champions',
    tournamentId: 'h202602191530320243ffdc849100c4d',
    divisionId: 'h20260408001936980835160e0489147',
  },
];

function buildDivisionUrl(tournamentId: string, divisionId: string): string {
  return `https://tourneymachine.com/Public/Results/Division.aspx?IDTournament=${tournamentId}&IDDivision=${divisionId}`;
}

// ─── Constants ───
const CACHE_TTL_MS = 45_000; // 45 seconds
const GAME_DURATION_MIN = 75;
const LIVE_WINDOW_MS = GAME_DURATION_MIN * 60 * 1000;
const COUNTDOWN_WINDOW_MS = 24 * 60 * 60 * 1000;
const GAME_ID_REGEX = /^[PBG]\d+/;
const TEAM_FILTER = 'legacy';

// ─── Cache ───
interface CacheEntry {
  games: Game[];
  timestamp: number;
  tournamentName: string;
}
let cache: Map<string, CacheEntry> = new Map();

/**
 * Parse Eastern time date string from Tourney Machine.
 * Handles formats like "Sat 06/14/26 8:00 AM" or "6/14/2026 8:00 AM"
 */
export function parseGameDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') return null;

  try {
    const cleaned = dateStr.trim();

    // Remove day-of-week prefix if present (e.g., "Sat ")
    const withoutDay = cleaned.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/i, '');

    // Match date and time: M/D/YY or M/D/YYYY + H:MM AM/PM
    const match = withoutDay.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;

    const month = parseInt(match[1], 10);
    const day = parseInt(match[2], 10);
    let year = parseInt(match[3], 10);
    let hours = parseInt(match[4], 10);
    const minutes = parseInt(match[5], 10);
    const ampm = match[6].toUpperCase();

    // Handle 2-digit year
    if (year < 100) year += 2000;

    // Convert 12-hour to 24-hour
    if (ampm === 'PM' && hours !== 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;

    // Construct as Eastern time, then convert to UTC
    const isDST = isEasternDST(year, month, day, hours);
    const offsetHours = isDST ? 4 : 5;

    // Build UTC date by adding the offset
    const utc = new Date(Date.UTC(year, month - 1, day, hours + offsetHours, minutes, 0));
    return utc;
  } catch {
    return null;
  }
}

/**
 * Is the given Eastern wall-clock instant within US daylight saving time?
 * DST runs from 02:00 local on the second Sunday of March to 02:00 local on the
 * first Sunday of November. The `localHour` argument lets the two transition
 * Sundays be classified correctly at the 2 AM boundary (the November Sunday is
 * still DST before 02:00; the March Sunday is standard before 02:00).
 */
function isEasternDST(year: number, month: number, day: number, localHour: number): boolean {
  // DST starts second Sunday in March, ends first Sunday in November
  if (month < 3 || month > 11) return false;
  if (month > 3 && month < 11) return true;

  if (month === 3) {
    // Second Sunday in March — spring forward at 02:00 local.
    const firstDay = new Date(year, 2, 1).getDay();
    const secondSunday = firstDay === 0 ? 8 : (14 - firstDay + 1);
    if (day > secondSunday) return true;
    if (day < secondSunday) return false;
    // On the transition day, DST begins at 02:00.
    return localHour >= 2;
  }

  // month === 11: First Sunday in November — fall back at 02:00 local.
  const firstDay = new Date(year, 10, 1).getDay();
  const firstSunday = firstDay === 0 ? 1 : (7 - firstDay + 1);
  if (day < firstSunday) return true;
  if (day > firstSunday) return false;
  // On the transition day, DST is still in effect until 02:00.
  return localHour < 2;
}

/**
 * Determine game status based on current time and scores.
 */
export function getGameStatus(gameTime: Date, hasScores: boolean, isCompleted: boolean): GameStatus {
  const now = new Date();
  const elapsed = now.getTime() - gameTime.getTime();

  // If explicitly marked completed (has final scores)
  if (isCompleted && hasScores) return 'completed';

  // If game started and within 75-min window → LIVE
  if (elapsed >= 0 && elapsed <= LIVE_WINDOW_MS && !isCompleted) return 'live';

  // If past the live window and has scores → completed
  if (elapsed > LIVE_WINDOW_MS && hasScores) return 'completed';

  // If past the live window but no scores → still mark completed (game happened)
  if (elapsed > LIVE_WINDOW_MS) return 'completed';

  // If within 24 hours → countdown
  if (elapsed < 0 && Math.abs(elapsed) <= COUNTDOWN_WINDOW_MS) return 'countdown';

  // Otherwise → upcoming
  return 'upcoming';
}

/**
 * Check if a game is currently live.
 */
export function isGameLive(gameTime: Date, isCompleted: boolean, now?: Date): boolean {
  const currentTime = now || new Date();
  const elapsed = currentTime.getTime() - gameTime.getTime();
  return elapsed >= 0 && elapsed <= LIVE_WINDOW_MS && !isCompleted;
}

/**
 * Get countdown string for upcoming games.
 */
export function getCountdown(gameTime: Date, now?: Date): string | null {
  const currentTime = now || new Date();
  const diff = gameTime.getTime() - currentTime.getTime();

  if (diff <= 0 || diff > COUNTDOWN_WINDOW_MS) return null;

  const hours = Math.floor(diff / (60 * 60 * 1000));
  const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

  if (hours > 0) return `Starts in ${hours}h ${minutes}m`;
  return `Starts in ${minutes}m`;
}

/**
 * Parse Tourney Machine HTML to extract games.
 * TM structure: <tr> with 7+ <td> cells → Game ID, DateTime, Location, Team1, Score1, Score2, Team2
 */
export function parseGamesFromHtml(html: string, tournamentName: string): Game[] {
  const games: Game[] = [];

  // Extract all table rows
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;

  while ((trMatch = trRegex.exec(html)) !== null) {
    const rowHtml = trMatch[1];

    // Extract cells
    const cells: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(stripHtml(tdMatch[1]).trim());
    }

    // Need 7+ cells for a valid game row
    if (cells.length < 7) continue;

    // Check if first cell matches game ID pattern (P###, B###, G###)
    const gameId = cells[0];
    if (!GAME_ID_REGEX.test(gameId)) continue;

    // Check if either team contains "Legacy"
    const team1 = cells[3] || '';
    const team2 = cells[6] || '';
    const hasLegacy = team1.toLowerCase().includes(TEAM_FILTER) ||
                      team2.toLowerCase().includes(TEAM_FILTER);

    if (!hasLegacy) continue;

    // Parse: GameID, DateTime, Location, Team1, Score1, Score2, Team2
    const dateTimeStr = cells[1] || '';
    const location = cells[2] || '';
    const score1Str = cells[4] || '';
    const score2Str = cells[5] || '';

    const gameTime = parseGameDate(dateTimeStr);
    if (!gameTime) continue;

    const score1 = score1Str && /^\d+$/.test(score1Str) ? parseInt(score1Str, 10) : null;
    const score2 = score2Str && /^\d+$/.test(score2Str) ? parseInt(score2Str, 10) : null;

    const hasScores = score1 !== null && score2 !== null && (score1 > 0 || score2 > 0);
    const isCompleted = hasScores && (new Date().getTime() - gameTime.getTime() > LIVE_WINDOW_MS);
    const status = getGameStatus(gameTime, hasScores, isCompleted);

    // Determine Legacy's position
    const isLegacyTeam1 = team1.toLowerCase().includes(TEAM_FILTER);
    
    // Legacy's score and opponent's score
    const legacyScore = isLegacyTeam1 ? score1 : score2;
    const opponentScore = isLegacyTeam1 ? score2 : score1;
    const opponent = isLegacyTeam1 ? team2 : team1;

    // Calculate point differential from Legacy's perspective
    let pointDifferential: number | null = null;
    let legacyWon: boolean | null = null;

    if (hasScores && status === 'completed') {
      pointDifferential = legacyScore! - opponentScore!;
      legacyWon = legacyScore! > opponentScore!;
    }

    // For display: Legacy is always "home" in our UI (listed first)
    const isLegacyHome = true;

    games.push({
      id: `${tournamentName.replace(/\s/g, '-').toLowerCase()}-${gameId}`,
      homeTeam: 'Legacy Hoopers',
      awayTeam: opponent,
      homeScore: legacyScore,
      awayScore: opponentScore,
      gameTime: gameTime.toISOString(),
      court: location,
      division: '11U Girls',
      status,
      isLegacyHome,
      pointDifferential,
      legacyWon,
    });
  }

  return games;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').trim();
}

/**
 * Fetch games from a single tournament division page.
 */
async function fetchTournamentGames(tournament: typeof TOURNAMENT_REGISTRY[0]): Promise<Game[]> {
  const url = buildDivisionUrl(tournament.tournamentId, tournament.divisionId);
  const cacheKey = `${tournament.tournamentId}-${tournament.divisionId}`;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached.games;
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const games = parseGamesFromHtml(html, tournament.name);

    // Update cache
    cache.set(cacheKey, { games, timestamp: Date.now(), tournamentName: tournament.name });
    return games;
  } catch (error) {
    console.error(`[Scraper] ${tournament.name} fetch failed:`, (error as Error).message);

    // Return stale data if available
    if (cached) {
      console.log(`[Scraper] Returning stale data for ${tournament.name}`);
      return cached.games;
    }
    return [];
  }
}

/**
 * Fetch all games across all tournaments.
 */
export async function fetchAllGames(): Promise<{ games: Game[]; lastUpdated: string; cached: boolean }> {
  const results = await Promise.allSettled(
    TOURNAMENT_REGISTRY.map(t => fetchTournamentGames(t))
  );

  const allGames: Game[] = [];
  let anyFresh = false;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allGames.push(...result.value);
    }
  }

  // Check if any data was freshly fetched
  cache.forEach((entry) => {
    if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
      anyFresh = true;
    }
  });

  return {
    games: allGames,
    lastUpdated: new Date().toISOString(),
    cached: !anyFresh,
  };
}

/**
 * Get the tournament registry for display.
 */
export function getTournamentRegistry() {
  return TOURNAMENT_REGISTRY.map(t => ({
    ...t,
    url: buildDivisionUrl(t.tournamentId, t.divisionId),
  }));
}

/**
 * Force refresh all caches.
 */
export function invalidateAllCaches(): void {
  cache.clear();
}
