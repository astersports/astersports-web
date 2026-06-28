import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Home as HomeIcon, Compass, Film, Check } from "lucide-react";
import FindDiscovery from "../components/aau/FindDiscovery";
import TournamentDetail from "../components/aau/TournamentDetail";
import TrackTeams from "../components/aau/TrackTeams";
import HubHomeV2 from "../components/aau/HubHomeV2";
import FilmHighlights from "../components/aau/FilmHighlights";
import PlusGate, { GO_PLUS_EVENT } from "../components/aau/PlusGate";
import HubAccount from "../components/aau/HubAccount";
import { useHubAuth } from "@/lib/aau/useHubAuth";
import type { DirTournament } from "@/lib/aster";

// AAU hub shell — the rolled-up North Star IA (aau-hub-northstar-render.html, ratified l99
// 2026-06-27): THREE tabs, nothing spare. HOME (the logistics command center — up-next, leave-by,
// what-changed, live, tracked standings + the predictive model) · BROWSE (discover/track + upload
// a tournament; Live rides here as a section) · FILM (kids' highlights + AI review). Standings
// dissolved into Home + Division Detail; Live is a strip/section, not a tab; Plus is a gate, not a
// destination. Each screen carries its own header.
const NAV = [
  { id: "home", label: "Home", Icon: HomeIcon },
  { id: "browse", label: "Browse", Icon: Compass },
  { id: "film", label: "Film", Icon: Film },
] as const;

type SectionId = (typeof NAV)[number]["id"];

export default function AAUBasketball() {
  // Default landing: a new/anonymous visitor opens on BROWSE (the free front door — they have no
  // teams yet); a signed-in user opens on HOME (their weekend is the point). useHubAuth resolves
  // async, so default to "browse" and land once on "home" the first time a user is known — unless
  // the visitor has already navigated (don't yank them mid-tap).
  const [activeSection, setActiveSection] = useState<SectionId>("browse");
  // Browse → tap a tournament → its detail page (live scoreboard + divisions + standings),
  // and FROM there → Screen 02 Track. Both are sub-screens of Browse, not nav tabs.
  const [detailTournament, setDetailTournament] = useState<DirTournament | null>(null);
  const [trackTournament, setTrackTournament] = useState<DirTournament | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Aster Plus gate — opened from any paid action via the GO_PLUS_EVENT window event (Plus is a
  // gate, not a tab). Cosmetic; checkout stays owner-applied.
  const [showPlus, setShowPlus] = useState(false);
  useEffect(() => {
    const open = () => setShowPlus(true);
    window.addEventListener(GO_PLUS_EVENT, open);
    return () => window.removeEventListener(GO_PLUS_EVENT, open);
  }, []);
  // Drives the tracking store's account/anon mode + provides the user for the sign-in UI.
  const user = useHubAuth();
  const landed = useRef(false);
  const navigated = useRef(false);
  useEffect(() => {
    if (landed.current || navigated.current) return;
    if (user) {
      landed.current = true;
      setActiveSection("home");
    }
  }, [user]);

  // LIGHT MODE (operator-directed 2026-06-27, one-way). The repo's base --as-* tokens are DARK
  // (--as-bg-page #0F1119); the AAU hub is light, so override the full --as-* set to the Aster
  // Sports light brand at the hub root — every var(--as-*) inside the hub resolves light. Gold stays
  // the house accent (darkened to #8F6708 so gold text passes AA on white).
  // MEDIUM BASE (operator-directed 2026-06-28: "medium … light is too light, dark is too dark ·
  // lighter base theme"). The page canvas is a comfortable cool mid-light gray (#E6EAF0) — NOT the
  // old near-white #F7F8FA — so the white cards and their data points float and POP off the canvas
  // (the iOS grouped-table / Linear pattern). Cards stay white; only the base steps down a tone.
  const goldTheme = {
    minHeight: "100vh",
    paddingBottom: "calc(64px + env(safe-area-inset-bottom))",
    backgroundColor: "#E6EAF0",
    "--as-bg-page": "#E6EAF0",
    "--as-bg-card": "#FFFFFF",
    "--as-bg-card-hover": "#F9FAFB",
    "--as-bg-secondary": "#F1F3F5",
    "--as-bg-tertiary": "#E9ECEF",
    "--as-text-primary": "#1A1D23",
    "--as-text-secondary": "#374151",
    "--as-text-tertiary": "#4B5563",
    "--as-text-inverse": "#FFFFFF",
    "--as-border-default": "#E2E8F0",
    "--as-border-subtle": "#EDF2F7",
    "--as-success": "#16A34A",
    "--as-danger": "#DC2626",
    "--as-neutral": "#9CA3AF",
    "--as-neutral-soft": "#F3F4F6",
    "--as-live": "#16A34A",
    "--as-live-soft": "#DCFCE7",
    "--as-gold-soft": "#FBF3DC",
    "--as-shadow-sm": "0 1px 2px rgba(0,0,0,0.04)",
    "--as-team-primary": "#8F6708",
    "--as-team-primary-soft": "rgba(246,204,85,0.14)",
    "--as-accent": "#C9952E",
    "--as-accent-soft": "rgba(201,149,46,0.12)",
  } as React.CSSProperties;

  const handleTracked = (count: number) => {
    setTrackTournament(null);
    setDetailTournament(null);
    setActiveSection("home"); // land on Home so the tracked teams are right there
    setToast(`Tracking ${count} team${count === 1 ? "" : "s"}`);
    window.setTimeout(() => setToast(null), 3200);
  };

  return (
    <div style={goldTheme}>
      {/* Thin top bar (back + wordmark). Sticky + safe-area-inset-top so it pins BELOW the
          iPhone status bar / camera island instead of sliding up under it on scroll. */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          paddingTop: "env(safe-area-inset-top)",
          // Navy chrome — the Aster signature is a dark navy header on a light body (operator:
          // "more dark highlights in the aster theme", 2026-06-27). Light text + bright gold accent
          // ride on the navy; the body stays the light brand.
          background: "rgba(21,21,37,0.95)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
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
              color: "#CBD2E0", // light-on-navy
              textDecoration: "none",
            }}
          >
            <ArrowLeft style={{ width: 15, height: 15 }} />
            Aster Sports
          </a>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {/* Aster constellation mark — brand lockup with the AAU Hub badge */}
              <img src="/aster-mark.png" alt="" aria-hidden="true" style={{ height: 18, width: "auto", display: "block" }} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: "0.04em",
                  color: "#F6CC55", // bright gold reads on navy
                }}
              >
                Aster Sports AAU Hub
              </span>
            </span>
            <HubAccount user={user} />
          </div>
        </div>
      </div>

      {/* Section content */}
      <div className="container" style={{ paddingTop: 18, paddingBottom: 32 }}>
        {activeSection === "home" && <HubHomeV2 onFindTeams={() => setActiveSection("browse")} />}
        {activeSection === "browse" &&
          (trackTournament ? (
            // Track flow opens FROM the tournament detail page; back lands on detail again
            // (detailTournament is still set) rather than the front door.
            <TrackTeams
              tournamentId={trackTournament.id}
              tournamentName={trackTournament.name}
              onBack={() => setTrackTournament(null)}
              onTracked={handleTracked}
            />
          ) : detailTournament ? (
            <TournamentDetail
              tournament={detailTournament}
              onBack={() => setDetailTournament(null)}
              onTrack={() => setTrackTournament(detailTournament)}
            />
          ) : (
            <FindDiscovery
              user={user}
              onOpenTournament={(t) => {
                // opening a tournament IS navigation into the detail flow — mark it so a late
                // useHubAuth() resolve can't yank the visitor out to My Teams (Copilot #152).
                navigated.current = true;
                setDetailTournament(t);
              }}
            />
          ))}
        {activeSection === "film" && <FilmHighlights user={user} />}
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

      {/* Aster Plus gate overlay */}
      {showPlus && <PlusGate onClose={() => setShowPlus(false)} />}

      {/* 3-tab bottom nav (North Star: Home · Browse · Film) */}
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
          background: "rgba(21,21,37,0.95)", // navy chrome — matches the header
          backdropFilter: "blur(12px)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        {NAV.map(({ id, label, Icon }) => {
          const active = activeSection === id;
          return (
            <button
              key={id}
              onClick={() => {
                navigated.current = true;
                setActiveSection(id);
                if (id === "browse") {
                  setTrackTournament(null);
                  setDetailTournament(null);
                }
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
                color: active ? "#F6CC55" : "#8896AB", // bright gold active · muted slate inactive, on navy
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
