import { describe, it, expect } from "vitest";
import { KNOWLEDGE_PRODUCTS, SCOUT_FACTS, FAQ, POSITIONING } from "@shared/landingKnowledge";
import { PRODUCTS, SERVICES } from "@/lib/services";

/** http(s) links and bare domains (astersports.app, foo.io, …). Node.js / e.g.
 *  don't match — `.js`/single-letter TLDs are excluded. */
const URL_OR_BARE_DOMAIN = /(https?:\/\/)|(\b[a-z0-9-]+\.(app|io|co|com|net|org|ai|dev|xyz)\b)/i;

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
    // FAQ/positioning prose must not smuggle in a link OR a bare domain the
    // registry doesn't own — links are the registry's job, surfaced as CTA
    // cards. Catches "astersports.app", not just "https://…".
    const prose = [...POSITIONING, ...FAQ.flatMap((f) => [f.q, f.a])].join("\n");
    expect(prose).not.toMatch(URL_OR_BARE_DOMAIN);
  });

  it("exposes a URL-free model-facing projection (SCOUT_FACTS — condition C1)", () => {
    // The agent prompt is built from SCOUT_FACTS, never KNOWLEDGE_PRODUCTS, so
    // the model has no href/URL to inline or parrot — enforced by construction.
    expect(SCOUT_FACTS.map((f) => f.id)).toEqual(KNOWLEDGE_PRODUCTS.map((k) => k.id));
    expect(JSON.stringify(SCOUT_FACTS)).not.toMatch(/href/);
    const factsCorpus = SCOUT_FACTS.flatMap((f) => [f.name, f.tagline, f.description]).join("\n");
    expect(factsCorpus).not.toMatch(URL_OR_BARE_DOMAIN);
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
