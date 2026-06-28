import { describe, it, expect } from "vitest";
import { KNOWLEDGE_PRODUCTS, FAQ, POSITIONING } from "@shared/landingKnowledge";
import { PRODUCTS, SERVICES } from "@/lib/services";

/**
 * P1 guard for the landing knowledge pack (docs/SPEC_LANDING_AGENT.txt).
 *
 * Condition C4 — the pack is version-pinned to the service registry, so the
 * agent's grounding can never drift from what the page shows.
 * Condition C1 — the pack carries no raw price literal, so a model answering
 * from it has nothing to misquote (prices/URLs are the registry's job, rendered
 * client-side; the model only routes by id).
 */
describe("landing knowledge pack", () => {
  const registry = [...PRODUCTS, ...SERVICES];

  it("mirrors every service-registry entry, in order and by id", () => {
    expect(KNOWLEDGE_PRODUCTS.map((k) => k.id)).toEqual(registry.map((r) => r.id));
  });

  it("matches the registry facts for each entry (no drift)", () => {
    for (const entry of KNOWLEDGE_PRODUCTS) {
      const source = registry.find((r) => r.id === entry.id);
      expect(source, `registry entry for "${entry.id}"`).toBeDefined();
      expect(entry.name).toBe(source!.name);
      expect(entry.tagline).toBe(source!.tagline);
      expect(entry.description).toBe(source!.description);
      expect(entry.href).toBe(source!.href);
      expect(entry.status).toBe(source!.status);
      expect(entry.kind).toBe(source!.kind);
    }
  });

  it("carries no raw price literal anywhere in the pack (condition C1)", () => {
    const corpus = [
      ...KNOWLEDGE_PRODUCTS.flatMap((p) => [p.name, p.tagline, p.description]),
      ...POSITIONING,
      ...FAQ.flatMap((f) => [f.q, f.a]),
    ].join("\n");
    // $9, $9.99, "$ 9", etc. The agent must never have a hard price to parrot.
    expect(corpus).not.toMatch(/\$\s?\d/);
  });

  it("only references product URLs that exist in the registry (condition C1/C4)", () => {
    const registryHrefs = new Set(registry.map((r) => r.href));
    for (const entry of KNOWLEDGE_PRODUCTS) {
      expect(registryHrefs.has(entry.href)).toBe(true);
    }
    // FAQ/positioning prose must not smuggle in an http(s) link the registry
    // doesn't own — links are the registry's job, surfaced as CTA cards.
    const prose = [...POSITIONING, ...FAQ.flatMap((f) => [f.q, f.a])].join("\n");
    expect(prose).not.toMatch(/https?:\/\//);
  });

  it("has non-empty positioning and FAQ", () => {
    expect(POSITIONING.length).toBeGreaterThan(0);
    expect(FAQ.length).toBeGreaterThan(0);
    for (const f of FAQ) {
      expect(f.q.length).toBeGreaterThan(0);
      expect(f.a.length).toBeGreaterThan(0);
    }
  });
});
