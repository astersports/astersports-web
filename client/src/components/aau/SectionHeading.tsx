/**
 * SectionHeading — Eyebrow + Display heading with optional ghost text overlay.
 * Ports the .bc-sec-eye + .bc-sec-h2 + .bc-hero::after pattern from broadcast.css.
 */

interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  accentWord?: string; // Word to highlight in accent color
  ghostText?: string; // Large faded text behind the heading
}

export default function SectionHeading({ eyebrow, title, accentWord, ghostText }: SectionHeadingProps) {
  // Split title around accent word if provided
  let titleContent: React.ReactNode = title;
  if (accentWord) {
    const idx = title.toUpperCase().indexOf(accentWord.toUpperCase());
    if (idx >= 0) {
      const before = title.slice(0, idx);
      const match = title.slice(idx, idx + accentWord.length);
      const after = title.slice(idx + accentWord.length);
      titleContent = <>{before}<b>{match}</b>{after}</>;
    }
  }

  return (
    <div
      className={ghostText ? 'as-ghost-text' : ''}
      data-ghost={ghostText || undefined}
      style={{ position: 'relative', marginBottom: 20, padding: '0 4px' }}
    >
      <div className="as-sec-eye" style={{ position: 'relative', zIndex: 1 }}>
        {eyebrow}
      </div>
      <h2 className="as-sec-h2" style={{ position: 'relative', zIndex: 1, margin: 0 }}>
        {titleContent}
      </h2>
    </div>
  );
}
