import { useState } from "react";
import { Navigation } from "lucide-react";
import { buildDirections, type Venue } from "@/lib/aau/buildDirections";

// Directions control (C4 · build-bible §4.2 · render 04). Renders Apple / Google / Waze
// as three universal-link buttons for a venue. Remembers the user's last-chosen provider
// (local pref) and marks it as the default; the other two stay one tap away. When the
// venue has no resolvable destination, renders a "Venue TBD" chip instead of a broken
// link (§4.4). Each link is aria-labelled for screen readers (S3 — a11y is table stakes).

const LS_KEY = "aau:dir-provider";

type ProviderKey = "apple" | "google" | "waze";

// Provider tints legible on the hub's light surface (render 04's intent: Apple neutral,
// Google blue, Waze cyan — adapted from the dark render to the live --as-* theme).
const PROVIDERS: { key: ProviderKey; label: string; color: string }[] = [
  { key: "apple", label: "Apple", color: "var(--as-text-secondary)" },
  { key: "google", label: "Google", color: "#1a73e8" },
  { key: "waze", label: "Waze", color: "#05a8d6" },
];

function readPref(): ProviderKey | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    return v === "apple" || v === "google" || v === "waze" ? v : null;
  } catch {
    return null;
  }
}

export default function DirectionsControl({ venue }: { venue: Venue }) {
  const dirs = buildDirections(venue);
  const [pref, setPref] = useState<ProviderKey | null>(readPref);

  if (!dirs) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--as-text-tertiary)",
          padding: "6px 10px",
          borderRadius: 8,
          backgroundColor: "var(--as-bg-tertiary)",
        }}
      >
        Venue TBD
      </span>
    );
  }

  const remember = (key: ProviderKey) => {
    try {
      localStorage.setItem(LS_KEY, key);
    } catch {
      /* private mode / disabled storage — non-fatal, just don't persist */
    }
    setPref(key);
  };

  return (
    <div
      role="group"
      aria-label={`Directions to ${dirs.label}`}
      style={{ display: "flex", gap: 8 }}
    >
      {PROVIDERS.map((p) => {
        const isDefault = pref === p.key;
        return (
          <a
            key={p.key}
            href={dirs[p.key]}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => remember(p.key)}
            aria-label={`Open ${p.label} directions to ${dirs.label}`}
            className="as-press"
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              minHeight: 40,
              padding: "8px 0",
              borderRadius: 9,
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
              color: p.color,
              backgroundColor: isDefault
                ? "color-mix(in srgb, var(--as-team-primary) 10%, transparent)"
                : "var(--as-bg-card)",
              border: `1px solid ${isDefault ? "var(--as-team-primary)" : "var(--as-border-default)"}`,
            }}
          >
            <Navigation size={14} strokeWidth={2} />
            {p.label}
          </a>
        );
      })}
    </div>
  );
}
