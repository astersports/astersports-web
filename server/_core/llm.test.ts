import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK: `new Anthropic()` yields a client whose messages.create
// is our spy; Anthropic.APIError is a real class so `instanceof` works in the
// error path.
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status?: number;
  }
  const Anthropic = vi.fn(function () {
    return { messages: { create: mockCreate } };
  }) as unknown as {
    new (): unknown;
    APIError: typeof APIError;
  };
  (Anthropic as unknown as { APIError: typeof APIError }).APIError = APIError;
  return { default: Anthropic };
});

// Mutable env so a test can flip the key / model and re-import a fresh module.
const mockEnv = { anthropicApiKey: "sk-ant-test", anthropicModel: "claude-opus-4-8" };
vi.mock("./env", () => ({ ENV: mockEnv }));

async function freshInvoke() {
  vi.resetModules();
  return (await import("./llm")).invokeLLM;
}

const OK_RESPONSE = {
  id: "msg_1",
  model: "claude-opus-4-8",
  stop_reason: "end_turn",
  content: [{ type: "text", text: '{"x":0.1,"y":0.2,"w":0.5,"h":0.5,"confidence":0.9}' }],
  usage: { input_tokens: 120, output_tokens: 24 },
};

describe("invokeLLM (Anthropic adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.anthropicApiKey = "sk-ant-test";
    mockEnv.anthropicModel = "claude-opus-4-8";
    mockCreate.mockResolvedValue(OK_RESPONSE);
  });

  it("translates system + data-URL image + json_schema, and maps the response back", async () => {
    const invokeLLM = await freshInvoke();
    const result = await invokeLLM({
      messages: [
        { role: "system", content: "Locate the fabric." },
        {
          role: "user",
          content: [
            { type: "text", text: "Return the bbox." },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA", detail: "low" } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "fabric_region", strict: true, schema: { type: "object", properties: {} } },
      },
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const arg = mockCreate.mock.calls[0][0];
    // System message lifted to the top-level `system` (not a message turn).
    expect(arg.system).toBe("Locate the fabric.");
    expect(arg.model).toBe("claude-opus-4-8");
    expect(arg.max_tokens).toBe(4096);
    // One user turn: a text block + a base64 image block parsed from the data URL.
    expect(arg.messages).toHaveLength(1);
    expect(arg.messages[0].role).toBe("user");
    expect(arg.messages[0].content[0]).toEqual({ type: "text", text: "Return the bbox." });
    expect(arg.messages[0].content[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "AAAA" },
    });
    // response_format json_schema -> output_config.format.
    expect(arg.output_config).toEqual({
      format: { type: "json_schema", schema: { type: "object", properties: {} } },
    });

    // Response mapped onto the OpenAI-shaped contract callers parse.
    expect(result.choices[0].message.content).toBe(OK_RESPONSE.content[0].text);
    expect(result.choices[0].finish_reason).toBe("end_turn");
    expect(result.usage).toEqual({ prompt_tokens: 120, completion_tokens: 24, total_tokens: 144 });
  });

  it("passes an http(s) image URL through as a url source (provider fetches it)", async () => {
    const invokeLLM = await freshInvoke();
    await invokeLLM({
      messages: [
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: "https://example.com/signed.jpg" } }],
        },
      ],
    });
    const arg = mockCreate.mock.calls[0][0];
    expect(arg.messages[0].content[0]).toEqual({
      type: "image",
      source: { type: "url", url: "https://example.com/signed.jpg" },
    });
    // No structured output requested -> no output_config sent.
    expect(arg.output_config).toBeUndefined();
  });

  it("uses ANTHROPIC_MODEL as the env-configurable model lever", async () => {
    mockEnv.anthropicModel = "claude-haiku-4-5";
    const invokeLLM = await freshInvoke();
    await invokeLLM({ messages: [{ role: "user", content: "hi" }] });
    expect(mockCreate.mock.calls[0][0].model).toBe("claude-haiku-4-5");
  });

  it("throws when ANTHROPIC_API_KEY is absent (degrades the caller, never silently bills)", async () => {
    mockEnv.anthropicApiKey = "";
    const invokeLLM = await freshInvoke();
    await expect(invokeLLM({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      /ANTHROPIC_API_KEY is not configured/
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("surfaces a generic error (no upstream detail) when the API call fails", async () => {
    mockCreate.mockRejectedValueOnce(new Error("boom: internal host leak"));
    const invokeLLM = await freshInvoke();
    await expect(invokeLLM({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(
      /LLM invoke failed/
    );
  });
});
