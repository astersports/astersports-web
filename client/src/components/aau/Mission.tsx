import { Star, Target, Users, Award } from "lucide-react";

export default function Mission() {
  return (
    <div className="as-fade-in">
      {/* Header */}
      <div style={{ marginBottom: 20, padding: '0 4px' }}>
        <h2 className="font-display" style={{ fontSize: 20, color: 'var(--as-text-primary)', margin: 0 }}>
          OUR MISSION
        </h2>
      </div>

      {/* Philosophy statement — blockquote */}
      <blockquote className="as-fade-in as-stagger-1" style={{
        padding: '20px 24px', borderRadius: 12, marginBottom: 24, margin: '0 0 24px',
        backgroundColor: 'var(--as-bg-card)',
        borderLeft: '4px solid var(--as-team-primary)',
        boxShadow: 'var(--as-shadow-sm)',
        fontSize: 16, lineHeight: 1.7, color: 'var(--as-text-primary)', fontWeight: 400,
      }}>
        Aster AAU develops competitive young athletes through high-level basketball training,
        tournament competition, and team-first culture. We believe in building players who are
        skilled, disciplined, and fearless on the court.
      </blockquote>

      {/* Core values — 2x2 grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 12, marginBottom: 24,
      }}>
        <ValueCard
          icon={<Target size={18} strokeWidth={2} />}
          title="Compete at the Highest Level"
          description="We play in the Zero Gravity AAU circuit — one of the most competitive in the Northeast. Our girls face top-tier opponents every weekend and rise to the challenge."
          accent="var(--as-accent)"
          delay={1}
        />
        <ValueCard
          icon={<Users size={18} strokeWidth={2} />}
          title="Team-First Culture"
          description="Individual talent wins games. Team chemistry wins championships. We develop players who make their teammates better through passing, communication, and effort."
          accent="var(--as-team-primary)"
          delay={2}
        />
        <ValueCard
          icon={<Star size={18} strokeWidth={2} />}
          title="Skill Development"
          description="Three practices per week focused on fundamentals: ball handling, shooting mechanics, defensive positioning, and game IQ. We build complete players."
          accent="var(--as-success)"
          delay={3}
        />
        <ValueCard
          icon={<Award size={18} strokeWidth={2} />}
          title="Nationals Qualified"
          description="In our first full AAU season, the 11U Girls qualified for Nationals — going 3-0 in pool play at the ZG National Finals. This is just the beginning."
          accent="var(--as-gold)"
          delay={4}
        />
      </div>

      {/* Program details card */}
      <div className="as-fade-in as-stagger-5" style={{
        padding: '18px 20px', borderRadius: 12,
        backgroundColor: 'var(--as-bg-card)',
        border: '1px solid var(--as-border-default)',
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--as-text-tertiary)', display: 'block', marginBottom: 14 }}>
          PROGRAM DETAILS
        </span>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 16,
        }}>
          <DetailItem label="Division" value="11U Girls (5th Grade)" />
          <DetailItem label="Circuit" value="AAU — Zero Gravity Tri-State" />
          <DetailItem label="Season" value="Year-round (Winter + Spring)" />
          <DetailItem label="Practice" value="Mon / Tue / Wed evenings" />
        </div>
      </div>
    </div>
  );
}

function ValueCard({ icon, title, description, accent, delay }: {
  icon: React.ReactNode; title: string; description: string; accent: string; delay: number;
}) {
  return (
    <div
      className={`as-card-hover as-fade-in as-stagger-${delay}`}
      style={{
        padding: '18px 18px 20px', borderRadius: 12,
        backgroundColor: 'var(--as-bg-card)',
        border: '1px solid var(--as-border-default)',
        borderTop: `3px solid ${accent}`,
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: `color-mix(in srgb, ${accent} 12%, transparent)`,
        color: accent, marginBottom: 12,
      }}>
        {icon}
      </div>
      <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--as-text-primary)', margin: '0 0 6px' }}>
        {title}
      </h4>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--as-text-secondary)', margin: 0 }}>
        {description}
      </p>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--as-text-tertiary)', display: 'block', marginBottom: 3 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--as-text-primary)' }}>
        {value}
      </span>
    </div>
  );
}
