"use client";
import { useEffect, useRef, useState } from "react";
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

/**
 * `partialKwh`: the kWh actually recorded in an hour whose readings only partly arrived (its kW is then worked out from
 * the part that did); null for every other hour.
 */
export type HeatmapRow = { id: string; name: string; group: string; profileKw: Array<number | null>; partialKwh?: Array<number | null> };
type Rgb = [number, number, number];
const rgb = ([r, g, b]: Rgb) => `rgb(${r}, ${g}, ${b})`;
/** The colour at `t` along a list of stops, blended between the two stops either side of it. */
function blend(stops: Array<[number, Rgb]>, t: number): string {
  const at = Math.max(stops[0]![0], Math.min(stops[stops.length - 1]![0], t));
  const upper = stops.findIndex(([stop]) => stop >= at);
  const [a, from] = stops[Math.max(0, upper - 1)]!, [b, to] = stops[Math.max(0, upper)]!;
  const mix = b === a ? 0 : (at - a) / (b - a);
  return rgb(from.map((channel, index) => Math.round(channel + (to[index]! - channel) * mix)) as Rgb);
}
/** Traffic-light usage scale, green (low) → yellow → orange → red (high); every cell also prints its percentage, so colour is never the only cue. */
export const HEAT_STOPS: Array<[number, Rgb]> = [[0, [99, 190, 123]], [0.35, [250, 215, 100]], [0.7, [240, 140, 60]], [1, [214, 60, 47]]];
export const HEAT_GRADIENT = `linear-gradient(90deg, ${HEAT_STOPS.map(([at, colour]) => `${rgb(colour)} ${at * 100}%`).join(", ")})`;
/** Colour for a cell scaled to the row's busiest hour. */
export function heatColour(share: number | null): string {
  return share === null ? "transparent" : blend(HEAT_STOPS, share);
}

/**
 * Load in an hour as a whole percentage of the device's busiest hour; null when that hour has no complete readings.
 * An hour whose use shows as 0.00 kW reads 0%, never a sliver of a small busiest hour.
 */
export function loadPercent(kw: number | null, busiest: number): number | null {
  if (kw === null) return null;
  if (Math.round(kw * 100) === 0) return 0;
  return busiest > 0 ? Math.round(kw / busiest * 100) : 0;
}
/** White text only on the darkest part of the scale, so labels keep enough contrast. */
const heatText = (share: number) => share >= 0.85 ? "white" : "#1f2d25";
const hour24 = (hour: number) => String(hour).padStart(2, "0");

/**
 * The every-day grid compares each hour with what the device usually uses at that hour of the day. From 80% to 120% of
 * usual counts as usual and is drawn in one calm green, so only a real change stands out: blue for less than usual,
 * and the usage scale's yellow, orange and red for more.
 */
export const USUAL_BAND = { from: 80, to: 120 } as const;
const LESS_STOPS: Array<[number, Rgb]> = [[0, [45, 105, 175]], [0.8, [160, 196, 232]]];
const USUAL_RGB: Rgb = [208, 233, 216];
const MORE_STOPS: Array<[number, Rgb]> = [[1.2, HEAT_STOPS[1]![1]], [1.6, HEAT_STOPS[2]![1]], [2, HEAT_STOPS[3]![1]]];
/** Colour for a cell given as a percentage of that hour's usual use; 200% and more is the deepest red. */
export function usualColour(percent: number): string {
  if (percent < USUAL_BAND.from) return blend(LESS_STOPS, percent / 100);
  if (percent <= USUAL_BAND.to) return rgb(USUAL_RGB);
  return blend(MORE_STOPS, percent / 100);
}
/** The legend's bar runs from 0% to 200% of usual, with the flat "usual" band in the middle. */
export const USUAL_GRADIENT = `linear-gradient(90deg, ${[...LESS_STOPS, [USUAL_BAND.from / 100, USUAL_RGB] as [number, Rgb], [USUAL_BAND.to / 100, USUAL_RGB] as [number, Rgb], ...MORE_STOPS].map(([at, colour]) => `${rgb(colour)} ${at * 50}%`).join(", ")})`;
/** White text only on the deep blue and deep red ends, so labels keep enough contrast. */
const usualText = (percent: number) => percent < 25 || percent >= 180 ? "white" : "#1f2d25";

/** Below this, an hour's usual use counts as off: under 1% of the device's average hourly use, or under 0.001 kWh. */
export const OFF_SHARE = 0.01, OFF_KWH = 0.001;
type Rows = Array<{ profileKw: Array<number | null> }>;
const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
/** What the device usually uses in each hour of the day: the average over the rows (days) with a reading for that hour. */
export function usualByHour(rows: Rows): Array<number | null> {
  return Array.from({ length: 24 }, (_, hour) => mean(rows.map(row => row.profileKw[hour] ?? null).filter((kw): kw is number => kw !== null)));
}
/** The level under which an hour counts as off for this device. */
export function offBelow(rows: Rows): number {
  const average = mean(rows.flatMap(row => row.profileKw.filter((kw): kw is number => kw !== null))) ?? 0;
  return Math.max(OFF_KWH, average * OFF_SHARE);
}
/**
 * What one cell of the every-day grid shows. At an hour the device is usually off a percentage would be huge or
 * meaningless, so the cell reads "off", or is flagged when it used energy anyway. An hour whose use shows as 0.00 kWh
 * reads 0%, unless its usual use shows as 0.00 kWh too.
 */
export type UsualCell = { kind: "missing" } | { kind: "off" } | { kind: "usedWhileOff" } | { kind: "share"; percent: number };
export function usualCell(kw: number | null, usual: number | null, off: number): UsualCell {
  if (kw === null) return { kind: "missing" };
  if (usual === null || usual < off) return kw < off ? { kind: "off" } : { kind: "usedWhileOff" };
  if (Math.round(kw * 100) === 0 && Math.round(usual * 100) !== 0) return { kind: "share", percent: 0 };
  return { kind: "share", percent: Math.round(kw / usual * 100) };
}

/**
 * Load by hour of day. `scale="row"` compares each row with its own busiest hour (one row per device). `scale="usual"`
 * is for one device with a row per day: each cell is compared with the device's usual use at that hour of the day, so a
 * steady device reads about 100% everywhere and a cell well below or above it is a real change.
 */
export function UsageHeatmap({ rows, openHours, openingLabel, title, scale = "row", onOpenRow, period }: { rows: HeatmapRow[]; openHours: Set<number>; openingLabel?: string | null; title?: string; scale?: "row" | "usual"; onOpenRow?: (id: string) => void; period?: string | null }) {
  const t = useMessages(chartMessages);
  const [active, setActive] = useState<{ row: number; hour: number; x: number; y: number } | null>(null);
  const heatmap = useRef<HTMLDivElement>(null);
  // A tapped cell keeps its details until the next tap elsewhere: a touch screen has no pointer left to hover with.
  const shown = active !== null;
  useEffect(() => {
    if (!shown) return;
    const clear = (event: PointerEvent) => { if (!(event.target instanceof Node && heatmap.current?.contains(event.target))) setActive(null); };
    document.addEventListener("pointerdown", clear);
    return () => document.removeEventListener("pointerdown", clear);
  }, [shown]);
  const groups = [...new Set(rows.map(row => row.group))];
  const busiest = (row: HeatmapRow) => Math.max(0, ...row.profileKw.map(kw => kw ?? 0));
  const usual = scale === "usual" ? usualByHour(rows) : null;
  const off = usual ? offBelow(rows) : 0;
  const cells = usual ? rows.map(row => row.profileKw.map((kw, hour) => usualCell(kw, usual[hour] ?? null, off))) : null;
  const kinds = new Set(cells?.flat().map(cell => cell.kind));
  const dayTotal = (row: HeatmapRow) => row.profileKw.reduce<number>((sum, kw) => sum + (kw ?? 0), 0);
  const current = active ? rows[active.row] : null;
  const value = current && active ? current.profileKw[active.hour] ?? null : null;
  const partKwh = current && active ? current.partialKwh?.[active.hour] ?? null : null;
  const open = [...openHours].sort((a, b) => a - b);
  const contiguous = open.length > 0 && open[open.length - 1]! - open[0]! === open.length - 1;
  /** The tooltip's headline: the cell's percentage and what it is a percentage of, or why it has none. */
  const headline = () => {
    if (!current || !active || value === null) return t("heat.noComplete");
    const cell = cells?.[active.row]?.[active.hour];
    if (!cell) return t("heat.load", { load: loadPercent(value, busiest(current)) ?? 0, peak: compact(busiest(current)) });
    if (cell.kind === "off") return t("heat.usuallyOff");
    if (cell.kind === "usedWhileOff") return t("heat.usedWhileOff");
    return t("heat.loadUsual", { load: cell.kind === "share" ? cell.percent : 0, usual: compact(usual![active.hour] ?? 0) });
  };
  return <figure className={styles.chart}>
    <figcaption>{title ?? t("heat.title")}{period && <span className={styles.chartPeriod}>{period}</span>}</figcaption>
    {/* A finger lifting also "leaves" the heatmap, so only a mouse or pen leaving it hides the details. */}
    <div ref={heatmap} className={styles.heatmap} data-heatmap onPointerLeave={event => { if (event.pointerType !== "touch") setActive(null); }}>
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
          return <div key={row.id} className={styles.heatRow} role="img" aria-label={t("heat.rowAria", { name: row.name, hour: hour24(row.profileKw.indexOf(peak)), kw: compact(peak) })}>
            {onOpenRow ? <button type="button" className={`${styles.heatName} ${styles.heatNameButton}`} title={t("heat.open", { name: row.name })} onClick={() => onOpenRow(row.id)}>{row.name}</button> : <span className={styles.heatName} title={row.name}>{row.name}</span>}
            {row.profileKw.map((kw, hour) => {
              const cell = cells?.[index]?.[hour] ?? null;
              const load = cell ? null : loadPercent(kw, peak);
              // Off and used-while-off cells take their look from the stylesheet; the rest are coloured by their percentage.
              const look = cell === null
                ? { className: kw === null ? styles.heatEmpty : "", label: load === null ? null : `${load}%`, style: { background: heatColour(load === null ? null : load / 100), color: load === null ? undefined : heatText(load / 100) } }
                : cell.kind === "share" ? { className: "", label: `${cell.percent}%`, style: { background: usualColour(cell.percent), color: usualText(cell.percent) } }
                : cell.kind === "off" ? { className: styles.heatOff, label: t("heat.offLabel"), style: undefined }
                : cell.kind === "usedWhileOff" ? { className: styles.heatUsedWhileOff, label: "!", style: undefined }
                : { className: styles.heatEmpty, label: null, style: undefined };
              // A tap shows the same details as hovering, for touch screens.
              const show = (event: React.PointerEvent<HTMLSpanElement>) => { const box = event.currentTarget.closest("[data-heatmap]")!.getBoundingClientRect(); const spot = event.currentTarget.getBoundingClientRect(); setActive({ row: index, hour, x: Math.min(box.width - 110, Math.max(110, spot.left - box.left + spot.width / 2)), y: spot.top - box.top }); };
              return <span key={hour} data-heat-cell={`${index}:${hour}`} data-heat-kind={cell?.kind} className={`${styles.heatCell} ${look.className} ${openHours.has(hour) ? styles.heatCellOpen : ""} ${active?.row === index && active.hour === hour ? styles.heatActive : ""}`} style={look.style} onPointerMove={show} onPointerDown={show}>{look.label !== null && <span className={styles.heatLabel}>{look.label}</span>}</span>;
            })}
          </div>;
        })}
      </div>)}
      {current && active && <div className={styles.tooltip} style={{ left: active.x, top: active.y, transform: "translate(-50%, calc(-100% - 6px))" }}><strong>{headline()}</strong>{value != null && <span>{t(usual ? "heat.energy" : "heat.energyAverage", { kw: compact(value), kwh: compact(partKwh ?? value) })}</span>}{value != null && partKwh != null && <span>{t("heat.partHour")}</span>}<span>{t(openHours.has(active.hour) ? "heat.spanOpen" : "heat.span", { name: current.name, from: `${hour24(active.hour)}:00`, to: `${hour24((active.hour + 1) % 24)}:00` })}</span>{value != null && dayTotal(current) > 0 && <span>{t("heat.dailyShare", { pct: Math.round(value / dayTotal(current) * 100) })}</span>}</div>}
    </div>
    <p className={styles.legend}><span className={styles.heatScaleLabel}>{t(usual ? "heat.scaleUsual" : "heat.scale")}</span><span>{t(usual ? "heat.less" : "heat.low")}</span><span className={styles.heatScale} style={{ background: usual ? USUAL_GRADIENT : HEAT_GRADIENT }} /><span>{t(usual ? "heat.more" : "heat.high")}</span><span className={styles.legendNote}>{t(usual ? "heat.noteUsual" : "heat.noteRow")}{onOpenRow ? t("heat.noteClick") : ""}</span>{kinds.has("off") && <span className={styles.legendBadge}><span className={`${styles.swatch} ${styles.heatOff}`} />{t("heat.usuallyOff")}</span>}{kinds.has("usedWhileOff") && <span className={styles.legendBadge}><span className={`${styles.swatch} ${styles.heatUsedWhileOff}`} />{t("heat.usedWhileOffLegend")}</span>}</p>
  </figure>;
}
