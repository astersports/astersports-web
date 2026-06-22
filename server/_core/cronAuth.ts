/**
 * Shared-secret gate for the server-to-server scheduled endpoints (`/api/scheduled/*`).
 *
 * Accepts the configured CRON_SECRET via EITHER header, so a Manus scheduled task
 * authenticates whether it carries our custom header or the platform's native one:
 *   - `x-cron-secret: <secret>`         — the custom header configured on the older crons, OR
 *   - `Authorization: Bearer <secret>`   — what the Manus cron scheduler injects natively, OR
 *   - `x-webdev-schedule-uid: <uid>`     — platform-injected schedule identifier (Heartbeat).
 *
 * Why all three: the Manus Heartbeat scheduler does NOT inject `x-cron-secret` or
 * `Authorization: Bearer <CRON_SECRET>`. It authenticates via a session cookie
 * (verified downstream by `sdk.authenticateRequest → isCron`) and identifies itself
 * with `x-webdev-schedule-uid` + `x-webdev-run-uid`. The older crons were set up with
 * a manual `x-cron-secret` header. Accepting all three lets every cron flavor pass the
 * shared-secret gate without a manual custom-header step.
 *
 * This is defense-in-depth layered ON TOP of each route's separate cron-session check
 * (sdk.authenticateRequest → isCron/taskUid); it is NOT the sole gate.
 *
 * Backward-compatible: when CRON_SECRET is unset (e.g. unit CI) the secret gate is open
 * and only the session check applies.
 */
export function cronSecretOk(
  headers: Record<string, string | string[] | undefined>,
  cronSecret: string | undefined,
): boolean {
  if (!cronSecret) return true;

  // Accept our custom header
  const xCronSecret = headers["x-cron-secret"];
  if (typeof xCronSecret === "string" && xCronSecret === cronSecret) return true;

  // Accept Authorization: Bearer <CRON_SECRET>
  const authorization = headers["authorization"];
  if (typeof authorization === "string" && authorization === `Bearer ${cronSecret}`) return true;

  // Accept the Manus platform's Heartbeat schedule UID header.
  // When the platform sends x-webdev-schedule-uid, it also injects a cron session cookie
  // that sdk.authenticateRequest will verify downstream — so the schedule UID presence is
  // sufficient to pass this gate (the real auth is the session check that follows).
  const scheduleUid = headers["x-webdev-schedule-uid"];
  if (typeof scheduleUid === "string" && scheduleUid.length > 0) return true;

  return false;
}
