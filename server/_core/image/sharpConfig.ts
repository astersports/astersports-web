/**
 * T3.3 — Sharp configuration for production containers.
 *
 * Sets `sharp.concurrency` and `sharp.cache` to values appropriate for the
 * serverless container (Autoscale). Import this module early in the server
 * bootstrap so the settings apply before any image processing.
 *
 * Rationale:
 * - concurrency(1): Autoscale containers are single-vCPU. sharp defaults to
 *   the host's logical CPU count (which in serverless can be 2-4 even though
 *   only 1 vCPU is allocated). Over-threading on a single core causes context-
 *   switching overhead and unpredictable latency spikes.
 * - cache({ memory: 50, files: 20, items: 200 }): default sharp cache is
 *   unbounded in items; in a long-lived container processing many images, this
 *   leaks memory. Bounded cache keeps the hot-path fast without OOM risk.
 * - simd(true): explicit opt-in for SIMD (usually auto-detected, but making it
 *   explicit documents the expectation).
 */
import sharp from "sharp";

// Single-threaded: match the 1 vCPU allocation in Autoscale.
sharp.concurrency(1);

// Bounded cache: prevent unbounded memory growth in long-lived containers.
sharp.cache({ memory: 50, files: 20, items: 200 });

// SIMD: explicit opt-in (usually auto-detected on modern kernels).
sharp.simd(true);

console.log(
  `[sharp-config] concurrency=${sharp.concurrency()}, cache=${JSON.stringify(sharp.cache())}, simd=${sharp.simd()}`
);

export {};
