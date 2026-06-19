/**
 * Billing + credit constants. Single source of truth shared by client & server.
 * 1 standard generation = 10 credits. Generation is HARD-BLOCKED at 0 balance.
 */
export const CREDITS_PER_GENERATION = 10;

/** Warn the tenant when balance falls at or below this threshold. */
export const LOW_BALANCE_THRESHOLD = 100;

export type PlanKey = "none" | "starter" | "pro" | "team";

export interface PlanDef {
  key: PlanKey;
  name: string;
  /** Monthly price in USD. For team this is per-seat. */
  priceMonthly: number;
  perSeat: boolean;
  /** Credits granted per billing cycle (per seat for team). */
  creditsPerCycle: number;
  blurb: string;
  features: string[];
}

export const PLANS: Record<Exclude<PlanKey, "none">, PlanDef> = {
  starter: {
    key: "starter",
    name: "Starter",
    priceMonthly: 39,
    perSeat: false,
    creditsPerCycle: 3900,
    blurb: "For a single designer or a trial firm.",
    features: ["3,900 credits / mo", "~390 generations", "1 seat", "All three controls"],
  },
  pro: {
    key: "pro",
    name: "Pro",
    priceMonthly: 199,
    perSeat: false,
    creditsPerCycle: 19900,
    blurb: "For an active design team.",
    features: ["19,900 credits / mo", "~1,990 generations", "Up to 10 seats", "Priority processing"],
  },
  team: {
    key: "team",
    name: "Team",
    priceMonthly: 20,
    perSeat: true,
    creditsPerCycle: 2000,
    blurb: "Scale across seats. Pooled credits per seat.",
    features: ["From $20 / seat / mo", "2,000 credits / seat", "Unlimited seats", "Shared firm library"],
  },
};

/** Pay-as-you-go credit top-up packs. */
export interface TopupPack {
  key: string;
  name: string;
  credits: number;
  priceUsd: number;
}

export const TOPUP_PACKS: TopupPack[] = [
  { key: "topup_small", name: "Small Pack", credits: 1000, priceUsd: 15 },
  { key: "topup_medium", name: "Medium Pack", credits: 5000, priceUsd: 60 },
  { key: "topup_large", name: "Large Pack", credits: 20000, priceUsd: 200 },
];

/** Credit cost model per action. */
export const CREDIT_COST = {
  standardGeneration: 10,
  extraVariation: 10,
  combinedControls: 15,
  highRes: 5,
} as const;
