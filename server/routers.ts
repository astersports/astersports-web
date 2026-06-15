import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { fetchAllGames, invalidateAllCaches, getTournamentRegistry } from "./scraper";
import { notifyOwner } from "./_core/notification";
import { sdk } from "./_core/sdk";
import type { Game } from "../shared/types";

// Track last known game statuses for notifications
const lastKnownStatuses: Map<string, string> = new Map();

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // AAU Basketball endpoints
  games: router({
    list: publicProcedure.query(async () => {
      const result = await fetchAllGames();
      return {
        games: result.games,
        lastUpdated: result.lastUpdated,
        cached: result.cached,
        tournaments: getTournamentRegistry(),
      };
    }),

    live: publicProcedure.query(async () => {
      const result = await fetchAllGames();
      const liveGames = result.games.filter((g: Game) => g.status === 'live');
      return {
        games: liveGames,
        lastUpdated: result.lastUpdated,
        cached: result.cached,
      };
    }),

    completed: publicProcedure.query(async () => {
      const result = await fetchAllGames();
      const completedGames = result.games.filter((g: Game) => g.status === 'completed');
      return {
        games: completedGames,
        lastUpdated: result.lastUpdated,
      };
    }),

    refresh: publicProcedure.mutation(async () => {
      invalidateAllCaches();
      const result = await fetchAllGames();
      return {
        games: result.games,
        lastUpdated: result.lastUpdated,
        cached: false,
      };
    }),
  }),

  leaderboard: router({
    get: publicProcedure.query(async () => {
      const result = await fetchAllGames();
      const completedGames = result.games.filter((g: Game) => g.status === 'completed');

      // Group by opponent and compute stats
      const opponentStats = new Map<string, {
        wins: number;
        losses: number;
        totalDiff: number;
        currentStreak: number;
        maxStreak: number;
        games: Game[];
      }>();

      const sorted = [...completedGames].sort(
        (a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()
      );

      let totalWins = 0;
      let totalLosses = 0;
      let totalDiff = 0;
      let currentStreak = 0;
      let maxStreak = 0;

      for (const game of sorted) {
        if (game.legacyWon === true) {
          totalWins++;
          currentStreak++;
          if (currentStreak > maxStreak) maxStreak = currentStreak;
        } else if (game.legacyWon === false) {
          totalLosses++;
          currentStreak = 0;
        }
        if (game.pointDifferential !== null) {
          totalDiff += game.pointDifferential;
        }

        const opponent = game.isLegacyHome ? game.awayTeam : game.homeTeam;
        if (!opponentStats.has(opponent)) {
          opponentStats.set(opponent, { wins: 0, losses: 0, totalDiff: 0, currentStreak: 0, maxStreak: 0, games: [] });
        }
        const stats = opponentStats.get(opponent)!;
        stats.games.push(game);
        if (game.legacyWon === true) {
          stats.wins++;
          stats.currentStreak++;
          if (stats.currentStreak > stats.maxStreak) stats.maxStreak = stats.currentStreak;
        } else {
          stats.losses++;
          stats.currentStreak = 0;
        }
        if (game.pointDifferential !== null) {
          stats.totalDiff += game.pointDifferential;
        }
      }

      const entries: Array<{
        teamName: string;
        division: string;
        wins: number;
        losses: number;
        avgPointDifferential: number;
        winStreak: number;
        currentStreak: number;
        games: Game[];
      }> = [];

      opponentStats.forEach((stats, name) => {
        entries.push({
          teamName: name,
          division: '11U Girls',
          wins: stats.wins,
          losses: stats.losses,
          avgPointDifferential: stats.games.length > 0 ? Math.round((stats.totalDiff / stats.games.length) * 10) / 10 : 0,
          winStreak: stats.maxStreak,
          currentStreak: stats.currentStreak,
          games: stats.games,
        });
      });

      return {
        entries,
        overall: {
          wins: totalWins,
          losses: totalLosses,
          avgPointDifferential: sorted.length > 0 ? Math.round((totalDiff / sorted.length) * 10) / 10 : 0,
          winStreak: maxStreak,
          currentStreak,
        },
        lastUpdated: result.lastUpdated,
      };
    }),
  }),
});

// Register the scheduled game-check endpoint outside tRPC
export function registerScheduledRoutes(app: any) {
  app.post('/api/scheduled/game-check', async (req: any, res: any) => {
    try {
      // Authenticate cron request
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        return res.status(403).json({ error: 'cron-only' });
      }

      const result = await fetchAllGames();
      const notifications: Array<{ gameId: string; type: string; message: string }> = [];

      for (const game of result.games) {
        const lastStatus = lastKnownStatuses.get(game.id);

        if (lastStatus && lastStatus !== game.status) {
          if (game.status === 'live' && lastStatus !== 'live') {
            notifications.push({
              gameId: game.id,
              type: 'game_live',
              message: `LIVE NOW: ${game.awayTeam} vs ${game.homeTeam}`,
            });
          } else if (game.status === 'completed' && lastStatus === 'live') {
            const winner = (game.homeScore ?? 0) > (game.awayScore ?? 0) ? game.homeTeam : game.awayTeam;
            notifications.push({
              gameId: game.id,
              type: 'game_completed',
              message: `FINAL: ${game.awayTeam} ${game.awayScore} - ${game.homeTeam} ${game.homeScore}. ${winner} wins!`,
            });
          } else if (game.status === 'countdown' && lastStatus === 'upcoming') {
            notifications.push({
              gameId: game.id,
              type: 'game_starting',
              message: `STARTING SOON: ${game.awayTeam} vs ${game.homeTeam}`,
            });
          }
        }

        lastKnownStatuses.set(game.id, game.status);
      }

      if (notifications.length > 0) {
        const content = notifications.map(n => `${n.type}: ${n.message}`).join('\n');
        await notifyOwner({
          title: `Game Status Update (${notifications.length} change${notifications.length > 1 ? 's' : ''})`,
          content,
        });
      }

      res.json({
        success: true,
        gamesChecked: result.games.length,
        notifications: notifications.length,
        details: notifications,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[game-check] Error:', (error as Error).message);
      res.status(500).json({
        success: false,
        error: (error as Error).message,
      });
    }
  });
}

export type AppRouter = typeof appRouter;
