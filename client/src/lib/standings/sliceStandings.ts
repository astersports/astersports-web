import type { RankedRow } from "./computeStandings";

/**
 * Home renders a SLICE of the same standings Browse computes (§5.3 / §8 — one source, two
 * surfaces, no second computation). Given the full ranked rows from computeStandings, return only
 * the rows worth showing on Home: the focus team, its immediate neighbours, and the pair bracketing
 * the cut line — so a parent sees "where my team sits vs the cut" without the whole table.
 *
 * Pure. Matches the focus team by standings id first, then by normalized name (the tracked team's
 * key and the standings row id can live in different id spaces; the name is the reliable bridge
 * within a single division). Returns rows in rank order.
 */
const norm = (s: string) => s.trim().toLowerCase();

export function sliceStandings(
  rows: RankedRow[],
  focusId: string | null,
  advanceCount: number | null,
  focusName?: string | null,
): RankedRow[] {
  if (!rows.length) return [];
  const idx = rows.findIndex(
    (r) => (focusId != null && r.id === focusId) || (focusName != null && norm(r.name) === norm(focusName)),
  );
  const keep = new Set<number>();
  if (idx >= 0) {
    keep.add(idx);
    if (idx > 0) keep.add(idx - 1);
    if (idx < rows.length - 1) keep.add(idx + 1);
  }
  if (advanceCount != null) {
    const lastIn = advanceCount - 1; // 0-based index of the last advancing team
    const firstOut = advanceCount; // 0-based index of the first non-advancing team
    if (lastIn >= 0 && lastIn < rows.length) keep.add(lastIn);
    if (firstOut >= 0 && firstOut < rows.length) keep.add(firstOut);
  }
  if (keep.size === 0) {
    for (let i = 0; i < Math.min(3, rows.length); i++) keep.add(i); // no focus, no cut → top 3
  }
  return Array.from(keep)
    .sort((a, b) => a - b)
    .map((i) => rows[i]);
}
