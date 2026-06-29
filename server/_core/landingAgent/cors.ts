/**
 * CORS allowlist for the PUBLIC landing scout endpoint.
 *
 * The landing page itself is same-origin and never needs CORS. External
 * first-party surfaces that embed the scout (e.g. the AAU hub on its own
 * Railway domain) call it cross-origin and DO. We echo back only an exact-match
 * allowed Origin — never `*` — so the surface area stays explicit.
 *
 * Extend without a deploy via LANDING_SCOUT_ALLOWED_ORIGINS (comma-separated);
 * the built-in defaults cover the known first-party surfaces.
 */

/** Known first-party origins permitted to call the scout cross-origin. */
const DEFAULT_ALLOWED = [
  "https://astersports.io",
  "https://legacy-hoopers-production.up.railway.app", // AAU hub
];

/** Parse the env override into a trimmed, de-duped allowlist merged with defaults. */
export function parseAllowedOrigins(envVal: string | undefined): string[] {
  const fromEnv = (envVal ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_ALLOWED, ...fromEnv]));
}

/** The effective allowlist, read once at module load. */
export const SCOUT_ALLOWED_ORIGINS = parseAllowedOrigins(process.env.LANDING_SCOUT_ALLOWED_ORIGINS);

/**
 * Resolve the value to echo in Access-Control-Allow-Origin: the request Origin
 * if (and only if) it's an exact allowlist match, else null (→ send no CORS
 * headers, so a disallowed origin is blocked by the browser).
 */
export function allowedOrigin(
  origin: string | undefined,
  allowed: string[] = SCOUT_ALLOWED_ORIGINS,
): string | null {
  if (!origin) return null;
  return allowed.includes(origin) ? origin : null;
}
