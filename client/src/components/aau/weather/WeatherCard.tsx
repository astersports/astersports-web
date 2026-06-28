import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { MapPin, Wind, Droplets, Sunrise, Sunset, Sun, RefreshCw } from "lucide-react";
import WeatherIcon, { describeWeather, weatherAccent } from "./WeatherIcon";
import type { WeatherForecast } from "@shared/types";

/** Venue-local "now" as a sortable YYYY-MM-DDTHH:mm string. */
function localNowString(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date());
    return parts.replace(" ", "T");
  } catch {
    return new Date().toISOString().slice(0, 16);
  }
}

function dayLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return "Today";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function hourLabel(timeStr: string): string {
  const d = new Date(timeStr);
  return d.toLocaleTimeString("en-US", { hour: "numeric" });
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function WeatherCard() {
  const { data, isLoading, isError, refetch, isFetching } = trpc.weather.home.useQuery(undefined, {
    refetchInterval: 10 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return <div className="as-shimmer" style={{ height: 320, borderRadius: 16, marginBottom: 16 }} />;
  }
  if (isError || !data) {
    return (
      <div style={{
        marginBottom: 16, padding: "20px", borderRadius: 16, textAlign: "center",
        backgroundColor: "var(--as-bg-card)", border: "1px solid var(--as-border-default)",
      }}>
        <p style={{ fontSize: 13, color: "var(--as-text-tertiary)", margin: 0 }}>
          Couldn&apos;t load the forecast. Try again in a moment.
        </p>
        <button onClick={() => refetch()} className="as-press" aria-label="Retry loading weather" style={{
          marginTop: 10, minHeight: 44, padding: "6px 16px", borderRadius: 8, cursor: "pointer",
          fontFamily: "inherit", fontSize: 12, fontWeight: 600,
          backgroundColor: "var(--as-bg-tertiary)", color: "var(--as-text-secondary)",
          border: "1px solid var(--as-border-default)",
        }}>Retry</button>
      </div>
    );
  }

  return <WeatherCardView venueName={data.venue.name} forecast={data.forecast} onRefresh={() => refetch()} isFetching={isFetching} />;
}

export function WeatherCardView({ venueName, forecast, eyebrow = "Weather Hub", onRefresh, isFetching }: {
  venueName: string;
  forecast: WeatherForecast;
  eyebrow?: string;
  onRefresh?: () => void;
  isFetching?: boolean;
}) {
  const { current, daily, hourly, timezone } = forecast;
  const accent = weatherAccent(current.weatherCode, current.isDay);
  const today = daily[0];

  const nowStr = useMemo(() => localNowString(timezone), [timezone]);
  const todayStr = nowStr.slice(0, 10);

  const nextHours = useMemo(
    () => hourly.filter((h) => h.time >= nowStr).slice(0, 12),
    [hourly, nowStr],
  );

  // Temperature range across the 7-day window for the bar scaling.
  const { lo, hi } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const d of daily) { lo = Math.min(lo, d.tempMinF); hi = Math.max(hi, d.tempMaxF); }
    return { lo, hi };
  }, [daily]);
  const span = Math.max(1, hi - lo);

  return (
    <div className="as-fade-in" style={{
      marginBottom: 16, borderRadius: 16, overflow: "hidden",
      backgroundColor: "var(--as-bg-card)",
      border: "1px solid var(--as-border-default)",
    }}>
      {/* ─── Current conditions header ─── */}
      <div style={{
        position: "relative", padding: "16px 16px 14px",
        background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 22%, var(--as-bg-card)) 0%, var(--as-bg-card) 70%)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: accent }}>
            {eyebrow}
          </span>
          {onRefresh && (
            <button onClick={onRefresh} className="as-press" aria-label="Refresh weather" style={{
              width: 30, height: 30, borderRadius: 8, cursor: "pointer", border: "none",
              backgroundColor: "rgba(0,0,0,0.06)", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <RefreshCw size={13} style={{ color: "var(--as-text-tertiary)", transition: "transform 0.3s ease", transform: isFetching ? "rotate(180deg)" : "none" }} />
            </button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8 }}>
          <MapPin size={12} style={{ color: "var(--as-text-secondary)" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--as-text-primary)" }}>{venueName}</span>
          {forecast.cached && <span style={{ fontSize: 10, color: "var(--as-text-tertiary)" }}>· cached</span>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <WeatherIcon code={current.weatherCode} isDay={current.isDay} size={56} title={describeWeather(current.weatherCode)} />
          <div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
              <span className="font-display" style={{ fontSize: 42, fontWeight: 800, lineHeight: 1, color: "var(--as-text-primary)", letterSpacing: "-0.03em" }}>
                {current.temperatureF}
              </span>
              <span style={{ fontSize: 15, fontWeight: 600, color: "var(--as-text-secondary)", marginTop: 3 }}>°F</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--as-text-primary)", marginTop: 2 }}>
              {describeWeather(current.weatherCode)}
            </div>
            <div style={{ fontSize: 12, color: "var(--as-text-tertiary)" }}>
              Feels {current.apparentTemperatureF}° · H {today.tempMaxF}° L {today.tempMinF}°
            </div>
          </div>
        </div>

        {/* Detail chips */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(74px, 1fr))", gap: 8, marginTop: 14 }}>
          <DetailChip icon={<Wind size={13} />} label="Wind" value={`${current.windSpeedMph} mph`} />
          <DetailChip icon={<Droplets size={13} />} label="Humidity" value={`${current.humidityPct}%`} />
          <DetailChip icon={<Sun size={13} />} label="UV" value={`${today.uvIndexMax}`} />
          <DetailChip icon={<Sunrise size={13} />} label="Sunrise" value={fmtClock(today.sunrise)} />
          <DetailChip icon={<Sunset size={13} />} label="Sunset" value={fmtClock(today.sunset)} />
        </div>
      </div>

      {/* ─── Hourly strip ─── */}
      {nextHours.length > 0 && (
        <div style={{ borderTop: "1px solid var(--as-border-subtle)", padding: "12px 0 12px 16px" }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "var(--as-text-tertiary)", marginBottom: 10 }}>
            HOURLY
          </div>
          <div className="as-no-scrollbar" role="list" aria-label="Hourly forecast" style={{ display: "flex", gap: 4, overflowX: "auto", paddingRight: 16 }}>
            {nextHours.map((h, i) => (
              <div key={h.time} role="listitem" style={{
                flexShrink: 0, width: 52, textAlign: "center", padding: "6px 0", borderRadius: 10,
                backgroundColor: i === 0 ? "var(--as-bg-tertiary)" : "transparent",
                border: i === 0 ? "1px solid color-mix(in srgb, var(--as-accent) 35%, transparent)" : "1px solid transparent",
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: "var(--as-text-tertiary)" }}>
                  {i === 0 ? "Now" : hourLabel(h.time)}
                </div>
                <div style={{ display: "flex", justifyContent: "center", margin: "3px 0" }}>
                  <WeatherIcon code={h.weatherCode} isDay={h.isDay} size={26} animate={false} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--as-text-primary)" }}>{h.temperatureF}°</div>
                {h.precipProbPct >= 10 && (
                  <div style={{ fontSize: 9, fontWeight: 600, color: "var(--as-accent)" }}>{h.precipProbPct}%</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 7-day forecast ─── */}
      <div style={{ borderTop: "1px solid var(--as-border-subtle)", padding: "12px 16px 14px" }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "var(--as-text-tertiary)", marginBottom: 6 }}>
          7-DAY FORECAST
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {daily.map((d) => {
            const leftPct = ((d.tempMinF - lo) / span) * 100;
            const widthPct = ((d.tempMaxF - d.tempMinF) / span) * 100;
            return (
              <div key={d.date} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
                <span style={{ width: 38, fontSize: 12, fontWeight: 600, color: "var(--as-text-secondary)" }}>
                  {dayLabel(d.date, todayStr)}
                </span>
                <WeatherIcon code={d.weatherCode} isDay size={24} animate={false} />
                <span aria-hidden={d.precipProbPct < 10} style={{ width: 30, fontSize: 10, fontWeight: 600, color: "var(--as-accent)" }}>
                  {d.precipProbPct >= 10 ? `${d.precipProbPct}%` : ""}
                </span>
                <span style={{ width: 26, textAlign: "right", fontSize: 12, color: "var(--as-text-tertiary)" }}>{d.tempMinF}°</span>
                <div style={{ flex: 1, position: "relative", height: 5, borderRadius: 3, backgroundColor: "var(--as-bg-tertiary)" }}>
                  <div style={{
                    position: "absolute", top: 0, bottom: 0, left: `${leftPct}%`, width: `${Math.max(8, widthPct)}%`,
                    borderRadius: 3, background: "linear-gradient(90deg, #5BA0E0, #FFB22E)",
                  }} />
                </div>
                <span style={{ width: 26, fontSize: 12, fontWeight: 700, color: "var(--as-text-primary)" }}>{d.tempMaxF}°</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DetailChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{
      padding: "8px 6px", borderRadius: 10, textAlign: "center",
      backgroundColor: "rgba(0,0,0,0.04)", border: "1px solid var(--as-border-subtle)",
    }}>
      <div style={{ display: "flex", justifyContent: "center", color: "var(--as-text-tertiary)", marginBottom: 3 }}>{icon}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--as-text-primary)" }}>{value}</div>
      <div style={{ fontSize: 8, fontWeight: 600, letterSpacing: "0.04em", color: "var(--as-text-tertiary)", marginTop: 1 }}>{label}</div>
    </div>
  );
}
