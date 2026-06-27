import { describe, it, expect } from "vitest";
import { fmtRange, tournamentTimeState } from "./dates";

describe("fmtRange", () => {
  it("single day", () => expect(fmtRange("2026-06-14", "2026-06-14")).toBe("Jun 14"));
  it("same-month range", () => expect(fmtRange("2026-06-14", "2026-06-15")).toBe("Jun 14–15"));
  it("cross-month range", () => expect(fmtRange("2026-05-31", "2026-06-01")).toBe("May 31 – Jun 1"));
});

describe("tournamentTimeState", () => {
  const today = "2026-06-27";
  it("ended before today → past", () => expect(tournamentTimeState("2026-06-13", "2026-06-14", today)).toBe("past"));
  it("starts after today → upcoming", () => expect(tournamentTimeState("2026-06-28", "2026-06-29", today)).toBe("upcoming"));
  it("spans today → live", () => expect(tournamentTimeState("2026-06-27", "2026-06-28", today)).toBe("live"));
  it("single-day == today → live", () => expect(tournamentTimeState("2026-06-27", "2026-06-27", today)).toBe("live"));
  it("ends exactly today → live (inclusive)", () => expect(tournamentTimeState("2026-06-26", "2026-06-27", today)).toBe("live"));
  it("starts exactly today → live (inclusive)", () => expect(tournamentTimeState("2026-06-27", "2026-06-30", today)).toBe("live"));
});
