/**
 * H6 — resource guards for the deterministic image pipeline.
 *
 * Every Print Studio raster op decodes through decodeUpright, which allocates a
 * full RGBA frame (width*height*4 bytes). Two unbounded vectors live there:
 *   1. one oversized upload -> one huge allocation, and
 *   2. many concurrent jobs -> N huge allocations at once.
 * These guards bound both: a per-image megapixel cap and a semaphore that limits
 * how many decodes hold a frame in memory simultaneously. Both are configurable
 * via env (ENV.studioMaxMegapixels / ENV.studioMaxConcurrentDecodes).
 */
import { ENV } from "../env";

/** Thrown when a source image exceeds the configured pixel budget. */
export class ImageTooLargeError extends Error {
  constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly maxMegapixels: number,
  ) {
    const mp = ((width * height) / 1_000_000).toFixed(1);
    super(`image ${width}x${height} (${mp}MP) exceeds the ${maxMegapixels}MP limit`);
    this.name = "ImageTooLargeError";
  }
}

/** Total-pixel ceiling handed to sharp so it rejects before allocating a frame. */
export function maxInputPixels(): number {
  return Math.floor(ENV.studioMaxMegapixels * 1_000_000);
}

/** Post-decode belt-and-suspenders check (rotate can swap dims; pixel count is stable). */
export function assertWithinPixelLimit(width: number, height: number): void {
  if (width * height > maxInputPixels()) {
    throw new ImageTooLargeError(width, height, ENV.studioMaxMegapixels);
  }
}

/**
 * Minimal FIFO counting semaphore. No external dep (keeps the deterministic
 * pipeline's dependency surface flat). Fair: waiters resume in arrival order.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    this.available = Math.max(1, permits);
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next();
    } else {
      this.available++;
    }
  }

  /** Run `fn` while holding a permit; the permit is always released. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/** Shared limiter for all source-image decodes (the heavy sharp + RGBA step). */
export const decodeSemaphore = new Semaphore(ENV.studioMaxConcurrentDecodes);
