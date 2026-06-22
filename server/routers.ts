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
import { log } from './serverLog';
import { processTrialReminders } from './trialReminders';
import { reapStuckJobs, listSam2ProcessingJobs } from './studioDb';
import { processAsyncJob } from './studioAsyncWorker';
import { processTrialAutoCharges } from './shadowBilling';
import { cronSecretOk as cronSecretMatches } from "./_core/cronAuth";
import type { Game } from "../shared/types";

// Owner-only procedure: restricts access to the site owner (OWNER_OPEN_ID)
const ownerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ENV.ownerOpenId) {
    // Fail closed in production: with no owner configured we must not silently
    // downgrade "owner-only" to "any admin". Outside production we keep the
    // admin fallback so dev/test stays runnable without OWNER_OPEN_ID.
    if (ENV.isProduction) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Owner access only" });
    }
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
    // TODO(security): logout is cookie-only; stateless JWT stays valid until exp — add a tokenValidAfter/sessionVersion revocation store (needs migration).
    logout: publicProcedure.mutation(({ ctx }) => {
      // Clear with a fixed canonical attribute set in production so the clear
      // directive matches the originally-set Secure cookie regardless of how the
      // per-request protocol is inferred (a request that doesn't look HTTPS would
      // otherwise emit a non-Secure clear that fails to remove the Secure cookie).
      const clearOptions = ENV.isProduction
        ? ({ httpOnly: true, sameSite: "lax", path: "/", secure: true } as const)
        : getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...clearOptions, maxAge: -1 });
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
// When CRON_SECRET is configured, the secret is required IN ADDITION to the existing
// cron session check — so privilege no longer derives from a session claim alone.
// The secret is accepted via our `x-cron-secret` header OR the `Authorization: Bearer
// <secret>` header the Manus scheduler injects natively (see ./_core/cronAuth for the
// match logic + tests). Backward-compatible: unset CRON_SECRET = no extra gate.
function cronSecretOk(req: any): boolean {
  return cronSecretMatches(req.headers, ENV.cronSecret);
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
      if (!cronSecretOk(req)) {
        return res.status(403).json({ error: 'forbidden' });
      }
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
      // Log the full error server-side only; never return stack/context in the
      // HTTP body (info disclosure, reachable before cron auth).
      console.error('[trial-reminders] Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal error',
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Trial auto-charge — Day 7: charge stored PaymentMethod, convert to paid plan
  app.post('/api/scheduled/trial-autocharge', async (req: any, res: any) => {
    try {
      if (!cronSecretOk(req)) {
        return res.status(403).json({ error: 'forbidden' });
      }
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
      // Log the full error server-side only; never return stack/context in the
      // HTTP body (info disclosure, reachable before cron auth).
      console.error('[trial-autocharge] Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal error',
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

  // Reap studio jobs stranded in "processing" — idempotently refund + fail any
  // job stuck past 10 min (well above the 180s in-process generation budget, so
  // it never races a live job). Backstops infra hard-kills and detached-promise
  // strands so a customer is never billed for a job that produced nothing.
  app.post('/api/scheduled/reap-stuck-jobs', async (req: any, res: any) => {
    try {
      if (!cronSecretOk(req)) {
        log.error('cron', '[reap-stuck-jobs] cronSecretOk failed', { metadata: { headers: Object.keys(req.headers).join(',') } });
        return res.status(403).json({ error: 'forbidden' });
      }
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        log.error('cron', `[reap-stuck-jobs] cron-only check failed: isCron=${user.isCron}, taskUid=${user.taskUid}`);
        return res.status(403).json({ error: 'cron-only' });
      }

      const result = await reapStuckJobs(10 * 60 * 1000);
      log.info('cron', `[reap-stuck-jobs] reaped ${result.reaped}, refunded ${result.refunded}`);

      res.json({ success: true, ...result, timestamp: new Date().toISOString() });
    } catch (error) {
      log.error('cron', `[reap-stuck-jobs] Error: ${(error as Error).message}`);
      res.status(500).json({ success: false, error: 'reap failed', timestamp: new Date().toISOString() });
    }
  });

  // Poll Replicate for jobs awaiting their SAM2 prediction and process completed ones
  // (ASYNC_GENERATION_SPEC §3 — the cron fallback for dropped webhooks). N=1 per tick: a single
  // 40MP CPU op must clear the unforgiving Manus 60s execution cap with headroom.
  app.post('/api/scheduled/poll-predictions', async (req: any, res: any) => {
    try {
      if (!cronSecretOk(req)) {
        log.error('cron', '[poll-predictions] cronSecretOk failed', { metadata: { headers: Object.keys(req.headers).join(',') } });
        return res.status(403).json({ error: 'forbidden' });
      }
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) {
        log.error('cron', `[poll-predictions] cron-only check failed: isCron=${user.isCron}, taskUid=${user.taskUid}`);
        return res.status(403).json({ error: 'cron-only' });
      }
      if (!ENV.studioAsyncJobs) {
        return res.json({ success: true, skipped: 'async disabled', timestamp: new Date().toISOString() });
      }
      const pending = await listSam2ProcessingJobs(1); // N=1 — stay well under the 60s cap
      const results: Array<{ jobId: number; status: string }> = [];
      for (const j of pending) {
        const r = await processAsyncJob(j.id);
        results.push({ jobId: j.id, status: r.status });
      }
      log.info('cron', `[poll-predictions] processed ${results.length} jobs`);
      res.json({ success: true, processed: results.length, results, timestamp: new Date().toISOString() });
    } catch (error) {
      log.error('cron', `[poll-predictions] Error: ${(error as Error).message}`);
      res.status(500).json({ success: false, error: 'poll failed', timestamp: new Date().toISOString() });
    }
  });
}

export type AppRouter = typeof appRouter;
