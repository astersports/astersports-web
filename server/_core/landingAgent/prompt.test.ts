import { describe, it, expect } from "vitest";
import { buildScoutSystemPrompt } from "@shared/landingAgentPrompt";
import { SCOUT_FACTS } from "@shared/landingKnowledge";

const URL_OR_BARE_DOMAIN = /(https?:\/\/)|(\b[a-z0-9-]+\.(app|io|co|com|net|org|ai|dev|xyz)\b)/i;

describe("buildScoutSystemPrompt", () => {
  const prompt = buildScoutSystemPrompt();

  it("is pure (same output each call)", () => {
    expect(buildScoutSystemPrompt()).toBe(prompt);
  });

  it("includes every product name + id so the model can route", () => {
    for (const f of SCOUT_FACTS) {
      expect(prompt).toContain(f.name);
      expect(prompt).toContain(`id "${f.id}"`);
    }
  });

  it("contains NO URL or bare domain (condition C1)", () => {
    expect(prompt).not.toMatch(URL_OR_BARE_DOMAIN);
  });

  it("contains NO raw price literal (condition C1)", () => {
    expect(prompt).not.toMatch(/\$\s?\d/);
  });

  it("carries the routing + lead + minor-framing guardrails", () => {
    expect(prompt).toMatch(/recommend_surface/);
    expect(prompt).toMatch(/capture_lead/);
    expect(prompt).toMatch(/never (state|write) a|NEVER state a price/i);
    expect(prompt.toLowerCase()).toContain("minor");
    expect(prompt.toLowerCase()).toContain("contact form");
  });
});
