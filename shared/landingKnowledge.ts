/**
 * Landing knowledge pack — the single source of truth for the facts the
 * astersports.io landing surface presents: the curated product list, the studio
 * positioning, and the FAQ. BOTH the public page (the FAQ section in
 * client/src/pages/Home.tsx) and the "Aster Scout" agent
 * (docs/SPEC_LANDING_AGENT.txt, P3) read from here — so the page and the agent
 * can never drift (acceptance condition C4).
 *
 * No imports on purpose: this is plain data, safe to import from the server
 * (agent prompt) and the client (FAQ render) alike. The product facts are
 * version-pinned to the client service registry (client/src/lib/services.ts);
 * client/src/lib/landingKnowledge.test.ts fails the build if they drift, and
 * also asserts the pack carries no raw price literal (so the agent has nothing
 * to parrot — supports condition C1: the registry speaks prices/URLs, the model
 * only routes).
 */

export type KnowledgeStatus = "live" | "beta" | "members" | "soon";

export interface KnowledgeProduct {
  /** Matches the service-registry id — the agent routes by this id (never a URL). */
  id: string;
  kind: "product" | "service";
  name: string;
  tagline: string;
  description: string;
  href: string;
  status?: KnowledgeStatus;
}

/**
 * Mirror of PRODUCTS + SERVICES from client/src/lib/services.ts, minus the
 * presentational fields (icon/accent/cta/nav). Pinned by the sync test.
 */
export const KNOWLEDGE_PRODUCTS: KnowledgeProduct[] = [
  {
    id: "studio",
    kind: "product",
    name: "Print Studio",
    tagline: "AI print & pattern engineering",
    description:
      "Upload a garment, detect its print elements, then scale, recolor, and refine patterns in seconds. Built for fashion production, priced per generation.",
    href: "/studio",
    status: "live",
  },
  {
    id: "app",
    kind: "product",
    name: "Aster Sports App",
    tagline: "One platform for youth sports orgs",
    description:
      "Schedules, rosters, RSVPs, messaging, and financials for youth sports organizations — replacing spreadsheets, group texts, and LeagueApps with one mobile-first app.",
    href: "https://astersports.app",
    status: "beta",
  },
  {
    id: "aau",
    kind: "product",
    name: "Aster Sports AAU Hub",
    tagline: "Track any tournament — live scores & predictor",
    description:
      "Paste a TourneyMachine link and follow any AAU team — live scores, standings, the exact bracket predictor, and game-day directions. Free to browse; track your teams to unlock the dashboard, alerts, and navigation.",
    href: "/aau",
    status: "live",
  },
  {
    id: "stpatrick",
    kind: "product",
    name: "St Patrick in Armonk",
    tagline: "Parish website & digital forms",
    description:
      "A full parish website — Mass times, bulletins, daily readings, calendar, and a digital forms suite for sacraments, CCD, and CYO registration. Rebuilt for the Armonk parish; preview live now, replacing the eCatholic site at cutover.",
    href: "https://st-patricks-armonk-production.up.railway.app",
    status: "beta",
  },
  {
    id: "legacy-hoopers",
    kind: "product",
    name: "Aster AAU",
    tagline: "Program site · beyond LeagueApps",
    description:
      "A public program site for Aster AAU — live scores, tournament history, season records, and film — powered by the Aster platform in place of LeagueApps. Early preview live now.",
    href: "https://legacy-hoopers-production.up.railway.app",
    status: "beta",
  },
  {
    id: "websites",
    kind: "product",
    name: "Websites",
    tagline: "Bespoke org & community sites",
    description:
      "Full-featured websites for organizations and communities — live data, calendars, registration, and admin tools, built on the Aster platform.",
    href: "#contact",
    status: "soon",
  },
  {
    id: "print-design",
    kind: "service",
    name: "Print & Pattern Design",
    tagline: "Textile & apparel print engineering",
    description:
      "AI-assisted print engineering for textiles and apparel — scale, recolor, and refine patterns with production-grade precision.",
    href: "/studio",
  },
  {
    id: "web",
    kind: "service",
    name: "Web Development",
    tagline: "Bespoke sites & web apps",
    description:
      "Custom websites and web applications built from the ground up — clean code, modern frameworks, pixel-perfect execution.",
    href: "#contact",
  },
  {
    id: "brand",
    kind: "service",
    name: "Brand Identity",
    tagline: "Identity systems & logos",
    description:
      "Visual identity systems, logo design, and brand guidelines that give sports and lifestyle brands a distinctive creative edge.",
    href: "#contact",
  },
  {
    id: "strategy",
    kind: "service",
    name: "Digital Strategy",
    tagline: "Hosting, performance & evolution",
    description:
      "End-to-end digital presence — hosting, performance, security, and the ongoing evolution of your online platform.",
    href: "#contact",
  },
];

/**
 * Model-facing projection of the product facts for the "Aster Scout" agent (P3).
 * Deliberately DROPS `href` (and never carries any URL): the agent routes by
 * `id`, and the CLIENT renders the registry-sourced CTA card with the actual
 * link — the model never sees or emits a URL (condition C1). Build the agent
 * prompt from SCOUT_FACTS, NEVER from KNOWLEDGE_PRODUCTS (which keeps `href` for
 * the page's CTA + the C4 registry mirror). The guard test asserts SCOUT_FACTS
 * is URL-free.
 */
export interface ScoutFact {
  id: string;
  kind: "product" | "service";
  name: string;
  tagline: string;
  description: string;
  status?: KnowledgeStatus;
}

export const SCOUT_FACTS: ScoutFact[] = KNOWLEDGE_PRODUCTS.map(
  ({ id, kind, name, tagline, description, status }) => ({
    id,
    kind,
    name,
    tagline,
    description,
    status,
  })
);

/** Short studio positioning — the "who we are" the agent leads with. */
export const POSITIONING: string[] = [
  "Aster Sports is a design and technology studio based in Westchester, NY, building the products youth sports actually run on — print, the app, and the programs we field ourselves.",
  "We work at the intersection of creative design and technical engineering: AI-assisted print tooling for fashion production, and custom web platforms for sports and community organizations.",
  "We serve fashion brands, sports organizations, and community institutions across the Northeast and beyond.",
];

export interface FaqEntry {
  q: string;
  a: string;
}

/**
 * The landing FAQ. This IS the source the page renders (Home.tsx imports it) and
 * the grounding the agent answers from — one list, no drift (condition C4). Keep
 * answers qualitative: no hard dollar prices (the registry/checkout speaks
 * those), so there is nothing here for the agent to misquote (condition C1).
 */
export const FAQ: FaqEntry[] = [
  {
    q: "What does Aster Sports offer?",
    a: "Aster Sports is a platform with several products: Print Studio (AI print & pattern engineering for apparel), a Sports Management App for youth sports organizations, and the Aster Sports AAU Hub for live AAU tournament tracking. We also take on bespoke web development, brand identity, and digital strategy engagements.",
  },
  {
    q: "What is the Sports Management App?",
    a: "It's a mobile-first platform for youth sports organizations — schedules, rosters, RSVPs, team messaging, and financials in one place, replacing spreadsheets, group texts, and LeagueApps. It's live in beta with our pilot program; open it from the Aster Sports App card.",
  },
  {
    q: "How does the Print Studio work?",
    a: "Upload a garment photo, and our AI detects the print elements (florals, geometrics, textures). Then use controls to adjust density, scale, remove elements, or shift colorways. Results are generated in seconds.",
  },
  {
    q: "What's your typical project timeline?",
    a: "Print Studio edits are instant. For web development and branding projects, most take a few weeks from kickoff to launch. We'll give you a clear timeline during our discovery call.",
  },
  {
    q: "How does billing work?",
    a: "Print Studio uses a credit-based system — each generation costs credits. For web and branding projects, we structure with a deposit upfront and the balance on completion. Monthly retainers are available for ongoing work.",
  },
  {
    q: "Do you work with clients outside of Westchester?",
    a: "Absolutely. While we're based in Westchester, NY, we work with fashion brands and organizations nationwide. Print Studio is available globally, and all collaboration happens digitally.",
  },
  {
    q: "What technologies power your tools?",
    a: "Our Print Studio uses advanced AI image generation with textile-specific prompt engineering. Web projects use React, Node.js, and modern frameworks chosen for each client's needs.",
  },
];
