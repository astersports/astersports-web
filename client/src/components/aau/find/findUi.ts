// Shared palette + small style helpers for the Find/Discovery redesign (render contract:
// aau-discovery-redesign-render.html). Centralizes the dark-palette hex tokens the render
// uses so the subcomponents read one source instead of re-typing literals. These mirror the
// render's :root and the existing FindDiscovery inline tokens — not platform --as-* tokens
// (the AAU hub wears its own dark palette).

export const C = {
  bg: "#070a11",
  s1: "#10141f",
  s2: "#151b29",
  s3: "#1b2233",
  ink: "#f0f3fa",
  dim: "#9aa4ba",
  mut: "#5f6981",
  faint: "#454e63",
  line: "#212939",
  hair: "rgba(255,255,255,0.055)",
  hair2: "rgba(255,255,255,0.09)",
  g2: "#E8902A",
  g3: "#F6CC55",
  live: "#34e0a4",
  pos: "#5ecb8f",
  cobalt: "#5fa0e6",
  grad: "linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)",
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
