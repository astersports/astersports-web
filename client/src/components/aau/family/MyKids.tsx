import { useState } from "react";
import { Trophy, Film, Clock, ChevronRight, Play } from "lucide-react";
import SectionHeading from "../SectionHeading";
import { PILOT_KIDS, type PilotKid, type KidReel } from "@/lib/aau/pilotKids";

/**
 * My Kids — the AAU family hub's kid view (pilot, operator-directed 2026-06-26).
 * One parent, every kid, across programs: Charlie (Legacy Hoopers) + Rowan
 * (Chris Ward) on one surface, each with their tournament result and their own
 * film. Film is filtered to the kid's jersey only — a parent sees their child,
 * never another family's. Pilot data lives in lib/aau/pilotKids.ts; it swaps to
 * the public RPCs once those tournaments are ingested.
 */
const TYPE_LABEL: Record<string, string> = {
  score: "PTS", rebound: "REB", assist: "AST", steal: "STL", "free-throw": "FT",
};

export default function MyKids() {
  const [activeId, setActiveId] = useState<string>(PILOT_KIDS[0].id);
  const kid = PILOT_KIDS.find((k) => k.id === activeId) ?? PILOT_KIDS[0];

  return (
    <div className="as-fade-in">
      <SectionHeading eyebrow="Family" title="My Kids" ghostText="FAMILY" />

      {/* Kid switcher — one card per child (cross-program) */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {PILOT_KIDS.map((k) => (
          <KidChip key={k.id} kid={k} active={k.id === activeId} onClick={() => setActiveId(k.id)} />
        ))}
      </div>

      {/* Selected kid */}
      <KidHeader kid={kid} />
      <TournamentCard kid={kid} />
      <FilmStrip kid={kid} />
    </div>
  );
}

function KidChip({ kid, active, onClick }: { kid: PilotKid; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="as-press"
      style={{
        display: "flex", alignItems: "center", gap: 10, cursor: "pointer",
        padding: "10px 14px", borderRadius: 12, fontFamily: "inherit", textAlign: "left",
        backgroundColor: active ? "var(--as-bg-card)" : "var(--as-bg-tertiary)",
        border: `1.5px solid ${active ? kid.accent : "var(--as-border-default)"}`,
        minHeight: 44,
      }}
    >
      <span style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: `color-mix(in srgb, ${kid.accent} 15%, transparent)`,
        border: `1.5px solid ${kid.accent}`,
        fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 13, color: kid.accent,
      }}>
        {kid.jersey.replace("#", "")}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--as-text-primary)" }}>{kid.name}</span>
        <span style={{ display: "block", fontSize: 10, color: "var(--as-text-tertiary)" }}>{kid.program} · {kid.team}</span>
      </span>
    </button>
  );
}

function KidHeader({ kid }: { kid: PilotKid }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <span style={{
        width: 48, height: 48, borderRadius: 12, flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        backgroundColor: `color-mix(in srgb, ${kid.accent} 15%, transparent)`,
        border: `2px solid ${kid.accent}`,
        fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, color: kid.accent,
      }}>
        {kid.jersey.replace("#", "")}
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="font-display" style={{ fontSize: 22, fontWeight: 800, color: "var(--as-text-primary)", lineHeight: 1.1 }}>
          {kid.name} <span style={{ color: kid.accent }}>{kid.jersey}</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--as-text-secondary)", marginTop: 2 }}>
          {kid.program} {kid.team} · {kid.gradeNow} → {kid.gradeNext}
        </div>
      </div>
    </div>
  );
}

function TournamentCard({ kid }: { kid: PilotKid }) {
  const t = kid.tournament;
  return (
    <div style={{
      marginBottom: 24, padding: "14px 16px", borderRadius: 12,
      backgroundColor: "var(--as-bg-card)",
      border: `1px solid ${t.champion ? "var(--as-gold-soft)" : "var(--as-border-default)"}`,
      boxShadow: t.champion ? "0 0 0 1px var(--as-gold-soft) inset" : undefined,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--as-text-primary)" }}>{t.name}</div>
          <div style={{ fontSize: 11, color: "var(--as-text-tertiary)" }}>{t.dates}</div>
        </div>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: 5,
          fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 999,
          backgroundColor: t.champion ? "var(--as-gold-soft)" : "var(--as-bg-tertiary)",
          color: t.champion ? "#FFD700" : "var(--as-text-secondary)",
        }}>
          {t.champion && <Trophy size={12} />}
          {t.result}
        </span>
      </div>
      <p style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--as-text-secondary)", margin: 0 }}>{t.blurb}</p>
    </div>
  );
}

function FilmStrip({ kid }: { kid: PilotKid }) {
  return (
    <div>
      <h3 className="font-display" style={{ fontSize: 14, color: "var(--as-text-secondary)", margin: "0 0 12px 2px", display: "flex", alignItems: "center", gap: 6 }}>
        <Film size={14} style={{ color: kid.accent }} /> {kid.name.toUpperCase()}'S FILM
      </h3>
      {kid.reels.length === 0 ? (
        <div style={{
          padding: "20px 16px", borderRadius: 12, textAlign: "center",
          backgroundColor: "var(--as-bg-card)", border: "1px solid var(--as-border-default)",
        }}>
          <Clock size={18} style={{ color: "var(--as-text-tertiary)", marginBottom: 6 }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--as-text-primary)" }}>Film coming soon</div>
          <div style={{ fontSize: 11, color: "var(--as-text-tertiary)", marginTop: 2 }}>
            {kid.name}'s clips are auto-clipped to {kid.jersey} as they're uploaded.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {kid.reels.map((reel) => <ReelCard key={reel.id} reel={reel} accent={kid.accent} jersey={kid.jersey} />)}
        </div>
      )}
    </div>
  );
}

function ReelCard({ reel, accent, jersey }: { reel: KidReel; accent: string; jersey: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderRadius: 12, overflow: "hidden", backgroundColor: "var(--as-bg-card)", border: "1px solid var(--as-border-default)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="as-press"
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
          padding: "12px 14px", border: "none", background: "none", fontFamily: "inherit", textAlign: "left",
        }}
      >
        <span style={{
          width: 36, height: 36, borderRadius: 9, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          backgroundColor: `color-mix(in srgb, ${accent} 15%, transparent)`, border: `1.5px solid ${accent}`,
        }}>
          <Play size={15} style={{ color: accent, marginLeft: 2 }} fill={accent} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: "var(--as-text-primary)" }}>
            {jersey} — {reel.title}
          </span>
          <span style={{ display: "block", fontSize: 11, color: "var(--as-text-tertiary)" }}>
            {reel.opponent} · {reel.duration} · {reel.statLine}
          </span>
        </span>
        <ChevronRight size={16} style={{ color: "var(--as-text-tertiary)", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
      </button>

      {open && (
        <div style={{ borderTop: "1px solid var(--as-border-subtle)", padding: "12px 14px" }}>
          <p style={{ fontSize: 12, lineHeight: 1.5, color: "var(--as-text-secondary)", margin: "0 0 12px" }}>{reel.aiSummary}</p>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: "var(--as-text-tertiary)", marginBottom: 8 }}>
            AI PLAY-BY-PLAY · {reel.plays.length} PLAYS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {reel.plays.map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 10.5, color: accent, flexShrink: 0,
                  backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`, padding: "1px 5px", borderRadius: 4, marginTop: 1,
                }}>
                  {p.time}
                </span>
                <span style={{ flex: 1, fontSize: 12, lineHeight: 1.45, color: "var(--as-text-secondary)" }}>{p.description}</span>
                <span style={{
                  fontSize: 8.5, fontWeight: 800, letterSpacing: "0.04em", flexShrink: 0, marginTop: 2,
                  padding: "1px 5px", borderRadius: 4, border: "1px solid var(--as-border-default)", color: "var(--as-text-tertiary)",
                }}>
                  {TYPE_LABEL[p.type] ?? p.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
