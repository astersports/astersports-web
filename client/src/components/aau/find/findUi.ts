// Shared palette + small style helpers for the Find/Discovery redesign (render contract:
// aau-discovery-redesign-render.html). Centralizes the dark-palette hex tokens the render
// uses so the subcomponents read one source instead of re-typing literals. These mirror the
// render's :root and the existing FindDiscovery inline tokens — not platform --as-* tokens
// (the AAU hub wears its own dark palette).

// LIGHT MODE (operator-directed 2026-06-27, one-way) — aligned to the Aster Sports light brand:
// cool-gray/white surfaces, dark text ranks, gold + cobalt accents, semantic status colors. Keys
// are unchanged so every consumer flips automatically; values map each token to its light role.
export const C = {
  bg: "#F7F8FA",                 // page surface
  s1: "#FFFFFF",                 // card
  s2: "#FFFFFF",                 // raised card
  s3: "#F1F3F5",                 // secondary surface
  ink: "#1A1D23",                // primary text
  dim: "#374151",                // secondary text
  mut: "#4B5563",                // muted text (AA on white)
  faint: "#9CA3AF",              // faint text / icons / dividers
  line: "#E2E8F0",               // border
  hair: "rgba(0,0,0,0.06)",      // hairline
  hair2: "rgba(0,0,0,0.10)",     // hairline (stronger)
  g2: "#C9952E",                 // gold accent (fills / borders)
  g3: "#8F6708",                 // gold TEXT (AA on white) — was bright #F6CC55 on dark
  live: "#16A34A",               // live / success (reads on white)
  pos: "#16A34A",                // positive
  cobalt: "#2563eb",             // info / cobalt (AA)
  grad: "linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)", // gold gradient (dark text on it)
} as const;

/** First 1–2 initials for a row avatar/badge (program/tournament/division glyph). */
export function initials(label: string | null | undefined): string {
  const s = (label ?? "").trim();
  if (!s) return "··";
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Year label from an ISO start date — the only grouping a date reliably gives us. We do NOT
 *  derive a calendar SEASON (Spring/Summer/…): AAU "season" is a circuit concept that does not
 *  map to calendar months (June events belong to the spring circuit), so a month→season guess
 *  mislabels them. Until a real season field exists on the backbone, group/label by year only
 *  (no-fabrication, spec §7). Kept named seasonOf so the Browse grouping reads unchanged. */
export function seasonOf(iso: string | null | undefined): string {
  if (!iso) return "Undated";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "Undated";
  return String(d.getFullYear());
}
