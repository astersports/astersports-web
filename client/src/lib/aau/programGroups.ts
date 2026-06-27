import type { AauTeamVariant } from "@/lib/aster";

// Cluster flat search variant rows into program groups from the NON-AUTHORITATIVE
// `programGroup` hint the backbone derives (search_public_aau). This is the §2.E
// "one High Rise, not five rows" win — rendered PRESENTATION-ONLY, never written.
//
// Architect E4 guardrails (binding):
//  - CONSERVATIVE: rows cluster only when they share a non-null hint. A null hint is a
//    standalone team (its own group, no program header) — never merged on a guess.
//  - PRESENTATION-ONLY: grouping never changes the authoritative teamKey (resolved_key),
//    never affects tracking/routing — those stay keyed per-variant on teamKey.
//  - ZERO-DEBT SUPERSEDE: when the true `programs` entity lands it populates the same
//    hint; this helper is unchanged.
//
// Input order is preserved (the RPC already orders by recency); a program group sorts
// to where its FIRST variant appears.

export interface ProgramGroup {
  key: string; // stable React key
  program: string | null; // program label, or null for a standalone team (no header)
  variants: AauTeamVariant[];
}

export function groupByProgram(variants: AauTeamVariant[]): ProgramGroup[] {
  const groups: ProgramGroup[] = [];
  const byKey = new Map<string, ProgramGroup>();
  for (const v of variants) {
    const hint = v.programGroup?.trim();
    if (hint) {
      const k = `pg:${hint.toLowerCase()}`;
      let g = byKey.get(k);
      if (!g) {
        g = { key: k, program: hint, variants: [] };
        byKey.set(k, g);
        groups.push(g);
      }
      g.variants.push(v);
    } else {
      // standalone team — its own group, no program header, never merged
      groups.push({ key: `solo:${v.teamKey}:${v.divisionId}`, program: null, variants: [v] });
    }
  }
  return groups;
}

/** A group renders a program header only when it genuinely clusters (≥2 variants);
 *  a single-variant program reads as a normal team row (don't add header chrome for one). */
export function hasProgramHeader(g: ProgramGroup): boolean {
  return g.program !== null && g.variants.length >= 2;
}
