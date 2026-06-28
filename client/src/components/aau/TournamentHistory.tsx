import { Trophy, Medal, Award, Zap, CheckCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface TournamentMeta {
  name: string;
  dates: string;
  status: string;
  result?: string;
}

const TOURNAMENT_META: TournamentMeta[] = [
  { name: 'ZG NY Hoop Festival', dates: 'Jun 13–14, 2026', status: 'completed' },
  { name: 'ZG Girls National Finals', dates: 'May 30–31, 2026', status: 'completed', result: 'Final Four' },
  { name: 'ZG Rumble for the Ring CT', dates: 'May 16–17, 2026', status: 'completed', result: 'Finalists' },
  { name: 'ZG NY Metro Showdown', dates: 'Apr 18–19, 2026', status: 'completed' },
  { name: 'ZG Chase for the Chain NY', dates: 'Apr 11–12, 2026', status: 'completed', result: 'Champions' },
];

type Badge = 'champions' | 'finalists' | 'final-four' | null;

function getBadge(result?: string): Badge {
  if (!result) return null;
  if (result.toLowerCase().includes('champion')) return 'champions';
  if (result.toLowerCase().includes('finalist')) return 'finalists';
  if (result.toLowerCase().includes('final four')) return 'final-four';
  return null;
}

function getBadgeConfig(badge: Badge) {
  switch (badge) {
    case 'champions':
      return { icon: Trophy, label: 'CHAMPIONS', bg: 'var(--as-gold-soft)', color: 'var(--as-gold-text)', borderColor: 'rgba(184,134,11,0.3)' };
    case 'finalists':
      return { icon: Medal, label: 'FINALISTS', bg: 'rgba(167, 139, 250, 0.12)', color: 'var(--as-team-primary)', borderColor: 'rgba(167,139,250,0.3)' };
    case 'final-four':
      return { icon: Award, label: 'FINAL FOUR', bg: 'var(--as-accent-soft)', color: 'var(--as-accent)', borderColor: 'rgba(74,143,212,0.3)' };
    default:
      return null;
  }
}

function getStatusConfig(status: string) {
  switch (status) {
    case 'live':
      return { label: 'IN PROGRESS', bg: 'var(--as-live-soft)', color: 'var(--as-live)', icon: Zap };
    case 'completed':
      return { label: 'COMPLETE', bg: 'var(--as-neutral-soft)', color: 'var(--as-neutral)', icon: CheckCircle };
    default:
      return { label: 'SCHEDULED', bg: 'var(--as-accent-soft)', color: 'var(--as-accent)', icon: null };
  }
}

export default function TournamentHistory() {
  const { data, isLoading } = trpc.games.list.useQuery(undefined, {
    refetchInterval: 120_000,
  });

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className={`as-shimmer as-stagger-${i}`} style={{ height: 80, borderRadius: 12 }} />
        ))}
      </div>
    );
  }

  const games = data?.games || [];

  const tournamentRecords = TOURNAMENT_META.map(meta => {
    const prefix = meta.name.replace(/\s/g, '-').toLowerCase();
    const tournGames = games.filter(g => g.id.startsWith(prefix));
    const completed = tournGames.filter(g => g.status === 'completed');
    const wins = completed.filter(g => g.legacyWon === true).length;
    const losses = completed.filter(g => g.legacyWon === false).length;
    const badge = getBadge(meta.result);
    return { ...meta, wins, losses, badge, totalGames: tournGames.length };
  });

  const totalWins = tournamentRecords.reduce((sum, t) => sum + t.wins, 0);
  const totalLosses = tournamentRecords.reduce((sum, t) => sum + t.losses, 0);
  const winRate = totalWins + totalLosses > 0 ? Math.round((totalWins / (totalWins + totalLosses)) * 100) : 0;

  return (
    <div className="as-fade-in">
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 20, padding: '0 4px',
      }}>
        <h2 className="font-display" style={{ fontSize: 20, color: 'var(--as-text-primary)', margin: 0 }}>
          TOURNAMENT HISTORY
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--as-text-secondary)' }}>
            Spring 2026 · Final
          </span>
          <span style={{
            fontSize: 14, fontWeight: 700, color: 'var(--as-text-primary)',
            padding: '3px 10px', borderRadius: 6,
            backgroundColor: 'var(--as-bg-tertiary)',
          }}>
            {totalWins}–{totalLosses}
          </span>
        </div>
      </div>

      {/* Win rate progress bar — only when there are completed games to rate (no fabricated 0%) */}
      {totalWins + totalLosses > 0 && (
        <div style={{ marginBottom: 20, padding: '0 4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--as-text-secondary)' }}>Win Rate</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--as-success)' }}>{winRate}%</span>
          </div>
          <div
            className="as-progress-bar"
            role="progressbar"
            aria-label="Win rate"
            aria-valuenow={winRate}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="as-progress-fill" style={{
              width: `${winRate}%`,
              backgroundColor: 'var(--as-success)',
            }} />
          </div>
        </div>
      )}

      {/* Championship highlights row */}
      {tournamentRecords.filter(t => t.badge).length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 10, marginBottom: 20,
        }}>
          {tournamentRecords.filter(t => t.badge).map((t, idx) => {
            const config = getBadgeConfig(t.badge)!;
            const Icon = config.icon;
            return (
              <div
                key={t.name}
                className={`as-fade-in as-stagger-${idx + 1}`}
                style={{
                  padding: '14px 12px', borderRadius: 10, textAlign: 'center',
                  backgroundColor: config.bg, border: `1px solid ${config.borderColor}`,
                }}
              >
                <Icon size={20} strokeWidth={2} style={{ color: config.color, margin: '0 auto 6px' }} />
                <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: config.color, margin: '0 0 3px' }}>
                  {config.label}
                </p>
                <p style={{ fontSize: 11, color: 'var(--as-text-secondary)', margin: 0 }}>
                  {t.name.replace('ZG ', '')}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Tournament list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tournamentRecords.map((tournament, idx) => {
          const badgeConfig = getBadgeConfig(tournament.badge);
          const statusConfig = getStatusConfig(tournament.status);
          const hasRecord = tournament.wins > 0 || tournament.losses > 0;
          const isLive = tournament.status === 'live';

          // Left border color
          const borderLeftColor = badgeConfig
            ? badgeConfig.borderColor
            : isLive
              ? 'var(--as-live)'
              : 'var(--as-border-default)';

          return (
            <div
              key={tournament.name}
              className={`as-card-hover as-fade-in as-stagger-${idx + 1}`}
              style={{
                display: 'flex', alignItems: 'center',
                padding: '14px 16px', borderRadius: 10,
                backgroundColor: 'var(--as-bg-card)',
                border: `1px solid var(--as-border-default)`,
                borderLeft: `4px solid ${borderLeftColor}`,
                gap: 14,
              }}
            >
              {/* Left: tournament info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--as-text-primary)' }}>
                    {tournament.name}
                  </span>
                  {/* Status chip */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                    padding: '2px 7px', borderRadius: 999,
                    backgroundColor: statusConfig.bg, color: statusConfig.color,
                  }}>
                    {isLive && <span className="live-dot" style={{ width: 5, height: 5 }} />}
                    {statusConfig.label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--as-text-tertiary)' }}>
                    {tournament.dates}
                  </span>
                  {badgeConfig && (
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                      backgroundColor: badgeConfig.bg, color: badgeConfig.color,
                    }}>
                      {badgeConfig.label}
                    </span>
                  )}
                </div>
              </div>

              {/* Right: record */}
              <div style={{ flexShrink: 0, textAlign: 'right' }}>
                {hasRecord ? (
                  <div style={{
                    fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em',
                    color: tournament.wins > tournament.losses ? 'var(--as-success)' : 'var(--as-text-secondary)',
                  }}>
                    {tournament.wins}–{tournament.losses}
                  </div>
                ) : isLive ? (
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--as-live)' }}>
                    {tournament.totalGames} games
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
