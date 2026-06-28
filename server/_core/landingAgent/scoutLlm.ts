/**
 * Streaming model call for the landing "Aster Scout" agent
 * (docs/SPEC_LANDING_AGENT.txt, P3b). Thin wrapper over the Anthropic SDK's
 * streaming API: pipes text deltas to `onText` as they arrive, then returns the
 * final structured message (text + any tool_use + token usage) for the route to
 * settle spend and execute the tool. Uses the dedicated agent model (Haiku) and
 * the small MAX_OUTPUT_TOKENS cap. Network-dependent; the route fails closed
 * around it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "../env";
import { RECOMMEND_SURFACE_TOOL, CAPTURE_LEAD_TOOL } from "../../../shared/landingAgentTools";
import { MAX_OUTPUT_TOKENS, type ScoutMessage } from "./scoutRequest";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!ENV.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  if (!client) client = new Anthropic({ apiKey: ENV.anthropicApiKey, maxRetries: 2 });
  return client;
}

export interface ScoutToolCall {
  name: string;
  input: unknown;
}

export interface ScoutResult {
  text: string;
  toolCalls: ScoutToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string | null;
}

export async function streamScout(opts: {
  system: string;
  messages: ScoutMessage[];
  onText: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<ScoutResult> {
  const c = getClient();

  const stream = c.messages.stream(
    {
      model: ENV.anthropicAgentModel,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: opts.system,
      messages: opts.messages.map((m) => ({ role: m.role, content: m.content })),
      tools: [RECOMMEND_SURFACE_TOOL, CAPTURE_LEAD_TOOL] as unknown as Anthropic.Tool[],
    },
    opts.signal ? { signal: opts.signal } : undefined,
  );

  stream.on("text", (delta: string) => {
    try {
      opts.onText(delta);
    } catch {
      /* client connection gone — keep draining the stream so usage settles */
    }
  });

  const final = await stream.finalMessage();

  let text = "";
  const toolCalls: ScoutToolCall[] = [];
  for (const block of final.content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") toolCalls.push({ name: block.name, input: block.input });
  }

  return {
    text,
    toolCalls,
    usage: { inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens },
    stopReason: final.stop_reason ?? null,
  };
}
