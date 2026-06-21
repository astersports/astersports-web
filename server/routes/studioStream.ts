/**
 * SSE streaming endpoint for long-running density/scale generation.
 *
 * Problem: On Autoscale (serverless) hosting, the container shuts down after
 * the HTTP response is sent. Fire-and-forget background promises get killed.
 *
 * Solution: Keep the HTTP connection open via Server-Sent Events (SSE).
 * The response streams periodic heartbeats every 5s, keeping the container
 * alive while `runVariation()` does the actual SAM2 + image processing work.
 * Once complete, a final "done" or "error" event is sent and the stream ends.
 *
 * Route: POST /api/studio/generate-stream
 * Auth: Session cookie (same as tRPC)
 * Body: { tenantId, jobId, controls }
 */
import type { Express, Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";
import { getMaskProvider } from "../_core/masking";
import { checkUpscaleDpi } from "../_core/studio/guards/dpiGuard";
import { storageGetSignedUrl } from "../storage";
import { log } from "../serverLog";
import { runVariation } from "../studioEngine";
import {
  getTenantById,
  getMembership,
  getJob,
  updateJobStatus,
  deductCredits,
  grantCredits,
  getTrialStatus,
} from "../studioDb";
import { getImpersonationFromRequest } from "../impersonation";
import {
  buildInstruction,
  computeCredits,
  describeExpectedChange,
  type ControlSettings,
} from "../../shared/controls";
import { CREDIT_COST, LOW_BALANCE_THRESHOLD } from "../../shared/billing";
import { sanitizeElementName, sanitizeColorValue, MAX_ELEMENT_NAME_LENGTH } from "../../shared/sanitize";

/** SSE helper: write a typed event to the response stream. */
function sendSSE(res: Response, data: Record<string, unknown>, finished: { value: boolean }) {
  if (finished.value) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Connection already closed — swallow
  }
}

/** Validate and clamp control settings (mirrors the tRPC input schema transforms). */
function validateControls(raw: any): ControlSettings {
  if (!raw || typeof raw !== "object") throw new Error("Invalid controls");

  const scale = raw.scale ?? {};
  const density = raw.density ?? {};
  const remove = raw.remove ?? {};
  const recolor = raw.recolor ?? {};

  return {
    scale: {
      enabled: Boolean(scale.enabled),
      percent: Math.max(-50, Math.min(100, Number(scale.percent) || 0)),
    },
    density: {
      enabled: Boolean(density.enabled),
      percent: Math.max(0, Math.min(90, Number(density.percent) || 0)),
    },
    remove: {
      enabled: Boolean(remove.enabled),
      element: sanitizeElementName(String(remove.element ?? "").slice(0, MAX_ELEMENT_NAME_LENGTH)),
      percent: Number(remove.percent) || 0,
    },
    recolor: {
      enabled: Boolean(recolor.enabled),
      element: sanitizeElementName(String(recolor.element ?? "").slice(0, MAX_ELEMENT_NAME_LENGTH)),
      fromColor: String(recolor.fromColor ?? "").slice(0, 30),
      targetColor: sanitizeColorValue(String(recolor.targetColor ?? "").slice(0, 30)),
      coverage: Math.min(100, Math.max(10, Number(recolor.coverage) || 100)),
    },
    variations: 1, // clamped to 1
  };
}

export function registerStudioStreamRoutes(app: Express) {
  app.post("/api/studio/generate-stream", async (req: Request, res: Response) => {
    const finished = { value: false };

    // ─── 1. Authenticate user ──────────────────────────────────────────────────
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // ─── 2. Parse body ─────────────────────────────────────────────────────────
    const { tenantId, jobId, controls: rawControls } = req.body ?? {};
    if (!tenantId || !jobId) {
      res.status(400).json({ error: "Missing tenantId or jobId" });
      return;
    }

    let controls: ControlSettings;
    try {
      controls = validateControls(rawControls);
    } catch (e: any) {
      res.status(400).json({ error: e.message || "Invalid controls" });
      return;
    }

    // ─── 3. Resolve tenant + membership ────────────────────────────────────────
    const tenant = await getTenantById(tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }

    // Check impersonation
    const impersonation = await getImpersonationFromRequest(req);
    let membership;
    if (impersonation && impersonation.tenantId === tenantId) {
      // Impersonating — synthetic owner membership
      membership = { id: -1, userId: user.id, tenantId, role: "owner" as const, status: "active" as const };
    } else {
      membership = await getMembership(tenantId, user.id);
      if (!membership || membership.status !== "active") {
        res.status(403).json({ error: "Not a member of this organization" });
        return;
      }
    }

    // ─── 4. Load job ───────────────────────────────────────────────────────────
    const job = await getJob(jobId);
    if (!job || job.tenantId !== tenantId) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    // ─── 5. Trial check ────────────────────────────────────────────────────────
    const trial = getTrialStatus(tenant);
    if (trial.inTrial && trial.expired) {
      res.status(403).json({ error: "Your free trial has ended. Choose a plan to continue generating." });
      return;
    }

    // ─── 6. Validate controls ──────────────────────────────────────────────────
    if (controls.remove.enabled && !controls.remove.element) {
      res.status(400).json({ error: "Remove element name is required." });
      return;
    }
    if (controls.recolor.enabled && !controls.recolor.element) {
      res.status(400).json({ error: "Recolor element name is required." });
      return;
    }
    if (controls.recolor.enabled && !controls.recolor.targetColor) {
      res.status(400).json({ error: "Target color is required." });
      return;
    }

    // ─── 7. Determine deterministic path ───────────────────────────────────────
    const densityOnly =
      controls.density.enabled && !controls.scale.enabled &&
      !controls.recolor.enabled && !controls.remove.enabled;
    const densityDeterministic = ENV.studioDensityLive || ENV.studioDensityRedistribute;
    const useDeterministicDensity = densityDeterministic && densityOnly;

    if (densityDeterministic && controls.density.enabled && controls.density.percent > 0 && !densityOnly) {
      res.status(400).json({ error: "Density can't yet combine with other edits — run it separately." });
      return;
    }

    const scaleOnly =
      controls.scale.enabled && controls.scale.percent !== 0 &&
      !controls.recolor.enabled && !controls.density.enabled && !controls.remove.enabled;
    const scaleRasterReady = getMaskProvider().rasterReady;
    const useDeterministicScale = ENV.studioScaleLive && scaleOnly && scaleRasterReady;

    if (ENV.studioScaleLive && scaleRasterReady && controls.scale.enabled && controls.scale.percent !== 0 && !scaleOnly) {
      res.status(400).json({ error: "Scale can't yet combine with other edits — run it separately." });
      return;
    }

    // DPI guard for scale enlarge
    if (useDeterministicScale && controls.scale.percent > 0) {
      const f = (100 + controls.scale.percent) / 100;
      const resolveUrl = async (url: string) => {
        if (url.startsWith("/manus-storage/")) {
          return storageGetSignedUrl(url.replace("/manus-storage/", ""));
        }
        return url;
      };
      const dpiCheck = await checkUpscaleDpi(job.originalUrl, f, resolveUrl);
      if (dpiCheck.reject) {
        res.status(400).json({ error: dpiCheck.message! });
        return;
      }
    }

    // This endpoint only handles density/scale deterministic paths
    if (!useDeterministicDensity && !useDeterministicScale) {
      res.status(400).json({ error: "This endpoint only handles density/scale deterministic generation. Use the standard generate mutation for other paths." });
      return;
    }

    // ─── 8. Compute credits & deduct ──────────────────────────────────────────
    const creditCost = computeCredits(controls, CREDIT_COST);
    if (creditCost === 0) {
      res.status(400).json({ error: "No controls are active" });
      return;
    }
    if (tenant.creditBalance < creditCost) {
      res.status(400).json({ error: `Insufficient credits. Need ${creditCost}, have ${tenant.creditBalance}.` });
      return;
    }

    let newBalance: number;
    try {
      newBalance = await deductCredits(tenant.id, user.id, creditCost, "generation", `job-${job.id}`);
    } catch (e: any) {
      const msg = e?.message === "Insufficient credits"
        ? `Insufficient credits. Need ${creditCost}, have ${tenant.creditBalance}.`
        : "Failed to reserve credits. Please try again.";
      res.status(400).json({ error: msg });
      return;
    }

    // ─── 9. Update job to processing ──────────────────────────────────────────
    const instruction = buildInstruction(controls);
    const expectation = describeExpectedChange(controls);

    await updateJobStatus(job.id, "processing", {
      instruction,
      controls: JSON.stringify(controls),
      creditsUsed: creditCost,
    });

    // ─── 10. Set SSE headers and begin streaming ──────────────────────────────
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
    });

    // Send initial event
    sendSSE(res, { type: "started", jobId: job.id, creditCost, newBalance }, finished);

    // Start heartbeat interval (every 5s)
    const heartbeatInterval = setInterval(() => {
      sendSSE(res, { type: "heartbeat", elapsed: Date.now() }, finished);
    }, 5000);

    // Handle client disconnect
    req.on("close", () => {
      finished.value = true;
      clearInterval(heartbeatInterval);
    });

    // ─── 11. Run the generation (AWAITED, not fire-and-forget) ────────────────
    const mode = {
      recolor: false,
      density: useDeterministicDensity,
      scale: useDeterministicScale,
    };

    try {
      const result = await runVariation({
        controls,
        originalUrl: job.originalUrl,
        tenantId: tenant.id,
        jobId: job.id,
        instruction,
        expectation,
        round: 1,
        mode,
      });

      await updateJobStatus(job.id, "done", { creditsUsed: creditCost });

      // Send success event
      sendSSE(res, {
        type: "done",
        jobId: job.id,
        results: [result],
        creditsUsed: creditCost,
        newBalance,
        lowBalance: newBalance <= LOW_BALANCE_THRESHOLD,
      }, finished);
    } catch (err: any) {
      const errMsg = err?.message || "Generation failed";
      log.error("studio", `SSE generation failed: ${errMsg}`, {
        jobId: job.id,
        tenantId: tenant.id,
        userId: user.id,
        metadata: { error: errMsg, path: useDeterministicDensity ? "density" : "scale" },
      });

      // Refund credits on failure
      await grantCredits(tenant.id, creditCost, "refund", `job-${job.id}-failed`, user.id);
      await updateJobStatus(job.id, "failed", { errorMessage: errMsg });

      // Send error event
      sendSSE(res, {
        type: "error",
        jobId: job.id,
        message: errMsg,
        refunded: true,
      }, finished);
    } finally {
      // Cleanup
      clearInterval(heartbeatInterval);
      finished.value = true;
      if (!res.writableEnded) {
        res.end();
      }
    }
  });
}
