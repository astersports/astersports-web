/**
 * Vitest tests for Print Studio shared logic:
 * - buildInstruction (instruction builder)
 * - computeCredits (credit cost calculator)
 * - emailAllowedForDomain (domain gating)
 */
import { describe, it, expect } from "vitest";
import {
  buildInstruction,
  computeCredits,
  deriveEditType,
  defaultControls,
  describeExpectedChange,
  resolveTargetColorHex,
  RECOLOR_PRESET_HEX,
  RECOLOR_PRESETS,
  type ControlSettings,
} from "../shared/controls";
import { hexToLab } from "./_core/studio/ops/color";
import { CREDIT_COST, PLANS, TOPUP_PACKS } from "../shared/billing";
import { emailAllowedForDomain } from "../shared/domain";
import { toJobsBooleanQuery } from "./studioDb";

describe("buildInstruction", () => {
  it("returns unchanged instruction when no controls enabled", () => {
    const controls = defaultControls();
    const result = buildInstruction(controls);
    expect(result).toBe("Return the image unchanged.");
  });

  it("builds scale-up instruction", () => {
    const controls = defaultControls();
    controls.scale.enabled = true;
    controls.scale.percent = 30;
    const result = buildInstruction(controls);
    expect(result).toContain("ENLARGE THE MOTIF REPEAT");
    expect(result).toContain("LARGER repeat scale");
    expect(result).toContain("130%");
    expect(result).not.toContain("SHRINK");
  });

  it("builds scale-down instruction", () => {
    const controls = defaultControls();
    controls.scale.enabled = true;
    controls.scale.percent = -20;
    const result = buildInstruction(controls);
    expect(result).toContain("SHRINK THE MOTIF REPEAT");
    expect(result).toContain("SMALLER repeat scale");
    expect(result).toContain("80%");
  });

  it("builds density reduction instruction", () => {
    const controls = defaultControls();
    controls.density.enabled = true;
    controls.density.percent = 50;
    const result = buildInstruction(controls);
    expect(result).toContain("DENSITY REDUCTION");
    expect(result).toContain("50%");
    expect(result).toContain("base fabric background color");
  });

  it("builds remove element instruction", () => {
    const controls = defaultControls();
    controls.remove.enabled = true;
    controls.remove.element = "pink blossoms";
    controls.remove.percent = 70;
    const result = buildInstruction(controls);
    expect(result).toContain("pink blossoms");
    expect(result).toContain("70%");
  });

  it("builds recolor instruction with full coverage", () => {
    const controls = defaultControls();
    controls.recolor.enabled = true;
    controls.recolor.element = "dusty rose petals";
    controls.recolor.targetColor = "coral";
    controls.recolor.coverage = 100;
    const result = buildInstruction(controls);
    expect(result).toContain("COLORWAY SHIFT");
    expect(result).toContain("dusty rose petals");
    expect(result).toContain("coral");
    expect(result).toContain("all");
    expect(result).toContain("dye-lot change");
    expect(result).toContain("textile print designer");
    expect(result).toContain("OUTPUT REQUIREMENTS");
  });

  it("builds recolor instruction with partial coverage", () => {
    const controls = defaultControls();
    controls.recolor.enabled = true;
    controls.recolor.element = "blue forget-me-nots";
    controls.recolor.targetColor = "deep navy";
    controls.recolor.coverage = 60;
    const result = buildInstruction(controls);
    expect(result).toContain("COLORWAY SHIFT");
    expect(result).toContain("approximately 60%");
    expect(result).toContain("blue forget-me-nots");
    expect(result).toContain("deep navy");
  });

  it("ignores recolor when element is empty", () => {
    const controls = defaultControls();
    controls.recolor.enabled = true;
    controls.recolor.element = "";
    controls.recolor.targetColor = "coral";
    controls.recolor.coverage = 100;
    const result = buildInstruction(controls);
    expect(result).toBe("Return the image unchanged.");
  });

  it("ignores recolor when targetColor is empty", () => {
    const controls = defaultControls();
    controls.recolor.enabled = true;
    controls.recolor.element = "pink blossoms";
    controls.recolor.targetColor = "";
    controls.recolor.coverage = 100;
    const result = buildInstruction(controls);
    expect(result).toBe("Return the image unchanged.");
  });

  it("combines multiple controls into one instruction", () => {
    const controls: ControlSettings = {
      scale: { enabled: true, percent: 20 },
      density: { enabled: true, percent: 30 },
      remove: { enabled: true, element: "leaves", percent: 50 },
      recolor: { enabled: false, element: "", targetColor: "", coverage: 100 },
      variations: 2,
    };
    const result = buildInstruction(controls);
    expect(result).toContain("ENLARGE THE MOTIF REPEAT");
    expect(result).toContain("DENSITY REDUCTION");
    expect(result).toContain("leaves");
    expect(result).toContain("textile print designer");
    expect(result).toContain("OUTPUT REQUIREMENTS");
  });

  it("combines recolor with other controls", () => {
    const controls: ControlSettings = {
      scale: { enabled: false, percent: 0 },
      density: { enabled: true, percent: 40 },
      remove: { enabled: false, element: "", percent: 0 },
      recolor: { enabled: true, element: "pink blossoms", targetColor: "sage green", coverage: 100 },
      variations: 1,
    };
    const result = buildInstruction(controls);
    expect(result).toContain("DENSITY REDUCTION");
    expect(result).toContain("COLORWAY SHIFT");
    expect(result).toContain("sage green");
    expect(result).toContain("pink blossoms");
  });

  it("ignores enabled controls with zero percent", () => {
    const controls = defaultControls();
    controls.scale.enabled = true;
    controls.scale.percent = 0;
    const result = buildInstruction(controls);
    expect(result).toBe("Return the image unchanged.");
  });

  it("ignores remove control with empty element name", () => {
    const controls = defaultControls();
    controls.remove.enabled = true;
    controls.remove.element = "";
    controls.remove.percent = 50;
    const result = buildInstruction(controls);
    expect(result).toBe("Return the image unchanged.");
  });

  it("no longer instructs the model to return the image unchanged as a fallback", () => {
    const controls = defaultControls();
    controls.scale.enabled = true;
    controls.scale.percent = -50;
    const result = buildInstruction(controls);
    // The old escape hatch ("return the image unchanged rather than rotating it")
    // produced billable no-ops and must not be present in an active edit prompt.
    expect(result).not.toContain("unchanged rather than rotating");
    expect(result).toContain("MUST apply the requested change");
  });
});

describe("describeExpectedChange", () => {
  it("returns empty string when no controls are active", () => {
    expect(describeExpectedChange(defaultControls())).toBe("");
  });

  it("describes a scale-down as smaller motifs", () => {
    const controls = defaultControls();
    controls.scale.enabled = true;
    controls.scale.percent = -50;
    expect(describeExpectedChange(controls)).toContain("SMALLER");
  });

  it("describes a scale-up as larger motifs", () => {
    const controls = defaultControls();
    controls.scale.enabled = true;
    controls.scale.percent = 30;
    expect(describeExpectedChange(controls)).toContain("LARGER");
  });

  it("describes density, remove and recolor changes", () => {
    const controls: ControlSettings = {
      scale: { enabled: false, percent: 0 },
      density: { enabled: true, percent: 40 },
      remove: { enabled: true, element: "blue buds", percent: 50 },
      recolor: { enabled: true, element: "pink blossoms", targetColor: "coral", coverage: 100 },
      variations: 1,
    };
    const desc = describeExpectedChange(controls);
    expect(desc).toContain("FEWER");
    expect(desc).toContain("blue buds");
    expect(desc).toContain("pink blossoms");
    expect(desc).toContain("coral");
  });

  it("ignores controls with empty/zero values", () => {
    const controls = defaultControls();
    controls.density.enabled = true;
    controls.density.percent = 0;
    controls.remove.enabled = true;
    controls.remove.element = "";
    controls.remove.percent = 50;
    expect(describeExpectedChange(controls)).toBe("");
  });
});

describe("resolveTargetColorHex (A2)", () => {
  it("maps every preset to a pinned 6-digit hex", () => {
    for (const p of RECOLOR_PRESETS) {
      expect(resolveTargetColorHex(p.value)).toBe(RECOLOR_PRESET_HEX[p.value]);
      expect(resolveTargetColorHex(p.value)).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("passes hex and non-preset CSS names through unchanged", () => {
    expect(resolveTargetColorHex("#2A4B7C")).toBe("#2A4B7C");
    expect(resolveTargetColorHex("teal")).toBe("teal");
  });

  it("is case/whitespace insensitive for presets", () => {
    expect(resolveTargetColorHex("  Deep Navy ")).toBe("#14233A");
  });

  it("resolved presets/hex/CSS parse via hexToLab; garbage surfaces the throw", () => {
    expect(() => hexToLab(resolveTargetColorHex("deep navy"))).not.toThrow();
    expect(() => hexToLab(resolveTargetColorHex("#2A4B7C"))).not.toThrow();
    expect(() => hexToLab(resolveTargetColorHex("teal"))).not.toThrow();
    expect(() => hexToLab(resolveTargetColorHex("xyz-not-a-color"))).toThrow();
  });
});

describe("computeCredits", () => {
  it("returns 0 when no controls are enabled", () => {
    const controls = defaultControls();
    const cost = computeCredits(controls, CREDIT_COST);
    expect(cost).toBe(0);
  });

  it("charges standard generation for single control", () => {
    const controls = defaultControls();
    controls.scale.enabled = true;
    controls.scale.percent = 20;
    controls.variations = 1;
    const cost = computeCredits(controls, CREDIT_COST);
    expect(cost).toBe(CREDIT_COST.standardGeneration); // 10
  });

  it("charges standard generation for recolor alone", () => {
    const controls = defaultControls();
    controls.recolor.enabled = true;
    controls.recolor.element = "pink blossoms";
    controls.recolor.targetColor = "coral";
    controls.recolor.coverage = 100;
    controls.variations = 1;
    const cost = computeCredits(controls, CREDIT_COST);
    expect(cost).toBe(CREDIT_COST.standardGeneration); // 10
  });

  it("charges combined controls for multiple active controls", () => {
    const controls: ControlSettings = {
      scale: { enabled: true, percent: 20 },
      density: { enabled: true, percent: 30 },
      remove: { enabled: false, element: "", percent: 0 },
      recolor: { enabled: false, element: "", targetColor: "", coverage: 100 },
      variations: 1,
    };
    const cost = computeCredits(controls, CREDIT_COST);
    expect(cost).toBe(CREDIT_COST.combinedControls); // 15
  });

  it("charges combined when recolor is combined with another control", () => {
    const controls: ControlSettings = {
      scale: { enabled: false, percent: 0 },
      density: { enabled: true, percent: 30 },
      remove: { enabled: false, element: "", percent: 0 },
      recolor: { enabled: true, element: "blossoms", targetColor: "coral", coverage: 100 },
      variations: 1,
    };
    const cost = computeCredits(controls, CREDIT_COST);
    expect(cost).toBe(CREDIT_COST.combinedControls); // 15
  });

  it("adds extra variation costs", () => {
    const controls = defaultControls();
    controls.scale.enabled = true;
    controls.scale.percent = 20;
    controls.variations = 3;
    const cost = computeCredits(controls, CREDIT_COST);
    // base (10) + 2 extra variations * 10 = 30
    expect(cost).toBe(CREDIT_COST.standardGeneration + 2 * CREDIT_COST.extraVariation);
  });

  it("charges combined + extra for multiple controls with variations", () => {
    const controls: ControlSettings = {
      scale: { enabled: true, percent: 20 },
      density: { enabled: true, percent: 30 },
      remove: { enabled: true, element: "buds", percent: 40 },
      recolor: { enabled: false, element: "", targetColor: "", coverage: 100 },
      variations: 4,
    };
    const cost = computeCredits(controls, CREDIT_COST);
    // combined (15) + 3 extra * 10 = 45
    expect(cost).toBe(CREDIT_COST.combinedControls + 3 * CREDIT_COST.extraVariation);
  });

  it("charges combined + extra for all four controls with variations", () => {
    const controls: ControlSettings = {
      scale: { enabled: true, percent: 10 },
      density: { enabled: true, percent: 20 },
      remove: { enabled: true, element: "buds", percent: 30 },
      recolor: { enabled: true, element: "petals", targetColor: "coral", coverage: 100 },
      variations: 2,
    };
    const cost = computeCredits(controls, CREDIT_COST);
    // combined (15) + 1 extra * 10 = 25
    expect(cost).toBe(CREDIT_COST.combinedControls + 1 * CREDIT_COST.extraVariation);
  });
});

describe("deriveEditType", () => {
  it("returns 'none' when no control is enabled", () => {
    expect(deriveEditType(defaultControls())).toBe("none");
  });

  it("returns the single enabled control", () => {
    const c = defaultControls();
    c.recolor.enabled = true;
    expect(deriveEditType(c)).toBe("recolor");
  });

  it("returns 'mixed' when more than one control is enabled (one bucket, no double-count)", () => {
    const c: ControlSettings = {
      scale: { enabled: true, percent: 20 },
      density: { enabled: true, percent: 30 },
      remove: { enabled: false, element: "", percent: 0 },
      recolor: { enabled: false, element: "", targetColor: "", coverage: 100 },
      variations: 1,
    };
    expect(deriveEditType(c)).toBe("mixed");
  });
});

describe("toJobsBooleanQuery (M5d)", () => {
  it("requires each token as a prefix match", () => {
    expect(toJobsBooleanQuery("red shirt")).toBe("+red* +shirt*");
  });

  it("tokenizes on non-alphanumerics and is Unicode-aware", () => {
    expect(toJobsBooleanQuery("logo-front, café")).toBe("+logo* +front* +café*");
  });

  it("strips FULLTEXT boolean operators so input can't inject syntax", () => {
    // The +, -, (, ), <, >, ~, *, " operators are dropped by tokenization.
    expect(toJobsBooleanQuery('-red +(shirt) "logo*"')).toBe("+red* +shirt* +logo*");
  });

  it("returns null for empty / punctuation-only queries (caller uses LIKE)", () => {
    expect(toJobsBooleanQuery("")).toBeNull();
    expect(toJobsBooleanQuery("  -+() ")).toBeNull();
  });

  it("returns null when any token is shorter than the min indexed length", () => {
    // "of" (< 3 chars) isn't indexable; fall back to LIKE so it still matches.
    expect(toJobsBooleanQuery("of red")).toBeNull();
    expect(toJobsBooleanQuery("ab")).toBeNull();
  });
});

describe("emailAllowedForDomain", () => {
  it("allows matching domain", () => {
    expect(emailAllowedForDomain("user@jayallc.com", "jayallc.com")).toBe(true);
  });

  it("rejects non-matching domain", () => {
    expect(emailAllowedForDomain("user@gmail.com", "jayallc.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(emailAllowedForDomain("User@JayaLLC.COM", "jayallc.com")).toBe(true);
  });

  it("allows any email when domain is null", () => {
    expect(emailAllowedForDomain("anyone@anywhere.com", null)).toBe(true);
  });

  it("allows any email when domain is empty string", () => {
    expect(emailAllowedForDomain("anyone@anywhere.com", "")).toBe(true);
  });

  it("rejects invalid email format", () => {
    expect(emailAllowedForDomain("not-an-email", "jayallc.com")).toBe(false);
  });
});

describe("billing constants", () => {
  it("PLANS has starter, pro, and team", () => {
    expect(PLANS.starter).toBeDefined();
    expect(PLANS.pro).toBeDefined();
    expect(PLANS.team).toBeDefined();
  });

  it("starter plan has correct pricing", () => {
    expect(PLANS.starter.priceMonthly).toBe(39);
    expect(PLANS.starter.creditsPerCycle).toBe(3900);
    expect(PLANS.starter.perSeat).toBe(false);
  });

  it("pro plan has correct pricing", () => {
    expect(PLANS.pro.priceMonthly).toBe(199);
    expect(PLANS.pro.creditsPerCycle).toBe(19900);
    expect(PLANS.pro.perSeat).toBe(false);
  });

  it("team plan is per-seat", () => {
    expect(PLANS.team.priceMonthly).toBe(20);
    expect(PLANS.team.perSeat).toBe(true);
    expect(PLANS.team.creditsPerCycle).toBe(2000);
  });

  it("TOPUP_PACKS has 3 options", () => {
    expect(TOPUP_PACKS).toHaveLength(3);
    expect(TOPUP_PACKS[0].credits).toBe(1000);
    expect(TOPUP_PACKS[1].credits).toBe(5000);
    expect(TOPUP_PACKS[2].credits).toBe(20000);
  });
});
