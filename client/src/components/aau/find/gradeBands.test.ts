import { describe, it, expect } from "vitest";
import { bandOf, gradeOrder, expandGrade, GRADE_BANDS } from "./gradeBands";

// The grade band is a declared map over the REAL grade_label column values (no name-parsing).
// Split grades expand to individual grades (operator-directed 2026-06-27): "5th/6th" → [5th,6th],
// each bucketed independently, so a combined division filters under either component.

describe("expandGrade", () => {
  it("splits a combined grade into its individual grades", () => {
    expect(expandGrade("5th/6th")).toEqual(["5th", "6th"]);
    expect(expandGrade("2nd/3rd")).toEqual(["2nd", "3rd"]);
    expect(expandGrade("8th/9th")).toEqual(["8th", "9th"]);
    expect(expandGrade("9th/10th")).toEqual(["9th", "10th"]);
  });

  it("returns a singleton for a non-split grade", () => {
    expect(expandGrade("8th")).toEqual(["8th"]);
    expect(expandGrade("High School")).toEqual(["High School"]);
    expect(expandGrade("Varsity")).toEqual(["Varsity"]);
  });

  it("returns [] for empty/null", () => {
    expect(expandGrade(null)).toEqual([]);
    expect(expandGrade(undefined)).toEqual([]);
    expect(expandGrade("")).toEqual([]);
  });
});

describe("bandOf (individual grades)", () => {
  it("buckets lower grades (2nd–4th)", () => {
    for (const g of ["2nd", "3rd", "4th"]) expect(bandOf(g)).toBe("lower");
  });

  it("buckets middle grades (5th–8th)", () => {
    for (const g of ["5th", "6th", "7th", "8th"]) expect(bandOf(g)).toBe("middle");
  });

  it("buckets high-school grades (9th, 10th, High School, Varsity)", () => {
    for (const g of ["9th", "10th", "High School", "Varsity"]) expect(bandOf(g)).toBe("hs");
  });

  it("a combined grade's components straddle bands (8th=middle, 9th=hs)", () => {
    const [a, b] = expandGrade("8th/9th");
    expect(bandOf(a)).toBe("middle");
    expect(bandOf(b)).toBe("hs");
  });

  it("falls back to 'other' for unknown values and null — honest, never fabricated", () => {
    expect(bandOf("11th")).toBe("other");
    expect(bandOf("College")).toBe("other");
    expect(bandOf(null)).toBe("other");
    expect(bandOf("")).toBe("other");
    // a combined chip is never a known individual grade — picker shows components, not the combo
    expect(bandOf("5th/6th")).toBe("other");
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
