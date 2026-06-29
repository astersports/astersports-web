/**
 * Seamless infinite marquee of the stack the platform is built on. Two
 * identical groups translate -50% so the loop is invisible; the duplicate is
 * aria-hidden so screen readers read the list once.
 */
const TECH = [
  "React 19",
  "Tailwind CSS",
  "SAM2",
  "LaMa inpainting",
  "Replicate",
  "Supabase",
  "Stripe",
  "Railway",
  "tRPC",
  "Vite",
];

function Group({ hidden }: { hidden?: boolean }) {
  return (
    <div className="aster-marquee-group flex" aria-hidden={hidden}>
      {TECH.map((t) => (
        <span key={t} className="aster-marquee-item">
          {t}
        </span>
      ))}
    </div>
  );
}

export default function TechMarquee() {
  return (
    <section className="relative py-8 md:py-10 bg-[#E6EAF0] border-y border-black/5">
      <div className="container">
        <p
          className="text-center text-[11px] tracking-[0.28em] uppercase text-slate-500 mb-5"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Built on a modern stack
        </p>
        <div className="aster-edge-fade overflow-hidden">
          <div className="aster-marquee">
            <Group />
            <Group hidden />
          </div>
        </div>
      </div>
    </section>
  );
}
