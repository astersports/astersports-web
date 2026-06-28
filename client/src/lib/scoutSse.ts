/**
 * Client parser for the "Aster Scout" SSE stream (docs/SPEC_LANDING_AGENT.txt P4).
 * The server emits one JSON object per `data:` frame; this turns a growing text
 * buffer into typed events + the unparsed remainder. Pure + unit-tested.
 *
 * The event shapes mirror server/routes/landingScout.ts exactly (the contract).
 */

export type ScoutEvent =
  | { type: "delta"; text: string }
  | { type: "cta"; serviceId: string }
  | { type: "lead_ack"; name: string }
  | { type: "lead_denied"; message: string }
  | { type: "lead_error"; message: string }
  | { type: "denied"; reason?: string; message: string }
  | { type: "error"; message: string }
  | { type: "done"; denied?: boolean };

/**
 * Validate an event shape at the contract boundary: the required field for each
 * type must be present and correctly typed, so the UI never concatenates an
 * `undefined` delta or shows an empty notice from a malformed frame. Unknown or
 * invalid shapes return null and are dropped.
 */
function asScoutEvent(obj: unknown): ScoutEvent | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
  switch (o.type) {
    case "delta":
      return typeof o.text === "string" ? { type: "delta", text: o.text } : null;
    case "cta":
      return isStr(o.serviceId) ? { type: "cta", serviceId: o.serviceId } : null;
    case "lead_ack":
      return typeof o.name === "string" ? { type: "lead_ack", name: o.name } : null;
    case "lead_denied":
      return isStr(o.message) ? { type: "lead_denied", message: o.message } : null;
    case "lead_error":
      return isStr(o.message) ? { type: "lead_error", message: o.message } : null;
    case "denied":
      return isStr(o.message)
        ? { type: "denied", message: o.message, reason: typeof o.reason === "string" ? o.reason : undefined }
        : null;
    case "error":
      return isStr(o.message) ? { type: "error", message: o.message } : null;
    case "done":
      return { type: "done", denied: o.denied === true };
    default:
      return null;
  }
}

/**
 * Parse complete `data: {...}\n\n` frames out of `buffer`. Returns the decoded
 * events and the trailing partial frame (`rest`) the caller should prepend to
 * the next chunk. Malformed/invalid frames are skipped, not thrown.
 */
export function parseSseBuffer(buffer: string): { events: ScoutEvent[]; rest: string } {
  const events: ScoutEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? ""; // last segment may be an incomplete frame

  for (const part of parts) {
    const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
    if (!dataLine) continue;
    const json = dataLine.slice(dataLine.indexOf(":") + 1).trim();
    if (!json) continue;
    try {
      const ev = asScoutEvent(JSON.parse(json));
      if (ev) events.push(ev);
    } catch {
      /* skip a malformed frame */
    }
  }
  return { events, rest };
}
