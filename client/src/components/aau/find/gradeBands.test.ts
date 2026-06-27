import { describe, it, expect } from "vitest";
import { bandOf, gradeOrder, GRADE_BANDS } from "./gradeBands";

// The grade band is a declared map over the REAL grade_label column values (no name-parsing).
// These lock the bucketing for the 18 values grounded in the directory 2026-06-27, the
// younger-grade rule for split grades, and the honest "other" fallback for new values.

describe("bandOf", () => {
  it("buckets lower grades (2nd–4th, incl. 4th/5th by younger grade)", () => {
    for (const g of ["2nd", "2nd/3rd", "3rd", "3rd/4th", "4th", "4th/5th"]) {
      expect(bandOf(g)).toBe("lower");
    }
  });

  it("buckets middle grades (5th–8th, incl. 8th/9th by younger grade)", () => {
    for (const g of ["5th", "5th/6th", "6th", "6th/7th", "7th", "8th", "8th/9th"]) {
      expect(bandOf(g)).toBe("middle");
    }
  });

  it("buckets high-school grades (9th+, incl. 9th/10th, Varsity)", () => {
    for (const g of ["9th", "9th/10th", "10th", "High School", "Varsity"]) {
      expect(bandOf(g)).toBe("hs");
    }
  });

  it("falls back to 'other' for unknown/new values and null — honest, never fabricated", () => {
    expect(bandOf("11th")).toBe("other");
    expect(bandOf("College")).toBe("other");
    expect(bandOf(null)).toBe("other");
    expect(bandOf(undefined)).toBe("other");
    expect(bandOf("")).toBe("other");
  });

  it("covers every grounded grade_label (no value silently uncatalogued in known bands)", () => {
    const grounded = [
      "2nd", "2nd/3rd", "3rd", "3rd/4th", "4th", "4th/5th",
      "5th", "5th/6th", "6th", "6th/7th", "7th", "8th", "8th/9th",
      "9th", "9th/10th", "10th", "High School", "Varsity",
    ];
    for (const g of grounded) {
      expect(bandOf(g)).not.toBe("other");
    }
  });
});

describe("gradeOrder", () => {
  it("orders younger → older and is monotonic across known grades", () => {
    expect(gradeOrder("2nd")).toBeLessThan(gradeOrder("5th"));
    expect(gradeOrder("5th")).toBeLessThan(gradeOrder("High School"));
  });

  it("sorts unknown grades after all known grades", () => {
    const known = GRADE_BANDS.flatMap((b) => b.grades).length;
    expect(gradeOrder("11th")).toBe(known);
  });
});
