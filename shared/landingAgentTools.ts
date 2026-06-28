/**
 * Landing "Aster Scout" agent tools + input validation
 * (docs/SPEC_LANDING_AGENT.txt, P3). Two tools, both validated server-side
 * before any effect:
 *   - recommend_surface(serviceId): the model routes by registry id ONLY; the
 *     client renders the CTA card with the real link, so the model never emits a
 *     URL (condition C1).
 *   - capture_lead(name, email, need): the public, unauthenticated email-send
 *     primitive — the free-text `need` is sanitized to inert plaintext before it
 *     can reach a human inbox (condition C2b).
 *
 * Pure module (the schemas + validators); the SSE route (P3b) wires these to the
 * Anthropic call, the spend guard, and Resend.
 */

import { KNOWLEDGE_PRODUCTS } from "./landingKnowledge";

/** Registry-pinned set of routable ids — the ONLY values recommend_surface accepts. */
export const VALID_SURFACE_IDS: string[] = KNOWLEDGE_PRODUCTS.map((p) => p.id);

export const LEAD_NEED_MAX = 600;
export const LEAD_NAME_MAX = 80;
const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Anthropic tool definitions (passed to messages.stream in P3b). */
export const RECOMMEND_SURFACE_TOOL = {
  name: "recommend_surface",
  description:
    "Point the visitor at the right Aster Sports product. Pass the product's id only — the page renders the link; never write a URL yourself.",
  input_schema: {
    type: "object",
    properties: { serviceId: { type: "string", enum: VALID_SURFACE_IDS } },
    required: ["serviceId"],
  },
} as const;

export const CAPTURE_LEAD_TOOL = {
  name: "capture_lead",
  description:
    "Pass a lead to the team when the visitor asks to be contacted. Requires a name and email; include one short line about what they need.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      email: { type: "string" },
      need: { type: "string" },
    },
    required: ["name", "email"],
  },
} as const;

/** Strip a free-text field to inert plaintext for a human inbox (condition C2b). */
export function sanitizeLeadNeed(input: unknown): string {
  if (typeof input !== "string") return "";
  let s = input;
  s = s.replace(/<[^>]*>/g, " "); // drop HTML tags/comments
  s = s.replace(/&(?:lt|gt|amp|quot|#x?[0-9a-f]+);?/gi, " "); // neutralize entities so they can't re-form tags
  s = s.replace(/[<>]/g, ""); // belt + suspenders: no stray angle brackets
  s = s.replace(CONTROL_CHARS, " "); // strip control chars
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > LEAD_NEED_MAX) s = s.slice(0, LEAD_NEED_MAX).trim();
  return s;
}

/** Same plaintext strip for the name, with a tighter cap. */
export function sanitizeLeadName(input: unknown): string {
  if (typeof input !== "string") return "";
  let s = input
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, "")
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > LEAD_NAME_MAX) s = s.slice(0, LEAD_NAME_MAX).trim();
  return s;
}

/** Validate + normalize a recommend_surface tool call. Throws on an unknown id. */
export function validateRecommendSurface(input: unknown): { serviceId: string } {
  const serviceId =
    input && typeof input === "object" && typeof (input as Record<string, unknown>).serviceId === "string"
      ? ((input as Record<string, unknown>).serviceId as string)
      : "";
  if (!VALID_SURFACE_IDS.includes(serviceId)) {
    throw new Error(`recommend_surface: unknown serviceId "${serviceId}"`);
  }
  return { serviceId };
}

export interface CapturedLead {
  name: string;
  email: string;
  need: string;
}

/** Validate + sanitize a capture_lead tool call. Throws on a bad email / empty name. */
export function validateCaptureLead(input: unknown): CapturedLead {
  const obj = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const email = typeof obj.email === "string" ? obj.email.trim() : "";
  if (!EMAIL_RE.test(email) || email.length > EMAIL_MAX) {
    throw new Error("capture_lead: invalid email");
  }
  const name = sanitizeLeadName(obj.name);
  if (!name) throw new Error("capture_lead: name required");
  const need = sanitizeLeadNeed(obj.need);
  return { name, email, need };
}
