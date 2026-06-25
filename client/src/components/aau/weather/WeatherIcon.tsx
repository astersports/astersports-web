import { useId } from "react";
import { getWeatherInfo } from "@aster/weather";

/**
 * Best-in-class animated weather icons — hand-built SVGs with CSS-driven motion
 * (rotating sun, drifting clouds, falling rain/snow, flashing bolts, twinkling
 * stars). Keyframes live in index.css under the `wx-*` namespace and respect
 * prefers-reduced-motion.
 *
 * Convergence (PR #106 → @aster/weather): the WMO code→text table that used to
 * live here is gone — condition text now comes from the shared package's
 * canonical WMO map (one source of truth, AP#42). The animated SVG rendering
 * and the `weatherKind`/`weatherAccent` theming helpers stay local: they are
 * this card's presentation, not shared logic.
 */

export type WxKind =
  | "clear"
  | "mostly-clear"
  | "partly-cloudy"
  | "overcast"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunder";

export function describeWeather(code: number): string {
  // Canonical descriptions from @aster/weather; preserve the local "—" empty
  // fallback for codes the shared map doesn't recognize.
  const { description } = getWeatherInfo(code);
  return description === "Unknown" ? "—" : description;
}

export function weatherKind(code: number): WxKind {
  if (code === 0) return "clear";
  if (code === 1) return "mostly-clear";
  if (code === 2) return "partly-cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "thunder";
  return "cloudy";
}

/** A short accent color for the condition — used by callers for theming. */
export function weatherAccent(code: number, isDay = true): string {
  const kind = weatherKind(code);
  switch (kind) {
    case "clear":
    case "mostly-clear":
      return isDay ? "#FFB22E" : "#9AB4E8";
    case "partly-cloudy":
      return isDay ? "#FFB22E" : "#9AB4E8";
    case "rain":
    case "drizzle":
      return "#4a8fd4";
    case "snow":
      return "#9CC9F0";
    case "thunder":
      return "#FFD43B";
    case "fog":
      return "#94A3B8";
    default:
      return "#A8B6CC";
  }
}

const SUN = "#FFD43B";
const SUN_EDGE = "#FF9F1C";
const MOON = "#E8EEF7";
const CLOUD_LIGHT = "#E2E8F0";
const CLOUD_MID = "#B6C2D4";
const CLOUD_DARK = "#8C9AB2";
const RAIN = "#5BA0E0";
const SNOW = "#DCEcFF";
const BOLT = "#FFD43B";

function Sun({ cx, cy, r, uid, animate }: { cx: number; cy: number; r: number; uid: string; animate: boolean }) {
  const rays = Array.from({ length: 8 });
  return (
    <g>
      <g
        style={animate ? { transformOrigin: `${cx}px ${cy}px`, animation: "wx-spin 18s linear infinite" } : undefined}
      >
        {rays.map((_, i) => {
          const a = (i * Math.PI) / 4;
          const x1 = cx + Math.cos(a) * (r + 2.5);
          const y1 = cy + Math.sin(a) * (r + 2.5);
          const x2 = cx + Math.cos(a) * (r + 7);
          const y2 = cy + Math.sin(a) * (r + 7);
          return (
            <line
              key={i}
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={SUN_EDGE} strokeWidth={2.2} strokeLinecap="round"
            />
          );
        })}
      </g>
      <circle
        cx={cx} cy={cy} r={r} fill={`url(#sun-${uid})`}
        style={animate ? { transformOrigin: `${cx}px ${cy}px`, animation: "wx-pulse 3.5s ease-in-out infinite" } : undefined}
      />
    </g>
  );
}

function Moon({ cx, cy, r, uid, animate }: { cx: number; cy: number; r: number; uid: string; animate: boolean }) {
  return (
    <g>
      {animate && (
        <>
          <circle cx={cx + r + 6} cy={cy - r} r={1.1} fill="#FFFFFF" style={{ animation: "wx-twinkle 2.2s ease-in-out infinite" }} />
          <circle cx={cx + r + 2} cy={cy + r - 3} r={0.9} fill="#FFFFFF" style={{ animation: "wx-twinkle 2.8s ease-in-out infinite 0.6s" }} />
          <circle cx={cx - r - 4} cy={cy - r + 4} r={0.8} fill="#FFFFFF" style={{ animation: "wx-twinkle 3.1s ease-in-out infinite 1.1s" }} />
        </>
      )}
      <path
        d={`M ${cx + r * 0.55} ${cy - r * 0.85}
            A ${r} ${r} 0 1 0 ${cx + r * 0.55} ${cy + r * 0.85}
            A ${r * 0.8} ${r * 0.8} 0 1 1 ${cx + r * 0.55} ${cy - r * 0.85} Z`}
        fill={`url(#moon-${uid})`}
      />
    </g>
  );
}

function Cloud({ x, y, scale, fill, uid, drift, animate, delay = 0 }: {
  x: number; y: number; scale: number; fill: string; uid: string; drift?: boolean; animate: boolean; delay?: number;
}) {
  return (
    <g
      transform={`translate(${x} ${y}) scale(${scale})`}
      style={drift && animate ? { animation: `wx-drift 7s ease-in-out infinite`, animationDelay: `${delay}s` } : undefined}
    >
      <path
        d="M 14 26 a 11 11 0 0 1 1 -21.8 a 14 14 0 0 1 26.5 4 a 9.5 9.5 0 0 1 -1.5 17.8 Z"
        fill={fill}
        stroke={`url(#cloudstroke-${uid})`}
        strokeWidth={0.6}
      />
    </g>
  );
}

function Drops({ count, baseX, y, color, freeze, animate }: {
  count: number; baseX: number; y: number; color: string; freeze?: boolean; animate: boolean;
}) {
  return (
    <g>
      {Array.from({ length: count }).map((_, i) => {
        const x = baseX + i * 9;
        const delay = (i * 0.33).toFixed(2);
        return freeze ? (
          <g key={i} style={animate ? { animation: "wx-snow 2.4s linear infinite", animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px` } : undefined}>
            <circle cx={x} cy={y} r={2} fill={color} />
          </g>
        ) : (
          <line
            key={i}
            x1={x} y1={y} x2={x - 1.5} y2={y + 5}
            stroke={color} strokeWidth={2.1} strokeLinecap="round"
            style={animate ? { animation: "wx-fall 1.15s linear infinite", animationDelay: `${delay}s` } : undefined}
          />
        );
      })}
    </g>
  );
}

export default function WeatherIcon({
  code,
  isDay = true,
  size = 64,
  animate = true,
  title,
}: {
  code: number;
  isDay?: boolean;
  size?: number;
  animate?: boolean;
  title?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const kind = weatherKind(code);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title ?? describeWeather(code)}
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <radialGradient id={`sun-${uid}`} cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#FFF3B0" />
          <stop offset="55%" stopColor={SUN} />
          <stop offset="100%" stopColor={SUN_EDGE} />
        </radialGradient>
        <linearGradient id={`moon-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor={MOON} />
        </linearGradient>
        <linearGradient id={`cloudstroke-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>

      {/* CLEAR */}
      {kind === "clear" &&
        (isDay ? (
          <Sun cx={32} cy={32} r={13} uid={uid} animate={animate} />
        ) : (
          <Moon cx={32} cy={32} r={13} uid={uid} animate={animate} />
        ))}

      {/* MOSTLY CLEAR / PARTLY CLOUDY */}
      {(kind === "mostly-clear" || kind === "partly-cloudy") && (
        <>
          {isDay ? (
            <Sun cx={24} cy={24} r={10} uid={uid} animate={animate} />
          ) : (
            <Moon cx={24} cy={24} r={10} uid={uid} animate={animate} />
          )}
          <Cloud x={20} y={26} scale={0.78} fill={CLOUD_LIGHT} uid={uid} drift animate={animate} />
        </>
      )}

      {/* OVERCAST / CLOUDY */}
      {(kind === "overcast" || kind === "cloudy") && (
        <>
          <Cloud x={8} y={16} scale={0.7} fill={CLOUD_MID} uid={uid} drift animate={animate} delay={0.5} />
          <Cloud x={18} y={22} scale={0.95} fill={kind === "overcast" ? CLOUD_DARK : CLOUD_LIGHT} uid={uid} drift animate={animate} />
        </>
      )}

      {/* FOG */}
      {kind === "fog" && (
        <>
          <Cloud x={16} y={14} scale={0.9} fill={CLOUD_MID} uid={uid} animate={animate} />
          {[0, 1, 2].map((i) => (
            <line
              key={i}
              x1={12} y1={44 + i * 6} x2={52} y2={44 + i * 6}
              stroke={CLOUD_LIGHT} strokeWidth={2.4} strokeLinecap="round"
              style={animate ? { animation: "wx-fog 3.2s ease-in-out infinite", animationDelay: `${i * 0.4}s` } : undefined}
            />
          ))}
        </>
      )}

      {/* DRIZZLE / RAIN */}
      {(kind === "drizzle" || kind === "rain") && (
        <>
          <Cloud x={16} y={12} scale={0.95} fill={CLOUD_MID} uid={uid} animate={animate} />
          <Drops count={kind === "rain" ? 4 : 3} baseX={22} y={44} color={RAIN} animate={animate} />
        </>
      )}

      {/* SNOW */}
      {kind === "snow" && (
        <>
          <Cloud x={16} y={12} scale={0.95} fill={CLOUD_LIGHT} uid={uid} animate={animate} />
          <Drops count={4} baseX={21} y={44} color={SNOW} freeze animate={animate} />
        </>
      )}

      {/* THUNDER */}
      {kind === "thunder" && (
        <>
          <Cloud x={16} y={10} scale={0.95} fill={CLOUD_DARK} uid={uid} animate={animate} />
          <path
            d="M 34 36 L 27 47 L 32 47 L 28 56 L 40 43 L 34 43 L 38 36 Z"
            fill={BOLT}
            style={animate ? { animation: "wx-flash 2.4s ease-in-out infinite", transformOrigin: "32px 46px" } : undefined}
          />
          <Drops count={2} baseX={20} y={46} color={RAIN} animate={animate} />
        </>
      )}
    </svg>
  );
}
