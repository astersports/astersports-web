import { useState, useEffect, useCallback, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { ChevronDown, Clock, RefreshCw, Zap } from "lucide-react";
import GameWeather from "./weather/GameWeather";

interface Venue { latitude: number; longitude: number; name: string }

interface Game {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  gameTime: string;
  court: string;
  division: string;
  status: 'live' | 'countdown' | 'upcoming' | 'completed';
  isLegacyHome: boolean;
  pointDifferential: number | null;
  legacyWon: boolean | null;
}

// ─── Tournament metadata ───
const TOURNAMENT_META: { name: string; dates: string; result?: string }[] = [
  { name: 'ZG NY Hoop Festival', dates: 'Jun 13–14, 2026' },
  { name: 'ZG Girls National Finals', dates: 'May 30–31, 2026', result: 'Final Four' },
  { name: 'ZG Rumble for the Ring CT', dates: 'May 16–17, 2026', result: 'Finalists' },
  { name: 'ZG NY Metro Showdown', dates: 'Apr 18–19, 2026' },
  { name: 'ZG Chase for the Chain NY', dates: 'Apr 11–12, 2026', result: 'Champions' },
];

const STORAGE_KEY = 'aster-aau-collapsed-tournaments';

function getCollapsedTournaments(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? new Set(JSON.parse(stored) as string[]) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

function saveCollapsedTournaments(collapsed: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(collapsed)));
}

function getCountdownText(gameTime: string): string {
  const diff = new Date(gameTime).getTime() - Date.now();
  if (diff <= 0) return "Now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rm = mins % 60;
  if (hrs < 24) return `in ${hrs}h ${rm}m`;
  const dt = new Date(gameTime);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayKey = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  if (dayKey(dt) === dayKey(tomorrow)) {
    return `Tomorrow ${dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}`;
  }
  return dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' }) + ' ' +
    dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
}

function getUrgencyClass(gameTime: string): string {
  const diff = new Date(gameTime).getTime() - Date.now();
  if (diff <= 0) return '';
  const hours = diff / (60 * 60 * 1000);
  if (hours <= 1) return 'as-urgency-1h';
  if (hours <= 6) return 'as-urgency-6h';
  if (hours <= 24) return 'as-urgency-24h';
  return 'as-countdown';
}

function sortGames(games: Game[]): Game[] {
  return [...games].sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1;
    if (b.status === 'live' && a.status !== 'live') return 1;
    if (a.status === 'countdown' && b.status === 'countdown') {
      return new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime();
    }
    if (a.status === 'countdown' && b.status !== 'countdown') return -1;
    if (b.status === 'countdown' && a.status !== 'countdown') return 1;
    if (a.status === 'completed' && b.status === 'completed') {
      return new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime();
    }
    return new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime();
  });
}

function findBiggestWin(games: Game[]): string | null {
  let maxDiff = 0;
  let biggestId: string | null = null;
  for (const game of games) {
    if (game.legacyWon && game.pointDifferential !== null && game.pointDifferential > maxDiff) {
      maxDiff = game.pointDifferential;
      biggestId = game.id;
    }
  }
  return biggestId;
}

function getTournamentStatus(games: Game[]): 'live' | 'next' | 'complete' | 'upcoming' {
  if (games.some(g => g.status === 'live')) return 'live';
  if (games.some(g => g.status === 'countdown')) return 'next';
  if (games.every(g => g.status === 'completed') && games.length > 0) return 'complete';
  return 'upcoming';
}

function getPillClass(status: string, result?: string): string {
  if (status === 'live') return 'next';
  if (result?.toLowerCase().includes('champion')) return 'champions';
  if (status === 'complete') return 'complete';
  return '';
}

function getPillLabel(status: string, result?: string): string {
  if (status === 'live') return 'IN PROGRESS';
  if (result?.toLowerCase().includes('champion')) return '🏆 CHAMPIONS';
  if (result?.toLowerCase().includes('finalist')) return 'FINALISTS';
  if (result?.toLowerCase().includes('final four')) return 'FINAL FOUR';
  if (status === 'complete') return 'COMPLETE';
  if (status === 'next') return 'NEXT UP';
  return 'SCHEDULED';
}

/* ─── Loading Skeleton ─── */
function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-3">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className={`as-shimmer as-stagger-${i}`} style={{ height: 72, borderRadius: 10 }} />
      ))}
    </div>
  );
}

/* ─── Main Component ─── */
export default function LiveScores() {
  const [collapsedTournaments, setCollapsedTournaments] = useState<Set<string>>(getCollapsedTournaments);
  const [, setTick] = useState(0);

  const { data, isLoading, refetch, isFetching } = trpc.games.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  // Update countdown timers every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => setTick(c => c + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const toggleTournament = useCallback((name: string) => {
    setCollapsedTournaments(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      saveCollapsedTournaments(next);
      return next;
    });
  }, []);

  const games: Game[] = useMemo(() => data?.games || [], [data]);
  const biggestWinId = useMemo(() => findBiggestWin(games), [games]);

  // Venue coordinates per tournament (from the server registry) for forecasts.
  const venuesByName = useMemo(() => {
    const map = new Map<string, Venue>();
    for (const t of data?.tournaments ?? []) {
      if (t.venue) map.set(t.name, t.venue);
    }
    return map;
  }, [data]);

  // Group games by tournament (using ID prefix pattern from scraper)
  const tournamentGroups = useMemo(() => {
    return TOURNAMENT_META.map(meta => {
      const prefix = meta.name.replace(/\s/g, '-').toLowerCase();
      const tournGames = games.filter(g => g.id.startsWith(prefix));
      const sorted = sortGames(tournGames);
      const status = getTournamentStatus(tournGames);
      const completed = tournGames.filter(g => g.status === 'completed');
      const wins = completed.filter(g => g.legacyWon === true).length;
      const losses = completed.filter(g => g.legacyWon === false).length;
      const liveCount = tournGames.filter(g => g.status === 'live').length;

      return {
        ...meta,
        games: sorted,
        status,
        wins,
        losses,
        liveCount,
        totalGames: tournGames.length,
        venue: venuesByName.get(meta.name),
      };
    }).filter(t => t.totalGames > 0);
  }, [games, venuesByName]);

  const liveCount = useMemo(() => games.filter(g => g.status === 'live').length, [games]);

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="as-fade-in">
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, padding: '0 4px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 className="font-display" style={{ fontSize: 20, color: 'var(--as-text-primary)', margin: 0 }}>
            LIVE SCORES
          </h2>
          {liveCount > 0 && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '3px 10px', borderRadius: 999,
              backgroundColor: 'var(--as-live-soft)', color: 'var(--as-live)',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
            }}>
              <span className="live-dot" />
              {liveCount} LIVE
            </span>
          )}
        </div>
        <button
          onClick={() => refetch()}
          className="as-press"
          aria-label="Refresh scores"
          style={{
            width: 44, height: 44, borderRadius: 10, border: 'none',
            backgroundColor: 'var(--as-bg-tertiary)',
            color: 'var(--as-text-tertiary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={15} strokeWidth={2} style={{
            transition: 'transform 0.3s ease',
            transform: isFetching ? 'rotate(180deg)' : 'rotate(0deg)',
          }} />
        </button>
      </div>

      {/* Last updated */}
      {data?.lastUpdated && (
        <p style={{ fontSize: 11, color: 'var(--as-text-tertiary)', margin: '0 0 16px 4px' }}>
          Updated {new Date(data.lastUpdated).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}
          {data.cached ? ' · cached' : ''}
        </p>
      )}

      {/* No games state */}
      {games.length === 0 && (
        <div className="as-fade-in" style={{
          textAlign: 'center', padding: '48px 24px', borderRadius: 12,
          backgroundColor: 'var(--as-bg-card)', border: '1px solid var(--as-border-default)',
        }}>
          <Clock size={32} strokeWidth={1.5} style={{ color: 'var(--as-text-tertiary)', margin: '0 auto 12px' }} />
          <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--as-text-secondary)', margin: '0 0 4px' }}>
            No games scheduled
          </p>
          <p style={{ fontSize: 13, color: 'var(--as-text-tertiary)', margin: 0 }}>
            Check back when the next tournament begins
          </p>
        </div>
      )}

      {/* Tournament Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tournamentGroups.map((tournament, tIdx) => {
          const isCollapsed = collapsedTournaments.has(tournament.name);
          const pillClass = getPillClass(tournament.status, tournament.result);
          const pillLabel = getPillLabel(tournament.status, tournament.result);
          const isChampion = tournament.result?.toLowerCase().includes('champion');

          return (
            <div key={tournament.name} className={`as-fade-in as-stagger-${Math.min(tIdx + 1, 10)}`}>
              {/* Tournament Header */}
              <button
                onClick={() => toggleTournament(tournament.name)}
                className={`as-tourney ${!isCollapsed ? 'expanded' : ''} ${isChampion ? 'as-champ-glow' : ''}`}
                aria-expanded={!isCollapsed}
                aria-controls={`tournament-${tIdx}`}
                style={{
                  width: '100%', textAlign: 'left', fontFamily: 'inherit',
                  cursor: 'pointer',
                  borderLeft: `4px solid ${
                    tournament.status === 'live' ? 'var(--as-live)' :
                    isChampion ? '#FFD700' :
                    tournament.result?.toLowerCase().includes('finalist') ? 'var(--as-team-primary)' :
                    tournament.result?.toLowerCase().includes('final four') ? 'var(--as-accent)' :
                    'var(--as-border-default)'
                  }`,
                }}
              >
                {/* Title row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                    <ChevronDown
                      size={14} strokeWidth={2.5}
                      style={{
                        color: 'var(--as-text-tertiary)', flexShrink: 0,
                        transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                        transition: 'transform 200ms ease-out',
                      }}
                    />
                    <span className="font-display" style={{
                      fontSize: 14, color: 'var(--as-text-primary)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {tournament.name}
                    </span>
                    {tournament.liveCount > 0 && <span className="live-dot" style={{ width: 6, height: 6 }} />}
                  </div>
                  <span className={`as-tourney-pill ${pillClass}`}>
                    {pillLabel}
                  </span>
                </div>

                {/* Meta row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, marginLeft: 22 }}>
                  <span style={{ fontSize: 12, color: 'var(--as-text-tertiary)' }}>
                    {tournament.dates}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--as-text-tertiary)' }}>·</span>
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: tournament.wins > tournament.losses ? 'var(--as-success)' :
                           tournament.wins < tournament.losses ? 'var(--as-danger)' :
                           'var(--as-text-secondary)',
                  }}>
                    {tournament.wins}–{tournament.losses}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--as-text-tertiary)' }}>
                    ({tournament.totalGames} games)
                  </span>
                </div>
              </button>

              {/* Games — collapsible */}
              <div
                id={`tournament-${tIdx}`}
                className="as-collapsible"
                data-open={!isCollapsed ? 'true' : 'false'}
              >
                <div className="as-collapsible-inner">
                  <div style={{ paddingTop: 6, paddingLeft: 4, paddingRight: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {tournament.games.map((game, idx) => (
                      <GameRow
                        key={game.id}
                        game={game}
                        isBiggestWin={game.id === biggestWinId}
                        staggerIndex={idx}
                        venue={tournament.venue}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Game Row (broadcast game log pattern) ─── */
function GameRow({ game, isBiggestWin, staggerIndex, venue }: {
  game: Game; isBiggestWin: boolean; staggerIndex: number; venue?: Venue;
}) {
  const isLegacy = game.isLegacyHome;
  const legacyScore = isLegacy ? game.homeScore : game.awayScore;
  const opponentScore = isLegacy ? game.awayScore : game.homeScore;
  const opponent = isLegacy ? game.awayTeam : game.homeTeam;

  const isLive = game.status === 'live';
  const isCountdown = game.status === 'countdown';
  const isCompleted = game.status === 'completed';

  const railTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
  };

  // Completed game — broadcast game log grid
  if (isCompleted && legacyScore !== null && opponentScore !== null) {
    const won = game.legacyWon;
    return (
      <div
        className={`as-glog as-fade-in as-stagger-${Math.min(staggerIndex + 1, 10)} ${isBiggestWin ? 'as-champ-glow' : ''}`}
        style={isBiggestWin ? { background: 'rgba(255,215,0,0.04)' } : undefined}
      >
        {/* Result badge */}
        <div className={`as-glog-result ${won ? 'W' : 'L'}`}>
          {won ? 'W' : 'L'}
        </div>

        {/* Middle: opponent + date */}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--as-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {opponent}
            </span>
            {isBiggestWin && (
              <span className="as-champ-badge" style={{ marginLeft: 4, fontSize: 8, padding: '1px 5px' }}>
                BIGGEST WIN
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 11, color: 'var(--as-text-tertiary)' }}>
              {new Date(game.gameTime).toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
                timeZone: 'America/New_York',
              })}
            </span>
            {game.court && (
              <span style={{ fontSize: 11, color: 'var(--as-text-tertiary)' }}>
                · {game.court}
              </span>
            )}
          </div>
        </div>

        {/* Score */}
        <div style={{ textAlign: 'right' }}>
          <span className="as-glog-score" style={{
            color: won ? 'var(--as-success)' : 'var(--as-danger)',
          }}>
            {legacyScore}–{opponentScore}
          </span>
          <div style={{
            fontSize: 10, fontWeight: 700, marginTop: 2,
            color: game.pointDifferential && game.pointDifferential > 0 ? 'var(--as-success)' : 'var(--as-danger)',
          }}>
            {game.pointDifferential !== null && game.pointDifferential > 0 ? '+' : ''}
            {game.pointDifferential}
          </div>
        </div>
      </div>
    );
  }

  // Live / countdown / upcoming game row
  return (
    <div
      className={`as-fade-in as-stagger-${Math.min(staggerIndex + 1, 10)}`}
      style={{
        display: 'flex', alignItems: 'center',
        backgroundColor: 'var(--as-bg-card)',
        borderRadius: 8,
        border: `1px solid ${isLive ? 'rgba(239, 68, 68, 0.3)' : 'var(--as-border-subtle)'}`,
        borderLeft: `4px solid ${isLive ? 'var(--as-live)' : 'var(--as-team-primary)'}`,
        boxShadow: isLive ? '0 0 12px rgba(239, 68, 68, 0.06)' : 'none',
        overflow: 'hidden',
        minHeight: 44,
      }}
    >
      {/* Time rail */}
      <div style={{
        flexShrink: 0, width: 60, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 1,
        padding: '10px 0',
        borderRight: '1px solid var(--as-border-subtle)',
      }}>
        {isLive ? (
          <>
            <Zap size={13} strokeWidth={2} style={{ color: 'var(--as-live)' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--as-live)', letterSpacing: '0.06em' }}>LIVE</span>
          </>
        ) : isCountdown ? (
          <span className={getUrgencyClass(game.gameTime)} style={{ fontSize: 10, fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>
            {getCountdownText(game.gameTime)}
          </span>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--as-text-tertiary)', textAlign: 'center' }}>
            {railTime(game.gameTime)}
          </span>
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, padding: '8px 12px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--as-text-primary)' }}>
            Aster AAU
          </span>
          <span style={{ fontSize: 12, color: 'var(--as-text-tertiary)' }}>vs</span>
          <span style={{
            fontSize: 13, fontWeight: 500, color: 'var(--as-text-secondary)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {opponent}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
          {isLive && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 999,
              backgroundColor: 'var(--as-live-soft)', color: 'var(--as-live)',
            }}>
              <span style={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: 'var(--as-live)', animation: 'pulse 2s ease-in-out infinite' }} />
              NOW
            </span>
          )}
          {isCountdown && (
            <span className={getUrgencyClass(game.gameTime)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 999,
              backgroundColor: 'var(--as-accent-soft)',
            }}>
              <Clock size={9} strokeWidth={2} />
              {getCountdownText(game.gameTime)}
            </span>
          )}
          {game.court && (
            <span style={{ fontSize: 10, color: 'var(--as-text-tertiary)' }}>
              {game.court}
            </span>
          )}
          <GameWeather latitude={venue?.latitude} longitude={venue?.longitude} gameTime={game.gameTime} />
        </div>
      </div>
    </div>
  );
}
