/**
 * Aster Sports Landing Page
 * Design: Celestial Cartography — dark constellation-themed aesthetic
 * Colors: Deep navy background, gold-to-orange gradient accents
 * Typography: Space Grotesk (display), Inter (body)
 */

import { useEffect, useRef, useState } from "react";
import { Mail, ArrowRight, ArrowUpRight, MapPin, Menu, X, Send, Settings } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useScanCycle } from "@/hooks/useScanCycle";
import { PRODUCTS, NAV_PRODUCTS, STATUS_META, type ServiceEntry } from "@/lib/services";
import ScrollProgress from "@/components/landing/ScrollProgress";
import IntelligenceSection from "@/components/landing/IntelligenceSection";
import FrontierSection from "@/components/landing/FrontierSection";
import ScoutChat from "@/components/landing/ScoutChat";

/** Client build-time flag — the live concierge chat only renders when this is
 *  "true" at build (paired with the server LANDING_AGENT_LIVE flag). */
const AGENT_LIVE = import.meta.env.VITE_LANDING_AGENT_LIVE === "true";

const LOGO_URL = "/aster-mark.png";

function StarAccent({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 0L9.5 6.5L16 8L9.5 9.5L8 16L6.5 9.5L0 8L6.5 6.5L8 0Z"
        fill="url(#star-gradient)"
      />
      <defs>
        <linearGradient id="star-gradient" x1="8" y1="0" x2="8" y2="16" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F6CC55" />
          <stop offset="1" stopColor="#E0631C" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, []);

  return { ref, isVisible };
}

function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  // Show owner/admin surfaces based on the server's super-admin flag (the
  // platform_admins gate), not the build-time VITE_OWNER_OPEN_ID heuristic.
  const isOwner = user?.isSuperAdmin === true;

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      const close = () => setMobileOpen(false);
      window.addEventListener("scroll", close);
      return () => window.removeEventListener("scroll", close);
    }
  }, [mobileOpen]);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#E6EAF0]/90 backdrop-blur-xl border-b border-black/5"
          : "bg-transparent"
      }`}
    >
      <div className="container flex items-center justify-between h-16 md:h-20">
        <a href="/" className="flex items-center gap-3">
          <img
            src={LOGO_URL}
            alt="Aster Sports"
            className="h-10 w-auto md:h-12"
          />
          <span className="text-lg md:text-xl font-semibold tracking-tight text-[#1c2230]" style={{ fontFamily: "var(--font-display)" }}>
            Aster Sports
          </span>
        </a>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6">
          {NAV_PRODUCTS.map((p) => (
            <a
              key={p.id}
              href={p.href}
              {...(p.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="text-sm text-slate-600 hover:text-[#F6CC55] transition-colors"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {p.navLabel ?? p.name}
            </a>
          ))}
          {isOwner && (
            <a href="/admin/billing" className="text-sm text-slate-600 hover:text-[#F6CC55] transition-colors flex items-center gap-1" style={{ fontFamily: "var(--font-display)" }}>
              <Settings className="w-3.5 h-3.5" />
              Billing
            </a>
          )}
          <a
            href="#contact"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#F6CC55] to-[#E0631C] text-[#1c2230] font-medium text-sm transition-transform duration-160 hover:scale-[1.03] active:scale-[0.97]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Mail className="w-4 h-4" />
            Get in Touch
          </a>
        </nav>

        {/* Mobile menu button */}
        <button
          className="sm:hidden p-2 text-[#1c2230]"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu dropdown */}
      <div
        className={`sm:hidden overflow-hidden transition-all duration-300 ease-out ${
          mobileOpen ? "max-h-[34rem] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <nav className="container pt-2 pb-6 flex flex-col gap-4 bg-[#E6EAF0] border-b border-black/10 shadow-2xl">
          {NAV_PRODUCTS.map((p) => (
            <a
              key={p.id}
              href={p.href}
              {...(p.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="text-base text-slate-600 hover:text-[#F6CC55] transition-colors py-2"
              style={{ fontFamily: "var(--font-display)" }}
              onClick={() => setMobileOpen(false)}
            >
              {p.navLabel ?? p.name}
            </a>
          ))}
          {isOwner && (
            <a href="/admin/billing" className="text-base text-slate-600 hover:text-[#F6CC55] transition-colors py-2 flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }} onClick={() => setMobileOpen(false)}>
              <Settings className="w-4 h-4" />
              Billing
            </a>
          )}
          <a
            href="#contact"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-gradient-to-r from-[#F6CC55] to-[#E0631C] text-[#1c2230] font-medium text-sm transition-transform duration-160 active:scale-[0.97]"
            style={{ fontFamily: "var(--font-display)" }}
            onClick={() => setMobileOpen(false)}
          >
            <Mail className="w-4 h-4" />
            Get in Touch
          </a>
        </nav>
      </div>
    </header>
  );
}

const STARS = [
  { top: "14%", left: "9%", tw: true }, { top: "8%", left: "30%", tw: true },
  { top: "22%", left: "52%", tw: true }, { top: "18%", left: "70%", tw: false },
  { top: "11%", left: "86%", tw: true }, { top: "34%", left: "20%", tw: false },
  { top: "40%", left: "78%", tw: false }, { top: "6%", left: "62%", tw: false },
  { top: "30%", left: "40%", tw: true }, { top: "26%", left: "92%", tw: false },
];

function HeroSection() {
  const { ref, isVisible } = useScrollReveal();
  const sectionRef = useRef<HTMLElement>(null);

  const handleGlow = (e: React.MouseEvent<HTMLElement>) => {
    const el = sectionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  return (
    <section ref={sectionRef} onMouseMove={handleGlow} className="relative flex items-center overflow-hidden">
      <div className="aster-sky" />
      <div className="aster-hero-glow" aria-hidden="true" />
      <div className="aster-stars absolute inset-0" aria-hidden="true">
        {STARS.map((s, i) => (
          <span key={i} className={s.tw ? "tw" : ""} style={{ top: s.top, left: s.left }} />
        ))}
      </div>

      {/* Big constellation mark glowing behind the hero (desktop only) */}
      <img
        src={LOGO_URL}
        alt=""
        aria-hidden="true"
        className="aster-hero-logo hidden lg:block absolute right-4 xl:right-16 top-24 h-[300px] xl:h-[400px] w-auto opacity-90 pointer-events-none select-none"
      />

      <div className="container relative z-10 pt-24 pb-8 md:pt-28 md:pb-16" ref={ref}>
        <div className="max-w-2xl">
          <AgentEyebrow tag="systems online" isVisible={isVisible} />

          <h1
            className={`text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.02] tracking-tight text-[#1c2230] mb-3 transition-all duration-700 delay-100 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
            style={{ fontFamily: "var(--font-display)" }}
          >
            The platform your
            <br />
            program <span className="aster-grad-text">orbits.</span>
          </h1>

          <div
            className={`mb-4 transition-all duration-500 delay-150 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <span className="aster-mono text-xs tracking-[0.32em] uppercase text-[#FBD56B]/85">
              Design &amp; technology studio · youth sports
            </span>
          </div>

          <p
            className={`text-lg md:text-xl text-slate-600 max-w-xl leading-relaxed mb-6 transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            One studio, four things youth sports actually runs on: AI apparel print, the team app, live AAU tracking, and bespoke org sites.
          </p>

          <div
            className={`flex flex-col sm:flex-row gap-4 mb-6 transition-all duration-700 delay-300 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <a
              href="#contact"
              className="aster-grad-bg inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full text-[#1a0e05] font-semibold text-base transition-transform duration-160 hover:scale-[1.03] active:scale-[0.97] shadow-lg shadow-[#E0631C]/20"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Start a project
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="#platform"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full border border-black/15 text-[#1c2230] font-medium text-base transition-all duration-200 hover:border-[#F6CC55]/40 hover:text-[#F6CC55]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Explore the constellation
            </a>
          </div>

          <div
            className={`flex items-center gap-2 text-slate-500 text-sm transition-all duration-700 delay-400 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <MapPin className="w-4 h-4 text-[#F6CC55]/60" />
            <span>Based in Westchester, NY</span>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Unified "ASTER-AGENT · <tag>" section eyebrow — the quiet thread of the
 * live-scan motif across the whole page (the pulsing live dot + mono tag). Left
 * variant trails a divider line; center variant sits inline above a centered
 * heading.
 */
function AgentEyebrow({ tag, isVisible, center = false }: { tag: string; isVisible: boolean; center?: boolean }) {
  const reveal = isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4";
  if (center) {
    return (
      <div className={`flex items-center justify-center gap-2 mb-4 transition-all duration-500 ${reveal}`}>
        <span className="aster-dot-live" />
        <span className="aster-mono text-[11px] tracking-[0.14em] uppercase text-slate-400">
          aster-agent · {tag}
        </span>
        <span className="aster-mono text-[10px] text-[#34d399]">live</span>
      </div>
    );
  }
  return (
    <div className={`flex items-center gap-2 mb-4 transition-all duration-500 ${reveal}`}>
      <span className="aster-dot-live" />
      <span className="aster-mono text-[11px] tracking-[0.14em] uppercase text-slate-400">
        aster-agent · {tag}
      </span>
      <span className="flex-1 h-px bg-black/10" />
      <span className="aster-mono text-[10px] text-[#34d399]">live</span>
    </div>
  );
}

function NodePill({ status }: { status: NonNullable<ServiceEntry["status"]> }) {
  const meta = STATUS_META[status];
  if (status === "live" || status === "members") {
    return (
      <span className="aster-grad-bg aster-mono self-start mt-auto text-[10.5px] tracking-[0.12em] uppercase px-2.5 py-1 rounded-full text-[#1a0e05] font-bold">
        {meta.label}
      </span>
    );
  }
  return (
    <span
      className="aster-mono self-start mt-auto text-[10.5px] tracking-[0.12em] uppercase px-2.5 py-1 rounded-full border"
      style={{ color: meta.color, borderColor: `color-mix(in srgb, ${meta.color} 45%, transparent)` }}
    >
      {meta.label}
    </span>
  );
}

function ConstellationNode({ product, index, isVisible, active }: { product: ServiceEntry; index: number; isVisible: boolean; active: boolean }) {
  const Icon = product.icon;
  const lit = product.status === "live" || product.status === "members";
  return (
    <a
      href={product.href}
      {...(product.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`aster-node aster-trend-card group relative flex flex-col p-4 min-h-[124px] transition-all duration-500 ${
        active ? "active" : ""
      } ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
      style={{ transitionDelay: `${120 + index * 100}ms` }}
    >
      {/* the scout's scan sweeps the node it's currently charting */}
      {active && (
        <span className="aster-scan-track absolute inset-0 rounded-[18px] pointer-events-none" aria-hidden="true" />
      )}
      <div className={`aster-star ${lit || active ? "on" : ""} mb-2.5 transition-all duration-300`}>
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-base font-semibold text-[#1c2230] mb-1" style={{ fontFamily: "var(--font-display)" }}>
        {product.name}
      </h3>
      <p className="text-[12.5px] text-slate-500 leading-snug mb-2.5">{product.tagline}</p>
      {product.status && <NodePill status={product.status} />}
      {product.external && (
        <ArrowUpRight className="absolute top-4 right-4 w-4 h-4 text-slate-500 group-hover:text-[#F6CC55] transition-colors" />
      )}
    </a>
  );
}

function PlatformSection() {
  const { ref, isVisible } = useScrollReveal();
  // The agent "maps the constellation" — a scout cycles through and charts each
  // node in turn (same live-scan motif as the frontier section). The hook pauses
  // under prefers-reduced-motion and reacts to the user toggling it mid-session.
  const active = useScanCycle(PRODUCTS.length, isVisible);
  const current = PRODUCTS[active];

  return (
    <section id="platform" className="relative pt-2 pb-10 md:pt-4 md:pb-16 bg-[#EBEEF4]">
      <div className="container aster-constellation" ref={ref}>
        <h2
          className={`flex items-center gap-3 text-[13px] font-semibold tracking-[0.2em] uppercase text-[#8f6708] mb-4 transition-all duration-500 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
          }`}
          style={{ fontFamily: "var(--font-display)" }}
        >
          The constellation
          <span className="flex-1 h-px bg-slate-900/10" />
        </h2>

        {/* agent console — the scout charting the platform map, live */}
        <div
          className={`aster-terminal p-4 md:p-4 mb-5 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="aster-dot-live" />
            <span className="aster-mono text-[11px] tracking-[0.14em] uppercase text-slate-400">
              aster-agent · mapping the constellation
            </span>
            <span className="aster-mono text-[10px] text-[#34d399] ml-auto">live</span>
          </div>
          <div className="aster-scan-track rounded-lg bg-white/[0.02] border border-black/5 px-3.5 py-3">
            <div className="aster-mono text-[12px] text-slate-300 leading-relaxed">
              <span className="text-[#F6CC55]">▸</span> charting node{" "}
              <span className="text-white">{active + 1}</span>
              <span className="text-slate-500"> / {PRODUCTS.length}</span> —{" "}
              <span className="aster-grad-text font-semibold">{current.name}</span>
            </div>
            <div className="as-progress-bar mt-2.5" aria-hidden="true">
              <div
                className="as-progress-fill"
                style={{
                  width: `${((active + 1) / PRODUCTS.length) * 100}%`,
                  background: "var(--brand-grad)",
                  transition: "width .5s cubic-bezier(0.23,1,0.32,1)",
                }}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          {PRODUCTS.map((product, i) => (
            <ConstellationNode key={product.id} product={product} index={i} isVisible={isVisible} active={i === active} />
          ))}
        </div>

        <div
          className={`mt-4 flex items-center gap-4 flex-wrap rounded-2xl border border-slate-200 bg-white shadow-sm px-5 py-4 text-slate-600 text-[13.5px] transition-all duration-700 delay-300 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <b className="text-slate-900 font-semibold tracking-wide" style={{ fontFamily: "var(--font-display)" }}>
            We also build
          </b>
          <span>agency work for brands &amp; orgs</span>
          <div className="flex gap-2 flex-wrap sm:ml-auto">
            {["Brand", "Web", "Apps", "Print"].map((t) => (
              <span key={t} className="text-xs text-slate-500 border border-slate-200 rounded-md px-2.5 py-1">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Prominent "Ask Aster Scout" block — the live AI concierge, lifted to the top
 * of the page so it's the obvious thing to use. Renders only when the agent is
 * live at build (AGENT_LIVE); otherwise nothing shows (no dead box).
 */
function AskScoutSection() {
  const { ref, isVisible } = useScrollReveal();
  if (!AGENT_LIVE) return null;
  return (
    <section id="scout" className="relative py-10 md:py-14 bg-[#E6EAF0]">
      <div className="container" ref={ref}>
        <div className="max-w-2xl mx-auto">
          <AgentEyebrow tag="concierge online" isVisible={isVisible} center />
          <h2
            className={`text-3xl md:text-4xl font-bold text-[#1c2230] text-center tracking-tight mb-3 transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
            style={{ fontFamily: "var(--font-display)" }}
          >
            Ask <span className="aster-grad-text">Aster Scout</span>
          </h2>
          <p
            className={`text-center text-slate-600 leading-relaxed mb-6 transition-all duration-700 delay-100 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            Tell our AI concierge what you're working on — it points you to the right product or
            service in seconds. Tap a question below to try it.
          </p>
          <div
            className={`transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <ScoutChat />
          </div>
        </div>
      </div>
    </section>
  );
}

function ContactSection() {
  const { ref, isVisible } = useScrollReveal();
  const [formState, setFormState] = useState({ name: "", email: "", message: "" });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Construct mailto link with form data
    const subject = encodeURIComponent(`New inquiry from ${formState.name}`);
    const body = encodeURIComponent(
      `Name: ${formState.name}\nEmail: ${formState.email}\n\nMessage:\n${formState.message}`
    );
    window.location.href = `mailto:frank@astersports.co?subject=${subject}&body=${body}`;
    setSubmitted(true);
  };

  return (
    <section id="contact" className="relative py-10 md:py-16 overflow-hidden">
      {/* Background — same navy/starfield motif as the hero */}
      <div className="aster-sky" />
      <div className="aster-stars absolute inset-0" aria-hidden="true">
        {STARS.map((s, i) => (
          <span key={i} className={s.tw ? "tw" : ""} style={{ top: s.top, left: s.left }} />
        ))}
      </div>

      <div className="container relative z-10" ref={ref}>
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-start">
            {/* Left: CTA text */}
            <div
              className={`transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
            >
              <AgentEyebrow tag="open channel" isVisible={isVisible} />
              <h2
                className="text-3xl md:text-4xl font-bold text-[#1c2230] mb-6 tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Ready to create something
                <br />
                <span className="bg-gradient-to-r from-[#F6CC55] to-[#E0631C] bg-clip-text text-transparent">
                  that stands apart?
                </span>
              </h2>
              <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                Let's discuss your project. No pressure, no jargon — just a straightforward
                conversation about what you need.
              </p>
              <div className="space-y-3 text-slate-500">
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-[#F6CC55]/60" />
                  <a href="mailto:frank@astersports.co" className="hover:text-[#F6CC55] transition-colors">
                    frank@astersports.co
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-[#F6CC55]/60" />
                  <span>Westchester, NY</span>
                </div>
              </div>
            </div>

            {/* Right: Contact form */}
            <div
              className={`transition-all duration-700 delay-200 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
            >
              {submitted ? (
                <div className="aster-terminal--light p-6 md:p-8 text-center">
                  <div className="flex items-center gap-2 mb-5">
                    <span className="aster-dot-live" />
                    <span className="aster-mono text-[11px] tracking-[0.14em] uppercase text-slate-400">
                      aster-agent · open channel
                    </span>
                    <span className="aster-mono text-[10px] text-[#34d399] ml-auto">live</span>
                  </div>
                  <StarAccent className="mx-auto mb-4 w-6 h-6" />
                  <h3 className="text-xl font-semibold text-[#1c2230] mb-2" style={{ fontFamily: "var(--font-display)" }}>
                    Message ready to send
                  </h3>
                  <p className="text-slate-500 text-sm">
                    Your email client should have opened with your message. If not, email us directly at{" "}
                    <a href="mailto:frank@astersports.co" className="text-[#F6CC55]">frank@astersports.co</a>.
                  </p>
                  <button
                    onClick={() => { setSubmitted(false); setFormState({ name: "", email: "", message: "" }); }}
                    className="mt-4 text-sm text-[#F6CC55] hover:underline"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="aster-terminal--light p-6 md:p-8">
                  <div className="flex items-center gap-2 mb-5">
                    <span className="aster-dot-live" />
                    <span className="aster-mono text-[11px] tracking-[0.14em] uppercase text-slate-400">
                      aster-agent · open channel
                    </span>
                    <span className="aster-mono text-[10px] text-[#34d399] ml-auto">live</span>
                  </div>
                  <div className="space-y-5">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-slate-600 mb-2" style={{ fontFamily: "var(--font-display)" }}>
                      Name
                    </label>
                    <input
                      id="name"
                      type="text"
                      required
                      value={formState.name}
                      onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg bg-[#F4F6FA] border border-black/10 text-[#1c2230] placeholder-slate-500 focus:outline-none focus:border-[#F6CC55]/40 focus:ring-1 focus:ring-[#F6CC55]/20 transition-all"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-slate-600 mb-2" style={{ fontFamily: "var(--font-display)" }}>
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={formState.email}
                      onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg bg-[#F4F6FA] border border-black/10 text-[#1c2230] placeholder-slate-500 focus:outline-none focus:border-[#F6CC55]/40 focus:ring-1 focus:ring-[#F6CC55]/20 transition-all"
                      placeholder="your@email.com"
                    />
                  </div>
                  <div>
                    <label htmlFor="message" className="block text-sm font-medium text-slate-600 mb-2" style={{ fontFamily: "var(--font-display)" }}>
                      Message
                    </label>
                    <textarea
                      id="message"
                      required
                      rows={4}
                      value={formState.message}
                      onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg bg-[#F4F6FA] border border-black/10 text-[#1c2230] placeholder-slate-500 focus:outline-none focus:border-[#F6CC55]/40 focus:ring-1 focus:ring-[#F6CC55]/20 transition-all resize-none"
                      placeholder="Tell us about your project..."
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-gradient-to-r from-[#F6CC55] to-[#E0631C] text-[#1c2230] font-semibold text-base transition-transform duration-160 hover:scale-[1.02] active:scale-[0.97] shadow-lg shadow-[#F6CC55]/20"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    <Send className="w-4 h-4" />
                    Send Message
                  </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-12 bg-[#FFFFFF] border-t border-black/5">
      <div className="container">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src={LOGO_URL} alt="Aster Sports" className="h-8 w-auto" />
              <span className="text-base font-semibold text-[#1c2230]" style={{ fontFamily: "var(--font-display)" }}>
                Aster Sports
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8 text-sm text-slate-500">
              <span>Design, Technology & Sports</span>
              {NAV_PRODUCTS.map((p) => (
                <a
                  key={p.id}
                  href={p.href}
                  {...(p.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                  className="text-[#F6CC55] hover:text-[#E0631C] transition-colors"
                >
                  {p.name}
                </a>
              ))}
              <a href="mailto:frank@astersports.co" className="text-[#F6CC55] hover:text-[#E0631C] transition-colors">
                frank@astersports.co
              </a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-black/5">
            <p className="text-xs text-slate-500">
              &copy; {new Date().getFullYear()} Aster Sports. All rights reserved.
            </p>
            <div className="flex items-center gap-6 text-xs text-slate-500">
              <a href="/privacy" className="hover:text-slate-600 transition-colors">
                Privacy Policy
              </a>
              <a href="/terms" className="hover:text-slate-600 transition-colors">
                Terms of Service
              </a>
              <span className="flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                Westchester, NY
              </span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <div className="relative min-h-screen bg-[#E6EAF0] overflow-x-hidden">
      <div className="aster-grain" aria-hidden="true" />
      <ScrollProgress />
      <Header />
      <HeroSection />
      <AskScoutSection />
      <PlatformSection />
      <IntelligenceSection />
      <FrontierSection />
      <ContactSection />
      <Footer />
    </div>
  );
}
