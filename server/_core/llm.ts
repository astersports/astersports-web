import Anthropic from "@anthropic-ai/sdk";
import { ENV } from "./env";

/**
 * Vision LLM client. Migrated from the Manus forge OpenAI-compatible gateway
 * (forge.manus.im/v1/chat/completions) to the official Anthropic SDK (Claude).
 *
 * The public surface is unchanged on purpose: callers (aiEngine, locateFabricRegion)
 * and the test mocks pass OpenAI-shaped `InvokeParams` and read an OpenAI-shaped
 * `InvokeResult` (`choices[0].message.content`). This module adapts that contract
 * onto Anthropic's Messages API — OpenAI `messages`/`image_url`/`response_format`
 * translate to Anthropic `system` + `messages` (image blocks) + `output_config.format`.
 */

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  model?: string;
  thinking?: Record<string, unknown>;
  reasoning?: Record<string, unknown>;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

/** Anthropic requires max_tokens; our structured-extraction calls emit small JSON,
 *  so a modest default avoids truncating an element list without inflating latency. */
const DEFAULT_MAX_TOKENS = 4096;

const ALLOWED_IMAGE_MEDIA = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type AllowedImageMedia = (typeof ALLOWED_IMAGE_MEDIA)[number];

let cachedClient: Anthropic | null = null;
const getClient = (): Anthropic => {
  if (!ENV.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
  if (!cachedClient) {
    // maxRetries mirrors the old custom backoff (4 tries); the SDK retries 429/5xx
    // and connection errors with exponential backoff automatically.
    cachedClient = new Anthropic({ apiKey: ENV.anthropicApiKey, maxRetries: 4 });
  }
  return cachedClient;
};

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

/** Translate one OpenAI image_url part (data URL or http(s) URL) into an Anthropic image block. */
const toImageBlock = (part: ImageContent): Anthropic.ImageBlockParam => {
  const url = part.image_url.url;
  // Inline data URL (the locate path downscales to a base64 JPEG): decode to a
  // base64 source so Anthropic never has to fetch anything.
  const dataMatch = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(url);
  if (url.startsWith("data:") && dataMatch) {
    const declared = (dataMatch[1] || "image/jpeg").toLowerCase();
    const media: AllowedImageMedia = (ALLOWED_IMAGE_MEDIA as readonly string[]).includes(declared)
      ? (declared as AllowedImageMedia)
      : "image/jpeg";
    return { type: "image", source: { type: "base64", media_type: media, data: dataMatch[3] ?? "" } };
  }
  // Signed/remote URL (detect + no-op judge paths): Anthropic fetches it server-side.
  return { type: "image", source: { type: "url", url } };
};

const toContentBlock = (part: MessageContent): Anthropic.ContentBlockParam => {
  if (typeof part === "string") return { type: "text", text: part };
  if (part.type === "text") return { type: "text", text: part.text };
  if (part.type === "image_url") return toImageBlock(part);
  // file_url is unused by the current vision callers; surface loudly if one appears.
  throw new Error("Unsupported message content part for the Anthropic vision client");
};

/** Split OpenAI-style messages into Anthropic's top-level `system` string + user/assistant turns. */
const toAnthropicMessages = (
  messages: Message[]
): { system: string; messages: Anthropic.MessageParam[] } => {
  const systemParts: string[] = [];
  const out: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(
        ensureArray(message.content)
          .map((p) => (typeof p === "string" ? p : p.type === "text" ? p.text : ""))
          .filter(Boolean)
          .join("\n")
      );
      continue;
    }
    // tool/function roles are unused here; fold anything non-assistant into a user turn.
    const role: "user" | "assistant" = message.role === "assistant" ? "assistant" : "user";
    out.push({ role, content: ensureArray(message.content).map(toContentBlock) });
  }

  return { system: systemParts.join("\n\n"), messages: out };
};

/** Map an OpenAI response_format / outputSchema onto Anthropic's structured-output config. */
const toOutputConfig = (params: InvokeParams): Anthropic.OutputConfig | undefined => {
  const explicit = params.responseFormat || params.response_format;
  if (explicit && explicit.type === "json_schema") {
    return { format: { type: "json_schema", schema: explicit.json_schema.schema } };
  }
  const schema = params.outputSchema || params.output_schema;
  if (schema?.schema) {
    return { format: { type: "json_schema", schema: schema.schema } };
  }
  return undefined;
};

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  // Resolve the client (and its API-key check) BEFORE the try so a missing-key
  // configuration error surfaces verbatim instead of being masked as a call failure.
  const client = getClient();
  const { system, messages } = toAnthropicMessages(params.messages);
  const outputConfig = toOutputConfig(params);
  const maxTokens = params.max_tokens ?? params.maxTokens ?? DEFAULT_MAX_TOKENS;

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: params.model || ENV.anthropicModel,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages,
      ...(outputConfig ? { output_config: outputConfig } : {}),
    });
  } catch (error) {
    // H4 parity: keep upstream detail server-side; throw a generic message so it
    // can't leak request content through serverLogs to a client.
    console.error(`[llm] invoke failed:`, error);
    throw new Error(
      `LLM invoke failed: ${error instanceof Anthropic.APIError ? error.status : "error"}`
    );
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return {
    id: response.id,
    created: 0,
    model: response.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: response.stop_reason ?? null,
      },
    ],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
}
