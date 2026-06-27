// "Remind me to leave" → a real calendar event, no push backend required. Builds an .ics
// VEVENT spanning leave-by → tip with an at-time alarm and triggers a download; the native
// calendar app fires the reminder. Pure string-build + one DOM download so it works on iOS
// Safari + Android today (push is gated behind the PWA-install work, TECH-1, and isn't here
// yet). No fabrication — callers pass it only real, resolved times/venues.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC timestamp in iCalendar basic format (YYYYMMDDTHHMMSSZ). */
function icsStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Escape per RFC 5545 text rules (backslash, semicolon, comma, newline). */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export interface LeaveReminder {
  title: string; // e.g. "Leave for Legacy 11U vs CT Hoops"
  leaveAtMs: number; // when to leave (event start)
  gameStartMs: number; // tip-off (event end)
  location?: string | null; // venue + court
  url?: string | null; // a directions deep link, attached to the event
}

/** Build the .ics and trigger a download/open of the native "add event" sheet. Returns
 *  false when there's no DOM (SSR) so callers can no-op safely. */
export function addLeaveReminder(r: LeaveReminder): boolean {
  if (typeof document === "undefined") return false;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Aster Sports//AAU Hub//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:aau-leave-${r.leaveAtMs}@astersports.io`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(new Date(r.leaveAtMs))}`,
    `DTEND:${icsStamp(new Date(r.gameStartMs))}`,
    `SUMMARY:${escapeText(r.title)}`,
    r.location ? `LOCATION:${escapeText(r.location)}` : "",
    r.url ? `URL:${escapeText(r.url)}` : "",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Time to leave",
    "TRIGGER:PT0M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = "leave-reminder.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return true;
}
