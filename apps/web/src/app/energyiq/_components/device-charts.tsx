"use client";
import { useState } from "react";
import styles from "./site-devices.module.css";
import { DAY_KIND_BADGES, dayKindBadge, dayKindLabel, describeDay, type DayContext, type DayKind } from "./day-context";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale, type EnergyIqLocale, type Translate } from "./energyiq-messages";
import { chartMessages } from "./site-devices-messages";

const MARK = "var(--chart-mark, #176b59)";
const GRID = "var(--chart-grid, #d7ded9)";
const CLOSED = "var(--chart-closed, #eef1ee)";
const CLOSED_MARK = "var(--chart-closed-mark, #9aa89f)";
const OPEN_BAND = "var(--chart-open-band, #e3efe8)";

/** Rounds up to 1, 2 or 5 × 10^n so axis ticks stay clean. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find(step => step * power >= value) ?? 10) * power;
}
const compact = (value: number) => value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
const dayLabel = (date: string, locale: EnergyIqLocale) => new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const weekdayLetter = (date: string, locale: EnergyIqLocale) => new Intl.DateTimeFormat(intlLocale(locale), { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
/** "14 Aug – 10 Sep 2026 · 28 days": which dates a chart covers. */
export function chartRange(dates: string[], locale: EnergyIqLocale, t: (key: "chart.range", values: Record<string, string | number>) => string): string | null {
  if (!dates.length) return null;
  const format = (date: string, year: boolean) => new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", ...(year ? { year: "numeric" as const } : {}), timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  return t("chart.range", { from: format(dates[0]!, false), to: format(dates.at(-1)!, true), count: dates.length });
}
const shortDay = (date: string, locale: EnergyIqLocale) => new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
type ChartKey = keyof (typeof chartMessages)["en"];
const hourLabel = (hour: number, t: Translate<ChartKey>) => t(hour < 12 ? "hour.am" : "hour.pm", { hour: hour % 12 === 0 ? 12 : hour % 12 });
/** Keeps a centred tooltip inside the chart card near its left and right edges. */
const tooltipLeft = (percent: number) => Math.min(84, Math.max(16, percent));
/** A column with a 4px rounded data end and a square baseline. */
const column = (x: number, y: number, width: number, height: number) => {
  const r = Math.min(4, width / 2, height);
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
};

const W = 560, H = 168, LEFT = 40, RIGHT = 8, TOP = 10, BOTTOM = 40;
const PLOT_W = W - LEFT - RIGHT, PLOT_H = H - TOP - BOTTOM;

function Axis({ max, unit }: { max: number; unit: string }) {
  return <g>{[0, max / 2, max].map(tick => { const y = TOP + PLOT_H - tick / max * PLOT_H; return <g key={tick}><line x1={LEFT} x2={W - RIGHT} y1={y} y2={y} style={{ stroke: GRID }} strokeWidth={1} /><text x={LEFT - 6} y={y + 4} textAnchor="end" className={styles.axisText}>{tick === 0 ? "0" : `${compact(tick)}${tick === max ? ` ${unit}` : ""}`}</text></g>; })}</g>;
}

export function DailyUsageChart({ daily, name, title, rate, days }: { daily: Array<{ date: string; kwh: number | null; open: boolean; complete?: boolean }>; name: string; title?: string; rate?: number | null; days?: Map<string, DayContext> }) {
  const t = useMessages(chartMessages);
  const { locale } = useEnergyIqLocale();
  const [active, setActive] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...daily.map(day => day.kwh ?? 0)));
  const slot = PLOT_W / Math.max(1, daily.length);
  const barWidth = Math.max(2, Math.min(14, slot - 2));
  const point = active === null ? null : daily[active];
  const ticks = daily.length ? [0, Math.floor((daily.length - 1) / 2), daily.length - 1] : [];
  const badges = [...new Set(daily.map(day => days?.get(day.date)?.kind).filter((kind): kind is DayKind => !!kind && !!DAY_KIND_BADGES[kind]))];
  const context = point ? days?.get(point.date) : undefined;
  const range = chartRange(daily.map(day => day.date), locale, t);
  return <figure className={styles.chart}>
    <figcaption>{title ?? t("daily.title")}{range && <span className={styles.chartPeriod}>{range}</span>}</figcaption>
    <div className={styles.plot} onPointerLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("daily.aria", { name })}>
        {daily.map((day, index) => !day.open && <rect key={`c${day.date}`} x={LEFT + index * slot} y={TOP} width={slot} height={PLOT_H} style={{ fill: CLOSED }} />)}
        <Axis max={max} unit="kWh" />
        {daily.map((day, index) => !day.open && <rect key={`m${day.date}`} x={LEFT + index * slot + 1} y={TOP + PLOT_H + 3} width={Math.max(1, slot - 2)} height={4} rx={2} style={{ fill: CLOSED_MARK }} />)}
        {/* Under each bar: the day of the week (weekends lighter), or PH / PC / SH for a special day. */}
        {daily.map((day, index) => { const badge = dayKindBadge(days?.get(day.date)?.kind ?? "open", locale); const letter = slot >= 10 ? weekdayLetter(day.date, locale) : ""; if (!badge && !letter) return null; return <text key={`b${day.date}`} x={LEFT + index * slot + slot / 2} y={TOP + PLOT_H + 19} textAnchor="middle" className={badge ? styles.dayBadge : isWeekend(day.date) ? styles.weekendLetter : styles.dayLetter}>{badge || letter}</text>; })}
        {/* A day missing readings is drawn as an outline: its height is real as far as it goes,
            but it is not a figure to compare against a whole day, so it must not look like one. */}
        {daily.map((day, index) => day.kwh !== null && day.kwh > 0 && <path key={day.date} d={column(LEFT + index * slot + (slot - barWidth) / 2, TOP + PLOT_H - day.kwh / max * PLOT_H, barWidth, day.kwh / max * PLOT_H)} style={day.complete === false ? { fill: "none", stroke: MARK, strokeWidth: 1.5, strokeDasharray: "3 2" } : { fill: MARK }} opacity={active === null || active === index ? 1 : 0.55} />)}
        {ticks.map(index => <text key={index} x={LEFT + index * slot + slot / 2} y={H - 4} textAnchor="middle" className={styles.axisText}>{shortDay(daily[index]!.date, locale)}</text>)}
        {daily.map((day, index) => { const info = days?.get(day.date); return <rect key={`h${day.date}`} x={LEFT + index * slot} y={TOP} width={slot} height={PLOT_H} fill="transparent" tabIndex={0} aria-label={t("daily.dayAria", { day: dayLabel(day.date, locale), value: day.kwh === null ? t("daily.noReadingsLower") : `${compact(day.kwh)} kWh${day.complete === false ? `, ${t("daily.incompleteLower")}` : ""}`, what: info ? describeDay(info, true, locale) : t(day.open ? "daily.openDayLower" : "daily.closedDayLower") })} onPointerMove={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} />; })}
      </svg>
      {point && active !== null && <div className={styles.tooltip} style={{ left: `${tooltipLeft((LEFT + active * slot + slot / 2) / W * 100)}%` }}><strong>{point.kwh === null ? t("daily.noReadings") : `${compact(point.kwh)} kWh${rate && point.complete !== false ? ` · SGD ${(point.kwh * rate).toFixed(2)}` : ""}`}</strong>{point.complete === false && <span className={styles.incompleteNote}>{t("daily.incomplete")}</span>}<span>{dayLabel(point.date, locale)}</span><span>{context ? describeDay(context, true, locale) : t(point.open ? "daily.openDay" : "daily.closedDay")}</span></div>}
    </div>
    <p className={styles.legend}><span className={styles.swatch} style={{ background: CLOSED_MARK, height: 5, borderColor: CLOSED_MARK }} />{t("daily.closedDay")}{daily.some(day => day.complete === false) && <span className={styles.legendBadge}><span className={styles.swatch} style={{ background: "none", border: `1.5px dashed ${MARK}`, height: 10 }} />{t("daily.incompleteLegend")}</span>}{badges.map(kind => <span key={kind} className={styles.legendBadge}><b className={styles.dayBadgeKey}>{dayKindBadge(kind, locale)}</b>{dayKindLabel(kind, locale)}</span>)}</p>
  </figure>;
}

export function DailyProfileChart({ profileKw, openHours, name, title, max: fixedMax, period }: { profileKw: Array<number | null>; openHours: Set<number>; name: string; title?: string; max?: number; period?: string | null }) {
  const t = useMessages(chartMessages);
  const [active, setActive] = useState<number | null>(null);
  const max = fixedMax ?? niceMax(Math.max(0, ...profileKw.map(value => value ?? 0)));
  const x = (hour: number) => LEFT + (hour + 0.5) * PLOT_W / 24;
  const y = (kw: number) => TOP + PLOT_H - kw / max * PLOT_H;
  const points = profileKw.map((kw, hour) => kw === null ? null : [x(hour), y(kw)] as const);
  const line = points.reduce((path, point, index) => !point ? path : `${path}${path && points[index - 1] ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}`, "");
  const present = points.filter((point): point is readonly [number, number] => !!point);
  const area = present.length > 1 ? `M${present[0]![0]},${TOP + PLOT_H}${present.map(point => `L${point[0].toFixed(1)},${point[1].toFixed(1)}`).join("")}L${present[present.length - 1]![0]},${TOP + PLOT_H}Z` : "";
  const value = active === null ? null : profileKw[active];
  return <figure className={styles.chart}>
    <figcaption>{title ?? t("profile.title")}{period && <span className={styles.chartPeriod}>{period}</span>}</figcaption>
    <div className={styles.plot} onPointerLeave={() => setActive(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("profile.aria", { name })}>
        {[...openHours].map(hour => <rect key={`o${hour}`} x={LEFT + hour * PLOT_W / 24} y={TOP} width={PLOT_W / 24} height={PLOT_H} style={{ fill: OPEN_BAND }} />)}
        <Axis max={max} unit="kW" />
        {area && <path d={area} style={{ fill: MARK }} opacity={0.1} />}
        <path d={line} fill="none" style={{ stroke: MARK }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {active !== null && <line x1={x(active)} x2={x(active)} y1={TOP} y2={TOP + PLOT_H} strokeWidth={1} className={styles.crosshair} />}
        {active !== null && value != null && <circle cx={x(active)} cy={y(value)} r={4} style={{ fill: MARK }} strokeWidth={2} className={styles.ring} />}
        {[0, 6, 12, 18, 23].map(hour => <text key={hour} x={x(hour)} y={H - 6} textAnchor="middle" className={styles.axisText}>{hourLabel(hour, t)}</text>)}
        {profileKw.map((kw, hour) => <rect key={`h${hour}`} x={LEFT + hour * PLOT_W / 24} y={TOP} width={PLOT_W / 24} height={PLOT_H} fill="transparent" tabIndex={0} aria-label={t(openHours.has(hour) ? "profile.hourAriaOpen" : "profile.hourAria", { hour: hourLabel(hour, t), value: kw === null ? t("profile.noCompleteLower") : t("profile.average", { kw: compact(kw) }) })} onPointerMove={() => setActive(hour)} onFocus={() => setActive(hour)} onBlur={() => setActive(null)} />)}
      </svg>
      {active !== null && <div className={styles.tooltip} style={{ left: `${tooltipLeft(x(active) / W * 100)}%` }}><strong>{value == null ? t("profile.noComplete") : `${compact(value)} kW`}</strong><span>{t(openHours.has(active) ? "profile.spanOpen" : "profile.span", { from: hourLabel(active, t), to: hourLabel((active + 1) % 24, t) })}</span></div>}
    </div>
    {openHours.size > 0 ? <p className={styles.legend}><span className={styles.swatch} style={{ background: OPEN_BAND }} />{t("profile.operatingHours")}</p> : <p className={styles.legend}>{t("profile.closedAllDay")}</p>}
  </figure>;
}

export type HeatmapRow = { id: string; name: string; group: string; profileKw: Array<number | null> };
/** Traffic-light usage scale, green (low) → yellow → orange → red (high); every cell also prints its percentage, so colour is never the only cue. */
export const HEAT_STOPS: Array<[number, [number, number, number]]> = [[0, [99, 190, 123]], [0.35, [250, 215, 100]], [0.7, [240, 140, 60]], [1, [214, 60, 47]]];
export const HEAT_GRADIENT = `linear-gradient(90deg, ${HEAT_STOPS.map(([at, [r, g, b]]) => `rgb(${r}, ${g}, ${b}) ${at * 100}%`).join(", ")})`;
/** Colour for a cell scaled to the row's busiest hour. */
export function heatColour(share: number | null): string {
  if (share === null) return "transparent";
  const t = Math.max(0, Math.min(1, share));
  const upper = HEAT_STOPS.findIndex(([at]) => at >= t);
  const [a, from] = HEAT_STOPS[Math.max(0, upper - 1)]!, [b, to] = HEAT_STOPS[Math.max(0, upper)]!;
  const mix = b === a ? 0 : (t - a) / (b - a);
  return `rgb(${from.map((channel, index) => Math.round(channel + (to[index]! - channel) * mix)).join(", ")})`;
}

/** Load in an hour as a whole percentage of the device's busiest hour; null when that hour has no complete readings. */
export function loadPercent(kw: number | null, busiest: number): number | null {
  if (kw === null) return null;
  return busiest > 0 ? Math.round(kw / busiest * 100) : 0;
}
/** White text only on the darkest part of the scale, so labels keep enough contrast. */
const heatText = (share: number) => share >= 0.85 ? "white" : "#1f2d25";
const hour24 = (hour: number) => String(hour).padStart(2, "0");

/**
 * Load by hour of day. `scale="row"` compares each row with its own busiest hour (one row per device);
 * `scale="all"` uses one busiest hour for every row, so days of one device can be compared with each other.
 */
export function UsageHeatmap({ rows, openHours, openingLabel, title, scale = "row", onOpenRow, period }: { rows: HeatmapRow[]; openHours: Set<number>; openingLabel?: string | null; title?: string; scale?: "row" | "all"; onOpenRow?: (id: string) => void; period?: string | null }) {
  const t = useMessages(chartMessages);
  const [active, setActive] = useState<{ row: number; hour: number; x: number; y: number } | null>(null);
  const groups = [...new Set(rows.map(row => row.group))];
  const overall = Math.max(0, ...rows.flatMap(row => row.profileKw.map(kw => kw ?? 0)));
  const busiest = (row: HeatmapRow) => scale === "all" ? overall : Math.max(0, ...row.profileKw.map(kw => kw ?? 0));
  const dayTotal = (row: HeatmapRow) => row.profileKw.reduce<number>((sum, kw) => sum + (kw ?? 0), 0);
  const current = active ? rows[active.row] : null;
  const value = current && active ? current.profileKw[active.hour] : null;
  const open = [...openHours].sort((a, b) => a - b);
  const contiguous = open.length > 0 && open[open.length - 1]! - open[0]! === open.length - 1;
  return <figure className={styles.chart}>
    <figcaption>{title ?? t("heat.title")}{period && <span className={styles.chartPeriod}>{period}</span>}</figcaption>
    <div className={styles.heatmap} data-heatmap onPointerLeave={() => setActive(null)}>
      <div className={styles.heatTimeline} aria-hidden="true">
        {contiguous && open[0]! > 0 && <span className={styles.heatClosedBar} title={t("heat.afterHoursSpan", { from: "00:00", to: `${hour24(open[0]!)}:00` })} style={{ gridColumn: `2 / ${open[0]! + 2}` }}>{t("heat.afterHours")}</span>}
        {contiguous && <span className={styles.heatOpenBar} style={{ gridColumn: `${open[0]! + 2} / ${open[open.length - 1]! + 3}` }}>{openingLabel ? t("heat.operatingHoursLabel", { hours: openingLabel }) : t("heat.operatingHours")}</span>}
        {contiguous && open[open.length - 1]! < 23 && <span className={styles.heatClosedBar} title={t("heat.afterHoursSpan", { from: `${hour24(open[open.length - 1]! + 1)}:00`, to: "24:00" })} style={{ gridColumn: `${open[open.length - 1]! + 3} / 26` }}>{t("heat.afterHours")}</span>}
      </div>
      <div className={styles.heatHead} aria-hidden="true"><span className={styles.heatAxisTitle}>{t("heat.hourAxis")}</span>{Array.from({ length: 24 }, (_, hour) => <span key={hour} className={openHours.has(hour) ? styles.heatOpen : undefined}>{hour24(hour)}</span>)}</div>
      {groups.map(group => <div key={group} role="rowgroup" aria-label={group}>
        <p className={styles.heatGroup}>{group}</p>
        {rows.map((row, index) => {
          if (row.group !== group) return null;
          const peak = busiest(row);
          const rowPeak = Math.max(0, ...row.profileKw.map(kw => kw ?? 0));
          return <div key={row.id} className={styles.heatRow} role="img" aria-label={t("heat.rowAria", { name: row.name, hour: hour24(row.profileKw.indexOf(rowPeak)), kw: compact(rowPeak) })}>
            {onOpenRow ? <button type="button" className={`${styles.heatName} ${styles.heatNameButton}`} title={t("heat.open", { name: row.name })} onClick={() => onOpenRow(row.id)}>{row.name}</button> : <span className={styles.heatName} title={row.name}>{row.name}</span>}
            {row.profileKw.map((kw, hour) => {
              const load = loadPercent(kw, peak);
              return <span key={hour} className={`${styles.heatCell} ${kw === null ? styles.heatEmpty : ""} ${openHours.has(hour) ? styles.heatCellOpen : ""} ${active?.row === index && active.hour === hour ? styles.heatActive : ""}`} style={{ background: heatColour(load === null ? null : load / 100), color: load === null ? undefined : heatText(load / 100) }} onPointerMove={event => { const box = event.currentTarget.closest("[data-heatmap]")!.getBoundingClientRect(); const cell = event.currentTarget.getBoundingClientRect(); setActive({ row: index, hour, x: Math.min(box.width - 110, Math.max(110, cell.left - box.left + cell.width / 2)), y: cell.top - box.top }); }}>{load !== null && <span className={styles.heatLabel}>{load}%</span>}</span>;
            })}
          </div>;
        })}
      </div>)}
      {current && active && <div className={styles.tooltip} style={{ left: active.x, top: active.y, transform: "translate(-50%, calc(-100% - 6px))" }}><strong>{value == null ? t("heat.noComplete") : t("heat.load", { load: loadPercent(value, busiest(current)) ?? 0, kw: compact(value) })}</strong><span>{t(openHours.has(active.hour) ? "heat.spanOpen" : "heat.span", { name: current.name, from: `${hour24(active.hour)}:00`, to: `${hour24((active.hour + 1) % 24)}:00` })}</span>{value != null && dayTotal(current) > 0 && <span>{t("heat.dailyShare", { pct: Math.round(value / dayTotal(current) * 100) })}</span>}</div>}
    </div>
    <p className={styles.legend}><span>{t("heat.low")}</span><span className={styles.heatScale} style={{ background: HEAT_GRADIENT }} /><span>{t("heat.high")}</span><span className={styles.legendNote}>{t(scale === "all" ? "heat.noteAll" : "heat.noteRow")}{onOpenRow ? t("heat.noteClick") : ""}</span></p>
  </figure>;
}
