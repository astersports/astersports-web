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

/** ET "today" as a YYYY-MM-DD key, for date-only (string) comparison against tournament windows. */
export function etTodayISO(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * Classify a date-only tournament window (YYYY-MM-DD start/end) against a YYYY-MM-DD "today".
 * Date strings compare lexically, so no Date parsing/timezone drift. live = in progress today.
 */
export function tournamentTimeState(start: string, end: string, todayISO: string): "live" | "upcoming" | "past" {
  if (end < todayISO) return "past";
  if (start > todayISO) return "upcoming";
  return "live"; // start <= today <= end
}
