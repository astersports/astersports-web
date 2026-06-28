import { Link2, Check, Loader2 } from "lucide-react";
import { C } from "./findUi";

// Render state 03 "Paste any link" — restyle of the EXISTING submit→poll ingest flow. The
// submit/poll logic stays in the orchestrator (FindDiscovery); this is the presentational
// surface. HONEST status only (spec §7): the step text comes from the real ingest phase, and
// there is NO fabricated % — the render's 62% bar is placeholder. We show an indeterminate
// shimmer while working (no fake number), and real counts when the status RPC reports them.

export type PasteUi =
  | { kind: "idle" }
  | { kind: "working"; msg: string; divisions: number | null }
  | { kind: "done"; msg: string }
  | { kind: "error"; msg: string };

// The four real phases mirror the spec §5 ingest steps. We can't get a true % from the status
// RPC (it reports phase + counts, not progress), so steps light up by phase, never by a faked bar.
const STEPS = [
  "Tournament & divisions found",
  "Venues geocoded · directions ready",
  "Building brackets & standings…",
  "Stable game IDs & schedule watch",
] as const;

export default function PastePanel({
  url,
  onUrl,
  onSubmit,
  ui,
  disabled,
}: {
  url: string;
  onUrl: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
  ui: PasteUi;
  disabled: boolean;
}) {
  const working = ui.kind === "working";
  return (
    <div className="as-fade-in">
      <div className="px-[18px] pt-[8px]">
        <div className="font-[var(--font-mono)] text-[11.5px] uppercase tracking-[0.12em]" style={{ color: "#8F6708" }}>
          Got a link?
        </div>
        <h2 className="mt-1 font-[var(--font-display)] text-[26.5px] font-bold tracking-[-0.3px]" style={{ color: C.ink }}>
          Paste it, we&apos;ll do the rest
        </h2>
      </div>

      <form
        onSubmit={onSubmit}
        className="mx-[18px] mt-[14px] flex items-center gap-[10px] rounded-[14px] p-[13px_14px]"
        style={{
          border: "1px solid rgba(246,204,85,.34)",
          background: "radial-gradient(180px 80px at 12% 0,rgba(246,204,85,.08),transparent),linear-gradient(180deg,#F9FAFB,#FFFFFF)",
        }}
      >
        <Link2 className="h-[16px] w-[16px] shrink-0" style={{ color: C.g3 }} />
        <input
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          inputMode="url"
          placeholder="Paste a TourneyMachine tournament link"
          aria-label="Paste a tournament link"
          disabled={disabled}
          className="w-full bg-transparent font-[var(--font-mono)] text-[12.6px] outline-none disabled:opacity-60"
          style={{ color: C.dim }}
        />
        <button
          type="submit"
          disabled={disabled || !url.trim()}
          aria-label={working ? "Importing tournament" : "Import tournament from link"}
          className="as-press flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-[10px] px-[13px] font-[var(--font-display)] text-[13.8px] font-bold disabled:opacity-40"
          style={{ background: C.grad, color: "#1a1206" }}
        >
          {working ? <Loader2 className="h-[13px] w-[13px] animate-spin motion-reduce:animate-none" /> : null}
          Go
        </button>
      </form>

      {/* source line — labeled provenance (spec §5 / §7). Generic until the server resolves it. */}
      <div className="mx-[18px] mt-[11px] inline-flex items-center gap-[6px] font-[var(--font-mono)] text-[11.5px]" style={{ color: C.dim }}>
        <span className="h-[7px] w-[7px] rounded-full" style={{ background: C.cobalt }} aria-hidden />
        TourneyMachine links for now · source labeled, validated-or-held — never fabricated
      </div>

      {working && (
        <div
          className="mx-[18px] mt-[13px] rounded-[14px] p-[14px]"
          style={{ border: `1px solid ${C.hair}`, background: "linear-gradient(180deg,#F9FAFB,#FFFFFF)" }}
          aria-live="polite"
        >
          <div className="flex items-center gap-[9px] font-[var(--font-display)] text-[14.6px] font-semibold" style={{ color: C.ink }}>
            <span
              className="inline-block h-[16px] w-[16px] rounded-full motion-reduce:animate-none"
              style={{ border: "2px solid rgba(246,204,85,.25)", borderTopColor: C.g3, animation: "spin .8s linear infinite" }}
              aria-hidden
            />
            {ui.msg}
          </div>
          {/* indeterminate shimmer — NO fake % (spec §7). */}
          <div className="mt-[11px] h-[5px] overflow-hidden rounded-[3px]" style={{ background: C.s3 }}>
            <span className="animate-shimmer block h-full w-1/3 rounded-[3px]" style={{ background: C.grad }} aria-hidden />
          </div>
          <div className="mt-[11px] font-[var(--font-mono)] text-[12.1px] leading-[1.8]" style={{ color: C.dim }}>
            {STEPS.map((s, i) => {
              // Only step 0 is RPC-confirmable (the status RPC reports divisionCount). Once it
              // reports, step 0 is DONE and step 1 is the in-flight step; later steps stay pending.
              // No fabricated progress past what the RPC actually confirms (spec §7).
              const reached = ui.divisions != null;
              const doneStep = reached && i === 0;
              const activeStep = i === (reached ? 1 : 0);
              const mark = doneStep ? "✓ " : activeStep ? "→ " : "· ";
              return (
                <div key={s} style={{ color: doneStep ? C.pos : activeStep ? C.g3 : C.faint }}>
                  {mark}
                  {i === 0 && reached ? `Tournament & ${ui.divisions} divisions found` : s}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {ui.kind === "done" && (
        <div className="mx-[18px] mt-[13px] flex items-center gap-2 text-[13.8px] font-semibold" style={{ color: C.pos }} aria-live="polite">
          <Check className="h-[14px] w-[14px]" /> {ui.msg}
        </div>
      )}
      {ui.kind === "error" && (
        <div className="mx-[18px] mt-[13px] text-[13.8px] leading-[1.45]" style={{ color: "#DC2626" }} aria-live="polite">
          {ui.msg}
        </div>
      )}

      <div className="mx-[18px] mt-[13px] text-center font-[var(--font-mono)] text-[11.5px] leading-[1.5]" style={{ color: C.mut }}>
        TourneyMachine links for now — more sources are coming. We validate or hold what we ingest, never fabricate.
      </div>
    </div>
  );
}
