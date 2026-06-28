// Derive gender / grade / program from the strings the TM scrape gives us, since the
// ingest leaves grade_label/gender null and there is no club id (design doc D3). Pure,
// heuristic, fail-soft: anything we can't parse falls back to the raw name so nothing
// disappears.

export type Gender = "Boys" | "Girls" | "Coed";

export interface DivisionMeta {
  gender: Gender | null;
  grade: string | null; // display label, e.g. "5th", "10th", "High School"
}

/** "Boys - 10th" → {Boys, 10th}; "Girls - 5th Grade" → {Girls, 5th}; "Coed - HS" → {Coed, High School}. */
export function parseDivisionMeta(name: string): DivisionMeta {
  const parts = name.split(/\s*[-–·|]\s*/).map((p) => p.trim()).filter(Boolean);
  let gender: Gender | null = null;
  let grade: string | null = null;
  for (const p of parts) {
    const g = matchGender(p);
    if (g && !gender) {
      gender = g;
      continue;
    }
    if (!grade) {
      const gr = matchGrade(p);
      if (gr) grade = gr;
    }
  }
  // single-token fallback (e.g. "10U") — try the whole string for a grade
  if (!grade) grade = matchGrade(name);
  if (!gender) gender = matchGender(name);
  return { gender, grade };
}

function matchGender(s: string): Gender | null {
  const t = s.toLowerCase();
  if (/\bgirls?\b|\bg\b|\bwomen\b/.test(t)) return "Girls";
  if (/\bboys?\b|\bb\b|\bmen\b/.test(t)) return "Boys";
  if (/\bco-?ed\b/.test(t)) return "Coed";
  return null;
}

function matchGrade(s: string): string | null {
  const t = s.toLowerCase();
  if (/high\s*school|\bhs\b/.test(t)) return "High School";
  const ord = t.match(/(\d{1,2})\s*(st|nd|rd|th)/); // "5th"
  if (ord) return `${ord[1]}${ord[2]}`;
  const age = t.match(/\b(\d{1,2})\s*u\b/); // "10U" age group → show as-is
  if (age) return `${age[1]}U`;
  const uage = t.match(/\bu\s*(\d{1,2})\b/); // "U12"
  if (uage) return `${uage[1]}U`;
  return null;
}

/** "Aster AAU 11U" → "Aster AAU"; "Gravity Force 5th Grade" → "Gravity Force".
 *  Strips a trailing age/grade qualifier so same-club teams group. No match → full name. */
export function parseProgram(teamName: string): string {
  const stripped = teamName
    .replace(/\s+(\d{1,2}\s*u|u\s*\d{1,2})\b.*$/i, "")
    .replace(/\s+\d{1,2}\s*(st|nd|rd|th)(\s*grade)?\b.*$/i, "")
    .replace(/\s+(boys?|girls?)\b.*$/i, "")
    .trim();
  return stripped.length >= 3 ? stripped : teamName.trim();
}
