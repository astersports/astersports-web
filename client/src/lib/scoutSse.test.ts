import { describe, it, expect } from "vitest";
import { parseSseBuffer } from "./scoutSse";

describe("parseSseBuffer", () => {
  it("parses complete frames and returns the partial remainder", () => {
    const buf =
      `data: ${JSON.stringify({ type: "delta", text: "Hi" })}\n\n` +
      `data: ${JSON.stringify({ type: "cta", serviceId: "studio" })}\n\n` +
      `data: ${JSON.stringify({ type: "done" })}`; // no trailing \n\n yet
    const { events, rest } = parseSseBuffer(buf);
    expect(events).toEqual([
      { type: "delta", text: "Hi" },
      { type: "cta", serviceId: "studio" },
    ]);
    expect(rest).toBe(`data: ${JSON.stringify({ type: "done" })}`);
  });

  it("carries a partial frame to the next chunk", () => {
    const first = parseSseBuffer(`data: ${JSON.stringify({ type: "delta", text: "ab" })}\n\nda`);
    expect(first.events).toHaveLength(1);
    expect(first.rest).toBe("da");
    const second = parseSseBuffer(first.rest + `ta: ${JSON.stringify({ type: "delta", text: "cd" })}\n\n`);
    expect(second.events).toEqual([{ type: "delta", text: "cd" }]);
  });

  it("skips malformed frames without throwing", () => {
    const { events } = parseSseBuffer(
      `data: not-json\n\n` + `data: ${JSON.stringify({ type: "delta", text: "ok" })}\n\n`,
    );
    expect(events).toEqual([{ type: "delta", text: "ok" }]);
  });

  it("ignores frames without a type", () => {
    const { events } = parseSseBuffer(`data: ${JSON.stringify({ foo: 1 })}\n\n`);
    expect(events).toEqual([]);
  });

  it("returns nothing for an empty buffer", () => {
    expect(parseSseBuffer("")).toEqual({ events: [], rest: "" });
  });
});
