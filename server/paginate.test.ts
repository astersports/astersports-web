import { describe, it, expect } from "vitest";
import { paginate } from "../shared/paginate";

const items = Array.from({ length: 25 }, (_, i) => i + 1);

describe("paginate", () => {
  it("slices the requested page", () => {
    const p = paginate(items, 2, 10);
    expect(p.rows).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(p).toMatchObject({ total: 25, pageCount: 3, page: 2, start: 10 });
  });

  it("clamps an out-of-range page to the last page", () => {
    const p = paginate(items, 99, 10);
    expect(p.page).toBe(3);
    expect(p.rows).toEqual([21, 22, 23, 24, 25]);
  });

  it("clamps page below 1 to the first page", () => {
    expect(paginate(items, 0, 10).page).toBe(1);
    expect(paginate(items, -5, 10).page).toBe(1);
  });

  it("handles an empty list (pageCount stays 1)", () => {
    const p = paginate<number>([], 1, 10);
    expect(p).toMatchObject({ rows: [], total: 0, pageCount: 1, page: 1 });
  });

  it("guards a zero/negative page size", () => {
    const p = paginate(items, 1, 0);
    expect(p.rows).toEqual([1]);
    expect(p.pageCount).toBe(25);
  });
});
