/**
 * ControlPanel — the three editing controls (Scale, Density, Remove by Element).
 * Each has a toggle, a PercentStepper, and the Remove control has an element selector.
 */
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles } from "lucide-react";
import PercentStepper from "./PercentStepper";
import {
  type ControlSettings,
  SCALE_MIN,
  SCALE_MAX,
  DENSITY_MIN,
  DENSITY_MAX,
  REMOVE_MIN,
  REMOVE_MAX,
  MAX_VARIATIONS,
  defaultControls,
  computeCredits,
} from "@shared/controls";
import { CREDIT_COST } from "@shared/billing";

interface Props {
  detectedElements: string[];
  onGenerate: (controls: ControlSettings) => void;
  isGenerating: boolean;
  creditBalance: number;
}

export default function ControlPanel({
  detectedElements,
  onGenerate,
  isGenerating,
  creditBalance,
}: Props) {
  const [controls, setControls] = useState<ControlSettings>(defaultControls());

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

      {/* Remove by Element Control */}
      <div className="space-y-3 rounded-lg border border-border p-4 bg-card">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-semibold">Remove Print by Element</Label>
          <Switch
            checked={controls.remove.enabled}
            onCheckedChange={(checked) =>
              update({ remove: { ...controls.remove, enabled: checked } })
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Selectively remove a specific element using AI-detected names.
        </p>
        {controls.remove.enabled && (
          <div className="space-y-3">
            <Select
              value={controls.remove.element}
              onValueChange={(element) =>
                update({ remove: { ...controls.remove, element } })
              }
            >
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select element to remove..." />
              </SelectTrigger>
              <SelectContent>
                {detectedElements.map((el) => (
                  <SelectItem key={el} value={el}>
                    {el}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <PercentStepper
              value={controls.remove.percent}
              onChange={(percent) => update({ remove: { ...controls.remove, percent } })}
              min={REMOVE_MIN}
              max={REMOVE_MAX}
            />
          </div>
        )}
      </div>

      {/* Variations */}
      <div className="space-y-2 rounded-lg border border-border p-4 bg-card">
        <Label className="text-sm font-semibold">Variations</Label>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => update({ variations: n })}
              className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
                controls.variations === n
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Each additional variation costs {CREDIT_COST.extraVariation} credits.
        </p>
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
