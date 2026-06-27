// Grade prior for the bracket predictor. A team listed a grade below its division's floor
// (e.g. a 4th-grade squad in a Girls 5th/6th division) is, on average, at a developmental
// disadvantage, so it carries a rating penalty. Heuristic by design — a team that plays up
// is occasionally elite — but it keeps a younger team from out-projecting the field when
// there's no head-to-head data to say otherwise. Grades are parsed from names; when a grade
// can't be read, no penalty is applied (neutral).

/** Rating points docked per grade a team is playing up. A grade of youth development is a
 *  large edge — bigger than a typical game margin — so the prior is deliberately heavy: it
 *  should make a grade-up team a clear underdog to the field, not a coin-flip. */
const GRADE_PENALTY_PTS = 12;

/** Lowest explicit grade ordinal (1st–8th) found in a string, or null. "Girls - 5th/6th" → 5. */
export function parseDivisionGradeFloor(name: string | null | undefined): number | null {
  if (!name) return null;
  const grades = Array.from(name.matchAll(/\b([1-8])(?:st|nd|rd|th)\b/gi), (m) => Number(m[1]));
  return grades.length ? Math.min(...grades) : null;
}

/** A team's own grade ordinal from its name, or null. "East Coast Storm 4th" → 4. Age bands
 *  like "11U" are NOT grades and return null. */
export function parseTeamGrade(name: string | null | undefined): number | null {
  if (!name) return null;
  const m = name.match(/\b([1-8])(?:st|nd|rd|th)\b/i);
  return m ? Number(m[1]) : null;
}

export interface RatedTeam {
  id: string;
  name?: string;
  rating?: number | null;
}

/**
 * Effective strength rating per team = cross-tournament rating (0 when unknown) minus a
 * grade-up penalty. ONLY teams with a real signal (a rating OR a grade penalty) get an
 * entry, so the predictor can tell "no signal at all" (omit → treated as neutral 0, and
 * if every team is neutral the odds are gated) from "rated dead-even".
 */
export function effectiveRatings(
  teams: RatedTeam[],
  divisionName: string | null | undefined,
): Record<string, number> {
  const floor = parseDivisionGradeFloor(divisionName);
  const out: Record<string, number> = {};
  for (const t of teams) {
    const grade = parseTeamGrade(t.name);
    const penalty = floor != null && grade != null && grade < floor ? GRADE_PENALTY_PTS * (floor - grade) : 0;
    const hasRating = t.rating != null;
    if (!hasRating && penalty === 0) continue; // no signal → omit (neutral baseline)
    out[t.id] = (t.rating ?? 0) - penalty;
  }
  return out;
}
