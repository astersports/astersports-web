import { useEffect, useMemo, useState } from "react";
import { getTournamentStandings, type PublicStandingsBundle } from "@/lib/aster";
import { computeStandings, type RankedRow } from "@/lib/standings/computeStandings";
import { predictBracket, type Prediction } from "@/lib/standings/predictBracket";
import { effectiveRatings } from "@/lib/aau/gradePrior";

/**
 * Multi-division standings — ONE poll per UNIQUE divisionId, shared across every Home card that
 * needs it (Copilot review on #208: each TeamAccordionCard previously mounted its own
 * useAauStandings, fanning out duplicate 60s intervals + fetches when teams share a division).
 * Same source/engine as Browse (getTournamentStandings → computeStandings + predictBracket), so the
 * Home slice and the full Browse table never diverge. Returns a getter the cards read by divisionId.
 */
export interface DivisionStanding {
  standings: RankedRow[];
  advanceCount: number | null;
  predictFor: (focusId: string) => Prediction;
  loading: boolean;
}

const EMPTY: DivisionStanding = { standings: [], advanceCount: null, predictFor: () => ({ available: false }), loading: true };

export function useDivisionStandings(divisionIds: string[]): (id: string | null) => DivisionStanding {
  // Stable cache key: unique, sorted — so re-renders with the same division set don't re-fetch.
  const key = useMemo(() => Array.from(new Set(divisionIds.filter(Boolean))).sort().join(","), [divisionIds]);
  const [bundles, setBundles] = useState<Record<string, PublicStandingsBundle | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (!ids.length) { setBundles({}); setLoading(false); return; }
    let active = true;
    const load = async () => {
      const entries = await Promise.all(
        ids.map(async (id) => {
          try { return [id, await getTournamentStandings(id)] as const; }
          catch { return [id, null] as const; }
        }),
      );
      if (active) { setBundles(Object.fromEntries(entries)); setLoading(false); }
    };
    setLoading(true);
    load();
    const t = setInterval(load, 60_000); // one interval for the whole set
    return () => { active = false; clearInterval(t); };
  }, [key]);

  return useMemo(() => {
    const computed: Record<string, DivisionStanding> = {};
    for (const [id, bundle] of Object.entries(bundles)) {
      if (!bundle) { computed[id] = { ...EMPTY, loading }; continue; }
      const { teams, games, remaining, rules, division } = bundle;
      const advanceCount = division?.advance_count ?? null;
      const standings = computeStandings({ teams, games, rules, advanceCount });
      const eff = effectiveRatings(teams, division?.name);
      const predictFor = (focusId: string): Prediction => predictBracket({ teams, games, remaining, rules, advanceCount, focusId, eff });
      computed[id] = { standings, advanceCount, predictFor, loading: false };
    }
    return (id: string | null) => (id != null && computed[id]) || { ...EMPTY, loading };
  }, [bundles, loading]);
}
