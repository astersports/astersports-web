// Grade age-band bucketing (render state 05 · spec §R4). The band is a PRESENTATION grouping
// over the real `tournament_divisions.grade_label` column values — a DECLARED map keyed on the
// actual column value, never a parse of a team/division NAME (spec §7 do-not). Unknown/new
// grade_labels fall to "other" so they stay selectable and honest rather than vanishing.

export type GradeBand = "lower" | "middle" | "hs" | "other";

export interface BandDef {
  id: GradeBand;
  label: string;
  sub: string;
  // canonical render order of the grade_label values that belong to this band
  grades: string[];
}

// Bands cover the 18 grade_label values present in the directory (grounded 2026-06-27). A split
// grade (e.g. 4th/5th) is placed by its YOUNGER grade's band. New values → "other".
export const GRADE_BANDS: BandDef[] = [
  { id: "lower", label: "Lower", sub: "2nd–4th", grades: ["2nd", "2nd/3rd", "3rd", "3rd/4th", "4th", "4th/5th"] },
  { id: "middle", label: "Middle", sub: "5th–8th", grades: ["5th", "5th/6th", "6th", "6th/7th", "7th", "8th", "8th/9th"] },
  { id: "hs", label: "High School", sub: "9th+", grades: ["9th", "9th/10th", "10th", "High School", "Varsity"] },
];

const BAND_OF: Record<string, GradeBand> = GRADE_BANDS.reduce((acc, b) => {
  b.grades.forEach((g) => (acc[g] = b.id));
  return acc;
}, {} as Record<string, GradeBand>);

/** Which band a real grade_label belongs to; "other" for unknown/new values (honest, selectable). */
export function bandOf(grade: string | null | undefined): GradeBand {
  if (!grade) return "other";
  return BAND_OF[grade] ?? "other";
}

/** Stable display order index for a grade_label (younger → older), for sorting chips. */
export function gradeOrder(grade: string): number {
  const flat = GRADE_BANDS.flatMap((b) => b.grades);
  const i = flat.indexOf(grade);
  return i === -1 ? flat.length : i;
}
