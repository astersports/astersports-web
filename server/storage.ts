// Storage helpers. Migrated from the Manus Forge presigned-URL/S3 path to Supabase
// Storage (private `media` bucket). The public surface is unchanged on purpose:
//   - storagePut returns { key, url: "/manus-storage/{key}" } — same serving path,
//     so keys already persisted in the DB and rendered in the UI stay valid.
//   - storageGet returns that path without a network round-trip.
//   - storageGetSignedUrl returns a time-limited URL the sub-processors (Claude /
//     Replicate) can fetch directly.
// The /manus-storage/{key} route (server/_core/storageProxy.ts) keeps the
// tenant-isolation auth check and 307-redirects the browser to a short-lived
// signed URL — the bucket itself is never public.

import { ENV } from "./_core/env";
import { createStorageSignedUrl, getStorageClient } from "./_core/supabaseStorage";

/** TTL for read URLs handed to sub-processors (Claude vision, Replicate SAM2/LaMa).
 *  Generous so a queued async prediction can still fetch the source when it runs. */
const READ_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
  opts?: { deterministicKey?: boolean },
): Promise<{ key: string; url: string }> {
  // Default appends a random suffix so distinct user assets sharing a path don't clobber.
  // Content-addressed callers (the LaMa reproducible-by-cache layer) pass deterministicKey
  // so the write address equals the later read address — otherwise the cache never hits.
  const key = opts?.deterministicKey ? normalizeKey(relKey) : appendHashSuffix(normalizeKey(relKey));

  // Normalize to a Buffer (Supabase storage-js accepts Buffer/ArrayBuffer/Blob in Node).
  const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data as Uint8Array);

  const { error } = await getStorageClient()
    .storage.from(ENV.supabaseStorageBucket)
    .upload(key, body, {
      contentType,
      // Deterministic (content-addressed) keys are written repeatedly with identical
      // bytes, so overwrite is expected; random-suffix keys are unique, so don't.
      upsert: Boolean(opts?.deterministicKey),
    });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return createStorageSignedUrl(normalizeKey(relKey), READ_SIGNED_URL_TTL_SECONDS);
}
