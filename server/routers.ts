import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { ENV } from "./_core/env";
import { TRPCError } from "@trpc/server";
import { billingRouter } from "./billing";
import { tenantsRouter } from "./routers/tenants";
import { studioRouter } from "./routers/studio";
import { studioBillingRouter } from "./routers/studioBilling";
import { adminLogsRouter } from "./routers/adminLogs";
import { platformRouter } from "./routers/platform";
import { firmAdminRouter } from "./routers/firmAdmin";
import { inviteLinksRouter } from "./routers/inviteLinks";
import { fetchAllGames, invalidateAllCaches, getTournamentRegistry } from "./scraper";
import { notifyOwner } from "./_core/notification";
import { sdk } from "./_core/sdk";
import { pruneOldLogs } from './logRetention';
import { processTrialReminders } from './trialReminders';
import { processTrialAutoCharges } from './shadowBilling';
import type { Game } from "../shared/types";

// Owner-only procedure: restricts access to the site owner (OWNER_OPEN_ID)
const ownerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ENV.ownerOpenId) {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Owner access only" });
    }
  } else if (ctx.user.openId !== ENV.ownerOpenId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Owner access only" });
  }
  return next({ ctx });
});

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

  // Stripe billing routes (admin-only)
  billing: billingRouter,

  // Print Studio routes
  tenants: tenantsRouter,
  studio: studioRouter,
  studioBilling: studioBillingRouter,

  // Firm Admin (admin tab)
  firmAdmin: firmAdminRouter,

  // Platform Console (super_admin)
  platform: platformRouter,
  // Invite Links (shareable signup/join links)
  inviteLinks: inviteLinksRouter,

  // AAU Basketball endpoints (owner-only)
  games: router({
    list: ownerProcedure.query(async () => {
      const result = await fetchAllGames();
      return {
        games: result.games,
        lastUpdated: result.lastUpdated,
        cached: result.cached,
        tournaments: getTournamentRegistry(),
      };
    }),

    live: ownerProcedure.query(async () => {
      const result = await fetchAllGames();
      const liveGames = result.games.filter((g: Game) => g.status === 'live');
      return {
        games: liveGames,
        lastUpdated: result.lastUpdated,
        cached: result.cached,
      };
    }),

    completed: ownerProcedure.query(async () => {
      const result = await fetchAllGames();
      const completedGames = result.games.filter((g: Game) => g.status === 'completed');
      return {
        games: completedGames,
        lastUpdated: result.lastUpdated,
      };
    }),

    refresh: ownerProcedure.mutation(async () => {
      invalidateAllCaches();
      const result = await fetchAllGames();
      return {
        games: result.games,
        lastUpdated: result.lastUpdated,
        cached: false,
      };
    }),
  }),

  adminLogs: adminLogsRouter,

  leaderboard: router({
    get: ownerProcedure.query(async () => {
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

// H3: optional shared-secret gate for server-to-server scheduled endpoints.
// When CRON_SECRET is configured, the matching `x-cron-secret` header is required
// IN ADDITION to the existing cron session check — so privilege no longer derives
// from a session claim alone. Backward-compatible: unset = no extra gate.
function cronSecretOk(req: any): boolean {
  if (!ENV.cronSecret) return true;
  const provided = req.headers["x-cron-secret"];
  return typeof provided === "string" && provided === ENV.cronSecret;
}

// Register the scheduled endpoints outside tRPC
export function registerScheduledRoutes(app: any) {
  // Log retention cleanup — prune server_logs older than 30 days
  app.post('/api/scheduled/log-cleanup', async (req: any, res: any) => {
    try {
      if (!cronSecretOk(req)) {
        return res.status(403).json({ error: 'forbidden' });
      }
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        return res.status(403).json({ error: 'cron-only' });
      }

      const deleted = await pruneOldLogs();
      console.log(`[log-cleanup] Pruned ${deleted} log entries older than 30 days`);

      res.json({
        success: true,
        deletedRows: deleted,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // M8: log details server-side only; never leak stack/internal context to the response.
      console.error('[log-cleanup] Error:', (error as Error).message);
      res.status(500).json({
        success: false,
        error: 'log cleanup failed',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Trial reminder notifications — Day 4 and Day 6
  app.post('/api/scheduled/trial-reminders', async (req: any, res: any) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        return res.status(403).json({ error: 'cron-only' });
      }

      const result = await processTrialReminders();
      console.log(`[trial-reminders] Processed ${result.processed} trial tenants, sent ${result.sent}, skipped ${result.skipped}`);

      res.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[trial-reminders] Error:', (error as Error).message);
      res.status(500).json({
        success: false,
        error: (error as Error).message,
        stack: (error as Error).stack,
        context: { url: req.url, taskUid: (req as any).__taskUid },
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Trial auto-charge — Day 7: charge stored PaymentMethod, convert to paid plan
  app.post('/api/scheduled/trial-autocharge', async (req: any, res: any) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        return res.status(403).json({ error: 'cron-only' });
      }

      const result = await processTrialAutoCharges();
      console.log(`[trial-autocharge] Processed ${result.processed}, charged ${result.charged}, failed ${result.failed}`);

      res.json({
        success: true,
        ...result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('[trial-autocharge] Error:', (error as Error).message);
      res.status(500).json({
        success: false,
        error: (error as Error).message,
        stack: (error as Error).stack,
        context: { url: req.url, taskUid: (req as any).__taskUid },
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Game status check
  app.post('/api/scheduled/game-check', async (req: any, res: any) => {
    try {
      if (!cronSecretOk(req)) {
        return res.status(403).json({ error: 'forbidden' });
      }
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
