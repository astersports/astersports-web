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
 * Parse complete `data: {...}\n\n` frames out of `buffer`. Returns the decoded
 * events and the trailing partial frame (`rest`) the caller should prepend to
 * the next chunk. Malformed frames are skipped, not thrown.
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
      const obj = JSON.parse(json) as unknown;
      if (obj && typeof obj === "object" && typeof (obj as { type?: unknown }).type === "string") {
        events.push(obj as ScoutEvent);
      }
    } catch {
      /* skip a malformed frame */
    }
  }
  return { events, rest };
}
