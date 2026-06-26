import { useEffect, useMemo, useState } from "react";
import { getTournamentStandings, type PublicStandingsBundle } from "@/lib/aster";
import { computeStandings, type RankedRow } from "@/lib/standings/computeStandings";
import { predictBracket, type Prediction } from "@/lib/standings/predictBracket";

/**
 * Reads one division's standings inputs from the aster-sports backbone (public RPC) and
 * runs the ported engine: the SAME computeStandings powers the table AND the predictor
 * (one source). predictFor(teamId) enumerates the remaining games for that team's odds.
 * Polls every 60s so live scores + odds update during a tournament.
 */
export interface AauStandings {
  loading: boolean;
  error: Error | null;
  bundle: PublicStandingsBundle | null;
  standings: RankedRow[];
  advanceCount: number | null;
  predictFor: (focusId: string) => Prediction;
}

export function useAauStandings(divisionId: string | null): AauStandings {
  const [bundle, setBundle] = useState<PublicStandingsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!divisionId) { if (active) { setBundle(null); setLoading(false); } return; }
      try {
        const data = await getTournamentStandings(divisionId);
        if (active) { setBundle(data); setError(null); }
      } catch (e) {
        if (active) { setError(e as Error); setBundle(null); }
      } finally {
        if (active) setLoading(false);
      }
    };
    setLoading(true);
    load();
    const t = setInterval(load, 60_000);
    return () => { active = false; clearInterval(t); };
  }, [divisionId]);

  return useMemo(() => {
    if (!bundle) {
      return { loading, error, bundle: null, standings: [], advanceCount: null, predictFor: () => ({ available: false }) };
    }
    const { teams, games, remaining, rules, division } = bundle;
    const advanceCount = division?.advance_count ?? null;
    const standings = computeStandings({ teams, games, rules, advanceCount });
    const predictFor = (focusId: string): Prediction =>
      predictBracket({ teams, games, remaining, rules, advanceCount, focusId });
    return { loading, error, bundle, standings, advanceCount, predictFor };
  }, [bundle, loading, error]);
}
