/**
 * StatHeroBar — Horizontal gradient stat bar (broadcast pattern).
 * Displays key season stats in a compact, visually impactful row.
 */

interface StatItem {
  value: string;
  label: string;
  variant?: 'gold' | 'green' | 'default';
}

interface StatHeroBarProps {
  items: StatItem[];
}

export default function StatHeroBar({ items }: StatHeroBarProps) {
  return (
    <div className="as-statbar as-fade-in" role="region" aria-label="Season statistics">
      {items.map((item, idx) => (
        <div key={item.label} className="as-statbar-item">
          <span
            className={`as-statbar-num ${item.variant === 'gold' ? 'gold' : item.variant === 'green' ? 'green' : ''}`}
            aria-label={`${item.label}: ${item.value}`}
          >
            {item.value}
          </span>
          <span className="as-statbar-lbl">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
