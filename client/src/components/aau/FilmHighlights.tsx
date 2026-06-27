import { useState } from "react";
import { Film, Play, Trophy, Clock, Maximize2, X } from "lucide-react";
import SectionHeading from "./SectionHeading";
import FilmAiReviewGate from "./FilmAiReviewGate";

// ─── Featured Video ──────────────────────────────────────────────────────────
// "Birdie Buckets" — Finals highlight reel (video/mp4, ~126 MB). Streamed from
// the owner's Google Drive via the direct-download endpoint and played in a
// native HTML5 <video> element (matching the rest of the film room). The file is
// too large to commit to the repo (>100 MB GitHub cap), so it is not self-hosted.
// The Drive file must be shared "Anyone with the link" for the <video> to stream.
const BIRDIE_VIDEO = {
  title: 'Birdie Buckets',
  subtitle: 'Finals Highlights',
  driveFileId: '107ybmw6XvW7WADQQx6VB2-7BA1XXJyeY',
};
const BIRDIE_VIDEO_URL = `https://drive.usercontent.google.com/download?id=${BIRDIE_VIDEO.driveFileId}&export=download&confirm=t`;

// ─── Players — highlights coming soon ────────────────────────────────────────
interface Player {
  number: string;
  name: string;
  role: string;
  color: string;
}

// Per-jersey film is family-private: a parent's film view shows only their own
// child, never another family's kid. Charlie's full reels live in the My Kids
// tab; this team-level strip is filtered to her too (operator-directed 2026-06-26).
const PLAYERS: Player[] = [
  { number: '#5', name: 'Charlie', role: 'Floor General', color: 'var(--as-team-primary)' },
];

const TOURNAMENT_INFO = {
  name: 'ZG NY Hoop Festival',
  date: 'Jun 13–14, 2026',
  result: 'Champions',
};

// ─── Component ───────────────────────────────────────────────────────────────
export default function FilmHighlights() {
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="as-fade-in">
      {/* ─── HEADER ─── */}
      <SectionHeading
        eyebrow="Film Room"
        title="ZG NY Hoop Festival"
        ghostText="FILM"
      />

      {/* North Star pre-gate framing: jersey-not-face + grounded AI review, gated on guardian verify */}
      <FilmAiReviewGate />

      {/* Tournament context bar */}
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
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5,
          backgroundColor: 'var(--as-gold-soft)', color: '#FFD700',
        }}>
          <Trophy size={11} />
          {TOURNAMENT_INFO.result}
        </span>
      </div>

      {/* ─── FEATURED VIDEO: BIRDIE BUCKETS ─── */}
      <div className="as-fade-in as-stagger-2" style={{
        marginBottom: 24,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: 'var(--as-bg-card)',
        border: '1px solid var(--as-border-default)',
      }}>
        {/* Featured label */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid var(--as-border-subtle)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
              padding: '2px 7px', borderRadius: 4,
              backgroundColor: 'var(--as-team-primary-soft)', color: 'var(--as-team-primary)',
            }}>
              FEATURED · FINALS
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--as-text-primary)' }}>
              {BIRDIE_VIDEO.title}
            </span>
          </div>
          {playing && (
            <button
              onClick={() => setExpanded(true)}
              className="as-press"
              aria-label="Expand video"
              title="Expand"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, borderRadius: 6, cursor: 'pointer',
                backgroundColor: 'var(--as-bg-tertiary)',
                border: '1px solid var(--as-border-default)',
              }}
            >
              <Maximize2 size={13} style={{ color: 'var(--as-text-tertiary)' }} />
            </button>
          )}
        </div>

        {/* Video / poster */}
        <div style={{ position: 'relative', aspectRatio: '16/9', backgroundColor: '#000' }}>
          {playing ? (
            <video
              src={BIRDIE_VIDEO_URL}
              title={BIRDIE_VIDEO.title}
              controls
              autoPlay
              playsInline
              preload="metadata"
              style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
            />
          ) : (
            <button
              onClick={() => setPlaying(true)}
              className="as-press"
              aria-label={`Play ${BIRDIE_VIDEO.title}`}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 12, cursor: 'pointer', fontFamily: 'inherit',
                border: 'none',
                background: 'radial-gradient(circle at center, color-mix(in srgb, var(--as-team-primary) 20%, #000) 0%, #000 75%)',
              }}
            >
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'rgba(255,255,255,0.12)',
                backdropFilter: 'blur(6px)',
                border: '2px solid rgba(255,255,255,0.35)',
              }}>
                <Play size={24} fill="white" stroke="white" style={{ marginLeft: 3 }} />
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'white', fontFamily: 'var(--font-display)' }}>
                  {BIRDIE_VIDEO.title}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>
                  {BIRDIE_VIDEO.subtitle} · {TOURNAMENT_INFO.name}
                </div>
              </div>
            </button>
          )}
        </div>
      </div>

      {/* ─── MORE HIGHLIGHTS — COMING SOON ─── */}
      <h3 className="font-display" style={{
        fontSize: 14, color: 'var(--as-text-secondary)', margin: '0 0 12px 4px',
      }}>
        PLAYER HIGHLIGHTS
      </h3>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 8,
      }}>
        {PLAYERS.map((player, i) => (
          <div
            key={player.number}
            className={`as-fade-in as-stagger-${Math.min(i + 1, 10)}`}
            style={{
              borderRadius: 10,
              overflow: 'hidden',
              backgroundColor: 'var(--as-bg-card)',
              border: '1px solid var(--as-border-default)',
            }}
          >
            {/* Coming soon placeholder */}
            <div style={{
              position: 'relative', aspectRatio: '16/9',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'var(--as-bg-tertiary)',
            }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '4px 9px', borderRadius: 999,
                backgroundColor: 'var(--as-bg-card)',
                border: '1px solid var(--as-border-default)',
              }}>
                <Clock size={11} style={{ color: 'var(--as-text-tertiary)' }} />
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--as-text-tertiary)' }}>
                  Coming Soon
                </span>
              </div>
            </div>

            {/* Player info */}
            <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: `color-mix(in srgb, ${player.color} 15%, transparent)`,
                border: `1.5px solid ${player.color}`,
              }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: player.color, fontFamily: 'var(--font-display)' }}>
                  {player.number.replace('#', '')}
                </span>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--as-text-primary)' }}>
                  {player.name}
                </div>
                <div style={{ fontSize: 9, fontWeight: 500, color: 'var(--as-text-tertiary)' }}>
                  {player.role}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

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
          <StatBlock label="Featured" value="1" />
          <StatBlock label="Tournament" value="ZG Finals" />
          <StatBlock label="Result" value="Champions" />
          <StatBlock label="More" value="Soon" />
        </div>
      </div>

      {/* ─── EXPANDED VIDEO MODAL ─── */}
      {expanded && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(8px)',
            padding: 16,
          }}
          onClick={() => setExpanded(false)}
        >
          <div
            style={{
              width: '100%', maxWidth: 900,
              borderRadius: 14, overflow: 'hidden',
              backgroundColor: 'var(--as-bg-card)',
              border: '1px solid var(--as-border-default)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ position: 'relative', aspectRatio: '16/9', backgroundColor: '#000' }}>
              <video
                src={BIRDIE_VIDEO_URL}
                title={BIRDIE_VIDEO.title}
                controls
                autoPlay
                playsInline
                preload="metadata"
                style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#000' }}
              />
              <button
                onClick={() => setExpanded(false)}
                aria-label="Close"
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
          </div>
        </div>
      )}
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
