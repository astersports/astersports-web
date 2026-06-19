import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Minus, Plus } from "lucide-react";

interface Props {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Show +/- sign and allow negative (for scale). */
  signed?: boolean;
  unit?: string;
}

/**
 * Percent control with 10% increments PLUS a free custom input field.
 * Stepper buttons snap to the nearest 10; the input allows any value in range.
 */
export default function PercentStepper({
  value,
  onChange,
  min,
  max,
  step = 10,
  signed = false,
  unit = "%",
}: Props) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  const dec = () => {
    const snapped = Math.ceil((value - step) / step) * step;
    onChange(clamp(snapped));
  };
  const inc = () => {
    const snapped = Math.floor((value + step) / step) * step;
    onChange(clamp(snapped));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0 bg-card" onClick={dec}>
          <Minus className="h-4 w-4" />
        </Button>
        <div className="relative flex-1">
          <Input
            type="number"
            inputMode="numeric"
            value={Number.isFinite(value) ? value : 0}
            min={min}
            max={max}
            onChange={(e) => {
              const n = e.target.value === "" ? 0 : Number(e.target.value);
              if (Number.isFinite(n)) onChange(clamp(n));
            }}
            className="pr-8 text-center font-semibold tabular-nums"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {unit}
          </span>
        </div>
        <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0 bg-card" onClick={inc}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {/* Quick 10% presets */}
      <div className="flex flex-wrap gap-1.5">
        {presetList(min, max, step, signed).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(clamp(p))}
            className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
              value === p
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-accent"
            }`}
          >
            {signed && p > 0 ? "+" : ""}
            {p}%
          </button>
        ))}
      </div>
    </div>
  );
}

function presetList(min: number, max: number, step: number, signed: boolean) {
  const out: number[] = [];
  for (let v = min; v <= max; v += step) out.push(v);
  if (signed) return out.filter((v) => v % step === 0);
  return out;
}
