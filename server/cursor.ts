/**
 * M5c: opaque keyset cursors for load-more pagination.
 *
 * The client treats a cursor as an opaque token — it receives `nextCursor` from
 * a page and passes it back as `cursor` for the following page; only the server
 * encodes/decodes. Keyset pagination (WHERE sortKey past the cursor) avoids the
 * scan-and-discard cost of deep OFFSET pages.
 *
 * Encoded as base64url of `[k, id]` where `k` is the row's sort-key value
 * (createdAt epoch ms / creditsUsed / title) and `id` is the PK tiebreaker that
 * makes the order total (and the cursor stable across equal sort keys).
 */
export type CursorKey = string | number;

export function encodeCursor(k: CursorKey, id: number): string {
  return Buffer.from(JSON.stringify([k, id])).toString("base64url");
}

/**
 * Max accepted cursor length. A valid cursor is base64url of `[k, id]` where the
 * largest `k` is a title (varchar 255) — JSON + base64url tops out around ~360
 * chars, so 512 is safe headroom while bounding allocations on tampered input.
 */
const MAX_CURSOR_LENGTH = 512;

export function decodeCursor(cursor: string): { k: CursorKey; id: number } | null {
  if (!cursor || cursor.length > MAX_CURSOR_LENGTH) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [k, id] = parsed;
    if (typeof id !== "number" || !Number.isFinite(id)) return null;
    if (typeof k !== "string" && typeof k !== "number") return null;
    return { k, id };
  } catch {
    return null;
  }
}
