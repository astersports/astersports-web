/**
 * Sentry initialization for the Aster Sports web app ("astersports-landing" / astersports-web).
 *
 * Imported FIRST in main.tsx so the SDK installs its global error + tracing handlers before any
 * application code runs. Project: aster-sports.sentry.io → astersports-web (the surface where the
 * platform's web observability is now maintained).
 *
 * DSN: a Sentry DSN is a PUBLIC ingest key — it is safe in the client bundle and in the repo (it
 * cannot read data, only submit events). VITE_SENTRY_DSN overrides the baked default per
 * environment when set; the default keeps reporting working on deploy without an env change.
 *
 * Privacy posture (this app carries the Stripe money-path and will handle customer images):
 *   - sendDefaultPii: false — no IP / cookies / headers attached.
 *   - Session Replay masks ALL text and blocks ALL media, so replays never capture content.
 *   - beforeSend strips any user IP / geo defensively, in case PII is ever flipped on or the
 *     server enriches geo at ingest (mirrors the org's established Sentry hardening).
 * Server-side IP storage should additionally be disabled at the Sentry project level
 * (Settings → Security & Privacy → "Prevent Storing of IP Addresses").
 */
import * as Sentry from "@sentry/react";

const DSN =
  (import.meta.env.VITE_SENTRY_DSN as string | undefined) ??
  "https://8a928b2fba9d3d6b71710b48cb64cbdb@o4511255144103936.ingest.us.sentry.io/4511649199947776";

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION as string | undefined,

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Conservative sampling for a public landing surface — tune up once volume + quota are known.
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Propagate traces only to our own (same-origin) tRPC/API backend.
    tracePropagationTargets: ["localhost", /^\//, /astersports\.(io|app)$/],

    // No PII by default; strip IP/geo defensively even if something upstream re-adds it.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.user) {
        delete event.user.ip_address;
        delete (event.user as Record<string, unknown>).geo;
      }
      return event;
    },
  });
}
