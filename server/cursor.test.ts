import { describe, it, expect } from "vitest";
import { encodeCursor, decodeCursor } from "./cursor";

describe("keyset cursor (M5c)", () => {
  it("round-trips a numeric key (e.g. createdAt ms / credits)", () => {
    const c = encodeCursor(1782070000000, 42);
    expect(decodeCursor(c)).toEqual({ k: 1782070000000, id: 42 });
  });

  it("round-trips a string key (e.g. title sort)", () => {
    const c = encodeCursor("Navy Crewneck", 7);
    expect(decodeCursor(c)).toEqual({ k: "Navy Crewneck", id: 7 });
  });

  it("is URL-safe (base64url: no +, /, or = padding)", () => {
    const c = encodeCursor("a/b+c==d?", 999999);
    expect(c).not.toMatch(/[+/=]/);
    expect(decodeCursor(c)).toEqual({ k: "a/b+c==d?", id: 999999 });
  });

  it("returns null for malformed / non-cursor input", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not-base64-$$$")).toBeNull();
    expect(decodeCursor(Buffer.from("{}").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('"nope"').toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("[1]").toString("base64url"))).toBeNull(); // wrong arity
    expect(decodeCursor(Buffer.from('[1,"x"]').toString("base64url"))).toBeNull(); // id not a number
    expect(decodeCursor(Buffer.from("[true,2]").toString("base64url"))).toBeNull(); // k wrong type
  });

  it("rejects over-length input before decoding (alloc bound)", () => {
    expect(decodeCursor("A".repeat(513))).toBeNull();
  });
});
