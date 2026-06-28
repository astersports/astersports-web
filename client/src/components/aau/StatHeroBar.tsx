/**
 * StatHeroBar — Horizontal gradient stat bar (broadcast pattern).
 * Displays key season stats in a compact, visually impactful row on the navy chrome:
 * Space Mono data face, gold/green semantic accents, light-on-navy default rank.
 */

interface StatItem {
  value: string;
  label: string;
  variant?: 'gold' | 'green' | 'default';
}

interface StatHeroBarProps {
  items: StatItem[];
  /** Region label for assistive tech (defaults to "Season statistics"). */
  ariaLabel?: string;
}

// Default (non-semantic) numbers must read on the navy gradient — the shared .as-statbar-num
// rule paints them with --as-text-primary (near-black), which is invisible here. Override to a
// warm-white inline so the default rank stays legible without touching the global stylesheet.
const DEFAULT_NUM_COLOR = '#F5F0E8';

export default function StatHeroBar({ items, ariaLabel = 'Season statistics' }: StatHeroBarProps) {
  return (
    // <dl> gives each stat a real term/description pairing for screen readers (was a flat list
    // of redundantly-labelled spans). Native list semantics are kept (no explicit role). DOM
    // order is <dt> (label/term) then <dd> (value/description) per the spec; the value still
    // renders visually on top via flex `order` so the broadcast look is unchanged.
    <dl className="as-statbar as-fade-in" aria-label={ariaLabel}>
      {items.map((item) => {
        const semantic = item.variant === 'gold' || item.variant === 'green';
        return (
          <div key={item.label} className="as-statbar-item" style={{ display: 'flex', flexDirection: 'column' }}>
            <dt className="as-statbar-lbl" style={{ order: 2 }}>{item.label}</dt>
            <dd
              className={`as-statbar-num tabular-nums ${item.variant === 'gold' ? 'gold' : item.variant === 'green' ? 'green' : ''}`}
              style={semantic ? { order: 1, margin: 0 } : { order: 1, margin: 0, color: DEFAULT_NUM_COLOR }}
            >
              {item.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
