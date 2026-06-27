// Tournament date formatting + status, so the directory shows WHEN a tournament played
// or is coming up. Pure; status is date-window based (the scrape gives us start/end dates,
// not per-game live state — true live-game status is a Phase B add).

export type TStatus = "live" | "upcoming" | "past";

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

/** "Jun 14" · "Jun 14–15" · "May 31 – Jun 1". */
export function fmtRange(start: string, end: string): string {
  const s = d(start);
  const e = d(end);
  const mo = (x: Date) => x.toLocaleDateString("en-US", { month: "short" });
  if (start === end) return `${mo(s)} ${s.getDate()}`;
  if (s.getMonth() === e.getMonth()) return `${mo(s)} ${s.getDate()}–${e.getDate()}`;
  return `${mo(s)} ${s.getDate()} – ${mo(e)} ${e.getDate()}`;
}

/** upcoming (future) · live (date window includes today) · past (ended). */
export function tournamentStatus(start: string, end: string): TStatus {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today < d(start)) return "upcoming";
  if (today > d(end)) return "past";
  return "live";
}
