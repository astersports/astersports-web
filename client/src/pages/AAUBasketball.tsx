import { useState, useRef, useEffect, useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { trpc } from "@/lib/trpc";
import LiveScores from "../components/aau/LiveScores";
import TournamentHistory from "../components/aau/TournamentHistory";
import SeasonLeaderboard from "../components/aau/SeasonLeaderboard";
import FilmHighlights from "../components/aau/FilmHighlights";
import Locations from "../components/aau/Locations";
import Mission from "../components/aau/Mission";
import StatHeroBar from "../components/aau/StatHeroBar";

const SECTIONS = [
  { id: "scores", label: "Live Scores", emoji: "⚡" },
  { id: "history", label: "History", emoji: "🏆" },
  { id: "leaderboard", label: "Records", emoji: "📊" },
  { id: "film", label: "Film", emoji: "🎬" },
  { id: "locations", label: "Locations", emoji: "📍" },
  { id: "mission", label: "Mission", emoji: "🎯" },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

export default function AAUBasketball() {
  const [activeSection, setActiveSection] = useState<SectionId>("scores");
  const tabsRef = useRef<HTMLDivElement>(null);

  // Fetch leaderboard for the dynamic record display
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

    return [
      { value: '1', label: 'CHAMPS', variant: 'gold' as const },
      { value: '1', label: 'FINALIST', variant: 'gold' as const },
      { value: String(o.wins), label: 'WINS', variant: 'green' as const },
      { value: ppg, label: 'PPG', variant: 'default' as const },
      { value: `${o.avgPointDifferential > 0 ? '+' : ''}${o.avgPointDifferential}`, label: 'AVG DIFF', variant: 'green' as const },
      { value: `W${o.winStreak}`, label: 'STREAK', variant: 'default' as const },
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

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Hero Header */}
      <div style={{
        backgroundColor: 'var(--as-bg-secondary)',
        borderBottom: '1px solid var(--as-border-default)',
      }}>
        {/* Top color bar */}
        <div style={{
          height: 4, width: '100%',
          background: `linear-gradient(90deg, var(--as-team-primary), var(--as-accent))`,
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

          {/* Team identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              backgroundColor: 'var(--as-team-primary)',
              boxShadow: '0 0 8px rgba(167, 139, 250, 0.4)',
            }} />
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
            margin: '0 0 8px',
            lineHeight: 1.1,
          }}>
            ASTER AAU 11U GIRLS
          </h1>

          {/* Featured players */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--as-text-tertiary)' }}>ft.</span>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
              backgroundColor: 'color-mix(in srgb, var(--as-team-primary) 12%, transparent)',
              color: 'var(--as-team-primary)',
            }}>
              #5 Charlie
            </span>
            <span style={{ fontSize: 11, color: 'var(--as-text-tertiary)' }}>·</span>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
              backgroundColor: 'color-mix(in srgb, var(--as-accent) 12%, transparent)',
              color: 'var(--as-accent)',
            }}>
              #24 Sofia
            </span>
          </div>

          {/* Stats row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--as-text-secondary)' }}>
              Spring 2026
            </span>
            {record && (
              <span style={{
                fontSize: 13, fontWeight: 700, color: 'var(--as-text-primary)',
                padding: '2px 8px', borderRadius: 6,
                backgroundColor: 'var(--as-bg-tertiary)',
              }}>
                {record}
              </span>
            )}
            {winRate !== null && (
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--as-success)' }}>
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
        {activeSection === "scores" && <LiveScores />}
        {activeSection === "history" && <TournamentHistory />}
        {activeSection === "leaderboard" && <SeasonLeaderboard />}
        {activeSection === "film" && <FilmHighlights />}
        {activeSection === "locations" && <Locations />}
        {activeSection === "mission" && <Mission />}
      </div>
    </div>
  );
}
