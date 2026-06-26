import { MapPin, Clock } from "lucide-react";
import DirectionsControl from "./DirectionsControl";

interface Location {
  name: string;
  address: string;
  day: string;
  time: string;
  note?: string;
  color: string;
}

const LOCATIONS: Location[] = [
  {
    name: "St. Patrick's",
    address: '29 Cox Ave, Armonk, NY',
    day: 'Mondays',
    time: '7:35 – 8:35 PM',
    note: 'Skills Lab',
    color: 'var(--as-team-primary)',
  },
  {
    name: 'Rippowam Cisqua',
    address: '439 Cantitoe St, Bedford, NY',
    day: 'Tuesdays',
    time: '5:30 – 8:30 PM',
    color: 'var(--as-accent)',
  },
  {
    name: 'Westchester CC (PEB)',
    address: '75 Grasslands Rd, Valhalla, NY',
    day: 'Wednesdays',
    time: '5:00 – 8:00 PM',
    color: 'var(--as-success)',
  },
];

export default function Locations() {
  return (
    <div className="as-fade-in">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, padding: '0 4px' }}>
        <h2 className="font-display" style={{ fontSize: 20, color: 'var(--as-text-primary)', margin: 0 }}>
          PRACTICE LOCATIONS
        </h2>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--as-text-tertiary)' }}>
          3 gyms · Weekly
        </span>
      </div>

      {/* Location cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {LOCATIONS.map((location, idx) => (
          <div
            key={location.name}
            className={`as-fade-in as-stagger-${idx + 1}`}
            style={{
              borderRadius: 12, overflow: 'hidden',
              backgroundColor: 'var(--as-bg-card)',
              border: '1px solid var(--as-border-default)',
              borderLeft: `4px solid ${location.color}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
              {/* Icon column */}
              <div style={{
                flexShrink: 0, width: 56, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.1)',
              }}>
                <MapPin size={20} strokeWidth={2} style={{ color: location.color }} />
              </div>

              {/* Content */}
              <div style={{ flex: 1, padding: '14px 16px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--as-text-primary)' }}>
                    {location.name}
                  </span>
                  {location.note && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                      padding: '2px 7px', borderRadius: 999,
                      backgroundColor: `color-mix(in srgb, ${location.color} 15%, transparent)`,
                      color: location.color,
                    }}>
                      {location.note.toUpperCase()}
                    </span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: 'var(--as-text-secondary)', margin: '3px 0 0' }}>
                  {location.address}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                  <Clock size={12} strokeWidth={2} style={{ color: 'var(--as-text-tertiary)' }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--as-text-secondary)' }}>
                    {location.day} · {location.time}
                  </span>
                </div>
              </div>
            </div>

            {/* Directions — Apple / Google / Waze (C4 · §4.2) */}
            <div style={{ padding: '0 16px 14px' }}>
              <DirectionsControl venue={{ name: location.name, address: location.address }} />
            </div>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <p style={{ fontSize: 11, color: 'var(--as-text-tertiary)', marginTop: 16, padding: '0 4px' }}>
        Open directions in Apple Maps, Google Maps, or Waze. Schedules subject to change.
      </p>
    </div>
  );
}
