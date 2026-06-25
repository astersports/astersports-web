import { useState, useRef, useEffect, useMemo } from "react";
import { ArrowLeft, ArrowUpRight, Zap, Trophy, BarChart3, Film } from "lucide-react";
import { trpc } from "@/lib/trpc";
import LiveScores from "../components/aau/LiveScores";
import TournamentHistory from "../components/aau/TournamentHistory";
import SeasonLeaderboard from "../components/aau/SeasonLeaderboard";
import FilmHighlights from "../components/aau/FilmHighlights";
import Locations from "../components/aau/Locations";
import Mission from "../components/aau/Mission";
import StatHeroBar from "../components/aau/StatHeroBar";
import WeatherCard from "../components/aau/weather/WeatherCard";

const LOGO_URL = "/aster-mark.png";
const APP_URL = "https://astersports.app";

const SECTIONS = [
  { id: "scores", label: "Live Scores", emoji: "⚡" },
  { id: "history", label: "History", emoji: "🏆" },
  { id: "leaderboard", label: "Records", emoji: "📊" },
  { id: "film", label: "Film", emoji: "🎬" },
  { id: "locations", label: "Locations", emoji: "📍" },
  { id: "mission", label: "Mission", emoji: "🎯" },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

// Primary destinations for the persistent mobile bottom-nav (app-like surface).
const BOTTOM_NAV: { id: SectionId; label: string; Icon: typeof Zap }[] = [
  { id: "scores", label: "Scores", Icon: Zap },
  { id: "history", label: "History", Icon: Trophy },
  { id: "leaderboard", label: "Records", Icon: BarChart3 },
  { id: "film", label: "Film", Icon: Film },
];

export default function AAUBasketball() {
  const [activeSection, setActiveSection] = useState<SectionId>("scores");
  const tabsRef = useRef<HTMLDivElement>(null);

  // Public showcase (owner product decision 2026-06-25): no auth gate. Reads run
  // against public tRPC procedures; the data shown is the team's scoreboard +
  // schedule already intended for a public recruiting surface.
  const { data: leaderboardData } = trpc.leaderboard.get.useQuery(undefined, {
    refetchInterval: 120_000,
  });

  const overall = leaderboardData?.overall;
  const record = overall ? `${overall.wins}–${overall.losses}` : null;
  const qualified = overall && overall.wins >= 10;
  const winRate = overall && (overall.wins + overall.losses) > 0
    ? Math.round((overall.wins / (overall.wins + overall.losses)) * 100)
    : null;

  // Compute StatHeroBar items from leaderboard data
  const statBarItems = useMemo(() => {
    if (!leaderboardData) return null;
    const entries = leaderboardData.entries || [];
    const o = leaderboardData.overall;
    const totalGames = o.wins + o.losses;

    // Compute PPG
    let totalPoints = 0;
    let gamesWithScores = 0;
    for (const entry of entries) {
      for (const game of entry.games) {
        if (game.homeScore !== null && game.awayScore !== null) {
          const legacyScore = game.isLegacyHome ? game.homeScore : game.awayScore;
          totalPoints += legacyScore;
          gamesWithScores++;
        }
      }
    }
    const ppg = gamesWithScores > 0 ? (totalPoints / gamesWithScores).toFixed(1) : '0';

    const titles = leaderboardData.titles ?? { champions: 0, finalists: 0, finalFour: 0 };
    const streak = o.streakType ? `${o.streakType}${o.streakCount}` : '—';

    return [
      { value: String(titles.champions), label: 'CHAMPS', variant: 'gold' as const },
      { value: String(titles.finalists), label: 'FINALIST', variant: 'gold' as const },
      { value: String(o.wins), label: 'WINS', variant: 'green' as const },
      { value: ppg, label: 'PPG', variant: 'default' as const },
      { value: `${o.avgPointDifferential > 0 ? '+' : ''}${o.avgPointDifferential}`, label: 'AVG DIFF', variant: (o.avgPointDifferential > 0 ? 'green' : 'default') as 'green' | 'default' },
      { value: streak, label: 'STREAK', variant: (o.streakType === 'W' ? 'green' : 'default') as 'green' | 'default' },
    ];
  }, [leaderboardData]);

  // Scroll active tab into view on mobile
  useEffect(() => {
    if (tabsRef.current) {
      const activeTab = tabsRef.current.querySelector('[data-active="true"]') as HTMLElement;
      if (activeTab) {
        activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [activeSection]);

  // Aster AAU = the house program; it wears the Aster GOLD brand (R1/F3).
  // Override the team tokens at the page root so every AAU sub-component
  // (scores, records, film) inherits gold without per-component edits.
  const goldTheme = {
    minHeight: '100vh',
    paddingBottom: 'calc(64px + env(safe-area-inset-bottom))',
    '--as-team-primary': '#F6CC55',
    '--as-team-primary-soft': 'rgba(246,204,85,0.12)',
    '--as-accent': '#E8902A',
    '--as-accent-soft': 'rgba(232,144,42,0.12)',
  } as React.CSSProperties;

  return (
    <div style={goldTheme}>
      {/* Hero Header */}
      <div style={{
        backgroundColor: 'var(--as-bg-secondary)',
        borderBottom: '1px solid var(--as-border-default)',
      }}>
        {/* Top color bar — canonical 4-stop brand gradient */}
        <div style={{
          height: 4, width: '100%',
          background: 'var(--brand-grad)',
        }} />

        <div className="container" style={{ paddingTop: 16, paddingBottom: 0 }}>
          {/* Back to main site */}
          <a
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--as-text-secondary)',
              textDecoration: 'none',
              marginBottom: 16,
              padding: '8px 14px',
              borderRadius: 8,
              backgroundColor: 'var(--as-bg-card)',
              border: '1px solid var(--as-border-default)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--as-team-primary)'; e.currentTarget.style.borderColor = 'var(--as-team-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--as-text-secondary)'; e.currentTarget.style.borderColor = 'var(--as-border-default)'; }}
          >
            <ArrowLeft style={{ width: 16, height: 16 }} />
            Back to Aster Sports
          </a>

          {/* Mark + team identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <img src={LOGO_URL} alt="Aster Sports" style={{ height: 26, width: 'auto', filter: 'drop-shadow(0 0 8px rgba(246,204,85,0.5))' }} />
            <span style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
              color: 'var(--as-team-primary)', textTransform: 'uppercase',
            }}>
              5th Grade Girls · Zero Gravity AAU
            </span>
          </div>

          {/* Team name */}
          <h1 className="font-display-xl" style={{
            fontSize: 'clamp(24px, 5vw, 36px)',
            color: 'var(--as-text-primary)',
            margin: '0 0 12px',
            lineHeight: 1.05,
          }}>
            ASTER AAU{' '}
            <span className="aster-grad-text">11U GIRLS</span>
          </h1>

          {/* Open in the app CTA (the program runs on astersports.app) */}
          <a
            href={APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="as-press aster-grad-bg"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13, fontWeight: 700, color: '#1a0e05',
              padding: '9px 16px', borderRadius: 999, textDecoration: 'none',
              marginBottom: 12, minHeight: 40,
            }}
          >
            Open in the app
            <ArrowUpRight style={{ width: 15, height: 15 }} />
          </a>

          {/* Stats row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--as-text-secondary)' }}>
              Spring 2026 · Final
            </span>
            {record && (
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13, fontWeight: 700, color: 'var(--as-text-primary)',
                padding: '2px 8px', borderRadius: 6,
                backgroundColor: 'var(--as-bg-tertiary)',
              }}>
                {record}
              </span>
            )}
            {winRate !== null && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--as-success)' }}>
                {winRate}%
              </span>
            )}
            {qualified && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                padding: '3px 8px', borderRadius: 999,
                backgroundColor: 'var(--as-gold-soft)', color: '#FFD700',
              }}>
                🏅 NATIONALS QUALIFIED
              </span>
            )}
          </div>

          {/* StatHeroBar */}
          {statBarItems && (
            <div style={{ marginBottom: 16, marginLeft: -16, marginRight: -16 }}>
              <StatHeroBar items={statBarItems} />
            </div>
          )}

          {/* Section Nav — scrollable pill tabs */}
          <div
            ref={tabsRef}
            className="as-no-scrollbar"
            style={{
              display: 'flex', gap: 6, overflowX: 'auto',
              paddingBottom: 12, marginBottom: -1,
            }}
          >
            {SECTIONS.map(section => {
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  data-active={isActive}
                  onClick={() => setActiveSection(section.id)}
                  className="as-press"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 14px', borderRadius: 999,
                    fontSize: 13, fontWeight: isActive ? 700 : 500,
                    whiteSpace: 'nowrap', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit',
                    minHeight: 44,
                    backgroundColor: isActive ? 'var(--as-team-primary-soft)' : 'var(--as-bg-tertiary)',
                    color: isActive ? 'var(--as-team-primary)' : 'var(--as-text-tertiary)',
                    borderBottom: isActive ? '2px solid var(--as-team-primary)' : '2px solid transparent',
                    transition: 'all 200ms ease',
                  }}
                >
                  <span style={{ fontSize: 14 }}>{section.emoji}</span>
                  {section.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Section Content */}
      <div className="container" style={{ paddingTop: 24, paddingBottom: 48 }}>
        {activeSection === "scores" && (
          <>
            <WeatherCard />
            <LiveScores />
          </>
        )}
        {activeSection === "history" && <TournamentHistory />}
        {activeSection === "leaderboard" && <SeasonLeaderboard />}
        {activeSection === "film" && <FilmHighlights />}
        {activeSection === "locations" && <Locations />}
        {activeSection === "mission" && <Mission />}
      </div>

      {/* Persistent mobile bottom-nav (app-like primary destinations) */}
      <nav
        className="lg:hidden"
        aria-label="Sections"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 40,
          display: 'flex', justifyContent: 'space-around',
          padding: '8px 6px calc(8px + env(safe-area-inset-bottom))',
          background: 'rgba(8,11,20,0.92)', backdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--as-border-default)',
        }}
      >
        {BOTTOM_NAV.map(({ id, label, Icon }) => {
          const active = activeSection === id;
          return (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className="as-press"
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                background: 'none', border: 'none', cursor: 'pointer',
                minWidth: 56, minHeight: 44, fontFamily: 'inherit',
                fontSize: 10, fontWeight: 600,
                color: active ? 'var(--as-team-primary)' : 'var(--as-text-tertiary)',
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
