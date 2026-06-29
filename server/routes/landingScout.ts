/**
 * Landing "Aster Scout" concierge — SSE endpoint (docs/SPEC_LANDING_AGENT.txt, P3b).
 *
 * POST /api/landing/scout-stream
 *   body: { sessionId, messages: [{ role, content }] }
 *   auth: NONE (public). Defended by the §5 abuse/cost guard
 *         (server/_core/landingAgent/guard.ts) + dark-by-default flag.
 *
 * Flow: dark-check → parse/clamp body → spend+rate guard → stream the model,
 * piping text deltas as SSE → settle spend on real usage → execute at most one
 * tool (recommend_surface → `cta` event; capture_lead → separate lead-cap gate +
 * Resend + `lead_ack`). Fails CLOSED around the model call.
 *
 * Stays dark until LANDING_AGENT_LIVE is flipped (Frank, §1). While dark the
 * route 404s as if unmounted.
 */
import type { Express, Request, Response } from "express";
import { ENV } from "../_core/env";
import { log } from "../serverLog";
import { landingAgentGuard } from "../_core/landingAgent/guard";
import {
  parseScoutRequest,
  clientIpFromHeaders,
  estimateTurnTokens,
} from "../_core/landingAgent/scoutRequest";
import { streamScout } from "../_core/landingAgent/scoutLlm";
import { isTurnstileConfigured, verifyTurnstile } from "../_core/landingAgent/turnstile";
import { allowedOrigin } from "../_core/landingAgent/cors";
import { buildScoutSystemPrompt } from "../../shared/landingAgentPrompt";
import { validateRecommendSurface, validateCaptureLead } from "../../shared/landingAgentTools";
import { emailLeadCaptured } from "../email";

/** Kindness microcopy when the Turnstile bot gate rejects a turn (P5, Fork D). */
const TURNSTILE_DENY_MESSAGE =
  "We couldn't confirm you're human just yet — refresh the check and try again, or reach us on the contact form.";

/** Single fallback shown whenever a lead can't be captured (send failed OR threw),
 *  so the two branches never drift apart. */
const LEAD_FALLBACK_MESSAGE =
  "We couldn't capture that — please use the contact form and we'll reply by email.";

/**
 * Apply CORS headers when the request comes from an allowlisted cross-origin
 * surface (e.g. the AAU hub). Echoes the exact Origin — never `*` — and is a
 * no-op for same-origin / disallowed origins. Called on every response path
 * (incl. the dark 404, the 400, the SSE stream, and the OPTIONS preflight) so
 * the header is present whatever the outcome.
 */
function applyScoutCors(req: Request, res: Response): void {
  const origin = allowedOrigin(req.headers.origin as string | undefined);
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function sse(res: Response, data: Record<string, unknown>): void {
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
      (res as unknown as { flush: () => void }).flush();
    }
  } catch {
    /* connection closed — swallow */
  }
}

export function registerLandingScoutRoute(app: Express): void {
  // CORS preflight for cross-origin callers (the browser sends this before a
  // JSON POST from an allowlisted external surface like the AAU hub).
  app.options("/api/landing/scout-stream", (req: Request, res: Response) => {
    applyScoutCors(req, res);
    // Stay dark by default: while the flag is off the route 404s for POST, so the
    // preflight must 404 too — otherwise a 204 would advertise the route exists
    // before the flip.
    if (!ENV.landingAgentLive) {
      res.status(404).end();
      return;
    }
    res.status(204).end();
  });

  app.post("/api/landing/scout-stream", async (req: Request, res: Response) => {
    applyScoutCors(req, res);

    // Dark by default: behave as if the route does not exist until the flip.
    if (!ENV.landingAgentLive) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Validate + clamp the body BEFORE opening the stream so bad input is a clean 400.
    let parsed;
    try {
      parsed = parseScoutRequest(req.body);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    const ip = clientIpFromHeaders(
      req.headers as Record<string, unknown>,
      req.socket?.remoteAddress,
    );
    const now = Date.now();
    const system = buildScoutSystemPrompt();
    const estTokens = estimateTurnTokens(system, parsed.messages);

    const decision = landingAgentGuard.evaluateChatTurn({
      ip,
      sessionId: parsed.sessionId,
      estTokens,
      now,
      live: ENV.landingAgentLive,
    });

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    if (!decision.allowed) {
      sse(res, { type: "denied", reason: decision.reason, message: decision.message });
      sse(res, { type: "done", denied: true });
      res.end();
      return;
    }

    // Bot gate (P5, Fork D) — BEST-EFFORT by default. When a token is present we
    // verify it and cache the session (VERIFIED_TTL_MS) so later turns skip the
    // round-trip. A missing/failed token only HARD-BLOCKS when
    // LANDING_AGENT_TURNSTILE_REQUIRED=true; otherwise the turn proceeds and the
    // rate-limit + per-identity + global spend caps remain the hard guards. This
    // keeps the agent usable when the widget can't load (blocked/misconfigured)
    // without removing the bot signal where it does work. verifyTurnstile FAILS
    // CLOSED on every error path.
    if (isTurnstileConfigured() && !landingAgentGuard.isVerified(parsed.sessionId, now)) {
      const ok = await verifyTurnstile(parsed.turnstileToken, ip);
      if (ok) {
        landingAgentGuard.markVerified(parsed.sessionId, now);
      } else if (ENV.landingAgentTurnstileRequired) {
        sse(res, { type: "denied", reason: "turnstile", message: TURNSTILE_DENY_MESSAGE });
        sse(res, { type: "done", denied: true });
        res.end();
        return;
      }
      // soft-fail: not required → fall through and let the turn run.
    }

    // Abort the model stream if the visitor navigates away mid-turn.
    const ac = new AbortController();
    res.on("close", () => ac.abort());

    try {
      const result = await streamScout({
        system,
        messages: parsed.messages,
        onText: (delta) => sse(res, { type: "delta", text: delta }),
        signal: ac.signal,
      });

      // Settle the reservation against real usage (delta may be +/-).
      const actual = result.usage.inputTokens + result.usage.outputTokens;
      landingAgentGuard.settleChatTurn(ip, actual - estTokens, now);

      // Concierge v1: act on at most one tool call per turn.
      const tool = result.toolCalls[0];
      if (tool?.name === "recommend_surface") {
        try {
          const { serviceId } = validateRecommendSurface(tool.input);
          sse(res, { type: "cta", serviceId }); // client renders the registry CTA card (C1)
        } catch {
          /* unknown id — the text answer stands on its own */
        }
      } else if (tool?.name === "capture_lead") {
        const leadGate = landingAgentGuard.evaluateLeadCapture({ ip, now, live: ENV.landingAgentLive });
        if (!leadGate.allowed) {
          sse(res, { type: "lead_denied", message: leadGate.message });
        } else {
          try {
            const lead = validateCaptureLead(tool.input);
            // Only acknowledge if the email ACTUALLY sent. emailLeadCaptured
            // returns false (no throw) when Resend is unconfigured or errors —
            // acking anyway would tell the visitor "we'll be in touch" while the
            // lead is silently dropped. Honesty: fall back to the contact form.
            const sent = await emailLeadCaptured(lead);
            if (sent) {
              sse(res, { type: "lead_ack", name: lead.name });
            } else {
              sse(res, { type: "lead_error", message: LEAD_FALLBACK_MESSAGE });
            }
          } catch {
            sse(res, { type: "lead_error", message: LEAD_FALLBACK_MESSAGE });
          }
        }
      }

      sse(res, { type: "done" });
    } catch (err) {
      log.error("landing", `scout stream failed: ${(err as Error).message}`);
      sse(res, {
        type: "error",
        message: "Something hiccuped on our end. The contact form will reach us directly.",
      });
    } finally {
      if (!res.writableEnded) res.end();
    }
  });
}
