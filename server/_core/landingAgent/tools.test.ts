import { describe, it, expect } from "vitest";
import {
  VALID_SURFACE_IDS,
  RECOMMEND_SURFACE_TOOL,
  validateRecommendSurface,
  validateCaptureLead,
  sanitizeLeadNeed,
  sanitizeLeadName,
  LEAD_NEED_MAX,
} from "@shared/landingAgentTools";
import { KNOWLEDGE_PRODUCTS } from "@shared/landingKnowledge";

describe("recommend_surface", () => {
  it("enumerates exactly the registry ids (registry-pinned)", () => {
    expect(VALID_SURFACE_IDS).toEqual(KNOWLEDGE_PRODUCTS.map((p) => p.id));
    expect(RECOMMEND_SURFACE_TOOL.input_schema.properties.serviceId.enum).toEqual(VALID_SURFACE_IDS);
  });

  it("accepts a known id", () => {
    expect(validateRecommendSurface({ serviceId: "studio" })).toEqual({ serviceId: "studio" });
  });

  it.each([{ serviceId: "nope" }, { serviceId: "" }, {}, null, { serviceId: 123 }])(
    "rejects an unknown/malformed id (%o)",
    (bad) => {
      expect(() => validateRecommendSurface(bad)).toThrow();
    },
  );
});

describe("sanitizeLeadNeed (condition C2b)", () => {
  it("strips HTML tags to inert plaintext", () => {
    const out = sanitizeLeadNeed("Hi <script>alert(1)</script> <b>team</b>");
    expect(out).not.toMatch(/[<>]/);
    expect(out.toLowerCase()).not.toContain("script");
    expect(out).toContain("team");
  });

  it("neutralizes HTML entities so they can't re-form a tag", () => {
    const out = sanitizeLeadNeed("&lt;img src=x onerror=alert(1)&gt;");
    expect(out).not.toMatch(/[<>]/);
    expect(out).not.toMatch(/&lt;|&gt;/);
  });

  it("removes control characters", () => {
    // inject real C0 control chars (bell, null) without literal bytes in source
    const raw = `line1${String.fromCharCode(7)}line2${String.fromCharCode(0)}end`;
    expect(sanitizeLeadNeed(raw)).toBe("line1 line2 end");
  });

  it("caps length", () => {
    const out = sanitizeLeadNeed("x".repeat(LEAD_NEED_MAX + 500));
    expect(out.length).toBeLessThanOrEqual(LEAD_NEED_MAX);
  });

  it("returns empty for non-strings", () => {
    expect(sanitizeLeadNeed(null)).toBe("");
    expect(sanitizeLeadNeed(42 as unknown)).toBe("");
  });
});

describe("validateCaptureLead", () => {
  it("accepts a valid lead and sanitizes the fields", () => {
    const lead = validateCaptureLead({
      name: "  Jaya <b>B</b> ",
      email: "jaya@example.com",
      need: "Interested in <i>print</i> design",
    });
    expect(lead.email).toBe("jaya@example.com");
    expect(lead.name).not.toMatch(/[<>]/);
    expect(lead.need).not.toMatch(/[<>]/);
    expect(lead.name).toContain("Jaya");
  });

  it.each(["not-an-email", "", "a@b", "x@y.", "@no.com", "spaces in@email.com"])(
    "rejects a bad email (%s)",
    (email) => {
      expect(() => validateCaptureLead({ name: "A", email, need: "" })).toThrow();
    },
  );

  it("rejects an empty/HTML-only name", () => {
    expect(() => validateCaptureLead({ name: "<b></b>", email: "a@b.com", need: "" })).toThrow();
  });

  it("allows an empty need (optional field)", () => {
    const lead = validateCaptureLead({ name: "A", email: "a@b.com" });
    expect(lead.need).toBe("");
  });
});

describe("sanitizeLeadName", () => {
  it("strips tags and caps length", () => {
    expect(sanitizeLeadName("<script>x</script>Coach Kenny")).not.toMatch(/[<>]/);
    expect(sanitizeLeadName("n".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});
