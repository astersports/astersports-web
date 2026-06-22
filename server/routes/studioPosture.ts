/**
 * GET /api/studio/posture — operator G0 verification.
 *
 * Reports the RUNNING process's effective studio flag/provider posture, so "are
 * scale/density dark in prod?" is an authoritative read of the deployed env, not
 * a guess against the platform's env panel. Pairs with the Flip Authority gate
 * (CLAUDE.md §1): paste this output as the G0 evidence on incident #61.
 *
 * Fail-closed: requires CRON_SECRET set AND a matching `x-cron-secret` header.
 * Never exposes any secret or token VALUE — booleans only (e.g. replicateConfigured).
 */
import type { Express, Request, Response } from "express";
import { ENV } from "../_core/env";
import { getMaskProvider } from "../_core/masking";

export function registerStudioPostureRoute(app: Express) {
  app.get("/api/studio/posture", (req: Request, res: Response) => {
    // Fail closed: an unset secret returns 403 rather than leaking posture publicly.
    const provided = req.headers["x-cron-secret"];
    if (!ENV.cronSecret || provided !== ENV.cronSecret) {
      res.status(403).json({ error: "forbidden" });
      return;
    }

    const rasterReady = getMaskProvider().rasterReady;
    res.json({
      // Raw flag values from the running env (what G0 must show as all-false).
      flags: {
        scaleLive: ENV.studioScaleLive,
        densityLive: ENV.studioDensityLive,
        densityRedistribute: ENV.studioDensityRedistribute,
        createOrgLive: ENV.studioCreateOrgLive,
      },
      // dark = every money-path *_LIVE flag is off. createOrgLive (self-serve
      // credit-minting) is one too, so a future create-org flip correctly flips
      // dark→false; it ships off, so today's incident #61 G0 read stays dark:true.
      dark:
        !ENV.studioScaleLive &&
        !ENV.studioDensityLive &&
        !ENV.studioDensityRedistribute &&
        !ENV.studioCreateOrgLive,
      maskProvider: ENV.maskProvider,
      rasterReady,
      replicateConfigured: Boolean(ENV.replicateApiToken && ENV.replicateSam2Model),
      noOpGuard: ENV.studioNoOpGuard,
      // Async generation processor (ASYNC_GENERATION_SPEC) — an architecture toggle, not a
      // money-path *_LIVE flag, so it sits here (operational state) not in `flags`/`dark`.
      asyncJobs: ENV.studioAsyncJobs,
      sam2: {
        pointsPerSide: ENV.studioSam2PointsPerSide,
        useM2m: ENV.studioSam2UseM2m,
        maxInstances: ENV.studioMaxInstances,
      },
      // What ACTUALLY runs (flag AND a raster-capable provider) — mirrors the
      // generate/SSE gates, so you can see raw flags vs effective behavior.
      effective: {
        scaleLive: ENV.studioScaleLive && rasterReady,
        densityLive: (ENV.studioDensityLive || ENV.studioDensityRedistribute) && rasterReady,
      },
      timestamp: new Date().toISOString(),
    });
  });
}
