// Tournament date formatting, so Find shows WHEN a team's tournament played/plays.
// Pure; the scrape gives start/end dates (date-only ISO), not per-game live state.

/** "Jun 14" · "Jun 14–15" · "May 31 – Jun 1". */
export function fmtRange(start: string, end: string): string {
  const d = (iso: string) => new Date(`${iso}T00:00:00`);
  const s = d(start);
  const e = d(end);
  const mo = (x: Date) => x.toLocaleDateString("en-US", { month: "short" });
  if (start === end) return `${mo(s)} ${s.getDate()}`;
  if (s.getMonth() === e.getMonth()) return `${mo(s)} ${s.getDate()}–${e.getDate()}`;
  return `${mo(s)} ${s.getDate()} – ${mo(e)} ${e.getDate()}`;
}
