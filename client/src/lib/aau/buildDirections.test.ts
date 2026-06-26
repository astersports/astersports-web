import { describe, it, expect } from "vitest";
import { buildDirections } from "./buildDirections";

describe("buildDirections (AAU hub §4.1)", () => {
  it("prefers lat/lng for a precise pin", () => {
    const d = buildDirections({ name: "Westchester County Center", lat: 41.03, lng: -73.76 });
    expect(d).not.toBeNull();
    expect(d!.apple).toContain("daddr=41.03,-73.76");
    expect(d!.google).toContain("destination=41.03,-73.76");
    expect(d!.waze).toContain("ll=41.03,-73.76");
    expect(d!.label).toBe("Westchester County Center");
  });

  it("falls back to the full address string when there is no geocode", () => {
    const d = buildDirections({
      name: "Rippowam Cisqua",
      address: "439 Cantitoe St",
      city: "Bedford",
      state: "NY",
    });
    expect(d).not.toBeNull();
    const enc = encodeURIComponent("Rippowam Cisqua, 439 Cantitoe St, Bedford, NY");
    expect(d!.google).toContain(`destination=${enc}`);
    expect(d!.waze).toContain(`q=${enc}`);
    expect(d!.apple).toContain(`daddr=${enc}`);
  });

  it("returns null for a venue with no name, address, or coords (Venue TBD)", () => {
    expect(buildDirections({})).toBeNull();
    expect(buildDirections(null)).toBeNull();
    expect(buildDirections(undefined)).toBeNull();
  });

  it("ignores partial coordinates (only lat) and uses the address fallback", () => {
    const d = buildDirections({ name: "Court 3", lat: 41.0, lng: null });
    expect(d).not.toBeNull();
    expect(d!.apple).not.toContain("daddr=41,");
    expect(d!.apple).toContain(encodeURIComponent("Court 3"));
  });
});
