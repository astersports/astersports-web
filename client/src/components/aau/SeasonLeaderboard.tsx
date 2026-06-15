import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { TrendingUp, TrendingDown, Minus, Flame, Shield, Target, ChevronDown } from "lucide-react";
import SectionHeading from "./SectionHeading";

interface LeaderboardEntry {
  teamName: string;
  division: string;
  wins: number;
  losses: number;
  avgPointDifferential: number;
  winStreak: number;
  currentStreak: number;
  games: Array<{
    id: string;
    homeTeam: string;
    awayTeam: string;
    homeScore: number | null;
    awayScore: number | null;
    gameTime: string;
    court: string;
    pointDifferential: number | null;
    legacyWon: boolean | null;
    isLegacyHome: boolean;
  }>;
}

/* ─── FormGuide Dots ─── */
function FormGuide({ results }: { results: ('W' | 'L')[] }) {
  if (!results.length) return null;
  const wins = results.filter(r => r === 'W').length;
  const losses = results.filter(r => r === 'L').length;
  const ariaLabel = `Form guide — ${wins} ${wins === 1 ? 'win' : 'wins'}, ${losses} ${losses === 1 ? 'loss' : 'losses'}`;
  return (
    <div className="as-form-dots" role="img" aria-label={ariaLabel}>
      {results.map((r, i) => (
        <div key={i} aria-hidden="true" className={`as-form-dot ${r}`}>
          {r}
        </div>
      ))}
    </div>
  );
}

/* ─── TeamAccordion Row ─── */
function TeamAccordion({ entry, expanded, onToggle, staggerIndex }: {
  entry: LeaderboardEntry; expanded: boolean; onToggle: () => void; staggerIndex: number;
}) {
  const gp = entry.wins + entry.losses;
  const record = `${entry.wins}–${entry.losses}`;
  const color = entry.avgPointDifferential > 0 ? 'var(--as-success)' :
                entry.avgPointDifferential < 0 ? 'var(--as-danger)' : 'var(--as-text-tertiary)';

  // Build last-5 form from games sorted newest-first
  const last5: ('W' | 'L')[] = useMemo(() => {
    const sorted = [...entry.games]
      .filter(g => g.legacyWon !== null)
      .sort((a, b) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime());
    return sorted.slice(0, 5).map(g => g.legacyWon ? 'W' : 'L');
  }, [entry.games]);

  // Streak text
  const streakText = useMemo(() => {
    if (entry.currentStreak > 0) return `W${entry.currentStreak}`;
    // Calculate loss streak
    const sorted = [...entry.games]
      .filter(g => g.legacyWon !== null)
      .sort((a, b) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime());
    let lossStreak = 0;
    for (const g of sorted) {
      if (g.legacyWon === false) lossStreak++;
      else break;
    }
    if (lossStreak > 0) return `L${lossStreak}`;
    return '—';
  }, [entry.games, entry.currentStreak]);

  return (
    <div className={`as-fade-in as-stagger-${Math.min(staggerIndex + 1, 10)}`} style={{ marginBottom: 6 }}>
      {/* Accordion Header */}
      <button
        type="button"
        onClick={onToggle}
        className="as-press"
        aria-expanded={expanded}
        aria-label={`${entry.teamName}, ${record} record`}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', minHeight: 44,
          background: 'var(--as-bg-card)',
          border: `1px solid ${expanded ? color : 'var(--as-border-default)'}`,
          borderLeft: `4px solid ${color}`,
          borderRadius: 10, cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit',
          transition: 'border-color 200ms ease',
        }}
      >
        {/* Left: team name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-display" style={{
            fontSize: 15, color: 'var(--as-text-primary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {entry.teamName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--as-text-tertiary)', marginTop: 2 }}>
            {gp} game{gp !== 1 ? 's' : ''} · Avg {entry.avgPointDifferential > 0 ? '+' : ''}{entry.avgPointDifferential}
          </div>
        </div>

        {/* Right: record + form guide */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            fontFamily: "'Barlow Condensed', 'Inter', sans-serif",
            fontSize: 20, fontWeight: 800, color,
            lineHeight: 1,
          }}>
            {record}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
            {streakText !== '—' && (
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--as-text-secondary)' }}>
                {streakText}
              </span>
            )}
            <FormGuide results={last5} />
          </div>
        </div>

        {/* Chevron */}
        <ChevronDown
          size={14} strokeWidth={2.5}
          style={{
            color: 'var(--as-text-tertiary)', flexShrink: 0,
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 200ms ease-out',
          }}
        />
      </button>

      {/* Expanded Detail */}
      <div className="as-collapsible" data-open={expanded ? 'true' : 'false'}>
        <div className="as-collapsible-inner">
          <div style={{ padding: '8px 4px 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {[...entry.games]
              .sort((a, b) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime())
              .map((game, idx) => {
                const won = game.legacyWon;
                const legacyScore = game.isLegacyHome ? game.homeScore : game.awayScore;
                const oppScore = game.isLegacyHome ? game.awayScore : game.homeScore;
                const diff = game.pointDifferential ?? 0;
                return (
                  <div
                    key={game.id}
                    className="as-glog"
                    style={{ padding: '8px 10px' }}
                  >
                    <div className={`as-glog-result ${won ? 'W' : 'L'}`} style={{ width: 28, height: 28, fontSize: 12 }}>
                      {won ? 'W' : 'L'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--as-text-primary)' }}>
                        {legacyScore}–{oppScore}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--as-text-tertiary)' }}>
                        {new Date(game.gameTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}
                        {game.court ? ` · ${game.court}` : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {diff > 0 ? <TrendingUp size={11} strokeWidth={2} style={{ color: 'var(--as-success)' }} />
                        : diff < 0 ? <TrendingDown size={11} strokeWidth={2} style={{ color: 'var(--as-danger)' }} />
                          : <Minus size={11} strokeWidth={2} style={{ color: 'var(--as-text-tertiary)' }} />}
                      <span style={{
                        fontSize: 11, fontWeight: 700,
                        color: diff > 0 ? 'var(--as-success)' : diff < 0 ? 'var(--as-danger)' : 'var(--as-text-secondary)',
                      }}>
                        {diff > 0 ? '+' : ''}{diff}
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ─── */
export default function SeasonLeaderboard() {
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);

  const { data, isLoading } = trpc.leaderboard.get.useQuery(undefined, {
    refetchInterval: 120_000,
  });

  const entries: LeaderboardEntry[] = useMemo(() => data?.entries || [], [data]);
  const overall = useMemo(() => data?.overall || { wins: 0, losses: 0, avgPointDifferential: 0, winStreak: 0, currentStreak: 0 }, [data]);

  const stats = useMemo(() => {
    const totalGames = overall.wins + overall.losses;
    const winRate = totalGames > 0 ? Math.round((overall.wins / totalGames) * 100) : 0;

    let totalPoints = 0;
    let totalAllowed = 0;
    let gamesWithScores = 0;
    let bestWinDiff = 0;
    let bestWinOpponent = '';
    let heldUnder20 = 0;

    for (const entry of entries) {
      for (const game of entry.games) {
        if (game.homeScore !== null && game.awayScore !== null) {
          const legacyScore = game.isLegacyHome ? game.homeScore : game.awayScore;
          const oppScore = game.isLegacyHome ? game.awayScore : game.homeScore;
          totalPoints += legacyScore;
          totalAllowed += oppScore;
          gamesWithScores++;
          if (oppScore < 20) heldUnder20++;
          if (game.legacyWon && game.pointDifferential !== null && game.pointDifferential > bestWinDiff) {
            bestWinDiff = game.pointDifferential;
            bestWinOpponent = entry.teamName;
          }
        }
      }
    }

    const ppg = gamesWithScores > 0 ? (totalPoints / gamesWithScores).toFixed(1) : '0';
    const oppPpg = gamesWithScores > 0 ? (totalAllowed / gamesWithScores).toFixed(1) : '0';

    return { totalGames, winRate, ppg, oppPpg, totalPoints, totalAllowed, bestWinDiff, bestWinOpponent, heldUnder20 };
  }, [entries, overall]);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => b.avgPointDifferential - a.avgPointDifferential),
    [entries]
  );

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="as-shimmer" style={{ height: 100, borderRadius: 12 }} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={`as-shimmer as-stagger-${i}`} style={{ height: 80, borderRadius: 10 }} />
          ))}
        </div>
        {[1, 2, 3].map(i => (
          <div key={i} className={`as-shimmer as-stagger-${i + 4}`} style={{ height: 52, borderRadius: 8 }} />
        ))}
      </div>
    );
  }

  return (
    <div className="as-fade-in">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, padding: '0 4px' }}>
        <h2 className="font-display" style={{ fontSize: 20, color: 'var(--as-text-primary)', margin: 0 }}>
          SEASON RECORDS
        </h2>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--as-text-tertiary)' }}>
          Spring 2026 · Live
        </span>
      </div>

      {/* Hero stats row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: 10, marginBottom: 20,
      }}>
        <HeroStat icon={Target} label="PPG" value={stats.ppg} accent="var(--as-accent)" delay={0} />
        <HeroStat icon={Shield} label="OPP PPG" value={stats.oppPpg} accent="var(--as-team-primary)" delay={1} />
        <HeroStat icon={Flame} label="WIN STREAK" value={`W${overall.winStreak}`} accent="var(--as-success)" delay={2} />
        <HeroStat icon={TrendingUp} label="AVG DIFF" value={`${overall.avgPointDifferential > 0 ? '+' : ''}${overall.avgPointDifferential}`} accent={overall.avgPointDifferential > 0 ? 'var(--as-success)' : 'var(--as-danger)'} delay={3} />
      </div>

      {/* Win rate bar */}
      <div style={{
        padding: '14px 16px', borderRadius: 10, marginBottom: 20,
        backgroundColor: 'var(--as-bg-card)', border: '1px solid var(--as-border-default)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--as-text-secondary)' }}>
            Overall Record
          </span>
          <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--as-text-primary)' }}>
            {overall.wins}–{overall.losses}
          </span>
        </div>
        <div className="as-progress-bar" style={{ height: 8 }}>
          <div className="as-progress-fill" style={{
            width: `${stats.winRate}%`,
            backgroundColor: 'var(--as-success)',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--as-text-tertiary)' }}>{stats.winRate}% Win Rate</span>
          <span style={{ fontSize: 11, color: 'var(--as-text-tertiary)' }}>
            Best: +{stats.bestWinDiff} vs {stats.bestWinOpponent.split(' - ')[0] || stats.bestWinOpponent}
          </span>
        </div>
      </div>

      {/* Defensive highlights */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24,
      }}>
        <div className="as-fade-in as-stagger-1" style={{
          padding: '12px 14px', borderRadius: 10,
          backgroundColor: 'var(--as-bg-card)', border: '1px solid var(--as-border-default)',
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--as-text-tertiary)', letterSpacing: '0.04em' }}>HELD UNDER 20</span>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--as-team-primary)', marginTop: 2 }}>{stats.heldUnder20}</div>
          <span style={{ fontSize: 11, color: 'var(--as-text-tertiary)' }}>games</span>
        </div>
        <div className="as-fade-in as-stagger-2" style={{
          padding: '12px 14px', borderRadius: 10,
          backgroundColor: 'var(--as-bg-card)', border: '1px solid var(--as-border-default)',
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--as-text-tertiary)', letterSpacing: '0.04em' }}>TOTAL SCORED</span>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--as-accent)', marginTop: 2 }}>{stats.totalPoints}</div>
          <span style={{ fontSize: 11, color: 'var(--as-text-tertiary)' }}>in {stats.totalGames} games</span>
        </div>
      </div>

      {/* Opponent Breakdown — TeamAccordion pattern */}
      <div>
        <h3 className="font-display" style={{ fontSize: 14, color: 'var(--as-text-secondary)', margin: '0 0 12px 4px' }}>
          OPPONENT BREAKDOWN
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {sortedEntries.map((entry, idx) => (
            <TeamAccordion
              key={entry.teamName}
              entry={entry}
              expanded={expandedTeam === entry.teamName}
              onToggle={() => setExpandedTeam(expandedTeam === entry.teamName ? null : entry.teamName)}
              staggerIndex={idx}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Hero Stat Card ─── */
function HeroStat({ icon: Icon, label, value, accent, delay }: {
  icon: typeof Target; label: string; value: string; accent: string; delay: number;
}) {
  return (
    <div
      className={`as-fade-in as-stagger-${delay + 1}`}
      style={{
        padding: '14px 12px', borderRadius: 10, textAlign: 'center',
        backgroundColor: 'var(--as-bg-card)',
        border: '1px solid var(--as-border-default)',
        borderTop: `3px solid ${accent}`,
      }}
    >
      <Icon size={16} strokeWidth={2} style={{ color: accent, margin: '0 auto 6px' }} />
      <div style={{ fontSize: 20, fontWeight: 700, color: accent, letterSpacing: '-0.02em' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--as-text-tertiary)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
