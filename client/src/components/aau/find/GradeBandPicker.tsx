import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { GRADE_BANDS, bandOf, gradeOrder, type GradeBand } from "./gradeBands";
import { C } from "./findUi";

// Render state 05 — the grade age-band picker (shared by Browse + Track). Bands (Lower / Middle /
// High School) are collapsible; each holds the REAL grade_label chips present in the data. Tap a
// grade to toggle it, or "All" to take the whole band. Reads the structured grade column — no
// name-parsing (spec §R4/§7). `available` is the set of grade_labels actually present so empty
// bands never render.

export default function GradeBandPicker({
  available,
  selected,
  onToggleGrade,
  onToggleBand,
}: {
  available: string[];
  selected: Set<string>;
  onToggleGrade: (grade: string) => void;
  onToggleBand: (grades: string[]) => void;
}) {
  // grades present, grouped per band in canonical order
  const bands = useMemo(() => {
    const present = new Set(available);
    return GRADE_BANDS.map((b) => ({
      ...b,
      grades: b.grades.filter((g) => present.has(g)),
    }))
      .concat(
        // any unknown grade_labels → an "Other" band so they stay selectable (honest)
        (() => {
          const other = available.filter((g) => bandOf(g) === "other").sort((a, b) => gradeOrder(a) - gradeOrder(b));
          return other.length ? [{ id: "other" as GradeBand, label: "Other", sub: "uncatalogued", grades: other }] : [];
        })(),
      )
      .filter((b) => b.grades.length > 0);
  }, [available]);

  // open the band(s) holding a selection; else the first non-empty band
  const [open, setOpen] = useState<Set<GradeBand>>(() => {
    const init = new Set<GradeBand>();
    bands.forEach((b) => {
      if (b.grades.some((g) => selected.has(g))) init.add(b.id);
    });
    if (init.size === 0 && bands[0]) init.add(bands[0].id);
    return init;
  });

  if (bands.length === 0) return null;

  return (
    <div className="pt-[2px]">
      {bands.map((b) => {
        const isOpen = open.has(b.id);
        const allOn = b.grades.every((g) => selected.has(g));
        return (
          <div key={b.id} style={{ borderTop: `1px solid ${C.hair}` }}>
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() =>
                setOpen((prev) => {
                  const next = new Set(prev);
                  if (next.has(b.id)) next.delete(b.id);
                  else next.add(b.id);
                  return next;
                })
              }
              className="as-press flex w-full items-center gap-[10px] px-[18px] py-[12px] text-left font-[var(--font-mono)] text-[16px] uppercase tracking-[0.1em]"
              style={{ color: isOpen ? "#8F6708" : C.mut }}
            >
              <ChevronDown className="h-[10px] w-[10px] transition-transform" style={{ color: isOpen ? C.g3 : C.mut, transform: isOpen ? "none" : "rotate(-90deg)" }} />
              {b.label} · {b.sub}
            </button>
            {isOpen && (
              <div className="flex flex-wrap gap-[7px] px-[18px] pb-[12px] pt-[2px]">
                <button
                  type="button"
                  aria-pressed={allOn}
                  onClick={() => onToggleBand(b.grades)}
                  className="as-press rounded-[10px] px-[13px] py-[8px] font-[var(--font-mono)] text-[17.6px]"
                  style={allOn ? { background: C.grad, color: "#1a1206", fontWeight: 700 } : { border: `1px solid ${C.line}`, color: C.dim }}
                >
                  All
                </button>
                {b.grades.map((g) => {
                  const on = selected.has(g);
                  return (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onToggleGrade(g)}
                      className="as-press rounded-[10px] px-[13px] py-[8px] font-[var(--font-mono)] text-[17.6px]"
                      style={on ? { background: C.grad, color: "#1a1206", fontWeight: 700 } : { border: `1px solid ${C.line}`, color: C.dim }}
                    >
                      {g}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
