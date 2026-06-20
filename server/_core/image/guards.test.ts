/**
 * H6 guard tests — megapixel ceiling + decode concurrency semaphore.
 */
import { describe, it, expect } from "vitest";
import { assertWithinPixelLimit, ImageTooLargeError, maxInputPixels, Semaphore } from "./guards";

describe("assertWithinPixelLimit", () => {
  it("passes an image under the limit", () => {
    expect(() => assertWithinPixelLimit(2000, 2000)).not.toThrow(); // 4MP < 40MP default
  });

  it("throws ImageTooLargeError over the limit", () => {
    // 8000*8000 = 64MP > 40MP default.
    expect(() => assertWithinPixelLimit(8000, 8000)).toThrow(ImageTooLargeError);
  });

  it("maxInputPixels matches the configured megapixel budget", () => {
    expect(maxInputPixels()).toBe(40 * 1_000_000); // default STUDIO_MAX_MEGAPIXELS
  });
});

describe("Semaphore", () => {
  it("never lets more than `permits` run at once", async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const task = () =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      });
    await Promise.all(Array.from({ length: 10 }, task));
    expect(peak).toBeLessThanOrEqual(2);
    expect(active).toBe(0);
  });

  it("releases the permit even when the task throws", async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    // If the permit leaked, this second run would hang; a resolved value proves release.
    await expect(sem.run(async () => 42)).resolves.toBe(42);
  });

  it("preserves FIFO order among waiters", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) => sem.run(async () => { order.push(n); await new Promise((r) => setTimeout(r, 1)); })),
    );
    expect(order).toEqual([1, 2, 3]);
  });
});
