/**
 * Aster Sports — service registry.
 *
 * Single source of truth for everything the platform offers. The landing page,
 * header nav, and footer all render from this list, so bringing a new service
 * online (or flipping its status) is a one-entry edit here — no page surgery.
 *
 * `kind: "product"` = a live destination users can open (Studio, the app, AAU).
 * `kind: "service"` = an agency offering we sell as engagements (web, brand, etc.).
 */

import {
  Shirt,
  Smartphone,
  Trophy,
  Code,
  Sparkles,
  Globe,
  Palette,
  Monitor,
  type LucideIcon,
} from "lucide-react";
import { APP_URL } from "@/const";

export type ServiceStatus = "live" | "beta" | "members" | "soon";
export type ServiceKind = "product" | "service";

export interface ServiceEntry {
  /** Stable id (also the anchor / key). */
  id: string;
  kind: ServiceKind;
  name: string;
  /** One-line hook shown under the name on a card. */
  tagline: string;
  /** Longer card body. */
  description: string;
  href: string;
  /** True when the link leaves astersports.io (opens in a new tab). */
  external?: boolean;
  /** Products carry a status pill; services usually don't. */
  status?: ServiceStatus;
  icon: LucideIcon;
  /** Accent hex used for the card glow + icon. */
  accent: string;
  /** Button label on the product card. */
  cta?: string;
  /** Show in the top nav / footer link rail. */
  inNav?: boolean;
  /** Short label for the nav rail (falls back to `name` on detail surfaces). */
  navLabel?: string;
}

export const STATUS_META: Record<
  ServiceStatus,
  { label: string; color: string; bg: string }
> = {
  live: { label: "Live", color: "#34d399", bg: "rgba(52, 211, 153, 0.12)" },
  beta: { label: "Beta", color: "#4a9fff", bg: "rgba(74, 159, 255, 0.12)" },
  members: { label: "Members", color: "#a78bfa", bg: "rgba(167, 139, 250, 0.14)" },
  soon: { label: "Coming soon", color: "#94a3b8", bg: "rgba(148, 163, 184, 0.12)" },
};

/** Live destinations — the things you can actually open today. */
export const PRODUCTS: ServiceEntry[] = [
  {
    id: "studio",
    kind: "product",
    name: "Print Studio",
    tagline: "AI print & pattern engineering",
    description:
      "Upload a garment, detect its print elements, then scale, recolor, and refine patterns in seconds. Built for fashion production, priced per generation.",
    href: "/studio",
    status: "live",
    icon: Shirt,
    accent: "#F6CC55",
    cta: "Open Studio",
    inNav: true,
    navLabel: "Studio",
  },
  {
    id: "app",
    kind: "product",
    name: "Sports Management App",
    tagline: "One platform for youth sports orgs",
    description:
      "Schedules, rosters, RSVPs, messaging, and financials for youth sports organizations — replacing spreadsheets, group texts, and LeagueApps with one mobile-first app.",
    href: APP_URL,
    external: true,
    status: "beta",
    icon: Smartphone,
    accent: "#4a9fff",
    cta: "Explore the App",
    inNav: true,
    navLabel: "App",
  },
  {
    id: "aau",
    kind: "product",
    name: "AAU Basketball",
    tagline: "Aster 11U Girls · Zero Gravity AAU",
    description:
      "Live scores, tournament history, season records, film, and venues for the Aster AAU house program — a working showcase of what the platform powers for a real team.",
    href: "/aau",
    status: "live",
    icon: Trophy,
    accent: "#a78bfa",
    cta: "View the Program",
    inNav: true,
    navLabel: "Programs",
  },
  {
    // Productized site-building service. St Patrick (Armonk) is the first public
    // flagship, going live to the wider public in fall 2026.
    id: "websites",
    kind: "product",
    name: "Websites",
    tagline: "Bespoke org & community sites",
    description:
      "Full-featured websites for organizations and communities — live data, calendars, registration, and admin tools. St. Patrick's of Armonk is our first public build, launching fall 2026.",
    href: "#contact",
    status: "soon",
    icon: Monitor,
    accent: "#34d399",
    cta: "Start a Site",
  },
];

/** Agency engagements — sold as projects, not self-serve products. */
export const SERVICES: ServiceEntry[] = [
  {
    id: "print-design",
    kind: "service",
    name: "Print & Pattern Design",
    tagline: "Textile & apparel print engineering",
    description:
      "AI-assisted print engineering for textiles and apparel — scale, recolor, and refine patterns with production-grade precision.",
    href: "/studio",
    icon: Palette,
    accent: "#F6CC55",
  },
  {
    id: "web",
    kind: "service",
    name: "Web Development",
    tagline: "Bespoke sites & web apps",
    description:
      "Custom websites and web applications built from the ground up — clean code, modern frameworks, pixel-perfect execution.",
    href: "#contact",
    icon: Code,
    accent: "#4a9fff",
  },
  {
    id: "brand",
    kind: "service",
    name: "Brand Identity",
    tagline: "Identity systems & logos",
    description:
      "Visual identity systems, logo design, and brand guidelines that give sports and lifestyle brands a distinctive creative edge.",
    href: "#contact",
    icon: Sparkles,
    accent: "#E0631C",
  },
  {
    id: "strategy",
    kind: "service",
    name: "Digital Strategy",
    tagline: "Hosting, performance & evolution",
    description:
      "End-to-end digital presence — hosting, performance, security, and the ongoing evolution of your online platform.",
    href: "#contact",
    icon: Globe,
    accent: "#34d399",
  },
];

/** Everything, for nav/footer rendering. */
export const ALL_SERVICES: ServiceEntry[] = [...PRODUCTS, ...SERVICES];

/** Products that should appear as links in the header + footer. */
export const NAV_PRODUCTS = PRODUCTS.filter((p) => p.inNav);
