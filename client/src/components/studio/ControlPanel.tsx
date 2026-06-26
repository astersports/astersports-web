/**
 * ControlPanel — the two deterministic editing controls: Scale and Density.
 * (Remove and Recolor were retired in the two-op reduction.)
 */
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import PercentStepper from "./PercentStepper";
import {
  type ControlSettings,
  SCALE_MIN,
  SCALE_MAX,
  DENSITY_MIN,
  DENSITY_MAX,
  defaultControls,
  computeCredits,
} from "@shared/controls";
import { CREDIT_COST } from "@shared/billing";

interface Props {
  /** Detected element names (no longer used by the two-op panel; kept for callers). */
  detectedElements?: string[];
  onGenerate: (controls: ControlSettings) => void;
  isGenerating: boolean;
  creditBalance: number;
  /** Op availability from studio.config. Default true so existing callers/tests
   *  are unaffected; when false the control is disabled and shows "temporarily
   *  unavailable" instead of letting the user trigger a server-side rejection. */
  scaleLive?: boolean;
  densityLive?: boolean;
}

export default function ControlPanel({
  onGenerate,
  isGenerating,
  creditBalance,
  scaleLive = true,
  densityLive = true,
}: Props) {
  // Variations parked — always locked to 1 until quality validation is added.
  const [controls, setControls] = useState<ControlSettings>({ ...defaultControls(), variations: 1 });

  const creditCost = computeCredits(controls, CREDIT_COST);
  const canGenerate = creditCost > 0 && creditBalance >= creditCost && !isGenerating;

  const update = (partial: Partial<ControlSettings>) => {
    setControls((prev) => ({ ...prev, ...partial }));
  };

  return (
    <div className="space-y-6">
      {!scaleLive && !densityLive && (
        <div className="rounded-lg border border-amber-300/40 bg-amber-50/60 dark:bg-amber-950/20 p-3 text-xs text-amber-700 dark:text-amber-400">
          Scale and Density are temporarily unavailable while we fine-tune them. Please check back soon.
        </div>
      )}

      {/* Scale Control */}
      <div className="space-y-3 rounded-lg border border-border p-4 bg-card">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Adjustable Scale</Label>
          <Switch
            disabled={!scaleLive}
            checked={scaleLive && controls.scale.enabled}
            onCheckedChange={(checked) =>
              update({ scale: { ...controls.scale, enabled: checked } })
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Enlarge or reduce all print objects evenly.
        </p>
        {!scaleLive && (
          <p className="text-xs text-amber-600 dark:text-amber-500">Temporarily unavailable.</p>
        )}
        {scaleLive && controls.scale.enabled && (
          <PercentStepper
            value={controls.scale.percent}
            onChange={(percent) => update({ scale: { ...controls.scale, percent } })}
            min={SCALE_MIN}
            max={SCALE_MAX}
            signed
          />
        )}
      </div>

      {/* Density Control */}
      <div className="space-y-3 rounded-lg border border-border p-4 bg-card">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Density Reduction</Label>
          <Switch
            disabled={!densityLive}
            checked={densityLive && controls.density.enabled}
            onCheckedChange={(checked) =>
              update({ density: { ...controls.density, enabled: checked } })
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Thin out the print evenly by removing motifs.
        </p>
        {!densityLive && (
          <p className="text-xs text-amber-600 dark:text-amber-500">Temporarily unavailable.</p>
        )}
        {densityLive && controls.density.enabled && (
          <div className="space-y-3">
            <PercentStepper
              value={controls.density.percent}
              onChange={(percent) => update({ density: { ...controls.density, percent } })}
              min={DENSITY_MIN}
              max={DENSITY_MAX}
              // Even re-space re-spreads survivors over the whole garment, so its
              // perceived sparsity changes only as 1/sqrt(1-p) — adjacent 10% steps
              // are visually indistinguishable. Offer coarser 25% steps (0/25/50/75)
              // so each pick is perceptibly different. Thin in place keeps 10% steps
              // (it opens localized gaps, so fine steps read clearly). See the
              // architect ruling: respace is a spacing-evenness finisher, not a
              // density-strength dial.
              step={(controls.density.mode ?? "inplace") === "respace" ? 25 : 10}
            />
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Survivor layout</Label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: "respace", label: "Even re-space" },
                  { v: "inplace", label: "Thin in place" },
                ] as const).map((opt) => {
                  const selected = (controls.density.mode ?? "inplace") === opt.v;
                  return (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => update({ density: { ...controls.density, mode: opt.v } })}
                      className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {(controls.density.mode ?? "inplace") === "inplace"
                  ? "Keeps each surviving motif in place and removes the rest — this is the control for how sparse the print looks. Also best for placed or couture designs (preserves the composition)."
                  : "Evens out the spacing of the motifs that remain — a finisher for repeating all-over prints, not a strength dial. For a bigger visible change, raise the % or switch to Thin in place."}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Generate button */}
      <div className="space-y-2">
        <Button
          className="w-full"
          size="lg"
          disabled={!canGenerate}
          onClick={() => onGenerate(controls)}
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate ({creditCost} credits)
            </>
          )}
        </Button>
        {creditCost > 0 && creditBalance < creditCost && (
          <p className="text-xs text-destructive text-center">
            Insufficient credits. Need {creditCost}, have {creditBalance}.
          </p>
        )}
      </div>
    </div>
  );
}
