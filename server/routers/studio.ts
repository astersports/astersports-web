/**
 * Studio router — handles the core editing workflow:
 * upload → detect elements → configure controls → generate → view results.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { tenantProcedure } from "../tenancy";
import { storagePut } from "../storage";
import { detectPrintElements, generateEditedImage, generateRecoloredImage, generateDensityImage, generateScaledImage, NON_REPEAT_SCALE_ERROR } from "../aiEngine";
import { ENV } from "../_core/env";
import { getMaskProvider } from "../_core/masking";
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
} from "../studioDb";
import { buildInstruction, computeCredits, describeExpectedChange, resolveTargetColorHex, type ControlSettings } from "../../shared/controls";
import { CREDIT_COST, LOW_BALANCE_THRESHOLD, PLANS, TRIAL_DURATION_DAYS, TRIAL_RECOMMENDATION_START_DAY } from "../../shared/billing";
import { sanitizeElementName, sanitizeColorValue, sanitizeFileName, MAX_ELEMENT_NAME_LENGTH } from "../../shared/sanitize";

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
          remove: z.object({
            enabled: z.boolean(),
            element: z.string().max(MAX_ELEMENT_NAME_LENGTH).transform(sanitizeElementName),
            percent: z.number(),
          }),
          recolor: z.object({
            enabled: z.boolean(),
            element: z.string().max(MAX_ELEMENT_NAME_LENGTH).transform(sanitizeElementName),
            fromColor: z.string().max(30).default(""),
            targetColor: z.string().max(30).transform(sanitizeColorValue),
            coverage: z.number().min(10).max(100),
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

      const controls = input.controls as ControlSettings;

      // Validate sanitized element names are non-empty when controls are active
      if (controls.remove.enabled && !controls.remove.element) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Remove element name is required and must contain valid characters.",
        });
      }
      if (controls.recolor.enabled && !controls.recolor.element) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Recolor element name is required and must contain valid characters.",
        });
      }
      if (controls.recolor.enabled && !controls.recolor.targetColor) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target color is required and must contain valid characters.",
        });
      }

      // A2 live route: recolor-ONLY jobs go through the deterministic op (classical
      // provider, no SAM2) when STUDIO_RECOLOR_LIVE is on. Everything else (combined
      // or non-recolor) stays on the existing prompt path.
      const recolorOnly =
        controls.recolor.enabled && !controls.scale.enabled &&
        !controls.density.enabled && !controls.remove.enabled;
      const useDeterministicRecolor = ENV.studioRecolorLive && recolorOnly;
      if (useDeterministicRecolor && !controls.recolor.fromColor) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Source color is required for recolor. Click the print color to sample it.",
        });
      }

      // D-C live route: density-ONLY jobs go through the deterministic densityThin
      // op (SAM2 raster + instances) when STUDIO_DENSITY_LIVE is on. On a provider
      // degrade, density FAILS + REFUNDS — it never prompt-falls (the generative
      // path cannot do count-based removal, so it would silently ignore the ask).
      const densityOnly =
        controls.density.enabled && !controls.scale.enabled &&
        !controls.recolor.enabled && !controls.remove.enabled;
      const useDeterministicDensity = ENV.studioDensityLive && densityOnly;

      // D-A (density): reject density combined with other edits, gated on the live
      // flag (pre-deduct; flag off => unchanged). The reason is stronger than scale's:
      // a combined density+other job on the prompt path silently UNMETS the count-based
      // density intent, so reject honestly rather than return a generative result that
      // ignored it. Mirrors scale's D-A.
      if (ENV.studioDensityLive && controls.density.enabled && controls.density.percent > 0 && !densityOnly) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Density can't yet combine with other edits — run it separately.",
        });
      }

      // Scale-live route: scale-ONLY jobs go through scalePrintRepeat when
      // STUDIO_SCALE_LIVE is on AND the provider serves rasters. Dark by default.
      const scaleOnly =
        controls.scale.enabled && controls.scale.percent !== 0 &&
        !controls.recolor.enabled && !controls.density.enabled && !controls.remove.enabled;
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
      });

      // Generate variations in parallel — each is an independent AI call.
      const existingVariations = await getJobVariations(job.id);
      const nextRound = existingVariations.length > 0
        ? Math.max(...existingVariations.map((v) => v.round)) + 1
        : 1;

      const settled = await Promise.allSettled(
        Array.from({ length: controls.variations }, async (_unused, i) => {
          console.log(`[studio] Generating variation ${i + 1} for job ${job.id}`);
          if (useDeterministicRecolor) {
            const png = await generateRecoloredImage(job.originalUrl, {
              fromColor: controls.recolor.fromColor,
              toColor: resolveTargetColorHex(controls.recolor.targetColor),
              coverage: controls.recolor.coverage,
            });
            const key = `studio/${ctx.tenant.id}/${job.id}/recolor-${nextRound}.png`;
            const { url } = await storagePut(key, png, "image/png");
            await addVariation({ jobId: job.id, tenantId: ctx.tenant.id, resultKey: key, resultUrl: url, round: nextRound });
            return { url, key };
          }
          // D-C: deterministic density path. On degrade / no-op, FAIL + REFUND —
          // density never prompt-falls (the prompt path cannot do count-based
          // removal and would return garbage). The rejection triggers the existing
          // pro-rated refund.
          if (useDeterministicDensity) {
            const densityResult = await generateDensityImage(job.originalUrl, controls.density.percent);
            if (!densityResult) {
              console.warn(`[studio] Density provider degraded / no-op for job ${job.id}; rejecting (D-B).`);
              throw new Error("Density processing is temporarily unavailable. Please try again in a moment.");
            }
            const key = `studio/${ctx.tenant.id}/${job.id}/density-${nextRound}.png`;
            const { url } = await storagePut(key, densityResult.png, "image/png");
            await addVariation({ jobId: job.id, tenantId: ctx.tenant.id, resultKey: key, resultUrl: url, round: nextRound });
            console.log(`[studio] Density op removed ${densityResult.removed} instances for job ${job.id}`);
            return { url, key };
          }
          if (useDeterministicScale) {
            const png = await generateScaledImage(job.originalUrl, {
              targetFraction: (100 + controls.scale.percent) / 100,
            });
            const key = `studio/${ctx.tenant.id}/${job.id}/scale-${nextRound}.png`;
            const { url } = await storagePut(key, png, "image/png");
            await addVariation({ jobId: job.id, tenantId: ctx.tenant.id, resultKey: key, resultUrl: url, round: nextRound });
            return { url, key };
          }
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
          console.error(`[studio] Variation ${i + 1} failed:`, r.reason?.message || r.reason);
        }
      });

      if (results.length === 0) {
        // All generations failed — refund the full charge.
        await grantCredits(
          ctx.tenant.id,
          creditCost,
          "refund",
          `job-${job.id}-failed`,
          ctx.user.id
        );
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
          creditsUsed = creditCost - refund;
        }
      }

      await updateJobStatus(job.id, "done", { creditsUsed });

      return {
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
        status: z.string().optional(),
        search: z.string().max(200).optional(),
        favoritesOnly: z.boolean().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await listTenantJobsEnhanced(ctx.tenant.id, {
        limit: input.limit,
        offset: input.offset,
        status: input.status,
        search: input.search,
        favoritesOnly: input.favoritesOnly,
      });
      return {
        jobs: result.jobs.map((j) => ({
          ...j,
          detectedElements: j.detectedElements ? JSON.parse(j.detectedElements) : [],
          controls: j.controls ? JSON.parse(j.controls) : null,
        })),
        total: result.total,
      };
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
        reason: z.string().optional(),
        from: z.number().optional(),
        to: z.number().optional(),
        search: z.string().max(100).optional(),
      }).default({ limit: 25, offset: 0 })
    )
    .query(async ({ ctx, input }) => {
      return listCreditLedger(ctx.tenant.id, {
        limit: input.limit,
        offset: input.offset,
        reason: input.reason,
        from: input.from,
        to: input.to,
        search: input.search,
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
      if (!originalJob.controls || !originalJob.originalUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Job has no controls to re-run" });
      }

      const controls: ControlSettings = JSON.parse(originalJob.controls);
      const cost = computeCredits(controls, CREDIT_COST);

      // Deduct credits
      try {
        await deductCredits(ctx.tenant.id, ctx.user?.id ?? 0, cost, `rerun-${originalJob.id}`);
      } catch {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Insufficient credits" });
      }

      // Create new job
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
      });

      // Generate in background (don't block response)
      (async () => {
        try {
          const resultUrl = await generateEditedImage(originalJob.originalUrl, instruction, "image/jpeg", expectation);
          const key = `studio/${ctx.tenant.id}/${newJob.id}/result-1.png`;
          const { url } = await storagePut(key, Buffer.from(await (await fetch(resultUrl)).arrayBuffer()), "image/png");
          await addVariation({ jobId: newJob.id, tenantId: ctx.tenant.id, resultKey: key, resultUrl: url, round: 1 });
          await updateJobStatus(newJob.id, "done");
        } catch (err) {
          await updateJobStatus(newJob.id, "failed");
          // Refund credits on failure
          await grantCredits(ctx.tenant.id, cost, "refund", `job-${newJob.id}-failed`, ctx.user?.id);
        }
      })();

      return { jobId: newJob.id, creditsUsed: cost };
    }),

  /** Get the current trial status and plan recommendation for the tenant. */
  trialStatus: tenantProcedure.query(async ({ ctx }) => {
    const tenant = ctx.tenant;
    const trial = getTrialStatus(tenant);

    // If not in trial or before day 4, skip usage analysis
    if (!trial.inTrial || trial.trialDay < TRIAL_RECOMMENDATION_START_DAY) {
      return {
        ...trial,
        recommendation: null,
      };
    }

    // Analyze usage from days 4-7 and recommend a plan
    const usage = await analyzeTrialUsage(tenant.id, tenant.trialStartedAt!);
    const plan = PLANS[usage.recommendedPlan];

    return {
      ...trial,
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
