import { describe, it, expect } from "vitest";
import { parseAllowedOrigins, allowedOrigin } from "./cors";

describe("parseAllowedOrigins", () => {
  it("includes the built-in first-party defaults", () => {
    const list = parseAllowedOrigins(undefined);
    expect(list).toContain("https://astersports.io");
    expect(list).toContain("https://legacy-hoopers-production.up.railway.app");
  });

  it("merges + trims env-provided origins and de-dupes", () => {
    const list = parseAllowedOrigins(" https://a.example , https://b.example , https://astersports.io ");
    expect(list).toContain("https://a.example");
    expect(list).toContain("https://b.example");
    // astersports.io appears once despite being in both defaults and env
    expect(list.filter((o) => o === "https://astersports.io")).toHaveLength(1);
  });

  it("ignores empty/whitespace env entries", () => {
    const list = parseAllowedOrigins(" , ,, ");
    expect(list).toEqual(parseAllowedOrigins(undefined));
  });
});

describe("allowedOrigin", () => {
  const allow = ["https://astersports.io", "https://legacy-hoopers-production.up.railway.app"];

  it("echoes an exact allowlisted origin", () => {
    expect(allowedOrigin("https://legacy-hoopers-production.up.railway.app", allow)).toBe(
      "https://legacy-hoopers-production.up.railway.app",
    );
  });

  it("returns null for a disallowed origin", () => {
    expect(allowedOrigin("https://evil.example", allow)).toBeNull();
  });

  it("returns null when no Origin header is present (same-origin / non-CORS)", () => {
    expect(allowedOrigin(undefined, allow)).toBeNull();
  });

  it("does not partial-match (exact only)", () => {
    expect(allowedOrigin("https://astersports.io.evil.example", allow)).toBeNull();
    expect(allowedOrigin("http://astersports.io", allow)).toBeNull(); // scheme matters
  });
});
