// Killer #2 — drive time + "leave by". Free routing via the public OSRM server
// (router.project-osrm.org): no API key, no cost, NO live traffic — so every label is an
// honest estimate ("~18 min drive"), never presented as traffic-aware. Origin is the
// user's geolocation, asked once per session and cached; a denied/unavailable location
// just hides the line (the directions buttons still carry a live ETA on tap). No
// fabrication: any failure returns null rather than a guessed number.

const OSRM = "https://router.project-osrm.org/route/v1/driving";

export interface DriveEstimate {
  minutes: number;
}

let originCache: { lat: number; lon: number } | null = null;
let originPromise: Promise<{ lat: number; lon: number } | null> | null = null;

/** The user's current location, requested once per session (cached). null if the browser
 *  has no geolocation, the user denies it, or it times out. */
export function getOrigin(): Promise<{ lat: number; lon: number } | null> {
  if (originCache) return Promise.resolve(originCache);
  if (originPromise) return originPromise;
  originPromise = new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        originCache = { lat: p.coords.latitude, lon: p.coords.longitude };
        resolve(originCache);
      },
      () => resolve(null),
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  });
  return originPromise;
}

/** Driving minutes origin→venue via OSRM (no traffic). null on any failure. */
export async function estimateDrive(
  venue: { lat: number; lon: number },
  origin: { lat: number; lon: number } | null,
): Promise<DriveEstimate | null> {
  if (!origin) return null;
  const url = `${OSRM}/${origin.lon},${origin.lat};${venue.lon},${venue.lat}?overview=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const sec = data?.routes?.[0]?.duration;
    if (!Number.isFinite(sec)) return null;
    return { minutes: Math.max(1, Math.round(sec / 60)) };
  } catch {
    return null;
  }
}

/** "leave by H:MM" clock = game start − drive − buffer (default 10 min), in local time. */
export function leaveByLabel(startMs: number, driveMinutes: number, bufferMin = 10): string {
  const leave = new Date(startMs - (driveMinutes + bufferMin) * 60000);
  return leave.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
