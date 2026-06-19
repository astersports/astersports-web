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
  defaultControls,
  type ControlSettings,
} from "../shared/controls";
import { CREDIT_COST, PLANS, TOPUP_PACKS } from "../shared/billing";
import { emailAllowedForDomain } from "../shared/domain";

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
    expect(result).toContain("SCALE UP");
    expect(result).toContain("enlarge every motif");
    expect(result).toContain("30%");
    expect(result).not.toContain("SCALE DOWN");
  });

  it("builds scale-down instruction", () => {
    const controls = defaultControls();
    controls.scale.enabled = true;
    controls.scale.percent = -20;
    const result = buildInstruction(controls);
    expect(result).toContain("SCALE DOWN");
    expect(result).toContain("Uniformly reduce every motif");
    expect(result).toContain("20%");
  });

  it("builds density reduction instruction", () => {
    const controls = defaultControls();
    controls.density.enabled = true;
    controls.density.percent = 50;
    const result = buildInstruction(controls);
    expect(result).toContain("DENSITY REDUCTION");
    expect(result).toContain("50%");
    expect(result).toContain("base cloth ground color");
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
    expect(result).toContain("SCALE UP");
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
