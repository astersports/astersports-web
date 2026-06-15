import { useState, useRef, useMemo } from "react";
import { Play, Star, Zap, Target, Trophy, Film, Eye } from "lucide-react";
import SectionHeading from "./SectionHeading";

// ─── Player Roster ───────────────────────────────────────────────────────────
interface Player {
  number: string;
  name: string;
  role: string;
  tier: 'star' | 'core';
  color: string;
  skills: string[];
  reelCount: number;
}

const ROSTER: Player[] = [
  { number: '#5', name: 'Charlie', role: 'Floor General', tier: 'star', color: 'var(--as-team-primary)', skills: ['Three-Point Shooting', 'Fast-Break Finishing', 'Court Vision', 'Steals'], reelCount: 5 },
  { number: '#24', name: 'Sofia', role: 'Playmaker / Scorer', tier: 'star', color: 'var(--as-accent)', skills: ['Transition Scoring', 'Assists', 'Offensive Rebounds', 'Putbacks'], reelCount: 5 },
  { number: '#14', name: 'Karina', role: 'Volume Scorer', tier: 'core', color: 'var(--as-success)', skills: ['Three-Pointers', 'Free Throws', 'Fast-Break Layups', 'Mid-Range'], reelCount: 4 },
  { number: '#15', name: 'Bianca', role: 'Inside Presence', tier: 'core', color: '#f59e0b', skills: ['Free Throws', 'Drives', 'Putbacks', 'Interior Scoring'], reelCount: 3 },
  { number: '#4', name: 'Olivia', role: 'Cutter / Finisher', tier: 'core', color: '#ec4899', skills: ['Cutting', 'Finishing', 'Off-Ball Movement'], reelCount: 2 },
];

// ─── Reel Data (AI-analyzed) with tournament grouping ────────────────────────
interface Reel {
  id: number;
  title: string;
  videoUrl: string;
  duration: string;
  players: string[];
  primaryPlayer: string;
  playTypes: string[];
  aiSummary: string;
  standoutMoment: string;
  energy: string;
  tournament: string; // Tournament group key
}

const REELS: Reel[] = [
  {
    id: 1,
    title: 'Scoring Clinic — Full Squad',
    videoUrl: '/manus-storage/video1_2ad89c26.mp4',
    duration: '2:45',
    players: ['#14', '#24', '#5', '#15'],
    primaryPlayer: '#14',
    playTypes: ['Three-Pointers', 'Fast Breaks', 'Assists', 'Drives'],
    aiSummary: 'Karina #14 dominates with deep threes from the wing. Sofia #24 runs the floor as primary playmaker, delivering kick-out assists. Charlie #5 slashes through the lane for aggressive finishes. Set to AC/DC\'s "Thunderstruck."',
    standoutMoment: '#5 drives left side through multiple defenders for a contested layup',
    energy: 'High-octane run-and-gun',
    tournament: 'ZG Chase for the Chain NY',
  },
  {
    id: 2,
    title: 'Empire State of Mind',
    videoUrl: '/manus-storage/video2_6f52edc4.mp4',
    duration: '1:21',
    players: ['#14', '#5', '#24', '#15', '#4'],
    primaryPlayer: '#5',
    playTypes: ['Fast Breaks', 'Free Throws', 'Spin Moves', 'Putbacks'],
    aiSummary: 'Charlie #5 takes over in transition — coast-to-coast fast breaks and a filthy spin move through the lane. Karina #14 showcases free throw consistency. Bianca #15 crashes the boards for putbacks.',
    standoutMoment: '#5 executes a spin move through traffic for a finish at the rim',
    energy: 'NYC energy, fast-paced',
    tournament: 'ZG NY Metro Showdown',
  },
  {
    id: 3,
    title: 'The Connection — #14 × #24',
    videoUrl: '/manus-storage/video3_16877753.mp4',
    duration: '2:22',
    players: ['#14', '#24', '#5', '#15', '#4'],
    primaryPlayer: '#24',
    playTypes: ['Assists', 'Fast Breaks', 'Three-Pointers', 'Putbacks'],
    aiSummary: 'The Karina-Sofia connection on full display. Sofia #24 pushes pace and delivers transition assists. Karina #14 converts from deep. Charlie #5 feeds the break. Olivia #4 finishes a beautiful passing sequence.',
    standoutMoment: 'Sofia grabs an offensive rebound and converts the putback after her own assist',
    energy: 'Unselfish, team-first basketball',
    tournament: 'ZG Rumble for the Ring CT',
  },
  {
    id: 4,
    title: 'Attack Mode',
    videoUrl: '/manus-storage/video4_4935c136.mp4',
    duration: '2:02',
    players: ['#14', '#24', '#15'],
    primaryPlayer: '#14',
    playTypes: ['Drives', 'Layups', 'Free Throws', 'Court Vision'],
    aiSummary: 'Aggressive drives to the basket with contact. Karina #14 pushes pace on fast breaks. Sofia #24 hits a pull-up jumper from the left side. Bianca #15 automatic from the free throw line.',
    standoutMoment: '#14 drives, draws the foul, and converts the free throw',
    energy: 'Physical, downhill attack',
    tournament: 'ZG Girls National Finals',
  },
  {
    id: 5,
    title: 'Steal & Score — Defensive Masterclass',
    videoUrl: '/manus-storage/video5_2778ad74.mp4',
    duration: '1:48',
    players: ['#24', '#5'],
    primaryPlayer: '#24',
    playTypes: ['Steals', 'Fast Breaks', 'Free Throws', 'Rebounds'],
    aiSummary: 'Sofia #24 in a different jersey — anticipating passes, stealing the ball, and going coast-to-coast for unassisted layups. Elite court awareness and speed. Free throw montage showing shooting consistency.',
    standoutMoment: 'Back-to-back steals converted into fast-break layups',
    energy: 'Defensive intensity, transition scoring',
    tournament: 'ZG Girls National Finals',
  },
  {
    id: 6,
    title: 'Charlie Takes Over',
    videoUrl: '/manus-storage/video6_2406e59a.mp4',
    duration: '1:45',
    players: ['#5'],
    primaryPlayer: '#5',
    playTypes: ['Fast Breaks', 'Three-Pointers', 'Free Throws', 'Coast-to-Coast'],
    aiSummary: 'Charlie #5 showcase reel — opening with a confident free throw, then hitting from deep near the three-point line. Multiple coast-to-coast fast breaks showing elite speed and finishing ability.',
    standoutMoment: '#5 hits a deep three then immediately goes coast-to-coast on the next possession',
    energy: 'Speed, range, takeover mode',
    tournament: 'ZG NY Hoop Festival',
  },
];

// Tournament display order (newest first)
const TOURNAMENT_ORDER = [
  'ZG NY Hoop Festival',
  'ZG Girls National Finals',
  'ZG Rumble for the Ring CT',
  'ZG NY Metro Showdown',
  'ZG Chase for the Chain NY',
];

const TOURNAMENT_GHOST: Record<string, string> = {
  'ZG NY Hoop Festival': 'HOOP',
  'ZG Girls National Finals': 'FINALS',
  'ZG Rumble for the Ring CT': 'RUMBLE',
  'ZG NY Metro Showdown': 'METRO',
  'ZG Chase for the Chain NY': 'CHAIN',
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function FilmHighlights() {
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [activeReel, setActiveReel] = useState<number | null>(null);
  const videoRefs = useRef<Map<number, HTMLVideoElement>>(new Map());

  const filteredReels = selectedPlayer
    ? REELS.filter(r => r.players.includes(selectedPlayer))
    : REELS;

  const stars = ROSTER.filter(p => p.tier === 'star');
  const core = ROSTER.filter(p => p.tier === 'core');

  // Group filtered reels by tournament
  const groupedReels = useMemo(() => {
    const groups: { tournament: string; reels: Reel[] }[] = [];
    for (const tName of TOURNAMENT_ORDER) {
      const reels = filteredReels.filter(r => r.tournament === tName);
      if (reels.length > 0) {
        groups.push({ tournament: tName, reels });
      }
    }
    return groups;
  }, [filteredReels]);

  const handlePlayReel = (reelId: number) => {
    setActiveReel(reelId);
    const video = videoRefs.current.get(reelId);
    if (video) {
      video.play();
    }
  };

  return (
    <div className="as-fade-in">
      {/* ─── FEATURED DUO HERO ─── */}
      <div className="as-fade-in as-stagger-1" style={{
        marginBottom: 28,
        borderRadius: 16,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, rgba(167,139,250,0.08) 0%, rgba(74,143,212,0.08) 100%)',
        border: '1px solid var(--as-border-default)',
        position: 'relative',
      }}>
        {/* Gradient accent bar */}
        <div style={{
          height: 3,
          background: 'linear-gradient(90deg, var(--as-team-primary), var(--as-accent))',
        }} />

        <div style={{ padding: '24px 20px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <Star size={14} fill="var(--as-team-primary)" stroke="var(--as-team-primary)" />
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--as-team-primary)' }}>
              FEATURED PLAYERS
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {stars.map((player) => (
              <button
                key={player.number}
                onClick={() => setSelectedPlayer(selectedPlayer === player.number ? null : player.number)}
                className="as-press"
                style={{
                  padding: '16px 14px',
                  borderRadius: 12,
                  border: selectedPlayer === player.number
                    ? `2px solid ${player.color}`
                    : '2px solid var(--as-border-default)',
                  backgroundColor: selectedPlayer === player.number
                    ? `color-mix(in srgb, ${player.color} 8%, var(--as-bg-card))`
                    : 'var(--as-bg-card)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  transition: 'all 200ms cubic-bezier(0.23, 1, 0.32, 1)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: `color-mix(in srgb, ${player.color} 15%, transparent)`,
                    border: `1.5px solid ${player.color}`,
                  }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: player.color, fontFamily: 'var(--font-display)' }}>
                      {player.number.replace('#', '')}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--as-text-primary)' }}>
                      {player.name}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 500, color: player.color }}>
                      {player.role}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {player.skills.slice(0, 3).map(skill => (
                    <span key={skill} style={{
                      fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                      backgroundColor: `color-mix(in srgb, ${player.color} 10%, transparent)`,
                      color: player.color, letterSpacing: '0.02em',
                    }}>
                      {skill}
                    </span>
                  ))}
                </div>
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Film size={10} style={{ color: 'var(--as-text-tertiary)' }} />
                  <span style={{ fontSize: 10, color: 'var(--as-text-tertiary)', fontWeight: 500 }}>
                    {player.reelCount} reels
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── CORE PLAYERS ROW ─── */}
      <div className="as-fade-in as-stagger-2" style={{ marginBottom: 24 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--as-text-tertiary)', display: 'block', marginBottom: 10, padding: '0 4px' }}>
          CORE ROSTER
        </span>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto' }} className="as-no-scrollbar">
          {core.map((player) => (
            <button
              key={player.number}
              onClick={() => setSelectedPlayer(selectedPlayer === player.number ? null : player.number)}
              className="as-press"
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: selectedPlayer === player.number
                  ? `1.5px solid ${player.color}`
                  : '1.5px solid var(--as-border-default)',
                backgroundColor: selectedPlayer === player.number
                  ? `color-mix(in srgb, ${player.color} 8%, var(--as-bg-card))`
                  : 'var(--as-bg-card)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 8,
                transition: 'all 200ms cubic-bezier(0.23, 1, 0.32, 1)',
                minHeight: 44,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 800, color: player.color, fontFamily: 'var(--font-display)' }}>
                {player.number}
              </span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--as-text-primary)' }}>{player.name}</div>
                <div style={{ fontSize: 10, color: 'var(--as-text-tertiary)' }}>{player.role}</div>
              </div>
            </button>
          ))}
          {selectedPlayer && (
            <button
              onClick={() => setSelectedPlayer(null)}
              className="as-press"
              style={{
                padding: '10px 14px', borderRadius: 10,
                border: '1.5px solid var(--as-danger)',
                backgroundColor: 'color-mix(in srgb, var(--as-danger) 8%, var(--as-bg-card))',
                cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 11, fontWeight: 600, color: 'var(--as-danger)',
                whiteSpace: 'nowrap', minHeight: 44,
              }}
            >
              Clear Filter
            </button>
          )}
        </div>
      </div>

      {/* ─── FILTER INDICATOR ─── */}
      {selectedPlayer && (
        <div className="as-fade-in" style={{
          marginBottom: 16, padding: '8px 12px', borderRadius: 8,
          backgroundColor: 'var(--as-bg-tertiary)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Eye size={12} style={{ color: 'var(--as-text-tertiary)' }} />
          <span style={{ fontSize: 12, color: 'var(--as-text-secondary)' }}>
            Showing <strong style={{ color: ROSTER.find(p => p.number === selectedPlayer)?.color }}>
              {ROSTER.find(p => p.number === selectedPlayer)?.name} {selectedPlayer}
            </strong> reels · {filteredReels.length} of {REELS.length}
          </span>
        </div>
      )}

      {/* ─── TOURNAMENT-GROUPED FILM ─── */}
      {groupedReels.map((group, gIdx) => (
        <div key={group.tournament} className={`as-fade-in as-stagger-${Math.min(gIdx + 1, 5)}`} style={{ marginBottom: 32 }}>
          {/* Tournament section header with ghost text */}
          <SectionHeading
            eyebrow={`${group.reels.length} reel${group.reels.length !== 1 ? 's' : ''}`}
            title={group.tournament.replace('ZG ', '')}
            ghostText={TOURNAMENT_GHOST[group.tournament] || ''}
          />

          {/* Reel cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {group.reels.map((reel, i) => {
              const isActive = activeReel === reel.id;
              const primaryPlayerData = ROSTER.find(p => p.number === reel.primaryPlayer);

              return (
                <div
                  key={reel.id}
                  className={`as-fade-in as-stagger-${Math.min(i + 1, 10)}`}
                  style={{
                    borderRadius: 14,
                    overflow: 'hidden',
                    backgroundColor: 'var(--as-bg-card)',
                    border: isActive
                      ? `1.5px solid ${primaryPlayerData?.color || 'var(--as-border-default)'}`
                      : '1px solid var(--as-border-default)',
                    transition: 'border-color 200ms ease',
                  }}
                >
                  {/* Video */}
                  <div style={{ position: 'relative', aspectRatio: '16/9', backgroundColor: '#000' }}>
                    <video
                      ref={(el) => { if (el) videoRefs.current.set(reel.id, el); }}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      controls
                      preload="metadata"
                      playsInline
                      onPlay={() => setActiveReel(reel.id)}
                      onEnded={() => setActiveReel(null)}
                    >
                      <source src={reel.videoUrl} type="video/mp4" />
                    </video>

                    {/* Play overlay */}
                    {!isActive && (
                      <div
                        onClick={() => handlePlayReel(reel.id)}
                        style={{
                          position: 'absolute', inset: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.6) 100%)',
                          cursor: 'pointer',
                          opacity: 0.9,
                          transition: 'opacity 200ms ease',
                        }}
                      >
                        <div style={{
                          width: 56, height: 56, borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          backgroundColor: 'rgba(255,255,255,0.15)',
                          backdropFilter: 'blur(8px)',
                          border: '2px solid rgba(255,255,255,0.3)',
                        }}>
                          <Play size={24} fill="white" stroke="white" style={{ marginLeft: 3 }} />
                        </div>
                      </div>
                    )}

                    {/* Duration badge */}
                    <div style={{
                      position: 'absolute', bottom: 10, right: 10,
                      padding: '3px 8px', borderRadius: 6,
                      backgroundColor: 'rgba(0,0,0,0.8)', color: 'white',
                      fontSize: 11, fontWeight: 600, pointerEvents: 'none',
                    }}>
                      {reel.duration}
                    </div>

                    {/* Energy badge */}
                    <div style={{
                      position: 'absolute', top: 10, left: 10,
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 8px', borderRadius: 6,
                      backgroundColor: 'rgba(0,0,0,0.8)', color: 'white',
                      fontSize: 10, fontWeight: 600, pointerEvents: 'none',
                    }}>
                      <Zap size={10} fill="var(--as-team-primary)" stroke="var(--as-team-primary)" />
                      {reel.energy}
                    </div>
                  </div>

                  {/* Info */}
                  <div style={{ padding: '14px 16px 16px' }}>
                    {/* Title + primary player */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: 'var(--as-text-primary)', margin: 0 }}>
                        {reel.title}
                      </h4>
                      {primaryPlayerData && (
                        <span style={{
                          fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 5,
                          backgroundColor: `color-mix(in srgb, ${primaryPlayerData.color} 12%, transparent)`,
                          color: primaryPlayerData.color,
                          fontFamily: 'var(--font-display)',
                        }}>
                          {primaryPlayerData.number} {primaryPlayerData.name}
                        </span>
                      )}
                    </div>

                    {/* Player tags */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                      {reel.players.map(num => {
                        const p = ROSTER.find(r => r.number === num);
                        if (!p) return null;
                        return (
                          <span
                            key={num}
                            onClick={() => setSelectedPlayer(selectedPlayer === num ? null : num)}
                            className="as-press"
                            style={{
                              fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 4,
                              backgroundColor: `color-mix(in srgb, ${p.color} 10%, transparent)`,
                              color: p.color, cursor: 'pointer',
                              border: `1px solid color-mix(in srgb, ${p.color} 20%, transparent)`,
                            }}
                          >
                            {p.number} {p.name}
                          </span>
                        );
                      })}
                    </div>

                    {/* Play types */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
                      {reel.playTypes.map(play => (
                        <span key={play} style={{
                          fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 3,
                          backgroundColor: 'var(--as-bg-tertiary)', color: 'var(--as-text-tertiary)',
                          letterSpacing: '0.02em',
                        }}>
                          {play}
                        </span>
                      ))}
                    </div>

                    {/* AI Summary */}
                    <div style={{
                      padding: '10px 12px', borderRadius: 8,
                      backgroundColor: 'var(--as-bg-tertiary)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                        <Target size={10} style={{ color: 'var(--as-text-tertiary)' }} />
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--as-text-tertiary)' }}>
                          AI BREAKDOWN
                        </span>
                      </div>
                      <p style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--as-text-secondary)', margin: '0 0 8px' }}>
                        {reel.aiSummary}
                      </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <Trophy size={10} style={{ color: '#FFD700' }} />
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--as-text-primary)', fontStyle: 'italic' }}>
                          {reel.standoutMoment}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* ─── STATS FOOTER ─── */}
      <div className="as-fade-in as-stagger-7" style={{
        marginTop: 24, padding: '16px 18px', borderRadius: 12,
        backgroundColor: 'var(--as-bg-card)',
        border: '1px solid var(--as-border-default)',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--as-text-tertiary)', display: 'block', marginBottom: 12 }}>
          FILM ROOM STATS
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 12 }}>
          <StatBlock label="Total Reels" value="6" />
          <StatBlock label="Total Runtime" value="12:03" />
          <StatBlock label="Resolution" value="4K" />
          <StatBlock label="Play Types" value="8+" />
          <StatBlock label="Players Featured" value="5" />
        </div>
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--as-text-primary)', fontFamily: 'var(--font-display)' }}>
        {value}
      </div>
      <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--as-text-tertiary)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
