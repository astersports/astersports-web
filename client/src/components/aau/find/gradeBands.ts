// Grade age-band bucketing (render state 05 · spec §R4). The band is a PRESENTATION grouping
// over the real `tournament_divisions.grade_label` column values — a DECLARED map keyed on the
// actual column value, never a parse of a team/division NAME (spec §7 do-not).
//
// Split grades are expanded to their INDIVIDUAL grades (operator-directed 2026-06-27): a "5th/6th"
// division is filterable under BOTH 5th and 6th, so the picker shows individual grades only and a
// combined division matches either component. `expandGrade` is the structured split (on "/"),
// deterministic over the column value. Unknown/new values fall to "other" so they stay honest.

export type GradeBand = "lower" | "middle" | "hs" | "other";

export interface BandDef {
  id: GradeBand;
  label: string;
  sub: string;
  // canonical render order of the INDIVIDUAL grade values that belong to this band
  grades: string[];
}

export const GRADE_BANDS: BandDef[] = [
  { id: "lower", label: "Lower", sub: "2nd–4th", grades: ["2nd", "3rd", "4th"] },
  { id: "middle", label: "Middle", sub: "5th–8th", grades: ["5th", "6th", "7th", "8th"] },
  { id: "hs", label: "High School", sub: "9th+", grades: ["9th", "10th", "High School", "Varsity"] },
];

const BAND_OF: Record<string, GradeBand> = GRADE_BANDS.reduce((acc, b) => {
  b.grades.forEach((g) => (acc[g] = b.id));
  return acc;
}, {} as Record<string, GradeBand>);

/** Split a real grade_label into its individual component grades. "5th/6th" → ["5th","6th"];
 *  a singleton ("8th", "High School") → [itself]. Structured split on "/", never name-parsing. */
export function expandGrade(label: string | null | undefined): string[] {
  const s = (label ?? "").trim();
  if (!s) return [];
  if (!s.includes("/")) return [s];
  return s
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Which band an INDIVIDUAL grade belongs to; "other" for unknown/new values (honest, selectable). */
export function bandOf(grade: string | null | undefined): GradeBand {
  if (!grade) return "other";
  return BAND_OF[grade] ?? "other";
}

// Flattened once at module scope (GRADE_BANDS is static) so gradeOrder doesn't re-allocate the
// list on every sort-comparator call (Copilot #155).
const GRADE_FLAT: string[] = GRADE_BANDS.flatMap((b) => b.grades);

/** Stable display order index for an individual grade (younger → older), for sorting chips. */
export function gradeOrder(grade: string): number {
  const i = GRADE_FLAT.indexOf(grade);
  return i === -1 ? GRADE_FLAT.length : i;
}
