import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./env";

/**
 * Supabase Storage client (server-only). Uses the SERVICE-ROLE key, which bypasses
 * RLS — so this must never be imported into client code. The bucket is private; the
 * only way a customer image reaches a browser is a short-lived signed URL issued
 * here, after the /manus-storage proxy has run its tenant-isolation auth check.
 */
let cached: SupabaseClient | null = null;

export function getStorageClient(): SupabaseClient {
  if (!ENV.supabaseUrl || !ENV.supabaseServiceRoleKey) {
    throw new Error(
      "Supabase storage not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  if (!cached) {
    cached = createClient(ENV.supabaseUrl, ENV.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

/** Whether the storage backend has its credentials (used by the proxy's config gate). */
export function isStorageConfigured(): boolean {
  return Boolean(ENV.supabaseUrl && ENV.supabaseServiceRoleKey);
}

/** Create a time-limited signed URL for a private object. Throws on backend error. */
export async function createStorageSignedUrl(
  key: string,
  expiresInSeconds: number
): Promise<string> {
  const { data, error } = await getStorageClient()
    .storage.from(ENV.supabaseStorageBucket)
    .createSignedUrl(key, expiresInSeconds);
  if (error || !data?.signedUrl) {
    throw new Error(`Storage signed URL failed: ${error?.message ?? "no url returned"}`);
  }
  return data.signedUrl;
}
