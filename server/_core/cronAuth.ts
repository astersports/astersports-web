/**
 * Shared-secret gate for the server-to-server scheduled endpoints (`/api/scheduled/*`).
 *
 * Accepts the configured CRON_SECRET via EITHER header, so a Manus scheduled task
 * authenticates whether it carries our custom header or the platform's native one:
 *   - `x-cron-secret: <secret>`         — the custom header configured on the older crons, OR
 *   - `Authorization: Bearer <secret>`  — what the Manus cron scheduler injects natively.
 *
 * Why both: the older crons (reaper, trial-reminders, …) were set up with a manual
 * `x-cron-secret` header and pass; a freshly-scheduled cron that relies on Manus's native
 * `Authorization: Bearer <CRON_SECRET>` injection was 403-ing here. Accepting both lets a
 * cron authenticate without a manual custom-header step. This is defense-in-depth layered
 * ON TOP of each route's separate cron-session check (sdk.authenticateRequest →
 * isCron/taskUid); it is NOT the sole gate.
 *
 * Backward-compatible: when CRON_SECRET is unset (e.g. unit CI) the secret gate is open and
 * only the session check applies. The scheme match is exact (`Bearer ` + secret) — Manus
 * injects a capital-B `Bearer`, and an exact match avoids accidentally broadening what we accept.
 */
export function cronSecretOk(
  headers: Record<string, string | string[] | undefined>,
  cronSecret: string | undefined,
): boolean {
  if (!cronSecret) return true;

  const xCronSecret = headers["x-cron-secret"];
  if (typeof xCronSecret === "string" && xCronSecret === cronSecret) return true;

  const authorization = headers["authorization"];
  if (typeof authorization === "string" && authorization === `Bearer ${cronSecret}`) return true;

  return false;
}
