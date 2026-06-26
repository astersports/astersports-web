// AAU hub navigation (C4 · build-bible §4.1). Given a venue, returns driving-route
// deep links for Apple Maps, Google Maps, and Waze — or null when the venue has no
// resolvable location (caller renders "Venue TBD", no directions control).
//
// lat/lng is preferred (a precise pin — scraped TM site names are ambiguous); a
// name/address string is the fallback so a pending/failed geocode still routes, and so
// the links keep working offline at the gym (the native map app carries its own offline
// maps — S1). These are universal links: they open the native app if installed, else the
// web map. Pure — no network, no DOM — so it unit-tests in isolation and runs anywhere.

export interface Venue {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export interface DirectionUrls {
  apple: string;
  google: string;
  waze: string;
  label: string;
}

export function buildDirections(venue: Venue | null | undefined): DirectionUrls | null {
  if (!venue) return null;

  const hasLatLng = Number.isFinite(venue.lat) && Number.isFinite(venue.lng);
  const addr = [
    venue.name,
    venue.address,
    [venue.city, venue.state].filter(Boolean).join(", "),
    venue.zip,
  ]
    .filter(Boolean)
    .join(", ");
  const label = venue.name || venue.address || "Venue";

  if (hasLatLng) {
    const ll = `${venue.lat},${venue.lng}`;
    return {
      apple: `https://maps.apple.com/?daddr=${ll}&dirflg=d`,
      google: `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`,
      waze: `https://waze.com/ul?ll=${ll}&navigate=yes`,
      label,
    };
  }

  if (addr) {
    const enc = encodeURIComponent(addr);
    return {
      apple: `https://maps.apple.com/?daddr=${enc}`,
      google: `https://www.google.com/maps/dir/?api=1&destination=${enc}&travelmode=driving`,
      waze: `https://waze.com/ul?q=${enc}&navigate=yes`,
      label,
    };
  }

  return null; // venue TBD — no resolvable destination
}
