import { useState, useRef, useMemo } from "react";
import { Play, Pause, Star, Film, ChevronRight, Flame, Zap, Target } from "lucide-react";
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

// ─── Component ───────────────────────────────────────────────────────────────
export default function FilmHighlights() {
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [activeClip, setActiveClip] = useState<string | null>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());

  const currentPlayerData = selectedPlayer
    ? PLAYERS.find(p => p.number === selectedPlayer)
    : null;

  const currentClips = useMemo(() => {
    if (!selectedPlayer) return [];
    const playerClips = ALL_CLIPS.find(pc => pc.player === selectedPlayer);
    return playerClips?.clips || [];
  }, [selectedPlayer]);

  const totalClips = ALL_CLIPS.reduce((sum, pc) => sum + pc.clips.length, 0);

  const handlePlayClip = (clipId: string) => {
    // Pause any currently playing video
    if (activeClip && activeClip !== clipId) {
      const prevVideo = videoRefs.current.get(activeClip);
      if (prevVideo) prevVideo.pause();
    }
    setActiveClip(clipId);
    const video = videoRefs.current.get(clipId);
    if (video) {
      video.play();
    }
  };

  const handlePauseClip = (clipId: string) => {
    const video = videoRefs.current.get(clipId);
    if (video) video.pause();
    setActiveClip(null);
  };

  return (
    <div className="as-fade-in">
      {/* ─── TOURNAMENT HEADER ─── */}
      <SectionHeading
        eyebrow="Film Room"
        title="ZG National Finals"
        ghostText="FILM"
      />

      {/* Tournament context badge */}
      <div className="as-fade-in as-stagger-1" style={{
        marginBottom: 20,
        padding: '12px 16px',
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
          <Film size={14} style={{ color: 'var(--as-team-primary)' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--as-text-primary)' }}>
            {TOURNAMENT_INFO.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--as-text-tertiary)' }}>
            {TOURNAMENT_INFO.date}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
            backgroundColor: 'var(--as-team-primary-soft)',
            color: 'var(--as-team-primary)',
          }}>
            {totalClips} clips
          </span>
        </div>
      </div>

      {/* ─── PLAYER SELECTOR ─── */}
      <div className="as-fade-in as-stagger-2" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 8,
        marginBottom: 24,
      }}>
        {PLAYERS.map((player) => {
          const isSelected = selectedPlayer === player.number;
          return (
            <button
              key={player.number}
              onClick={() => setSelectedPlayer(isSelected ? null : player.number)}
              className="as-press"
              style={{
                padding: '14px 12px',
                borderRadius: 12,
                border: isSelected
                  ? `2px solid ${player.color}`
                  : '1.5px solid var(--as-border-default)',
                backgroundColor: isSelected
                  ? `color-mix(in srgb, ${player.color} 10%, var(--as-bg-card))`
                  : 'var(--as-bg-card)',
                cursor: 'pointer',
                textAlign: 'center',
                fontFamily: 'inherit',
                transition: 'all 180ms cubic-bezier(0.23, 1, 0.32, 1)',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* Active indicator bar */}
              {isSelected && (
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 3,
                  backgroundColor: player.color,
                }} />
              )}

              <div style={{
                width: 36, height: 36, borderRadius: 10, margin: '0 auto 8px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: `color-mix(in srgb, ${player.color} 15%, transparent)`,
                border: `1.5px solid ${player.color}`,
              }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: player.color, fontFamily: 'var(--font-display)' }}>
                  {player.number.replace('#', '')}
                </span>
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--as-text-primary)', marginBottom: 2 }}>
                {player.name}
              </div>
              <div style={{ fontSize: 10, fontWeight: 500, color: player.color, marginBottom: 6 }}>
                {player.role}
              </div>
              <div style={{
                fontSize: 10, fontWeight: 600, color: 'var(--as-text-tertiary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}>
                <Film size={9} />
                {player.clipCount} clips
              </div>
            </button>
          );
        })}
      </div>

      {/* ─── NO PLAYER SELECTED STATE ─── */}
      {!selectedPlayer && (
        <div className="as-fade-in" style={{
          padding: '40px 20px',
          textAlign: 'center',
          borderRadius: 14,
          backgroundColor: 'var(--as-bg-card)',
          border: '1px solid var(--as-border-default)',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, margin: '0 auto 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'var(--as-team-primary-soft)',
          }}>
            <Film size={24} style={{ color: 'var(--as-team-primary)' }} />
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--as-text-primary)', margin: '0 0 8px', fontFamily: 'var(--font-display)' }}>
            Select a Player
          </h3>
          <p style={{ fontSize: 13, color: 'var(--as-text-tertiary)', margin: 0, maxWidth: 280, marginInline: 'auto' }}>
            Tap a player above to view their individual highlight clips from the ZG National Finals.
          </p>
        </div>
      )}

      {/* ─── PLAYER CLIPS VIEW ─── */}
      {selectedPlayer && currentPlayerData && (
        <div className="as-fade-in">
          {/* Player header */}
          <div style={{
            marginBottom: 16,
            padding: '16px 18px',
            borderRadius: 12,
            backgroundColor: `color-mix(in srgb, ${currentPlayerData.color} 6%, var(--as-bg-card))`,
            border: `1px solid color-mix(in srgb, ${currentPlayerData.color} 20%, var(--as-border-default))`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: `color-mix(in srgb, ${currentPlayerData.color} 18%, transparent)`,
                  border: `2px solid ${currentPlayerData.color}`,
                }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: currentPlayerData.color, fontFamily: 'var(--font-display)' }}>
                    {currentPlayerData.number.replace('#', '')}
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--as-text-primary)', fontFamily: 'var(--font-display)' }}>
                    {currentPlayerData.name}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: currentPlayerData.color }}>
                    {currentPlayerData.role}
                  </div>
                </div>
              </div>
              <div style={{
                padding: '6px 10px', borderRadius: 8,
                backgroundColor: `color-mix(in srgb, ${currentPlayerData.color} 12%, transparent)`,
                display: 'flex', alignItems: 'center', gap: 5,
              }}>
                <Flame size={12} style={{ color: currentPlayerData.color }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: currentPlayerData.color }}>
                  {currentClips.length}
                </span>
              </div>
            </div>
          </div>

          {/* Clips grid */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {currentClips.map((clip, i) => {
              const isActive = activeClip === clip.id;
              return (
                <div
                  key={clip.id}
                  className={`as-fade-in as-stagger-${Math.min(i + 1, 10)}`}
                  style={{
                    borderRadius: 12,
                    overflow: 'hidden',
                    backgroundColor: 'var(--as-bg-card)',
                    border: isActive
                      ? `1.5px solid ${currentPlayerData.color}`
                      : '1px solid var(--as-border-default)',
                    transition: 'border-color 200ms ease',
                  }}
                >
                  {/* Video container */}
                  <div style={{ position: 'relative', aspectRatio: '16/9', backgroundColor: '#000' }}>
                    <video
                      ref={(el) => { if (el) videoRefs.current.set(clip.id, el); }}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      controls
                      preload="metadata"
                      playsInline
                      onPlay={() => setActiveClip(clip.id)}
                      onPause={() => { if (activeClip === clip.id) setActiveClip(null); }}
                      onEnded={() => setActiveClip(null)}
                    >
                      <source src={clip.videoUrl} type="video/mp4" />
                    </video>

                    {/* Play/Pause overlay */}
                    {!isActive && (
                      <div
                        onClick={() => handlePlayClip(clip.id)}
                        style={{
                          position: 'absolute', inset: 0,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: 'linear-gradient(180deg, transparent 30%, rgba(0,0,0,0.5) 100%)',
                          cursor: 'pointer',
                          transition: 'opacity 200ms ease',
                        }}
                      >
                        <div style={{
                          width: 48, height: 48, borderRadius: '50%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          backgroundColor: 'rgba(255,255,255,0.12)',
                          backdropFilter: 'blur(6px)',
                          border: '2px solid rgba(255,255,255,0.25)',
                        }}>
                          <Play size={20} fill="white" stroke="white" style={{ marginLeft: 2 }} />
                        </div>
                      </div>
                    )}

                    {/* Duration badge */}
                    <div style={{
                      position: 'absolute', bottom: 8, right: 8,
                      padding: '3px 7px', borderRadius: 5,
                      backgroundColor: 'rgba(0,0,0,0.8)', color: 'white',
                      fontSize: 10, fontWeight: 600, pointerEvents: 'none',
                    }}>
                      {clip.duration}
                    </div>

                    {/* Play type badge */}
                    <div style={{
                      position: 'absolute', top: 8, left: 8,
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '4px 8px', borderRadius: 5,
                      backgroundColor: `color-mix(in srgb, ${currentPlayerData.color} 80%, black)`,
                      color: 'white',
                      fontSize: 10, fontWeight: 700, pointerEvents: 'none',
                    }}>
                      <Zap size={9} fill="white" stroke="white" />
                      {clip.playType}
                    </div>
                  </div>

                  {/* AI Caption */}
                  <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <Target size={12} style={{ color: 'var(--as-text-tertiary)', marginTop: 2, flexShrink: 0 }} />
                    <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--as-text-secondary)', margin: 0 }}>
                      {clip.aiCaption}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── STATS FOOTER ─── */}
      <div className="as-fade-in as-stagger-7" style={{
        marginTop: 24, padding: '16px 18px', borderRadius: 12,
        backgroundColor: 'var(--as-bg-card)',
        border: '1px solid var(--as-border-default)',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--as-text-tertiary)', display: 'block', marginBottom: 12 }}>
          FILM ROOM STATS
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 12 }}>
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
      <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--as-text-primary)', fontFamily: 'var(--font-display)' }}>
        {value}
      </div>
      <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--as-text-tertiary)', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
