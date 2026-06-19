/**
 * ControlPanel — the four editing controls (Scale, Density, Remove by Element, Color Recolor).
 * Each has a toggle, appropriate inputs, and the Recolor control has element + color selectors.
 */
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Sparkles, Palette } from "lucide-react";
import PercentStepper from "./PercentStepper";
import {
  type ControlSettings,
  SCALE_MIN,
  SCALE_MAX,
  DENSITY_MIN,
  DENSITY_MAX,
  REMOVE_MIN,
  REMOVE_MAX,
  RECOLOR_COVERAGE_MIN,
  RECOLOR_COVERAGE_MAX,
  MAX_VARIATIONS,
  RECOLOR_PRESETS,
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
  // Validate that recolor has required fields when enabled
  const recolorValid = !controls.recolor.enabled || (controls.recolor.element !== "" && controls.recolor.targetColor.trim() !== "");
  const canGenerate = creditCost > 0 && creditBalance >= creditCost && !isGenerating && recolorValid;

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

      {/* Color Recolor Control */}
      <div className="space-y-3 rounded-lg border border-border p-4 bg-card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" />
            <Label className="text-sm font-semibold">Color Recolor</Label>
          </div>
          <Switch
            checked={controls.recolor.enabled}
            onCheckedChange={(checked) =>
              update({ recolor: { ...controls.recolor, enabled: checked } })
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Shift the colorway of a specific motif to a new target color.
        </p>
        {controls.recolor.enabled && (
          <div className="space-y-3">
            {/* Element selector */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Element to recolor</Label>
              <Select
                value={controls.recolor.element}
                onValueChange={(element) =>
                  update({ recolor: { ...controls.recolor, element } })
                }
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Select element to recolor..." />
                </SelectTrigger>
                <SelectContent>
                  {detectedElements.map((el) => (
                    <SelectItem key={el} value={el}>
                      {el}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Target color */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Target color</Label>
              <Input
                value={controls.recolor.targetColor}
                onChange={(e) =>
                  update({ recolor: { ...controls.recolor, targetColor: e.target.value } })
                }
                placeholder="e.g. coral, deep navy, #2A4B7C"
                className="bg-background"
              />
            </div>

            {/* Color presets */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Quick presets</Label>
              <div className="flex flex-wrap gap-1.5">
                {RECOLOR_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() =>
                      update({ recolor: { ...controls.recolor, targetColor: preset.value } })
                    }
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      controls.recolor.targetColor === preset.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground hover:bg-accent"
                    }`}
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Coverage slider */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Coverage: {controls.recolor.coverage}%
              </Label>
              <PercentStepper
                value={controls.recolor.coverage}
                onChange={(coverage) =>
                  update({ recolor: { ...controls.recolor, coverage } })
                }
                min={RECOLOR_COVERAGE_MIN}
                max={RECOLOR_COVERAGE_MAX}
              />
              <p className="text-xs text-muted-foreground">
                How much of the selected element to recolor (100% = all instances).
              </p>
            </div>
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
        {!recolorValid && (
          <p className="text-xs text-amber-500 text-center">
            Select an element and target color for recolor.
          </p>
        )}
      </div>
    </div>
  );
}
