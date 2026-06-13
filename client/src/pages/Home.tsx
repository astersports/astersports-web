/**
 * Aster Sports Landing Page
 * Design: Celestial Cartography — dark constellation-themed aesthetic
 * Colors: Deep navy background, gold-to-orange gradient accents
 * Typography: Space Grotesk (display), Inter (body)
 */

import { useEffect, useRef, useState } from "react";
import { Code, Globe, Wrench, Shield, Mail, ArrowRight } from "lucide-react";

const LOGO_URL = "/manus-storage/aster_sports_logo_high_res_2b537f86.png";
const HERO_BG_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663756289268/4gGAtBP2vWCBU9FC7zDMWA/hero-bg-kP7SSTui5UuAzDmbnWb2NK.webp";
const SERVICES_VISUAL_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663756289268/4gGAtBP2vWCBU9FC7zDMWA/services-visual-iD7nJ76bKWcPDDk2JN8BYh.webp";
const CTA_BG_URL = "https://d2xsxph8kpxj0f.cloudfront.net/310519663756289268/4gGAtBP2vWCBU9FC7zDMWA/cta-bg-MXeCiZ4GFgLGRGyvD68mXc.webp";

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
          <stop stopColor="#f5b731" />
          <stop offset="1" stopColor="#e67e22" />
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

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[#0a0e1a]/90 backdrop-blur-xl border-b border-white/5"
          : "bg-transparent"
      }`}
    >
      <div className="container flex items-center justify-between h-16 md:h-20">
        <a href="/" className="flex items-center gap-3">
          <img
            src={LOGO_URL}
            alt="Aster Sports"
            className="w-10 h-10 md:w-12 md:h-12"
          />
          <span className="text-lg md:text-xl font-semibold tracking-tight text-white" style={{ fontFamily: "var(--font-display)" }}>
            Aster Sports
          </span>
        </a>
        <a
          href="mailto:frank@astersports.co"
          className="hidden sm:inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-medium text-sm transition-transform duration-160 hover:scale-[1.03] active:scale-[0.97]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          <Mail className="w-4 h-4" />
          Get in Touch
        </a>
      </div>
    </header>
  );
}

function HeroSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section
      className="relative min-h-[100vh] flex items-center overflow-hidden"
      style={{
        background: `linear-gradient(180deg, #0a0e1a 0%, #0d1220 100%)`,
      }}
    >
      {/* Background image */}
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: `url(${HERO_BG_URL})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />

      {/* Gradient overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a0e1a]/40 via-transparent to-[#0a0e1a]/80" />

      <div className="container relative z-10 pt-32 pb-20" ref={ref}>
        <div className="max-w-3xl">
          <div
            className={`flex items-center gap-2 mb-6 transition-all duration-500 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <StarAccent className="animate-pulse-glow" />
            <span className="text-sm font-medium text-[#f5b731] tracking-wider uppercase" style={{ fontFamily: "var(--font-display)" }}>
              Web Development Agency
            </span>
          </div>

          <h1
            className={`text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] tracking-tight text-white mb-6 transition-all duration-700 delay-100 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
            style={{ fontFamily: "var(--font-display)" }}
          >
            We build digital
            <br />
            infrastructure that
            <br />
            <span className="bg-gradient-to-r from-[#f5b731] to-[#e67e22] bg-clip-text text-transparent">
              doesn't break.
            </span>
          </h1>

          <p
            className={`text-lg md:text-xl text-slate-300 max-w-xl leading-relaxed mb-10 transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            Aster Sports provides custom web development and ongoing maintenance
            for organizations that need reliable, high-performance digital presence.
          </p>

          <div
            className={`flex flex-col sm:flex-row gap-4 transition-all duration-700 delay-300 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <a
              href="mailto:frank@astersports.co"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-semibold text-base transition-transform duration-160 hover:scale-[1.03] active:scale-[0.97] shadow-lg shadow-[#f5b731]/20"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Start a Conversation
              <ArrowRight className="w-4 h-4" />
            </a>
            <a
              href="#services"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full border border-white/15 text-white font-medium text-base transition-all duration-200 hover:border-[#f5b731]/40 hover:text-[#f5b731]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Our Services
            </a>
          </div>
        </div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#0a0e1a] to-transparent" />
    </section>
  );
}

const services = [
  {
    icon: Code,
    title: "Custom Web Development",
    description:
      "Bespoke websites and web applications built from the ground up. Clean code, modern frameworks, pixel-perfect execution.",
  },
  {
    icon: Wrench,
    title: "Ongoing Maintenance",
    description:
      "Continuous updates, security patches, performance monitoring, and content changes. Your site stays current without the headache.",
  },
  {
    icon: Globe,
    title: "Hosting & Infrastructure",
    description:
      "Reliable hosting solutions with SSL, CDN, and automated backups. We keep your digital presence online and fast.",
  },
  {
    icon: Shield,
    title: "Security & Performance",
    description:
      "Regular security audits, performance optimization, and uptime monitoring. Protection and speed as standard.",
  },
];

function ServicesSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="services" className="relative py-24 md:py-32 bg-[#0a0e1a]">
      <div className="container" ref={ref}>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: Services list */}
          <div>
            <div
              className={`flex items-center gap-2 mb-4 transition-all duration-500 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
            >
              <StarAccent />
              <span className="text-sm font-medium text-[#f5b731] tracking-wider uppercase" style={{ fontFamily: "var(--font-display)" }}>
                What We Do
              </span>
            </div>

            <h2
              className={`text-3xl md:text-4xl font-bold text-white mb-12 tracking-tight transition-all duration-700 delay-100 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Every connection intentional.
              <br />
              <span className="text-slate-400">Every node purposeful.</span>
            </h2>

            <div className="space-y-8">
              {services.map((service, i) => (
                <div
                  key={service.title}
                  className={`flex gap-4 group transition-all duration-500 ${
                    isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
                  }`}
                  style={{ transitionDelay: `${150 + i * 80}ms` }}
                >
                  <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-[#f5b731]/10 border border-[#f5b731]/20 flex items-center justify-center group-hover:bg-[#f5b731]/20 transition-colors duration-200">
                    <service.icon className="w-5 h-5 text-[#f5b731]" />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-1" style={{ fontFamily: "var(--font-display)" }}>
                      {service.title}
                    </h3>
                    <p className="text-slate-400 leading-relaxed text-[15px]">
                      {service.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Visual */}
          <div
            className={`hidden lg:block transition-all duration-1000 delay-300 ${
              isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
            }`}
          >
            <div className="relative">
              <img
                src={SERVICES_VISUAL_URL}
                alt="Network visualization"
                className="w-full rounded-2xl opacity-80"
              />
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-t from-[#0a0e1a] via-transparent to-transparent" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ProcessSection() {
  const { ref, isVisible } = useScrollReveal();

  const steps = [
    { number: "01", title: "Discovery", description: "We learn your goals, audience, and technical requirements." },
    { number: "02", title: "Design & Build", description: "Custom development with regular check-ins and previews." },
    { number: "03", title: "Launch", description: "Thorough testing, deployment, and handoff documentation." },
    { number: "04", title: "Maintain", description: "Ongoing support, updates, and performance monitoring." },
  ];

  return (
    <section className="relative py-24 md:py-32 bg-[#0d1220]">
      <div className="container" ref={ref}>
        <div className="text-center mb-16">
          <div
            className={`flex items-center justify-center gap-2 mb-4 transition-all duration-500 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <StarAccent />
            <span className="text-sm font-medium text-[#f5b731] tracking-wider uppercase" style={{ fontFamily: "var(--font-display)" }}>
              Our Process
            </span>
          </div>
          <h2
            className={`text-3xl md:text-4xl font-bold text-white tracking-tight transition-all duration-700 delay-100 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
            style={{ fontFamily: "var(--font-display)" }}
          >
            From concept to constellation.
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-8">
          {steps.map((step, i) => (
            <div
              key={step.number}
              className={`relative p-6 rounded-xl border border-white/5 bg-[#0a0e1a]/60 backdrop-blur-sm hover:border-[#f5b731]/20 transition-all duration-300 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
              style={{ transitionDelay: `${200 + i * 100}ms` }}
            >
              <span className="text-4xl font-bold bg-gradient-to-b from-[#f5b731] to-[#e67e22] bg-clip-text text-transparent" style={{ fontFamily: "var(--font-display)" }}>
                {step.number}
              </span>
              <h3 className="text-lg font-semibold text-white mt-3 mb-2" style={{ fontFamily: "var(--font-display)" }}>
                {step.title}
              </h3>
              <p className="text-slate-400 text-sm leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section className="relative py-24 md:py-32 overflow-hidden">
      {/* Background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${CTA_BG_URL})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="absolute inset-0 bg-[#0a0e1a]/60" />

      <div className="container relative z-10 text-center" ref={ref}>
        <div
          className={`max-w-2xl mx-auto transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
          }`}
        >
          <StarAccent className="mx-auto mb-6 w-6 h-6 animate-pulse-glow" />
          <h2
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6 tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Ready to build something
            <br />
            <span className="bg-gradient-to-r from-[#f5b731] to-[#e67e22] bg-clip-text text-transparent">
              that lasts?
            </span>
          </h2>
          <p className="text-lg text-slate-300 mb-10 max-w-lg mx-auto leading-relaxed">
            Let's discuss your project. No pressure, no jargon — just a straightforward
            conversation about what you need.
          </p>
          <a
            href="mailto:frank@astersports.co"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-semibold text-lg transition-transform duration-160 hover:scale-[1.03] active:scale-[0.97] shadow-lg shadow-[#f5b731]/25"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Mail className="w-5 h-5" />
            frank@astersports.co
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-12 bg-[#070a12] border-t border-white/5">
      <div className="container">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <img
              src={LOGO_URL}
              alt="Aster Sports"
              className="w-8 h-8"
            />
            <span className="text-base font-semibold text-white" style={{ fontFamily: "var(--font-display)" }}>
              Aster Sports
            </span>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8 text-sm text-slate-400">
            <span>Custom Web Development & Maintenance</span>
            <a
              href="mailto:frank@astersports.co"
              className="text-[#f5b731] hover:text-[#e67e22] transition-colors"
            >
              frank@astersports.co
            </a>
          </div>

          <p className="text-xs text-slate-500">
            &copy; {new Date().getFullYear()} Aster Sports. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-[#0a0e1a]">
      <Header />
      <HeroSection />
      <ServicesSection />
      <ProcessSection />
      <CTASection />
      <Footer />
    </div>
  );
}
