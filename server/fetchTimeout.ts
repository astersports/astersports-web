/**
 * Fetch utility with timeout support via AbortController.
 * Prevents indefinite hangs when external APIs or storage services are unresponsive.
 */

/**
 * Wraps native fetch with an AbortController timeout.
 * @param url - The URL to fetch
 * @param options - Standard fetch RequestInit options
 * @param timeoutMs - Timeout in milliseconds (default: 30000)
 * @returns The fetch Response
 * @throws Error with descriptive message if timeout is exceeded
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 30_000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error(
        `Request timed out after ${timeoutMs}ms: ${url.substring(0, 100)}${url.length > 100 ? "..." : ""}`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Timeout constants for different operation types */
export const TIMEOUT = {
  /** Image download from S3 or external URL (30 seconds) */
  IMAGE_DOWNLOAD: 30_000,
  /** AI image generation API call (120 seconds — generation can take 10-20s) */
  IMAGE_GENERATION: 120_000,
  /** LLM element detection (60 seconds) */
  ELEMENT_DETECTION: 60_000,
  /** Storage presign URL fetch (10 seconds) */
  STORAGE_PRESIGN: 10_000,
} as const;
