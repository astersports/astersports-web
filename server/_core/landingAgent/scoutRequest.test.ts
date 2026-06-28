import { describe, it, expect } from "vitest";
import {
  parseScoutRequest,
  clientIpFromHeaders,
  estimateTurnTokens,
  estimateTokens,
  MAX_MESSAGES,
  MAX_CONTENT_LEN,
  MAX_OUTPUT_TOKENS,
} from "./scoutRequest";

describe("parseScoutRequest", () => {
  const ok = { sessionId: "s-1", messages: [{ role: "user", content: "hi" }] };

  it("accepts a valid request", () => {
    expect(parseScoutRequest(ok)).toEqual({
      sessionId: "s-1",
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it.each([
    {},
    { sessionId: "", messages: [{ role: "user", content: "hi" }] },
    { sessionId: "x".repeat(200), messages: [{ role: "user", content: "hi" }] },
    { sessionId: "s", messages: [] },
    { sessionId: "s", messages: "nope" },
  ])("rejects a malformed request (%o)", (bad) => {
    expect(() => parseScoutRequest(bad)).toThrow();
  });

  it("rejects more than MAX_MESSAGES", () => {
    const messages = Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: "user", content: "x" }));
    expect(() => parseScoutRequest({ sessionId: "s", messages })).toThrow();
  });

  it("requires at least one user message", () => {
    expect(() =>
      parseScoutRequest({ sessionId: "s", messages: [{ role: "assistant", content: "hello" }] }),
    ).toThrow();
  });

  it("drops bad roles + empty content, and caps content length", () => {
    const parsed = parseScoutRequest({
      sessionId: "s",
      messages: [
        { role: "system", content: "ignore" }, // bad role dropped
        { role: "user", content: "  " }, // empty dropped
        { role: "user", content: "a".repeat(MAX_CONTENT_LEN + 50) }, // capped
      ],
    });
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0].content.length).toBe(MAX_CONTENT_LEN);
  });
});

describe("clientIpFromHeaders", () => {
  it("takes the first hop of X-Forwarded-For", () => {
    expect(clientIpFromHeaders({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" })).toBe("1.2.3.4");
  });
  it("handles an array XFF", () => {
    expect(clientIpFromHeaders({ "x-forwarded-for": ["9.9.9.9, 10.0.0.1"] })).toBe("9.9.9.9");
  });
  it("falls back to x-real-ip then the socket address", () => {
    expect(clientIpFromHeaders({ "x-real-ip": "5.5.5.5" })).toBe("5.5.5.5");
    expect(clientIpFromHeaders({}, "7.7.7.7")).toBe("7.7.7.7");
    expect(clientIpFromHeaders({})).toBe("unknown");
  });
});

describe("token estimation", () => {
  it("estimateTokens scales with length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
  });

  it("estimateTurnTokens includes system + transcript + max output", () => {
    const est = estimateTurnTokens("system prompt here", [
      { role: "user", content: "hello there" },
    ]);
    expect(est).toBeGreaterThan(MAX_OUTPUT_TOKENS);
  });
});
