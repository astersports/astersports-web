import { Check, Plus } from "lucide-react";
import type { AauTeamVariant } from "@/lib/aster";
import { C } from "./findUi";

// One team variant row (render state 02). Carries value IN THE ROW (spec §R4): division chips
// (gender·grade·tier·day, real columns — no name-parsing), W–L record, rating (basis-gated:
// "—" when basis is false, never a guessed number), live dot. The tap IS the Track toggle
// (Find ends at the row + the tap — no Team Detail navigation from here, spec §1/§9).

// `nested` = rendered under a program header (indented + tree connector); false = standalone row.
export default function VariantRow({
  v,
  tracked,
  onToggle,
  nested,
}: {
  v: AauTeamVariant;
  tracked: boolean;
  onToggle: (v: AauTeamVariant) => void;
  nested: boolean;
}) {
  const chips: { label: string; kind?: "g" | "tier" }[] = [];
  if (v.gender) chips.push({ label: v.gender, kind: "g" });
  if (v.gradeLabel) chips.push({ label: v.gradeLabel });
  if (v.tier) chips.push({ label: v.tier, kind: "tier" });
  if (v.day) chips.push({ label: v.day });

  const hasRecord = v.record.w > 0 || v.record.l > 0;
  const ratingLabel = v.basis && v.rating != null ? v.rating.toFixed(1) : "—";

  return (
    <div
      className="relative flex items-center gap-[10px] py-[8px]"
      style={nested ? { paddingLeft: 40, paddingRight: 18 } : { paddingLeft: 18, paddingRight: 18 }}
    >
      {nested && (
        <>
          <span className="pointer-events-none absolute left-[30px] top-0 h-1/2 w-px" style={{ background: C.line }} aria-hidden />
          <span className="pointer-events-none absolute left-[30px] top-1/2 h-px w-[9px]" style={{ background: C.line }} aria-hidden />
        </>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-[7px] text-[20.8px] font-medium" style={{ color: C.ink }}>
          <span className="truncate">{v.name}</span>
          {v.isLive && (
            <span className="flex shrink-0 items-center gap-1 text-[16px]" style={{ color: C.live }}>
              <span
                className="inline-block h-[7px] w-[7px] rounded-full"
                style={{ background: C.live, boxShadow: `0 0 7px ${C.live}` }}
                aria-hidden
              />
              live
            </span>
          )}
        </span>
        <span className="mt-[3px] flex flex-wrap items-center gap-[5px]">
          {chips.map((c, i) => (
            <span
              key={i}
              className="rounded-[6px] border px-[7px] py-[2px] font-[var(--font-mono)] text-[14.4px]"
              style={
                c.kind === "g"
                  ? { color: C.cobalt, borderColor: "rgba(37,99,235,.3)" }
                  : c.kind === "tier"
                    ? { color: C.g3, borderColor: "#E2C98A" }
                    : { color: C.dim, borderColor: C.line }
              }
            >
              {c.label}
            </span>
          ))}
          {/* value-in-row: record (real results) + rating (projection, basis-gated) */}
          <span className="font-[var(--font-mono)] text-[14.4px]" style={{ color: hasRecord ? C.pos : C.mut }}>
            {hasRecord ? `${v.record.w}–${v.record.l}` : "0–0"}
          </span>
          <span className="font-[var(--font-mono)] text-[14.4px]" style={{ color: v.basis ? C.g3 : C.mut }} title="rating · a projection, distinct from the W–L record">
            rtg {ratingLabel}
          </span>
        </span>
      </span>
      <button
        type="button"
        onClick={() => onToggle(v)}
        aria-pressed={tracked}
        aria-label={`${tracked ? "Untrack" : "Track"} ${v.name} (${v.tournamentName})`}
        className="as-press flex min-h-[44px] shrink-0 items-center gap-1 rounded-[8px] px-[11px] font-[var(--font-mono)] text-[16px] font-semibold"
        style={
          tracked
            ? { background: "rgba(95,160,230,.14)", border: "1px solid rgba(95,160,230,.4)", color: "#bcd8f6" }
            : { background: C.grad, border: "none", color: "#1a1206" }
        }
      >
        {tracked ? (
          <>
            <Check className="h-[11px] w-[11px]" /> Tracked
          </>
        ) : (
          <>
            <Plus className="h-[11px] w-[11px]" /> Track
          </>
        )}
      </button>
    </div>
  );
}
