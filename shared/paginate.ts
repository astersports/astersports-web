/**
 * Tiny client-side pagination helper. Bounds how many rows/cards render at once so
 * admin lists stay short regardless of how many orgs/accounts exist. (Server-side
 * paging is the next step once datasets get large — see docs/ADMIN_MULTI_ORG_SPEC.md.)
 */
export interface Page<T> {
  rows: T[];
  total: number;
  pageCount: number;
  page: number; // 1-based, clamped to [1, pageCount]
  start: number; // 0-based index of the first row on this page
}

export function paginate<T>(items: T[], page: number, pageSize: number): Page<T> {
  const total = items.length;
  const size = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(total / size));
  const clamped = Math.min(Math.max(1, page), pageCount);
  const start = (clamped - 1) * size;
  return { rows: items.slice(start, start + size), total, pageCount, page: clamped, start };
}
