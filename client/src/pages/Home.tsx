/**
 * Aster Sports Landing Page
 * Design: Celestial Cartography — dark constellation-themed aesthetic
 * Colors: Deep navy background, gold-to-orange gradient accents
 * Typography: Space Grotesk (display), Inter (body)
 */

import { useEffect, useRef, useState } from "react";
import { Code, Globe, Wrench, Shield, Mail, ArrowRight, MapPin, Menu, X, ChevronDown, Send, Settings, Palette, Sparkles } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

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
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const isOwner = user?.role === "admin" && user?.openId === import.meta.env.VITE_OWNER_OPEN_ID;

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

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-6">
          <a href="/studio" className="text-sm text-slate-300 hover:text-[#f5b731] transition-colors" style={{ fontFamily: "var(--font-display)" }}>
            Print Studio
          </a>
          <a href="#services" className="text-sm text-slate-300 hover:text-[#f5b731] transition-colors" style={{ fontFamily: "var(--font-display)" }}>
            Services
          </a>
          <a href="#about" className="text-sm text-slate-300 hover:text-[#f5b731] transition-colors" style={{ fontFamily: "var(--font-display)" }}>
            About
          </a>
          <a href="#faq" className="text-sm text-slate-300 hover:text-[#f5b731] transition-colors" style={{ fontFamily: "var(--font-display)" }}>
            FAQ
          </a>

          {isOwner && (
            <>
              <a href="/aau" className="text-sm text-[#f5b731] hover:text-[#e67e22] transition-colors font-medium" style={{ fontFamily: "var(--font-display)" }}>
                AAU Basketball
              </a>
              <a href="/admin/billing" className="text-sm text-slate-300 hover:text-[#f5b731] transition-colors flex items-center gap-1" style={{ fontFamily: "var(--font-display)" }}>
                <Settings className="w-3.5 h-3.5" />
                Billing
              </a>
            </>
          )}
          <a
            href="#contact"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-medium text-sm transition-transform duration-160 hover:scale-[1.03] active:scale-[0.97]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <Mail className="w-4 h-4" />
            Get in Touch
          </a>
        </nav>

        {/* Mobile menu button */}
        <button
          className="sm:hidden p-2 text-white"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile menu dropdown */}
      <div
        className={`sm:hidden overflow-hidden transition-all duration-300 ease-out ${
          mobileOpen ? "max-h-72 opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <nav className="container pb-6 flex flex-col gap-4 bg-[#0a0e1a]/95 backdrop-blur-xl">
          <a href="/studio" className="text-base text-slate-300 hover:text-[#f5b731] transition-colors py-2" style={{ fontFamily: "var(--font-display)" }} onClick={() => setMobileOpen(false)}>
            Print Studio
          </a>
          <a href="#services" className="text-base text-slate-300 hover:text-[#f5b731] transition-colors py-2" style={{ fontFamily: "var(--font-display)" }} onClick={() => setMobileOpen(false)}>
            Services
          </a>
          <a href="#about" className="text-base text-slate-300 hover:text-[#f5b731] transition-colors py-2" style={{ fontFamily: "var(--font-display)" }} onClick={() => setMobileOpen(false)}>
            About
          </a>
          <a href="#faq" className="text-base text-slate-300 hover:text-[#f5b731] transition-colors py-2" style={{ fontFamily: "var(--font-display)" }} onClick={() => setMobileOpen(false)}>
            FAQ
          </a>

          {isOwner && (
            <>
              <a href="/aau" className="text-base text-[#f5b731] hover:text-[#e67e22] transition-colors py-2 font-medium" style={{ fontFamily: "var(--font-display)" }} onClick={() => setMobileOpen(false)}>
                AAU Basketball
              </a>
              <a href="/admin/billing" className="text-base text-slate-300 hover:text-[#f5b731] transition-colors py-2 flex items-center gap-2" style={{ fontFamily: "var(--font-display)" }} onClick={() => setMobileOpen(false)}>
                <Settings className="w-4 h-4" />
                Billing
              </a>
            </>
          )}
          <a
            href="#contact"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-medium text-sm transition-transform duration-160 active:scale-[0.97]"
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

function HeroSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section
      className="relative min-h-[100vh] flex items-center overflow-hidden"
      style={{
        background: `linear-gradient(180deg, #0a0e1a 0%, #0d1220 100%)`,
      }}
    >
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: `url(${HERO_BG_URL})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
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
              Design & Technology Studio
            </span>
          </div>

          <h1
            className={`text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.1] tracking-tight text-white mb-6 transition-all duration-700 delay-100 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
            style={{ fontFamily: "var(--font-display)" }}
          >
            We design, build &
            <br />
            elevate brands that
            <br />
            <span className="bg-gradient-to-r from-[#f5b731] to-[#e67e22] bg-clip-text text-transparent">
              stand apart.
            </span>
          </h1>

          <p
            className={`text-lg md:text-xl text-slate-300 max-w-xl leading-relaxed mb-10 transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            From print design and pattern engineering to web development and brand identity — we bring creative vision and technical precision to sports, fashion, and lifestyle brands.
          </p>

          <div
            className={`flex flex-col sm:flex-row gap-4 mb-8 transition-all duration-700 delay-300 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <a
              href="#contact"
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

          <div
            className={`flex items-center gap-2 text-slate-400 text-sm transition-all duration-700 delay-400 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <MapPin className="w-4 h-4 text-[#f5b731]/60" />
            <span>Based in Westchester, NY</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#0a0e1a] to-transparent" />
    </section>
  );
}

const services = [
  {
    icon: Palette,
    title: "Print & Pattern Design",
    description:
      "AI-powered print engineering for textiles and apparel. Scale, recolor, and refine patterns with precision tools built for fashion production.",
  },
  {
    icon: Code,
    title: "Web Development",
    description:
      "Bespoke websites and web applications built from the ground up. Clean code, modern frameworks, pixel-perfect execution.",
  },
  {
    icon: Sparkles,
    title: "Brand Identity",
    description:
      "Visual identity systems, logo design, and brand guidelines that give sports and lifestyle brands a distinctive creative edge.",
  },
  {
    icon: Globe,
    title: "Digital Strategy",
    description:
      "End-to-end digital presence management — hosting, performance, security, and ongoing evolution of your online platform.",
  },
];

function ServicesSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="services" className="relative py-16 md:py-20 bg-[#0a0e1a]">
      <div className="container" ref={ref}>
        <div className="grid lg:grid-cols-2 gap-16 items-center">
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
                    isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4"
                  }`}
                  style={{ transitionDelay: `${150 + i * 100}ms` }}
                >
                  <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-[#f5b731]/10 border border-[#f5b731]/20 flex items-center justify-center group-hover:bg-[#f5b731]/20 group-hover:border-[#f5b731]/40 transition-all duration-200">
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
    <section className="relative py-16 md:py-20 bg-[#0d1220]">
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
              className={`relative p-6 rounded-xl border border-white/5 bg-[#0a0e1a]/60 backdrop-blur-sm hover:border-[#f5b731]/20 hover:bg-[#0a0e1a]/80 transition-all duration-300 group ${
                isVisible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-8 scale-95"
              }`}
              style={{
                transitionDelay: `${200 + i * 120}ms`,
                transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
              }}
            >
              <span className="text-4xl font-bold bg-gradient-to-b from-[#f5b731] to-[#e67e22] bg-clip-text text-transparent group-hover:scale-110 inline-block transition-transform duration-200" style={{ fontFamily: "var(--font-display)" }}>
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

function AboutSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="about" className="relative py-16 md:py-20 bg-[#0a0e1a]">
      <div className="container" ref={ref}>
        <div className="max-w-3xl mx-auto">
          <div
            className={`flex items-center gap-2 mb-4 transition-all duration-500 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <StarAccent />
            <span className="text-sm font-medium text-[#f5b731] tracking-wider uppercase" style={{ fontFamily: "var(--font-display)" }}>
              About Us
            </span>
          </div>

          <h2
            className={`text-3xl md:text-4xl font-bold text-white mb-8 tracking-tight transition-all duration-700 delay-100 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
            style={{ fontFamily: "var(--font-display)" }}
          >
            Built on precision.
            <br />
            <span className="text-slate-400">Driven by craft.</span>
          </h2>

          <div
            className={`space-y-5 transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <p className="text-lg text-slate-300 leading-relaxed">
              Aster Sports is a design and technology studio based in Westchester, NY. We work at
              the intersection of creative design and technical engineering — from AI-powered print
              pattern tools for fashion production to custom web platforms for sports and lifestyle brands.
            </p>
            <p className="text-lg text-slate-300 leading-relaxed">
              We treat every project with the precision it deserves. Whether it's engineering a
              textile print workflow, building a brand identity system, or developing a web application,
              we bring the same care and craftsmanship to every detail.
            </p>
            <p className="text-slate-400 leading-relaxed">
              Currently serving fashion brands, sports organizations, and community-driven
              institutions across the Northeast and beyond.
            </p>
          </div>

          <div
            className={`mt-8 flex items-center gap-2 text-slate-400 text-sm transition-all duration-700 delay-300 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
            }`}
          >
            <MapPin className="w-4 h-4 text-[#f5b731]/60" />
            <span>Westchester, NY</span>
          </div>
        </div>
      </div>
    </section>
  );
}

const faqs = [
  {
    question: "What services does Aster Sports offer?",
    answer: "We offer AI-powered print and pattern design for textiles, custom web development, brand identity systems, and digital strategy. Our Print Studio tool lets fashion brands scale, recolor, and refine garment prints with precision.",
  },
  {
    question: "How does the Print Studio work?",
    answer: "Upload a garment photo, and our AI detects the print elements (florals, geometrics, textures). Then use controls to adjust density, scale, remove elements, or shift colorways. Results are generated in seconds.",
  },
  {
    question: "What's your typical project timeline?",
    answer: "Print Studio edits are instant. For web development and branding projects, most take 4–8 weeks from kickoff to launch. We'll give you a clear timeline during our discovery call.",
  },
  {
    question: "How does billing work?",
    answer: "Print Studio uses a credit-based system — each generation costs credits. For web and branding projects, we structure with a 50% deposit upfront and 50% upon completion. Monthly retainers available for ongoing work.",
  },
  {
    question: "Do you work with clients outside of Westchester?",
    answer: "Absolutely. While we're based in Westchester, NY, we work with fashion brands and organizations nationwide. Print Studio is available globally, and all collaboration happens digitally.",
  },
  {
    question: "What technologies power your tools?",
    answer: "Our Print Studio uses advanced AI image generation with textile-specific prompt engineering. Web projects use React, Node.js, and modern frameworks chosen for each client's needs.",
  },
];

function FAQSection() {
  const { ref, isVisible } = useScrollReveal();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="relative py-16 md:py-20 bg-[#0d1220]">
      <div className="container" ref={ref}>
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <div
              className={`flex items-center justify-center gap-2 mb-4 transition-all duration-500 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
            >
              <StarAccent />
              <span className="text-sm font-medium text-[#f5b731] tracking-wider uppercase" style={{ fontFamily: "var(--font-display)" }}>
                FAQ
              </span>
            </div>
            <h2
              className={`text-3xl md:text-4xl font-bold text-white tracking-tight transition-all duration-700 delay-100 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
              style={{ fontFamily: "var(--font-display)" }}
            >
              Common questions, straight answers.
            </h2>
          </div>

          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div
                key={i}
                className={`border border-white/5 rounded-xl overflow-hidden transition-all duration-500 ${
                  openIndex === i ? "bg-[#0a0e1a]/80 border-[#f5b731]/15" : "bg-[#0a0e1a]/40 hover:border-white/10"
                } ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
                style={{ transitionDelay: `${200 + i * 60}ms` }}
              >
                <button
                  className="w-full flex items-center justify-between p-5 text-left"
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                >
                  <span className="text-base font-medium text-white pr-4" style={{ fontFamily: "var(--font-display)" }}>
                    {faq.question}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-[#f5b731] flex-shrink-0 transition-transform duration-200 ${
                      openIndex === i ? "rotate-180" : ""
                    }`}
                  />
                </button>
                <div
                  className={`overflow-hidden transition-all duration-300 ease-out ${
                    openIndex === i ? "max-h-48 opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  <p className="px-5 pb-5 text-slate-400 leading-relaxed text-[15px]">
                    {faq.answer}
                  </p>
                </div>
              </div>
            ))}
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
    <section id="contact" className="relative py-16 md:py-20 overflow-hidden">
      {/* Background */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${CTA_BG_URL})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="absolute inset-0 bg-[#0a0e1a]/70" />

      <div className="container relative z-10" ref={ref}>
        <div className="max-w-4xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 md:gap-16 items-start">
            {/* Left: CTA text */}
            <div
              className={`transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-5"
              }`}
            >
              <StarAccent className="mb-6 w-5 h-5 animate-pulse-glow" />
              <h2
                className="text-3xl md:text-4xl font-bold text-white mb-6 tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Ready to create something
                <br />
                <span className="bg-gradient-to-r from-[#f5b731] to-[#e67e22] bg-clip-text text-transparent">
                  that stands apart?
                </span>
              </h2>
              <p className="text-lg text-slate-300 mb-8 leading-relaxed">
                Let's discuss your project. No pressure, no jargon — just a straightforward
                conversation about what you need.
              </p>
              <div className="space-y-3 text-slate-400">
                <div className="flex items-center gap-3">
                  <Mail className="w-4 h-4 text-[#f5b731]/60" />
                  <a href="mailto:frank@astersports.co" className="hover:text-[#f5b731] transition-colors">
                    frank@astersports.co
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <MapPin className="w-4 h-4 text-[#f5b731]/60" />
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
                <div className="p-8 rounded-2xl border border-[#f5b731]/20 bg-[#0a0e1a]/60 backdrop-blur-sm text-center">
                  <StarAccent className="mx-auto mb-4 w-6 h-6" />
                  <h3 className="text-xl font-semibold text-white mb-2" style={{ fontFamily: "var(--font-display)" }}>
                    Message ready to send
                  </h3>
                  <p className="text-slate-400 text-sm">
                    Your email client should have opened with your message. If not, email us directly at{" "}
                    <a href="mailto:frank@astersports.co" className="text-[#f5b731]">frank@astersports.co</a>.
                  </p>
                  <button
                    onClick={() => { setSubmitted(false); setFormState({ name: "", email: "", message: "" }); }}
                    className="mt-4 text-sm text-[#f5b731] hover:underline"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="p-6 md:p-8 rounded-2xl border border-white/5 bg-[#0a0e1a]/60 backdrop-blur-sm space-y-5">
                  <div>
                    <label htmlFor="name" className="block text-sm font-medium text-slate-300 mb-2" style={{ fontFamily: "var(--font-display)" }}>
                      Name
                    </label>
                    <input
                      id="name"
                      type="text"
                      required
                      value={formState.name}
                      onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg bg-[#111827] border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-[#f5b731]/40 focus:ring-1 focus:ring-[#f5b731]/20 transition-all"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-2" style={{ fontFamily: "var(--font-display)" }}>
                      Email
                    </label>
                    <input
                      id="email"
                      type="email"
                      required
                      value={formState.email}
                      onChange={(e) => setFormState({ ...formState, email: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg bg-[#111827] border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-[#f5b731]/40 focus:ring-1 focus:ring-[#f5b731]/20 transition-all"
                      placeholder="your@email.com"
                    />
                  </div>
                  <div>
                    <label htmlFor="message" className="block text-sm font-medium text-slate-300 mb-2" style={{ fontFamily: "var(--font-display)" }}>
                      Message
                    </label>
                    <textarea
                      id="message"
                      required
                      rows={4}
                      value={formState.message}
                      onChange={(e) => setFormState({ ...formState, message: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg bg-[#111827] border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-[#f5b731]/40 focus:ring-1 focus:ring-[#f5b731]/20 transition-all resize-none"
                      placeholder="Tell us about your project..."
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full bg-gradient-to-r from-[#f5b731] to-[#e67e22] text-[#0a0e1a] font-semibold text-base transition-transform duration-160 hover:scale-[1.02] active:scale-[0.97] shadow-lg shadow-[#f5b731]/20"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    <Send className="w-4 h-4" />
                    Send Message
                  </button>
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
  const { user } = useAuth();
  const isOwner = user?.role === "admin" && user?.openId === import.meta.env.VITE_OWNER_OPEN_ID;
  return (
    <footer className="py-12 bg-[#070a12] border-t border-white/5">
      <div className="container">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src={LOGO_URL} alt="Aster Sports" className="w-8 h-8" />
              <span className="text-base font-semibold text-white" style={{ fontFamily: "var(--font-display)" }}>
                Aster Sports
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8 text-sm text-slate-400">
              <span>Design, Technology & Creative Services</span>
              {isOwner && (
                <a href="/aau" className="text-[#f5b731] hover:text-[#e67e22] transition-colors">
                  AAU Basketball
                </a>
              )}
              <a href="/studio" className="text-[#f5b731] hover:text-[#e67e22] transition-colors">
                Print Studio
              </a>
              <a href="mailto:frank@astersports.co" className="text-[#f5b731] hover:text-[#e67e22] transition-colors">
                frank@astersports.co
              </a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-white/5">
            <p className="text-xs text-slate-500">
              &copy; {new Date().getFullYear()} Aster Sports. All rights reserved.
            </p>
            <div className="flex items-center gap-6 text-xs text-slate-500">
              <a href="/privacy" className="hover:text-slate-300 transition-colors">
                Privacy Policy
              </a>
              <a href="/terms" className="hover:text-slate-300 transition-colors">
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
    <div className="min-h-screen bg-[#0a0e1a]">
      <Header />
      <HeroSection />
      <ServicesSection />
      <ProcessSection />
      <AboutSection />
      <FAQSection />
      <ContactSection />
      <Footer />
    </div>
  );
}
