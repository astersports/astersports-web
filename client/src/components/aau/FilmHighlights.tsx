import { useState, useRef, useMemo, useCallback } from "react";
import { Play, Pause, Star, Film, ChevronRight, Flame, Zap, Target, X, Volume2, VolumeX, BarChart3, ChevronLeft, ChevronDown } from "lucide-react";
import SectionHeading from "./SectionHeading";

// ─── Player Data ────────────────────────────────────────────────────────────
interface Player {
  number: string;
  name: string;
  role: string;
  color: string;
  clipCount: number;
}

const PLAYERS: Player[] = [
  { number: '#5', name: 'Charlie', role: 'Floor General', color: 'var(--as-team-primary)', clipCount: 20 },
  { number: '#24', name: 'Sophia', role: 'Playmaker / Scorer', color: 'var(--as-accent)', clipCount: 11 },
  { number: '#14', name: 'Karina', role: 'Volume Scorer', color: 'var(--as-success)', clipCount: 7 },
  { number: '#15', name: 'Bianca', role: 'Inside Presence', color: '#f59e0b', clipCount: 15 },
  { number: '#4', name: 'Olivia', role: 'Cutter / Finisher', color: '#ec4899', clipCount: 7 },
];

// ─── Clip Data ──────────────────────────────────────────────────────────────
interface Clip {
  id: string;
  videoUrl: string;
  duration: string;
  playType: string;
  aiCaption: string;
}

interface PlayerClips {
  player: string;
  clips: Clip[];
}

const ALL_CLIPS: PlayerClips[] = [
  {
    player: '#5',
    clips: [
      { id: 'c1', videoUrl: '/manus-storage/IMG_8782_2d8e335b.mp4', duration: '0:14', playType: 'Steal & Assist', aiCaption: 'Steals the ball and leads a fast break, delivering an assist for a layup' },
      { id: 'c2', videoUrl: '/manus-storage/IMG_8783_0934c479.mp4', duration: '0:09', playType: 'Fast Break Layup', aiCaption: 'Drives coast-to-coast on the fast break and finishes with a layup' },
      { id: 'c3', videoUrl: '/manus-storage/IMG_8786_30d044da.mp4', duration: '0:19', playType: 'Transition Scoring', aiCaption: 'Pushes pace in transition and converts at the rim' },
      { id: 'c4', videoUrl: '/manus-storage/IMG_87882_8febd3af.mp4', duration: '0:16', playType: 'Drive & Finish', aiCaption: 'Attacks the lane through contact for a contested finish' },
      { id: 'c5', videoUrl: '/manus-storage/IMG_87902_ba87ad51.mp4', duration: '0:21', playType: 'Coast-to-Coast', aiCaption: 'Full-court drive beating multiple defenders for the score' },
      { id: 'c6', videoUrl: '/manus-storage/IMG_8791_fb62836a.mp4', duration: '0:16', playType: 'Fast Break', aiCaption: 'Leads the break and finishes in traffic' },
      { id: 'c7', videoUrl: '/manus-storage/IMG_9054_a4390cc5.mp4', duration: '0:12', playType: 'Transition Attack', aiCaption: 'Pushes the ball up court and attacks the rim' },
      { id: 'c8', videoUrl: '/manus-storage/IMG_9057_8c771e1c.mp4', duration: '0:13', playType: 'Drive & Score', aiCaption: 'Drives left side through the lane for a finish' },
      { id: 'c9', videoUrl: '/manus-storage/IMG_9058_b7e5fbeb.mp4', duration: '0:11', playType: 'Fast Break Finish', aiCaption: 'Converts on the fast break with speed and control' },
      { id: 'c10', videoUrl: '/manus-storage/IMG_9064_fc3e182c.mp4', duration: '0:09', playType: 'Layup', aiCaption: 'Finishes at the rim off the drive' },
      { id: 'c11', videoUrl: '/manus-storage/IMG_9065_ff032ab3.mp4', duration: '0:11', playType: 'Fast Break Layup', aiCaption: 'Dribbles down court on the break and scores' },
      { id: 'c12', videoUrl: '/manus-storage/IMG_9066_a563b0e6.mp4', duration: '0:10', playType: 'Drive & Finish', aiCaption: 'Attacks the basket with an aggressive drive' },
      { id: 'c13', videoUrl: '/manus-storage/IMG_9066_2_659e6772.mp4', duration: '0:09', playType: 'Transition Score', aiCaption: 'Scores in transition with pace and control' },
      { id: 'c14', videoUrl: '/manus-storage/IMG_9073_487d8869.mp4', duration: '0:14', playType: 'Coast-to-Coast', aiCaption: 'Goes end-to-end beating defenders for the layup' },
      { id: 'c15', videoUrl: '/manus-storage/IMG_9074_72084da7.mp4', duration: '0:08', playType: 'Quick Finish', aiCaption: 'Quick attack and finish at the basket' },
      { id: 'c16', videoUrl: '/manus-storage/IMG_9076_62945ce7.mp4', duration: '0:11', playType: 'Drive & Score', aiCaption: 'Drives through the lane and scores' },
      { id: 'c17', videoUrl: '/manus-storage/IMG_9077_a0a78205.mp4', duration: '0:07', playType: 'Fast Break', aiCaption: 'Converts on the fast break with elite speed' },
      { id: 'c18', videoUrl: '/manus-storage/IMG_9079_dcdb99cc.mp4', duration: '0:10', playType: 'Layup', aiCaption: 'Finishes the layup in traffic' },
      { id: 'c19', videoUrl: '/manus-storage/IMG_9103_998e71fd.mp4', duration: '0:08', playType: 'Transition Finish', aiCaption: 'Scores in transition off the steal' },
      { id: 'c20', videoUrl: '/manus-storage/IMG_9108_59e4a795.mp4', duration: '0:17', playType: 'Full-Court Drive', aiCaption: 'Full-court coast-to-coast drive and finish at the rim' },
    ],
  },
  {
    player: '#24',
    clips: [
      { id: 's1', videoUrl: '/manus-storage/IMG_8782_sophia_f03ddb13.mp4', duration: '0:14', playType: 'Drive & Score', aiCaption: 'Attacks the basket and finishes through contact' },
      { id: 's2', videoUrl: '/manus-storage/IMG_8783_sophia_5b7c391a.mp4', duration: '0:09', playType: 'Transition Layup', aiCaption: 'Pushes the ball in transition for a layup' },
      { id: 's3', videoUrl: '/manus-storage/IMG_9053_734010e6.mp4', duration: '0:14', playType: 'Free Throw', aiCaption: 'Steps to the line and converts the free throw' },
      { id: 's4', videoUrl: '/manus-storage/IMG_9054_sophia_d710d0d2.mp4', duration: '0:12', playType: 'Assist', aiCaption: 'Finds the open teammate with a crisp pass for the score' },
      { id: 's5', videoUrl: '/manus-storage/IMG_9067_5e8a395b.mp4', duration: '0:09', playType: 'Fast Break', aiCaption: 'Runs the floor and finishes on the break' },
      { id: 's6', videoUrl: '/manus-storage/IMG_9076_sophia_64d1db39.mp4', duration: '0:11', playType: 'Drive & Finish', aiCaption: 'Drives to the basket and scores through the defense' },
      { id: 's7', videoUrl: '/manus-storage/IMG_9078_d20b7b71.mp4', duration: '0:13', playType: 'And-One Drive', aiCaption: 'Drives to the basket, scores through contact, draws the foul' },
      { id: 's8', videoUrl: '/manus-storage/IMG_9091_370a17e1.mp4', duration: '0:06', playType: 'Putback', aiCaption: 'Crashes the boards and converts the putback' },
      { id: 's9', videoUrl: '/manus-storage/IMG_9092_7dff5899.mp4', duration: '0:07', playType: 'Offensive Rebound', aiCaption: 'Grabs the offensive rebound and puts it back up' },
      { id: 's10', videoUrl: '/manus-storage/IMG_9096_553476b8.mp4', duration: '0:04', playType: 'Quick Score', aiCaption: 'Quick finish off the pass inside' },
      { id: 's11', videoUrl: '/manus-storage/IMG_9103_sophia_b980c9c3.mp4', duration: '0:09', playType: 'Transition Score', aiCaption: 'Scores in transition with court vision and speed' },
    ],
  },
  {
    player: '#14',
    clips: [
      { id: 'k1', videoUrl: '/manus-storage/IMG_87942_a33284ad.mp4', duration: '0:10', playType: 'Three-Pointer', aiCaption: 'Pulls up from deep and drains the three' },
      { id: 'k2', videoUrl: '/manus-storage/IMG_9054_karina_2bbced5f.mp4', duration: '0:12', playType: 'Assist', aiCaption: 'Delivers a pass to a teammate under the basket for the score' },
      { id: 'k3', videoUrl: '/manus-storage/IMG_9061_75568a7e.mp4', duration: '0:10', playType: 'Mid-Range', aiCaption: 'Hits a pull-up jumper from the mid-range' },
      { id: 'k4', videoUrl: '/manus-storage/IMG_9065_karina_bdf4a1c5.mp4', duration: '0:11', playType: 'Fast Break', aiCaption: 'Runs the floor and finishes on the fast break' },
      { id: 'k5', videoUrl: '/manus-storage/IMG_9073_karina_85b4fa60.mp4', duration: '0:09', playType: 'Drive & Score', aiCaption: 'Attacks the rim with an aggressive drive' },
      { id: 'k6', videoUrl: '/manus-storage/IMG_9074_karina_07b08fd6.mp4', duration: '0:08', playType: 'Layup', aiCaption: 'Finishes the layup off the drive' },
      { id: 'k7', videoUrl: '/manus-storage/IMG_9099_5cb4a5b1.mp4', duration: '0:09', playType: 'Scoring Drive', aiCaption: 'Drives through the defense and scores' },
    ],
  },
  {
    player: '#15',
    clips: [
      { id: 'b1', videoUrl: '/manus-storage/IMG_8782_bianca2_54936309.mp4', duration: '0:14', playType: 'Interior Score', aiCaption: 'Finishes inside with strength and body control' },
      { id: 'b2', videoUrl: '/manus-storage/IMG_8786_bianca_4969e9e0.mp4', duration: '0:09', playType: 'Putback', aiCaption: 'Crashes the glass and converts the putback' },
      { id: 'b3', videoUrl: '/manus-storage/IMG_8787_c32edaaf.mp4', duration: '0:15', playType: 'Drive & Layup', aiCaption: 'Drives to the basket and scores a layup' },
      { id: 'b4', videoUrl: '/manus-storage/IMG_87902_bianca_6b034272.mp4', duration: '0:10', playType: 'Free Throw', aiCaption: 'Steps to the line and knocks down the free throw' },
      { id: 'b5', videoUrl: '/manus-storage/IMG_8791_bianca_77aaa546.mp4', duration: '0:13', playType: 'Interior Finish', aiCaption: 'Finishes inside through contact' },
      { id: 'b6', videoUrl: '/manus-storage/IMG_9057_bianca_1cc99175.mp4', duration: '0:13', playType: 'Drive & Score', aiCaption: 'Attacks the lane and finishes at the rim' },
      { id: 'b7', videoUrl: '/manus-storage/IMG_9065_bianca_77e82937.mp4', duration: '0:11', playType: 'Fast Break', aiCaption: 'Runs the floor and converts on the break' },
      { id: 'b8', videoUrl: '/manus-storage/IMG_9066_bianca_810b0717.mp4', duration: '0:08', playType: 'Layup', aiCaption: 'Finishes the layup in traffic' },
      { id: 'b9', videoUrl: '/manus-storage/IMG_9066_bianca_v2_2577e9dd.mp4', duration: '0:10', playType: 'Drive', aiCaption: 'Drives through the defense for the score' },
      { id: 'b10', videoUrl: '/manus-storage/IMG_9074_bianca_44a5c47a.mp4', duration: '0:11', playType: 'Post Move', aiCaption: 'Works in the post and finishes with a strong move' },
      { id: 'b11', videoUrl: '/manus-storage/IMG_9078_ec30de1f.mp4', duration: '0:06', playType: 'Quick Finish', aiCaption: 'Quick finish inside off the pass' },
      { id: 'b12', videoUrl: '/manus-storage/IMG_9078_bianca_70802328.mp4', duration: '0:07', playType: 'Putback', aiCaption: 'Grabs the board and puts it back up' },
      { id: 'b13', videoUrl: '/manus-storage/IMG_9092_bianca_dd357776.mp4', duration: '0:06', playType: 'Offensive Rebound', aiCaption: 'Crashes the offensive glass for the score' },
      { id: 'b14', videoUrl: '/manus-storage/IMG_9097_d4891aab.mp4', duration: '0:06', playType: 'Free Throw', aiCaption: 'Converts from the free throw line' },
      { id: 'b15', videoUrl: '/manus-storage/IMG_9108_bianca_12455098.mp4', duration: '0:17', playType: 'Full Drive', aiCaption: 'Takes it the length of the court for the score' },
    ],
  },
  {
    player: '#4',
    clips: [
      { id: 'o1', videoUrl: '/manus-storage/IMG_8787_olivia_09f220b3.mp4', duration: '0:18', playType: 'Drive & Layup', aiCaption: 'Drives to the basket and scores a layup' },
      { id: 'o2', videoUrl: '/manus-storage/IMG_87902_olivia_6e91a0b9.mp4', duration: '0:14', playType: 'Transition Score', aiCaption: 'Scores in transition off the pass' },
      { id: 'o3', videoUrl: '/manus-storage/IMG_9054_olivia_7e7087a8.mp4', duration: '0:10', playType: 'Cut & Finish', aiCaption: 'Makes a sharp cut and finishes off the pass' },
      { id: 'o4', videoUrl: '/manus-storage/IMG_9073_olivia_ab8f2d41.mp4', duration: '0:14', playType: 'Catch & Score', aiCaption: 'Catches a pass near the basket and scores' },
      { id: 'o5', videoUrl: '/manus-storage/IMG_9074_olivia_6c26e387.mp4', duration: '0:13', playType: 'Offensive Play', aiCaption: 'Finishes a nice offensive sequence' },
      { id: 'o6', videoUrl: '/manus-storage/IMG_9077_olivia_4ea15bb9.mp4', duration: '0:07', playType: 'Quick Finish', aiCaption: 'Quick finish at the rim off the cut' },
      { id: 'o7', videoUrl: '/manus-storage/IMG_9078_olivia_f0388da5.mp4', duration: '0:11', playType: 'Drive & Score', aiCaption: 'Drives and finishes through contact' },
    ],
  },
];

const TOURNAMENT_INFO = {
  name: 'Zero Gravity National Finals',
  date: 'May 30–31, 2026',
  games: '3 Pool Games + Final Four',
};

// ─── Helper: Compute play type breakdown ─────────────────────────────────────
function getPlayBreakdown(clips: Clip[]): { type: string; count: number; pct: number }[] {
  const counts: Record<string, number> = {};
  clips.forEach(c => {
    // Normalize similar play types
    const normalized = normalizePlayType(c.playType);
    counts[normalized] = (counts[normalized] || 0) + 1;
  });
  const total = clips.length;
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

function normalizePlayType(type: string): string {
  const lower = type.toLowerCase();
  if (lower.includes('fast break') || lower.includes('transition')) return 'Transition';
  if (lower.includes('drive') || lower.includes('coast-to-coast') || lower.includes('full drive') || lower.includes('full-court')) return 'Drives';
  if (lower.includes('layup') || lower.includes('finish') || lower.includes('score')) return 'Finishes';
  if (lower.includes('steal') || lower.includes('assist')) return 'Playmaking';
  if (lower.includes('putback') || lower.includes('rebound') || lower.includes('interior') || lower.includes('post')) return 'Inside Game';
  if (lower.includes('three') || lower.includes('mid-range') || lower.includes('jumper')) return 'Shooting';
  if (lower.includes('free throw')) return 'Free Throws';
  return 'Other';
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function FilmHighlights() {
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [expandedClip, setExpandedClip] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(true); // Muted by default
  const [showSummary, setShowSummary] = useState(true);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const currentPlayerData = selectedPlayer
    ? PLAYERS.find(p => p.number === selectedPlayer)
    : null;

  const currentClips = useMemo(() => {
    if (!selectedPlayer) return [];
    const playerClips = ALL_CLIPS.find(pc => pc.player === selectedPlayer);
    return playerClips?.clips || [];
  }, [selectedPlayer]);

  const playBreakdown = useMemo(() => getPlayBreakdown(currentClips), [currentClips]);

  const totalClips = ALL_CLIPS.reduce((sum, pc) => sum + pc.clips.length, 0);

  const handlePlayClip = useCallback((clipId: string) => {
    setExpandedClip(clipId);
    // Wait for DOM update then play
    setTimeout(() => {
      const video = videoRefs.current.get(clipId);
      if (video) {
        video.muted = isMuted;
        video.play();
      }
    }, 100);
  }, [isMuted]);

  const handleCloseExpanded = useCallback(() => {
    if (expandedClip) {
      const video = videoRefs.current.get(expandedClip);
      if (video) video.pause();
    }
    setExpandedClip(null);
  }, [expandedClip]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const newVal = !prev;
      // Update all video elements
      videoRefs.current.forEach(video => {
        video.muted = newVal;
      });
      return newVal;
    });
  }, []);

  return (
    <div className="as-fade-in">
      {/* ─── TOURNAMENT HEADER ─── */}
      <SectionHeading
        eyebrow="Film Room"
        title="ZG National Finals"
        ghostText="FILM"
      />

      {/* Tournament context + controls */}
      <div className="as-fade-in as-stagger-1" style={{
        marginBottom: 16,
        padding: '10px 14px',
        borderRadius: 10,
        backgroundColor: 'var(--as-bg-card)',
        border: '1px solid var(--as-border-default)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Film size={13} style={{ color: 'var(--as-team-primary)' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--as-text-primary)' }}>
            {TOURNAMENT_INFO.name}
          </span>
          <span style={{ fontSize: 10, color: 'var(--as-text-tertiary)' }}>
            {TOURNAMENT_INFO.date}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Mute toggle */}
          <button
            onClick={toggleMute}
            className="as-press"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 8px', borderRadius: 6,
              backgroundColor: isMuted ? 'var(--as-bg-tertiary)' : 'color-mix(in srgb, var(--as-team-primary) 15%, transparent)',
              border: `1px solid ${isMuted ? 'var(--as-border-default)' : 'var(--as-team-primary)'}`,
              cursor: 'pointer', fontFamily: 'inherit',
              transition: 'all 150ms ease',
            }}
            title={isMuted ? 'Unmute all videos' : 'Mute all videos'}
          >
            {isMuted ? <VolumeX size={11} style={{ color: 'var(--as-text-tertiary)' }} /> : <Volume2 size={11} style={{ color: 'var(--as-team-primary)' }} />}
            <span style={{ fontSize: 10, fontWeight: 600, color: isMuted ? 'var(--as-text-tertiary)' : 'var(--as-team-primary)' }}>
              {isMuted ? 'Muted' : 'Sound On'}
            </span>
          </button>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
            backgroundColor: 'var(--as-team-primary-soft)',
            color: 'var(--as-team-primary)',
          }}>
            {totalClips} clips
          </span>
        </div>
      </div>

      {/* ─── PLAYER SELECTOR (compact row) ─── */}
      <div className="as-fade-in as-stagger-2" style={{
        display: 'flex',
        gap: 6,
        marginBottom: 16,
        overflowX: 'auto',
        paddingBottom: 4,
      }}>
        {PLAYERS.map((player) => {
          const isSelected = selectedPlayer === player.number;
          return (
            <button
              key={player.number}
              onClick={() => setSelectedPlayer(isSelected ? null : player.number)}
              className="as-press"
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: isSelected
                  ? `2px solid ${player.color}`
                  : '1.5px solid var(--as-border-default)',
                backgroundColor: isSelected
                  ? `color-mix(in srgb, ${player.color} 10%, var(--as-bg-card))`
                  : 'var(--as-bg-card)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all 180ms cubic-bezier(0.23, 1, 0.32, 1)',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: `color-mix(in srgb, ${player.color} 15%, transparent)`,
                border: `1.5px solid ${player.color}`,
              }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: player.color, fontFamily: 'var(--font-display)' }}>
                  {player.number.replace('#', '')}
                </span>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--as-text-primary)' }}>
                  {player.name}
                </div>
                <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--as-text-tertiary)' }}>
                  {player.clipCount} clips
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ─── NO PLAYER SELECTED STATE ─── */}
      {!selectedPlayer && (
        <div className="as-fade-in" style={{
          padding: '32px 20px',
          textAlign: 'center',
          borderRadius: 14,
          backgroundColor: 'var(--as-bg-card)',
          border: '1px solid var(--as-border-default)',
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, margin: '0 auto 12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'var(--as-team-primary-soft)',
          }}>
            <Film size={22} style={{ color: 'var(--as-team-primary)' }} />
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--as-text-primary)', margin: '0 0 6px', fontFamily: 'var(--font-display)' }}>
            Select a Player
          </h3>
          <p style={{ fontSize: 12, color: 'var(--as-text-tertiary)', margin: 0, maxWidth: 260, marginInline: 'auto' }}>
            Tap a player above to view their highlight clips from the ZG National Finals.
          </p>
        </div>
      )}

      {/* ─── PLAYER CLIPS VIEW ─── */}
      {selectedPlayer && currentPlayerData && (
        <div className="as-fade-in">
          {/* Play Summary Toggle */}
          <button
            onClick={() => setShowSummary(!showSummary)}
            className="as-press"
            style={{
              width: '100%',
              marginBottom: 12,
              padding: '10px 14px',
              borderRadius: 10,
              backgroundColor: `color-mix(in srgb, ${currentPlayerData.color} 5%, var(--as-bg-card))`,
              border: `1px solid color-mix(in srgb, ${currentPlayerData.color} 15%, var(--as-border-default))`,
              cursor: 'pointer',
              fontFamily: 'inherit',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              transition: 'all 150ms ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart3 size={13} style={{ color: currentPlayerData.color }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--as-text-primary)' }}>
                {currentPlayerData.name} — Play Breakdown
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                backgroundColor: `color-mix(in srgb, ${currentPlayerData.color} 15%, transparent)`,
                color: currentPlayerData.color,
              }}>
                {currentClips.length} plays
              </span>
            </div>
            <ChevronDown size={14} style={{
              color: 'var(--as-text-tertiary)',
              transform: showSummary ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 200ms ease',
            }} />
          </button>

          {/* Play Summary Panel */}
          {showSummary && (
            <div className="as-fade-in" style={{
              marginBottom: 16,
              padding: '12px 14px',
              borderRadius: 10,
              backgroundColor: 'var(--as-bg-card)',
              border: '1px solid var(--as-border-default)',
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {playBreakdown.map(({ type, count, pct }) => (
                  <div key={type} style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    backgroundColor: 'var(--as-bg-tertiary)',
                    border: '1px solid var(--as-border-default)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: currentPlayerData.color }}>
                      {count}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--as-text-secondary)' }}>
                      {type}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--as-text-tertiary)' }}>
                      {pct}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── COMPACT THUMBNAIL GRID ─── */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 8,
          }}>
            {currentClips.map((clip, i) => {
              const isExpanded = expandedClip === clip.id;
              return (
                <div
                  key={clip.id}
                  className={`as-fade-in as-stagger-${Math.min(i + 1, 10)}`}
                  style={{
                    borderRadius: 10,
                    overflow: 'hidden',
                    backgroundColor: 'var(--as-bg-card)',
                    border: isExpanded
                      ? `2px solid ${currentPlayerData.color}`
                      : '1px solid var(--as-border-default)',
                    cursor: 'pointer',
                    transition: 'all 180ms cubic-bezier(0.23, 1, 0.32, 1)',
                  }}
                  onClick={() => !isExpanded && handlePlayClip(clip.id)}
                >
                  {/* Thumbnail / Video */}
                  <div style={{ position: 'relative', aspectRatio: '16/9', backgroundColor: '#000' }}>
                    {isExpanded ? (
                      <video
                        ref={(el) => { if (el) videoRefs.current.set(clip.id, el); }}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        controls
                        autoPlay
                        muted={isMuted}
                        preload="auto"
                        playsInline
                        onEnded={() => setExpandedClip(null)}
                      >
                        <source src={clip.videoUrl} type="video/mp4" />
                      </video>
                    ) : (
                      <>
                        <video
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          preload="metadata"
                          muted
                          playsInline
                        >
                          <source src={clip.videoUrl + '#t=1'} type="video/mp4" />
                        </video>
                        {/* Play overlay */}
                        <div style={{
                          position: 'absolute', inset: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.6) 100%)',
                        }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            backgroundColor: 'rgba(255,255,255,0.15)',
                            backdropFilter: 'blur(4px)',
                            border: '1.5px solid rgba(255,255,255,0.3)',
                          }}>
                            <Play size={14} fill="white" stroke="white" style={{ marginLeft: 1 }} />
                          </div>
                        </div>
                        {/* Duration badge */}
                        <div style={{
                          position: 'absolute', bottom: 4, right: 4,
                          padding: '2px 5px', borderRadius: 4,
                          backgroundColor: 'rgba(0,0,0,0.8)', color: 'white',
                          fontSize: 9, fontWeight: 600, pointerEvents: 'none',
                        }}>
                          {clip.duration}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Clip info */}
                  <div style={{ padding: '7px 9px' }}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      marginBottom: 2,
                    }}>
                      <Zap size={8} style={{ color: currentPlayerData.color }} />
                      <span style={{ fontSize: 10, fontWeight: 700, color: currentPlayerData.color }}>
                        {clip.playType}
                      </span>
                    </div>
                    {isExpanded && (
                      <p style={{ fontSize: 10, lineHeight: 1.4, color: 'var(--as-text-tertiary)', margin: '4px 0 0' }}>
                        {clip.aiCaption}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── EXPANDED VIDEO MODAL ─── */}
      {expandedClip && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(8px)',
            padding: 16,
          }}
          onClick={handleCloseExpanded}
        >
          <div
            style={{
              width: '100%', maxWidth: 720,
              borderRadius: 14, overflow: 'hidden',
              backgroundColor: 'var(--as-bg-card)',
              border: '1px solid var(--as-border-default)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Video */}
            <div style={{ position: 'relative', aspectRatio: '16/9', backgroundColor: '#000' }}>
              <video
                ref={(el) => { if (el) videoRefs.current.set(expandedClip + '-modal', el); }}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                controls
                autoPlay
                muted={isMuted}
                playsInline
                onEnded={handleCloseExpanded}
              >
                <source src={currentClips.find(c => c.id === expandedClip)?.videoUrl} type="video/mp4" />
              </video>
              {/* Close button */}
              <button
                onClick={handleCloseExpanded}
                style={{
                  position: 'absolute', top: 8, right: 8,
                  width: 28, height: 28, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: 'rgba(0,0,0,0.6)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer',
                }}
              >
                <X size={14} style={{ color: 'white' }} />
              </button>
            </div>
            {/* Caption */}
            {(() => {
              const clip = currentClips.find(c => c.id === expandedClip);
              if (!clip) return null;
              return (
                <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    padding: '4px 8px', borderRadius: 6,
                    backgroundColor: currentPlayerData ? `color-mix(in srgb, ${currentPlayerData.color} 15%, transparent)` : 'var(--as-bg-tertiary)',
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: currentPlayerData?.color || 'var(--as-text-primary)' }}>
                      {clip.playType}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--as-text-secondary)' }}>
                    {clip.aiCaption}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ─── STATS FOOTER ─── */}
      <div className="as-fade-in as-stagger-7" style={{
        marginTop: 20, padding: '12px 14px', borderRadius: 10,
        backgroundColor: 'var(--as-bg-card)',
        border: '1px solid var(--as-border-default)',
      }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--as-text-tertiary)', display: 'block', marginBottom: 10 }}>
          FILM ROOM STATS
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 8 }}>
          <StatBlock label="Total Clips" value={String(totalClips)} />
          <StatBlock label="Players" value="5" />
          <StatBlock label="Tournament" value="ZG Finals" />
          <StatBlock label="Format" value="HD MP4" />
          <StatBlock label="AI Analyzed" value="100%" />
        </div>
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--as-text-primary)', fontFamily: 'var(--font-display)' }}>
        {value}
      </div>
      <div style={{ fontSize: 8, fontWeight: 500, color: 'var(--as-text-tertiary)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
