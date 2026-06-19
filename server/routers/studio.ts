/**
 * Studio router — handles the core editing workflow:
 * upload → detect elements → configure controls → generate → view results.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { tenantProcedure } from "../tenancy";
import { storagePut } from "../storage";
import { detectPrintElements, generateEditedImage } from "../aiEngine";
import {
  createJob,
  updateJobStatus,
  getJob,
  listTenantJobs,
  getJobVariations,
  addVariation,
  deductCredits,
  grantCredits,
} from "../studioDb";
import { buildInstruction, computeCredits, type ControlSettings } from "../../shared/controls";
import { CREDIT_COST, LOW_BALANCE_THRESHOLD } from "../../shared/billing";

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
      const key = `studio/${ctx.tenant.id}/${Date.now()}-${input.fileName}`;
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
          scale: z.object({ enabled: z.boolean(), percent: z.number() }),
          density: z.object({ enabled: z.boolean(), percent: z.number() }),
          remove: z.object({ enabled: z.boolean(), element: z.string(), percent: z.number() }),
          variations: z.number().min(1).max(4),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const job = await getJob(input.jobId);
      if (!job || job.tenantId !== ctx.tenant.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      }

      const controls = input.controls as ControlSettings;
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

      // Build instruction
      const instruction = buildInstruction(controls);

      // Deduct credits
      const newBalance = await deductCredits(
        ctx.tenant.id,
        ctx.user.id,
        creditCost,
        "generation",
        `job-${job.id}`
      );

      // Update job status
      await updateJobStatus(job.id, "processing", {
        instruction,
        controls: JSON.stringify(controls),
        creditsUsed: creditCost,
      });

      // Generate variations
      const results: Array<{ url: string; key: string }> = [];
      const existingVariations = await getJobVariations(job.id);
      const nextRound = existingVariations.length > 0
        ? Math.max(...existingVariations.map((v) => v.round)) + 1
        : 1;

      for (let i = 0; i < controls.variations; i++) {
        try {
          const resultUrl = await generateEditedImage(job.originalUrl, instruction);

          // Store the result
          const resultKey = `studio/${ctx.tenant.id}/results/${job.id}-r${nextRound}-v${i + 1}.png`;
          const response = await fetch(resultUrl);
          if (!response.ok) {
            throw new Error(`Failed to download generated image: ${response.status}`);
          }
          const resultBuffer = Buffer.from(await response.arrayBuffer());
          const { key: storedKey, url: storedUrl } = await storagePut(
            resultKey,
            resultBuffer,
            "image/png"
          );

          await addVariation({
            jobId: job.id,
            tenantId: ctx.tenant.id,
            resultKey: storedKey,
            resultUrl: storedUrl,
            round: nextRound,
          });

          results.push({ url: storedUrl, key: storedKey });
        } catch (error) {
          console.error(`[studio] Variation ${i + 1} failed:`, error);
          // Continue with remaining variations
        }
      }

      if (results.length === 0) {
        // Refund credits since all generations failed
        await grantCredits(
          ctx.tenant.id,
          creditCost,
          "refund",
          `job-${job.id}-failed`,
          ctx.user.id
        );
        await updateJobStatus(job.id, "failed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "All image generations failed. Credits have been refunded.",
        });
      }

      await updateJobStatus(job.id, "done");

      return {
        results,
        creditsUsed: creditCost,
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

  /** Get tenant credit balance and low-balance warning. */
  balance: tenantProcedure.query(async ({ ctx }) => {
    return {
      balance: ctx.tenant.creditBalance,
      lowBalance: ctx.tenant.creditBalance <= LOW_BALANCE_THRESHOLD,
      plan: ctx.tenant.plan,
    };
  }),
});
