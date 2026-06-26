import { useState } from "react";
import { ArrowLeft, Search, Users, BarChart3, Film, Check } from "lucide-react";
import FindDiscovery from "../components/aau/FindDiscovery";
import TrackTeams from "../components/aau/TrackTeams";
import MyTeams from "../components/aau/MyTeams";
import StandingsHub from "../components/aau/standings/StandingsHub";
import FilmHighlights from "../components/aau/FilmHighlights";
import type { DirTournament } from "@/lib/aster";

// AAU hub shell — render set v2. Four parent jobs: Find (discovery) / My Teams
// (the kid/team view) / Standings (+ predictor) / Film. No marketing pills, no global
// hero — each screen carries its own header, exactly like the renderings.
const NAV = [
  { id: "find", label: "Find", Icon: Search },
  { id: "myteams", label: "My Teams", Icon: Users },
  { id: "standings", label: "Standings", Icon: BarChart3 },
  { id: "film", label: "Film", Icon: Film },
] as const;

type SectionId = (typeof NAV)[number]["id"];

export default function AAUBasketball() {
  const [activeSection, setActiveSection] = useState<SectionId>("myteams");
  // Find → tap a tournament → Screen 02 Track (sub-screen of Find, not a nav tab).
  const [trackTournament, setTrackTournament] = useState<DirTournament | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Aster AAU wears the house GOLD accent; override the team tokens at the root so
  // every sub-component inherits gold. Page bg is the repo's dark surface.
  const goldTheme = {
    minHeight: "100vh",
    paddingBottom: "calc(64px + env(safe-area-inset-bottom))",
    backgroundColor: "var(--as-bg-page)",
    "--as-team-primary": "#F6CC55",
    "--as-team-primary-soft": "rgba(246,204,85,0.12)",
    "--as-accent": "#E8902A",
    "--as-accent-soft": "rgba(232,144,42,0.12)",
  } as React.CSSProperties;

  const handleTracked = (count: number) => {
    setTrackTournament(null);
    setToast(`Tracking ${count} team${count === 1 ? "" : "s"}`);
    window.setTimeout(() => setToast(null), 3200);
  };

  return (
    <div style={goldTheme}>
      {/* Thin top bar (back + wordmark) */}
      <div style={{ borderBottom: "1px solid var(--as-border-default)" }}>
        <div style={{ height: 4, width: "100%", background: "var(--brand-grad)" }} />
        <div
          className="container"
          style={{
            paddingTop: 12,
            paddingBottom: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <a
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--as-text-secondary)",
              textDecoration: "none",
            }}
          >
            <ArrowLeft style={{ width: 15, height: 15 }} />
            Aster Sports
          </a>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--as-team-primary)",
              textTransform: "uppercase",
            }}
          >
            AAU Basketball
          </span>
        </div>
      </div>

      {/* Section content */}
      <div className="container" style={{ paddingTop: 18, paddingBottom: 32 }}>
        {activeSection === "find" &&
          (trackTournament ? (
            <TrackTeams
              tournamentId={trackTournament.id}
              tournamentName={trackTournament.name}
              onBack={() => setTrackTournament(null)}
              onTracked={handleTracked}
            />
          ) : (
            <FindDiscovery onOpenTournament={(t) => setTrackTournament(t)} />
          ))}
        {activeSection === "myteams" && <MyTeams />}
        {activeSection === "standings" && <StandingsHub />}
        {activeSection === "film" && <FilmHighlights />}
      </div>

      {/* track-confirmation toast */}
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            bottom: "calc(78px + env(safe-area-inset-bottom))",
            transform: "translateX(-50%)",
            zIndex: 50,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 999,
            background: "linear-gradient(100deg,#E0631C,#E8902A,#F6CC55,#FBD56B)",
            color: "#1a1206",
            fontSize: 13,
            fontWeight: 700,
            boxShadow: "0 12px 30px -12px rgba(224,99,28,0.6)",
          }}
        >
          <Check style={{ width: 15, height: 15 }} /> {toast}
        </div>
      )}

      {/* 4-job bottom nav (render set v2) */}
      <nav
        aria-label="Sections"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 40,
          display: "flex",
          justifyContent: "space-around",
          padding: "8px 6px calc(8px + env(safe-area-inset-bottom))",
          background: "rgba(8,11,20,0.92)",
          backdropFilter: "blur(12px)",
          borderTop: "1px solid var(--as-border-default)",
        }}
      >
        {NAV.map(({ id, label, Icon }) => {
          const active = activeSection === id;
          return (
            <button
              key={id}
              onClick={() => {
                setActiveSection(id);
                if (id === "find") setTrackTournament(null);
              }}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className="as-press"
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                background: "none",
                border: "none",
                cursor: "pointer",
                minWidth: 56,
                minHeight: 44,
                fontFamily: "inherit",
                fontSize: 10,
                fontWeight: 600,
                color: active ? "var(--as-team-primary)" : "var(--as-text-tertiary)",
              }}
            >
              <Icon style={{ width: 20, height: 20 }} />
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
