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
}

export default function ControlPanel({
  onGenerate,
  isGenerating,
  creditBalance,
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
      {/* Scale Control */}
      <div className="space-y-3 rounded-lg border border-border p-4 bg-card">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Adjustable Scale</Label>
          <Switch
            checked={controls.scale.enabled}
            onCheckedChange={(checked) =>
              update({ scale: { ...controls.scale, enabled: checked } })
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Enlarge or reduce all print objects evenly.
        </p>
        {controls.scale.enabled && (
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
            checked={controls.density.enabled}
            onCheckedChange={(checked) =>
              update({ density: { ...controls.density, enabled: checked } })
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Thin out the print evenly by removing motifs.
        </p>
        {controls.density.enabled && (
          <PercentStepper
            value={controls.density.percent}
            onChange={(percent) => update({ density: { ...controls.density, percent } })}
            min={DENSITY_MIN}
            max={DENSITY_MAX}
          />
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
