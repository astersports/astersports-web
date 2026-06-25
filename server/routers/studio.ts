/**
 * Studio router — handles the core editing workflow:
 * upload → detect elements → configure controls → generate → view results.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { tenantProcedure } from "../tenancy";
import { storagePut, storageGetSignedUrl } from "../storage";
import { detectPrintElements, generateEditedImage, NON_REPEAT_SCALE_ERROR } from "../aiEngine";
import { runVariation } from "../studioEngine";
import { ENV } from "../_core/env";
import { getMaskProvider } from "../_core/masking";
import { startSam2Segmentation } from "../_core/masking/sam2Provider";
import { checkUpscaleDpi } from "../_core/studio/guards/dpiGuard";
import { log } from "../serverLog";
import { emitRefundTelemetry } from "../refundTelemetry";
import { REFUND_REASONS } from "../../shared/refundReasons";
import {
  createJob,
  updateJobStatus,
  getJob,
  listTenantJobs,
  listTenantJobsEnhanced,
  getJobVariations,
  addVariation,
  deductCredits,
  grantCredits,
  listCreditLedger,
  toggleFavorite,
  getTenantFavoriteJobIds,
  getTrialStatus,
  analyzeTrialUsage,
  getHistoryStats,
  countJobGenerationAttempts,
  markJobEnqueued,
} from "../studioDb";
import { buildInstruction, computeCredits, deriveEditType, describeExpectedChange, type ControlSettings } from "../../shared/controls";
import { CREDIT_COST, LOW_BALANCE_THRESHOLD, PLANS, TRIAL_DURATION_DAYS, TRIAL_RECOMMENDATION_START_DAY } from "../../shared/billing";
import { sanitizeFileName } from "../../shared/sanitize";

/** "Only this control is active" predicates — the deterministic-path gates. */
function densityOnly(c: ControlSettings): boolean {
  return c.density.enabled && !c.scale.enabled;
}
function scaleOnly(c: ControlSettings): boolean {
  return c.scale.enabled && c.scale.percent !== 0 && !c.density.enabled;
}

/**
 * Replicate completion-webhook URL for async (STUDIO_ASYNC_JOBS) jobs. Returns
 * undefined unless REPLICATE_WEBHOOK_SECRET is set — the webhook handler is
 * fail-closed on that secret, so without it Replicate's callback would be rejected
 * and the cron poller resolves the job anyway (graceful degradation). With it (plus
 * a public base URL), Replicate POSTs the instant SAM2 settles, so the result lands
 * in seconds instead of waiting up to a full poll interval. Base URL: an explicit
 * PUBLIC_BASE_URL / VITE_APP_URL, else Railway's injected RAILWAY_PUBLIC_DOMAIN.
 */
function replicateWebhookUrl(): string | undefined {
  if (!ENV.replicateWebhookSecret) return undefined;
  const base = (
    process.env.PUBLIC_BASE_URL ||
    process.env.VITE_APP_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
  ).replace(/\/+$/, "");
  return base ? `${base}/api/webhooks/replicate` : undefined;
}

/**
 * H5: the single per-variation generator shared by `generate` and `rerun`.
 * `mode` selects the deterministic op (density/scale) vs the generative
 * prompt path. The density path returns no image on a degrade/no-op and THROWS
 * so the caller refunds — never billing for a count-based ask it could not meet
 * (CLAUDE.md §4). Throwing also propagates the failure to the caller's refund.
 */
// runVariation is imported from ../studioEngine (shared between tRPC + SSE endpoints)

export const studioRouter = router({
  /** Upload an image and create a new job. Returns the job with storage URL. */
  upload: tenantProcedure
    .input(
      z.object({
        fileName: z.string(),
        fileBase64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        title: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");

      // Server-side file size validation (16MB limit)
      const MAX_UPLOAD_SIZE = 16 * 1024 * 1024;
      if (buffer.length > MAX_UPLOAD_SIZE) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds the 16MB limit. Please upload a smaller image.`,
        });
      }

      // Validate MIME type
      const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
      if (!allowedMimes.includes(input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unsupported file type: ${input.mimeType}. Allowed: JPEG, PNG, WebP.`,
        });
      }

      // C2: sanitize the file name so it cannot escape the tenant key prefix.
      const safeFileName = sanitizeFileName(input.fileName);
      const key = `studio/${ctx.tenant.id}/${Date.now()}-${safeFileName}`;
      if (!key.startsWith(`studio/${ctx.tenant.id}/`)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid file name." });
      }
      const { key: storageKey, url } = await storagePut(key, buffer, input.mimeType);

      const job = await createJob({
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        title: input.title || input.fileName,
        originalKey: storageKey,
        originalUrl: url,
        status: "pending",
      });

      return job;
    }),

  /** Run AI element detection on a job's original image. */
  detectElements: tenantProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const job = await getJob(input.jobId);
      if (!job || job.tenantId !== ctx.tenant.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }

      const elements = await detectPrintElements(job.originalUrl);
      await updateJobStatus(job.id, "pending", {
        detectedElements: JSON.stringify(elements),
      });

      return { elements };
    }),

  /** Generate edited images based on control settings. */
  generate: tenantProcedure
    .input(
      z.object({
        jobId: z.number(),
        controls: z.object({
          scale: z.object({
            enabled: z.boolean(),
            percent: z.number().transform((v) => Math.max(-50, Math.min(100, v))),
          }),
          density: z.object({
            enabled: z.boolean(),
            percent: z.number().transform((v) => Math.max(0, Math.min(90, v))),
          }),
          // Variations parked — clamped to 1 until quality validation is added.
          variations: z.number().min(1).max(4).transform(() => 1),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getJob(input.jobId);
      if (!job || job.tenantId !== ctx.tenant.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }

      const trial = getTrialStatus(ctx.tenant);
      if (trial.inTrial && trial.expired) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Your free trial has ended. Choose a plan to continue generating." });
      }

      const controls = input.controls as ControlSettings;

      // D-C live route: density-ONLY jobs go through the deterministic densityThin
      // op (SAM2 raster + instances) when STUDIO_DENSITY_LIVE is on. On a provider
      // degrade, density FAILS + REFUNDS — it never prompt-falls (the generative
      // path cannot do count-based removal, so it would silently ignore the ask).
      const densityOnly =
        controls.density.enabled && !controls.scale.enabled;
      // Either density flag routes density through the deterministic path: v1
      // (densityThin) under STUDIO_DENSITY_LIVE, or v2 (densityRedistribute) under
      // STUDIO_DENSITY_REDISTRIBUTE — the op selection happens at the call site.
      // Both off => unchanged (generative path). Also requires a raster-capable
      // provider: density needs SAM2 instances; on the classical provider it would
      // only deduct -> call out -> refund, so degrade to generative instead.
      const densityDeterministic =
        (ENV.studioDensityLive || ENV.studioDensityRedistribute) && getMaskProvider().rasterReady;
      const useDeterministicDensity = densityDeterministic && densityOnly;

      // D-A (density): reject density combined with other edits, gated on the live
      // flag (pre-deduct; flag off => unchanged). The reason is stronger than scale's:
      // a combined density+other job on the prompt path silently UNMETS the count-based
      // density intent, so reject honestly rather than return a generative result that
      // ignored it. Mirrors scale's D-A.
      if (densityDeterministic && controls.density.enabled && controls.density.percent > 0 && !densityOnly) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Density can't yet combine with other edits — run it separately.",
        });
      }

      // Scale-live route: scale-ONLY jobs go through scalePrintRepeat when
      // STUDIO_SCALE_LIVE is on AND the provider serves rasters. Dark by default.
      const scaleOnly =
        controls.scale.enabled && controls.scale.percent !== 0 && !controls.density.enabled;
      const scaleRasterReady = getMaskProvider().rasterReady;
      const useDeterministicScale = ENV.studioScaleLive && scaleOnly && scaleRasterReady;
      // D-A: reject scale combined with other edits, gated on the live flag +
      // rasterReady (pre-deduct; flag off => unchanged). Chaining is deferred.
      if (
        ENV.studioScaleLive && scaleRasterReady &&
        controls.scale.enabled && controls.scale.percent !== 0 && !scaleOnly
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Scale can't yet combine with other edits — run it separately.",
        });
      }
      // D-B: live flag on but provider not rasterReady (misconfig / SAM2 down) ->
      // fall back to the prompt path + WARN with job + org context. (R4: once the
      // locked prompt makes rasterReady provisioning-aware, this becomes the
      // primary gate; the static flag here is the dark-build placeholder.)
      if (ENV.studioScaleLive && !scaleRasterReady && scaleOnly) {
        console.warn(
          `[studio] scale-live on but provider not rasterReady; prompt-path fallback. job=${job.id} org=${ctx.tenant.id}`
        );
      }

      // Upscale DPI guard (Decision 2, § 2.7): pre-deduct enforcement when source
      // DPI metadata is present; warn-only when absent. Only fires on enlarge (f > 1).
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
          throw new TRPCError({ code: "BAD_REQUEST", message: dpiCheck.message! });
        }
        if (dpiCheck.warn && dpiCheck.message) {
          console.warn(`[studio] DPI advisory: ${dpiCheck.message} job=${job.id}`);
        }
      }

      // R1: density/scale deterministic ops are handled exclusively by the SSE
      // streaming endpoint (/api/studio/generate-stream), which keeps the
      // serverless container alive via heartbeats and performs its own credit
      // deduct + work + refund. Return `async` BEFORE deducting here, so this
      // path can't (a) deduct then strand the job when the container is killed
      // mid fire-and-forget, or (b) double-deduct against the stream. The client
      // opens the stream on `async:true` (it already routes density/scale there
      // directly via shouldUseStream).
      if (useDeterministicDensity || useDeterministicScale) {
        // Async path (STUDIO_ASYNC_JOBS): deduct -> locate/crop + startPrediction -> persist, then
        // return immediately so the request clears the Manus 60s cap; the worker (webhook/cron)
        // finishes off-request. Flag OFF preserves the exact prior SSE deferral (the SSE endpoint
        // deducts + runs), so nothing changes until the flip.
        if (ENV.studioAsyncJobs) {
          const creditCost = computeCredits(controls, CREDIT_COST);
          if (creditCost === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "No controls are active" });
          }
          if (ctx.tenant.creditBalance < creditCost) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `Insufficient credits. Need ${creditCost}, have ${ctx.tenant.creditBalance}.` });
          }
          // Unique per-attempt deduct refId (mirrors the SSE path) so a regenerate charges.
          const attemptN = (await countJobGenerationAttempts(job.id)) + 1;
          const deductRef = `job-${job.id}-a${attemptN}`;
          let newBalance: number;
          try {
            newBalance = await deductCredits(ctx.tenant.id, ctx.user.id, creditCost, "generation", deductRef);
          } catch (e: any) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: e?.message === "Insufficient credits"
                ? `Insufficient credits. Need ${creditCost}, have ${ctx.tenant.creditBalance}.`
                : "Failed to reserve credits. Please try again.",
            });
          }
          try {
            const { predictionId, meta } = await startSam2Segmentation(
              { url: job.originalUrl, audit: { orgId: String(ctx.tenant.id), jobId: String(job.id) } },
              { forDensity: useDeterministicDensity, webhookUrl: replicateWebhookUrl() }
            );
            // Record the exact per-attempt deduct refId so the worker refunds THIS
            // attempt (`<deductRef>-failed`), not a fixed key that collides on regenerate.
            meta.deductRef = deductRef;
            await markJobEnqueued(job.id, predictionId, meta, creditCost, JSON.stringify(controls));
          } catch (startErr) {
            // Surface the real cause server-side — it was swallowed here before, which made a
            // start failure impossible to diagnose. The customer still gets the generic message +
            // refund below; only the logs get the detail.
            const detail = startErr instanceof Error ? (startErr.stack || `${startErr.name}: ${startErr.message}`) : String(startErr);
            const inner = (startErr as { cause?: unknown } | null)?.cause;
            console.error(
              `[studio.generate] SAM2 start FAILED (job ${job.id}): ${detail}` +
                (inner ? ` | caused by: ${inner instanceof Error ? inner.message : String(inner)}` : "")
            );
            // locate/crop/startPrediction failed BEFORE the job was enqueued -> refund + fail, so a
            // start error never leaves the customer charged for a job the worker will never see.
            await grantCredits(ctx.tenant.id, creditCost, "refund", `${deductRef}-failed`, ctx.user.id).catch(() => {});
            // T0.1: Emit refund telemetry for enqueue failure.
            emitRefundTelemetry({
              reason: REFUND_REASONS.enqueue_failure,
              jobId: job.id,
              tenantId: ctx.tenant.id,
              userId: ctx.user.id,
              credits: creditCost,
              detail: "Failed to start generation (locate/crop/startPrediction).",
            });
            await updateJobStatus(job.id, "failed", {
              errorMessage: `Failed to start generation: ${detail}${inner ? " | cause: " + (inner instanceof Error ? inner.message : String(inner)) : ""}`.slice(0, 900),
            }).catch(() => {});
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Couldn't start generation. Your credits have been refunded — please try again in a moment.",
            });
          }
          return {
            async: true as const,
            jobId: job.id,
            status: "sam2_processing" as const,
            results: [],
            creditsUsed: creditCost,
            newBalance,
            lowBalance: newBalance <= LOW_BALANCE_THRESHOLD,
          };
        }
        return {
          async: true as const,
          jobId: job.id,
          results: [],
          creditsUsed: 0,
          newBalance: ctx.tenant.creditBalance,
          lowBalance: ctx.tenant.creditBalance <= LOW_BALANCE_THRESHOLD,
        };
      }

      const creditCost = computeCredits(controls, CREDIT_COST);

      if (creditCost === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No controls are active" });
      }

      // Check balance
      if (ctx.tenant.creditBalance < creditCost) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient credits. Need ${creditCost}, have ${ctx.tenant.creditBalance}.`,
        });
      }

      // Build instruction + the expected-change description used by the no-op guard.
      const instruction = buildInstruction(controls);
      const expectation = describeExpectedChange(controls);

      // Deduct credits (atomic; throws if a concurrent balance race loses).
      let newBalance: number;
      try {
        newBalance = await deductCredits(
          ctx.tenant.id,
          ctx.user.id,
          creditCost,
          "generation",
          `job-${job.id}`
        );
      } catch (e: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            e?.message === "Insufficient credits"
              ? `Insufficient credits. Need ${creditCost}, have ${ctx.tenant.creditBalance}.`
              : "Failed to reserve credits. Please try again.",
        });
      }

      // Update job status
      await updateJobStatus(job.id, "processing", {
        instruction,
        controls: JSON.stringify(controls),
        creditsUsed: creditCost,
        editType: deriveEditType(controls),
      });

      // (Density/scale returned `async` above and run via the SSE endpoint — no
      // fire-and-forget background promise here. See R1 note above.)

      // ─── SYNC PATH: generative prompt fallback (fast enough for inline response) ──
      // Generate variations in parallel — each is an independent AI call.
      const existingVariations = await getJobVariations(job.id);
      const nextRound = existingVariations.length > 0
        ? Math.max(...existingVariations.map((v) => v.round)) + 1
        : 1;

      const settled = await Promise.allSettled(
        Array.from({ length: controls.variations }, async (_unused, i) => {
          log.info("studio", `Generating variation ${i + 1}`, { jobId: job.id, tenantId: ctx.tenant.id, userId: ctx.user.id, metadata: { round: nextRound, path: "prompt" } });
          const resultUrl = await generateEditedImage(job.originalUrl, instruction, "image/jpeg", expectation);
          await addVariation({
            jobId: job.id,
            tenantId: ctx.tenant.id,
            resultKey: resultUrl.replace("/manus-storage/", ""),
            resultUrl,
            round: nextRound,
          });
          return { url: resultUrl, key: resultUrl.replace("/manus-storage/", "") };
        })
      );

      const results = settled
        .filter(
          (r): r is PromiseFulfilledResult<{ url: string; key: string }> =>
            r.status === "fulfilled"
        )
        .map((r) => r.value);

      settled.forEach((r, i) => {
        if (r.status === "rejected") {
          const errMsg = r.reason?.message || String(r.reason);
          log.error("studio", `Variation ${i + 1} failed: ${errMsg}`, { jobId: job.id, tenantId: ctx.tenant.id, userId: ctx.user.id, metadata: { variationIndex: i, error: errMsg } });
        }
      });

      if (results.length === 0) {
        // All generations failed — refund the full charge.
        log.error("studio", `All generations failed, refunding ${creditCost} credits`, { jobId: job.id, tenantId: ctx.tenant.id, userId: ctx.user.id, metadata: { creditCost, controls } });
        await grantCredits(
          ctx.tenant.id,
          creditCost,
          "refund",
          `job-${job.id}-failed`,
          ctx.user.id
        );
        // T0.1: Emit refund telemetry for all-failed batch.
        {
          const nonRepeatFailCheck = settled.find(
            (r) => r.status === "rejected" && r.reason?.message === NON_REPEAT_SCALE_ERROR
          );
          emitRefundTelemetry({
            reason: nonRepeatFailCheck ? REFUND_REASONS.non_repeat : REFUND_REASONS.all_failed,
            jobId: job.id,
            tenantId: ctx.tenant.id,
            userId: ctx.user.id,
            credits: creditCost,
            detail: nonRepeatFailCheck ? "Non-repeat pattern detected" : "All variations failed",
          });
        }
        await updateJobStatus(job.id, "failed");

        // Non-repeat guard: surface an honest, actionable message instead of
        // a generic "all failed" error. The user can't fix this by retrying.
        const nonRepeatFail = settled.find(
          (r) => r.status === "rejected" && r.reason?.message === NON_REPEAT_SCALE_ERROR
        );
        if (nonRepeatFail) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Scale works on repeating prints (ditsy, allover, geometric). " +
              "This image reads as a single placed graphic — scale isn\u2019t supported for it yet. Credits refunded.",
          });
        }

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "All image generations failed. Credits have been refunded.",
        });
      }

      // Pro-rate a refund for any variations that failed (at least one succeeded).
      // Each extra variation costs CREDIT_COST.extraVariation; refunding that per
      // failure never claws back the base charge for the delivered image(s).
      let creditsUsed = creditCost;
      const failedCount = controls.variations - results.length;
      if (failedCount > 0) {
        const refund = failedCount * CREDIT_COST.extraVariation;
        if (refund > 0) {
          newBalance = await grantCredits(
            ctx.tenant.id,
            refund,
            "refund",
            `job-${job.id}-partial`,
            ctx.user.id
          );
          // T0.1: Emit refund telemetry for partial-failed batch.
          emitRefundTelemetry({
            reason: REFUND_REASONS.partial_failed,
            jobId: job.id,
            tenantId: ctx.tenant.id,
            userId: ctx.user.id,
            credits: refund,
            detail: `${failedCount} of ${controls.variations} variations failed`,
          });
          creditsUsed = creditCost - refund;
        }
      }

      await updateJobStatus(job.id, "done", { creditsUsed });

      return {
        async: false as const,
        results,
        creditsUsed,
        newBalance,
        lowBalance: newBalance <= LOW_BALANCE_THRESHOLD,
      };
    }),

  /** Get a single job with its variations. */
  getJob: tenantProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const job = await getJob(input.jobId);
      if (!job || job.tenantId !== ctx.tenant.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const variations = await getJobVariations(job.id);
      return {
        ...job,
        detectedElements: job.detectedElements ? JSON.parse(job.detectedElements) : [],
        controls: job.controls ? JSON.parse(job.controls) : null,
        variations,
      };
    }),

  /** List all jobs for the tenant (history). */
  history: tenantProcedure.query(async ({ ctx }) => {
    const jobsList = await listTenantJobs(ctx.tenant.id);
    return jobsList.map((j) => ({
      ...j,
      detectedElements: j.detectedElements ? JSON.parse(j.detectedElements) : [],
    }));
  }),

  /** Enhanced history with search, filter, pagination, and result images. */
  historyArchive: tenantProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(24),
        offset: z.number().min(0).default(0),
        // M5c: keyset (load-more); precedence over offset. nullish() because
        // tRPC useInfiniteQuery sends cursor:null on the first page.
        cursor: z.string().max(512).nullish(),
        status: z.string().optional(),
        search: z.string().max(200).optional(),
        favoritesOnly: z.boolean().optional(),
        startDate: z.number().optional(),
        endDate: z.number().optional(),
        userId: z.number().optional(),
        sortBy: z.enum(["date", "credits", "title"]).optional(),
        sortDir: z.enum(["asc", "desc"]).optional(),
        type: z.string().max(16).optional(), // edit-type filter (matches denormalized editType)
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await listTenantJobsEnhanced(ctx.tenant.id, {
        limit: input.limit,
        offset: input.offset,
        cursor: input.cursor ?? undefined,
        status: input.status,
        search: input.search,
        favoritesOnly: input.favoritesOnly,
        startDate: input.startDate,
        endDate: input.endDate,
        userId: input.userId,
        sortBy: input.sortBy,
        sortDir: input.sortDir,
        // Server-side type filter so pagination + total reflect it. The UI's
        // "upload" maps to the stored editType "none" (no active controls).
        editType: input.type && input.type !== "all"
          ? (input.type === "upload" ? "none" : input.type)
          : undefined,
      });
      return {
        jobs: result.jobs.map((j) => ({
          ...j,
          detectedElements: j.detectedElements ? JSON.parse(j.detectedElements) : [],
          controls: j.controls ? JSON.parse(j.controls) : null,
        })),
        total: result.total,
        nextCursor: result.nextCursor,
      };
    }),

  /** Summary stats for the History page dashboard cards. */
  historyStats: tenantProcedure.query(async ({ ctx }) => {
    return getHistoryStats(ctx.tenant.id);
  }),

  /** Get tenant credit balance and low-balance warning. */
  balance: tenantProcedure.query(async ({ ctx }) => {
    return {
      balance: ctx.tenant.creditBalance,
      lowBalance: ctx.tenant.creditBalance <= LOW_BALANCE_THRESHOLD,
      plan: ctx.tenant.plan,
    };
  }),

  /** Paginated credit ledger for the tenant. */
  creditLedger: tenantProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(25),
        offset: z.number().min(0).default(0),
        // M5c: keyset (load-more); precedence over offset. nullish() because
        // tRPC useInfiniteQuery sends cursor:null on the first page.
        cursor: z.string().max(512).nullish(),
        reason: z.string().optional(),
        from: z.number().optional(),
        to: z.number().optional(),
        search: z.string().max(100).optional(),
        userId: z.number().optional(),
      }).default({ limit: 25, offset: 0 })
    )
    .query(async ({ ctx, input }) => {
      return listCreditLedger(ctx.tenant.id, {
        limit: input.limit,
        offset: input.offset,
        cursor: input.cursor ?? undefined,
        reason: input.reason,
        from: input.from,
        to: input.to,
        search: input.search,
        userId: input.userId,
      });
    }),

  // ─── Favorites ──────────────────────────────────────────────────────────────

  /** Toggle a job as favorite/unfavorite. Returns new state. */
  toggleFavorite: tenantProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      // C3: verify the job belongs to this tenant before favoriting (mirror the
      // ownership check every other jobId-taking procedure performs) — otherwise
      // a member could favorite arbitrary cross-tenant job IDs.
      const job = await getJob(input.jobId);
      if (!job || job.tenantId !== ctx.tenant.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const isFavorited = await toggleFavorite(ctx.tenant.id, input.jobId);
      return { favorited: isFavorited };
    }),

  /** Get all favorite job IDs for the tenant. */
  favoriteIds: tenantProcedure.query(async ({ ctx }) => {
    return getTenantFavoriteJobIds(ctx.tenant.id);
  }),

  // ─── Re-run ──────────────────────────────────────────────────────────────────

  /** Re-run a previous job with the same settings. Creates a new job and generates. */
  rerun: tenantProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const originalJob = await getJob(input.jobId);
      if (!originalJob || originalJob.tenantId !== ctx.tenant.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }
      const trial = getTrialStatus(ctx.tenant);
      if (trial.inTrial && trial.expired) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Your free trial has ended. Choose a plan to continue generating." });
      }
      if (!originalJob.controls || !originalJob.originalUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Job has no controls to re-run" });
      }

      const controls: ControlSettings = JSON.parse(originalJob.controls);
      const cost = computeCredits(controls, CREDIT_COST);

      // Create the new job FIRST so the deduct/refund share a unique per-attempt
      // refId (`job-<newJobId>`), mirroring `generate`. The previous
      // `rerun-<originalJobId>` collided on the unique (refId,reason) index when a
      // job was re-run twice — dup-keying the deduct and surfacing a misleading
      // "Insufficient credits" to a user with ample balance.
      const instruction = buildInstruction(controls);
      const expectation = describeExpectedChange(controls);
      const newJob = await createJob({
        tenantId: ctx.tenant.id,
        userId: ctx.user?.id ?? 0,
        title: `${originalJob.title} (re-run)`,
        originalKey: originalJob.originalKey,
        originalUrl: originalJob.originalUrl,
        detectedElements: originalJob.detectedElements,
        controls: originalJob.controls,
        instruction,
        creditsUsed: cost,
        status: "processing",
        editType: deriveEditType(controls),
      });

      // Deduct credits against the new job id (unique per attempt).
      try {
        await deductCredits(ctx.tenant.id, ctx.user?.id ?? 0, cost, "generation", `job-${newJob.id}`);
      } catch (e: any) {
        await updateJobStatus(newJob.id, "failed", { errorMessage: "Credit reservation failed" }).catch(() => {});
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: e?.message === "Insufficient credits"
            ? "Insufficient credits"
            : "Failed to reserve credits. Please try again.",
        });
      }

      // H5: re-run honors the SAME deterministic-vs-prompt routing as `generate`
      // so a density re-run does count-based removal (or refunds on a no-op)
      // instead of silently billing a generative result that ignored the ask.
      const mode = {
        density: (ENV.studioDensityLive || ENV.studioDensityRedistribute) && densityOnly(controls) && getMaskProvider().rasterReady,
        scale: ENV.studioScaleLive && scaleOnly(controls) && getMaskProvider().rasterReady,
      };

      // Generate in background (don't block response)
      (async () => {
        try {
          await runVariation({
            controls,
            originalUrl: originalJob.originalUrl,
            tenantId: ctx.tenant.id,
            jobId: newJob.id,
            instruction,
            expectation,
            round: 1,
            mode,
          });
          await updateJobStatus(newJob.id, "done");
        } catch (err) {
          // Refund + status update must not themselves escape as an unhandled
          // rejection (customer charged, no refund). Guard each call. The refund
          // is idempotent on (refId, reason), so a retry cannot double-refund.
          try {
            await updateJobStatus(newJob.id, "failed");
          } catch (statusErr) {
            log.error("studio", `rerun: failed to mark job failed`, { jobId: newJob.id, tenantId: ctx.tenant.id, userId: ctx.user?.id, metadata: { error: (statusErr as any)?.message || String(statusErr) } });
          }
          try {
            // Refund credits on failure (deterministic no-op or provider error).
            await grantCredits(ctx.tenant.id, cost, "refund", `job-${newJob.id}-failed`, ctx.user?.id);
            // T0.1: Emit refund telemetry for rerun failure.
            emitRefundTelemetry({
              reason: REFUND_REASONS.degrade_other,
              jobId: newJob.id,
              tenantId: ctx.tenant.id,
              userId: ctx.user?.id,
              credits: cost,
              detail: (err as any)?.message || "rerun background task failed",
            });
          } catch (refundErr) {
            log.error("studio", `rerun: failed to refund credits`, { jobId: newJob.id, tenantId: ctx.tenant.id, userId: ctx.user?.id, metadata: { cost, error: (refundErr as any)?.message || String(refundErr) } });
          }
        }
      })().catch((escapedErr) => {
        log.error("studio", `rerun: background task escaped`, { jobId: newJob.id, tenantId: ctx.tenant.id, userId: ctx.user?.id, metadata: { error: (escapedErr as any)?.message || String(escapedErr) } });
      });

      return { jobId: newJob.id, creditsUsed: cost };
    }),

  /** Get the current trial status and plan recommendation for the tenant. */
  /** Studio op availability — drives the editor UI so dark/gated ops render as
   *  "temporarily unavailable" instead of letting a click reach the SSE endpoint
   *  and bounce a raw 400. Scale needs its live flag + a raster-capable provider;
   *  density needs its live flag(s) + a raster-capable provider (the op consumes
   *  SAM2 instances, which the classical provider cannot serve). Mirrors the
   *  server-side gates in generate/studioStream so the client never offers an op
   *  the server will reject. */
  config: tenantProcedure.query(async () => {
    const rasterReady = getMaskProvider().rasterReady;
    return {
      scaleLive: ENV.studioScaleLive && rasterReady,
      densityLive: (ENV.studioDensityLive || ENV.studioDensityRedistribute) && rasterReady,
      // Async processor on? Drives the client to enqueue + poll instead of opening the SSE stream
      // (ASYNC_GENERATION_SPEC §4). The client can't see the server flag otherwise.
      asyncJobs: ENV.studioAsyncJobs,
    };
  }),

  trialStatus: tenantProcedure.query(async ({ ctx }) => {
    const tenant = ctx.tenant;
    const trial = getTrialStatus(tenant);

    // If not in trial or before day 4, skip usage analysis
    if (!trial.inTrial || trial.trialDay < TRIAL_RECOMMENDATION_START_DAY) {
      return {
        ...trial,
        trialCredits: tenant.trialCredits,
        recommendation: null,
      };
    }

    // Analyze usage from days 4-7 and recommend a plan
    const usage = await analyzeTrialUsage(tenant.id, tenant.trialStartedAt!);
    const plan = PLANS[usage.recommendedPlan];

    return {
      ...trial,
      trialCredits: tenant.trialCredits,
      recommendation: {
        planKey: usage.recommendedPlan,
        planName: plan.name,
        priceMonthly: plan.priceMonthly,
        creditsPerCycle: plan.creditsPerCycle,
        avgDailyBurn: Math.round(usage.avgDailyBurn),
        projectedMonthly: Math.round(usage.avgDailyBurn * 30),
        reason: usage.avgDailyBurn > 200
          ? "Your team's high generation volume would benefit from pooled seats."
          : usage.avgDailyBurn > 50
          ? "Your active usage suggests the Pro plan's larger credit pool is the best fit."
          : "The Starter plan covers your current usage comfortably.",
      },
    };
  }),
});
