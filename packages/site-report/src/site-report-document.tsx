/**
 * The site energy report itself: the same structure, story and chart detail as the reference Tuya Office report,
 * filled from live readings. Charts are hand-built SVG so they work on the page, in print and in the standalone HTML
 * file (which needs no scripts or internet access). Nothing here reads the DOM, so the server can render the same
 * document with renderSiteReportHtml() and save it; the Overview renders it as a React element.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { holidayName, joinText } from "./analysis-messages.js";
import { shortDate } from "./analysis-model.js";
import { translatorFor, type EnergyIqLocale } from "./locale.js";
import { rich, Rich } from "./rich.js";
import { clock, hourRange, moneyText, pctText, REPORT_COLOURS as C, type ProfileNote, type ReportDay, type ReportZone, type SiteReport } from "./site-report-model.js";
import { siteReportMessages } from "./site-report-messages.js";
import { REPORT_CSS } from "./site-report-styles.js";
import { wrapLabel } from "./wrap-label.js";

export { Rich };

const num = (value: number | null, digits = 1) => value == null ? "—" : value.toLocaleString("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const whole = (value: number) => Math.round(value).toLocaleString("en-SG");
/** The document's wording follows the language its sentences were written in, so a downloaded copy never mixes languages. */
const reportText = (locale: EnergyIqLocale) => translatorFor(siteReportMessages, locale);

/** Axis ticks at a round step (1, 2, 2.5 or 5 × 10ⁿ) from zero to just above the maximum. */
export function niceTicks(max: number, target = 5) {
  if (!(max > 0)) return [0, 1];
  const raw = max / target, power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(value => value * power).find(value => value >= raw)!;
  return Array.from({ length: Math.ceil(max / step - 1e-9) + 1 }, (_, index) => Number((index * step).toFixed(6)));
}

/** Smooth line through the points that never overshoots (monotone cubic), as a path. */
export function monotonePath(points: Array<[number, number]>) {
  const n = points.length;
  if (n < 2) return "";
  const dx: number[] = [], slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) { dx.push(points[i + 1]![0] - points[i]![0]); slope.push((points[i + 1]![1] - points[i]![1]) / dx[i]!); }
  const tangent = points.map((_, i) => {
    if (i === 0) return slope[0]!;
    if (i === n - 1) return slope[n - 2]!;
    const a = slope[i - 1]!, b = slope[i]!;
    return a * b <= 0 ? 0 : 3 * (dx[i - 1]! + dx[i]!) / ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b);
  });
  let path = `M${points[0]![0].toFixed(1)},${points[0]![1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = points[i]!, [x1, y1] = points[i + 1]!, third = dx[i]! / 3;
    path += `C${(x0 + third).toFixed(1)},${(y0 + tangent[i]! * third).toFixed(1)} ${(x1 - third).toFixed(1)},${(y1 - tangent[i + 1]! * third).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return path;
}

/**
 * Chart width follows its container so text stays at its real size. Below the minimum (a phone) the chart keeps the
 * minimum width and scrolls sideways instead of squeezing its labels together.
 */
const CHART_MIN = 480;
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const update = () => { const value = Math.round(node.clientWidth); if (value > 0) setWidth(Math.max(CHART_MIN, value)); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}
/** Rough label width for layout: Chinese characters are about a full em wide, Latin letters a little over half. */
const textWidth = (text: string, size = 11) => { const wide = text.match(/[⺀-鿿＀-￯]/g)?.length ?? 0; return (text.length - wide) * size * 0.56 + wide * size; };
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const Tip = ({ x, y, children }: { x: number; y: number; children: ReactNode }) => <div className="tip" role="status" style={{ left: x, top: y }}>{children}</div>;

// ---------- 1. floor plan ----------
const CATEGORIES = ["light", "load", "aircon", "it", "kitchen", "plug", "other"] as const;
function FloorPlan({ report }: { report: SiteReport }) {
  const t = reportText(report.locale);
  const categoryWord = (category: string) => t(`plan.category.${CATEGORIES.find(item => item === category) ?? "other"}`);
  const reference = report.reference!;
  const [vx, vy, vw, vh] = reference.layout.viewBox;
  const areas = report.zones.filter(zone => !zone.subgroup && zone.rect);
  const subgroups = report.zones.filter(zone => zone.subgroup);
  const minX = Math.min(...areas.map(zone => zone.rect![0])) - 4, minY = Math.min(...areas.map(zone => zone.rect![1])) - 4;
  const maxX = Math.max(...areas.map(zone => zone.rect![0] + zone.rect![2])) + 4, maxY = Math.max(...areas.map(zone => zone.rect![1] + zone.rect![3])) + 4;
  const entrance = reference.layout.entrance?.position ? reference.layout.entrance : null;
  const [ex = 0, ey = 0] = entrance?.position ?? [];
  const doorOnWall = !!entrance && Math.abs(ey - maxY) <= 10;
  const leftEdge = Math.max(...areas.filter(zone => zone.rect![0] + zone.rect![2] <= ex).map(zone => zone.rect![0] + zone.rect![2]), -Infinity);
  const rightEdge = Math.min(...areas.filter(zone => zone.rect![0] >= ex).map(zone => zone.rect![0]), Infinity);
  const hasCorridor = !!entrance && Number.isFinite(leftEdge) && Number.isFinite(rightEdge);
  const est = (zone: ReportZone) => t("plan.estimate", { kwh: whole(zone.monthKwh) });
  const circuitsOf = (board: string) => report.circuits.filter(circuit => circuit.board === board);
  const markers = Object.entries(reference.layout.boardMarkers ?? {});
  const parentOf = (zone: ReportZone) => areas.find(area => zone.parentRoom && area.rooms.includes(zone.parentRoom));
  const side = (direction: string) => {
    const own = areas.filter(zone => zone.direction === direction);
    return [...own, ...subgroups.filter(zone => own.includes(parentOf(zone)!))];
  };
  const left = side("left"), right = side("right");
  // Zone letters only ("Zones B + C"); English strips the word from its own labels, other languages use the layout's ids.
  const zoneId = (zone: ReportZone) => report.locale === "en" ? zone.label.replace(/^Zone /, "") : zone.key.length <= 2 ? zone.key : zone.label;
  const zonesText = (zones: ReportZone[]) => t(zones.length > 1 ? "plan.zones.other" : "plan.zones.one", { ids: zones.map(zoneId).join(" + ") });
  const property = reference.property;
  const note = [t("plan.schematic"), property?.level !== undefined ? t("plan.level", { level: property.level }) : null, property?.approximateAreaM2 ? `≈${whole(property.approximateAreaM2)} m²` : null].filter(Boolean).join(" · ");
  const legend = [...areas.map(zone => ({ label: zone.area ? `${zone.label} · ${zone.area}` : zone.label, zone })), ...subgroups.map(zone => ({ label: `${zone.label} · ${t(zone.equipment ? "plan.displayScreens" : "plan.equipment")}`, zone }))];
  let cursor = vx + 4;
  const legendItems = legend.map(item => { const x = cursor; cursor += 22 + textWidth(item.label, 11.5) + 26; return { ...item, x }; });
  const badgeX = cursor;
  const panelLabel = t("plan.panel");
  cursor += 38 + textWidth(panelLabel, 11.5) + 26;
  const noteOnOwnLine = cursor + textWidth(note, 10.5) > vx + vw - 4;
  const legendY = maxY + (entrance ? 50 : 24);
  const height = Math.max(vh, legendY + (noteOnOwnLine ? 40 : 20)) - vy;
  return <svg className="plan" viewBox={`${vx} ${vy} ${vw} ${height}`} role="img" aria-label={t("plan.aria", { name: report.projectName })}>
    {doorOnWall
      ? <><path d={`M${minX} ${maxY} V${minY} H${maxX} V${maxY}`} fill="none" stroke={C.ink} strokeWidth={2.5} /><line x1={minX} y1={maxY} x2={ex - 32} y2={maxY} stroke={C.ink} strokeWidth={2.5} /><line x1={ex + 32} y1={maxY} x2={maxX} y2={maxY} stroke={C.ink} strokeWidth={2.5} /></>
      : <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="none" stroke={C.ink} strokeWidth={2.5} />}
    {areas.map(zone => { const [x, y, w, h] = zone.rect!; return <g key={zone.key}>
      <rect x={x} y={y} width={w} height={h} fill={zone.colour} fillOpacity={0.065} stroke={zone.colour} strokeWidth={1.5} />
      <text className="svgt zone-title" x={x + 10} y={y + 24}>{zone.label}{zone.area ? ` · ${zone.area}` : ""}</text>
      <text className="svgt rsub" x={x + 10} y={y + 40}>{est(zone)}</text>
    </g>; })}
    {reference.layout.rooms.map(room => {
      const [x, y, w, h] = room.rect as [number, number, number, number];
      const lines = wrapLabel(room.name, Math.max(6, Math.floor((w - 8) / 6.8)));
      const host = subgroups.find(zone => zone.parentRoom === room.name);
      const cy = y + h / 2 + (host ? 12 : 4) - (lines.length - 1) * 8;
      return <g key={room.name}>
        <rect className="room" x={x} y={y} width={w} height={h} />
        <text className="svgt rlabel" x={x + w / 2} y={cy} textAnchor="middle" fontWeight={host || w * h > 30000 ? 600 : 400}>{lines.map((line, index) => <tspan key={index} x={x + w / 2} dy={index ? 16 : 0}>{line}</tspan>)}</text>
      </g>;
    })}
    {subgroups.map(zone => {
      const room = reference.layout.rooms.find(item => item.name === zone.parentRoom);
      if (!room) return null;
      const [x, y, w] = room.rect as [number, number, number, number];
      const count = Math.min(6, Math.max(1, zone.circuitKeys.reduce((sum, key) => sum + (report.circuits.find(circuit => circuit.key === key)?.meterIds.length ?? 0), 0)));
      const barW = Math.min(56, (w - 28 - (count - 1) * 10) / count);
      return <g key={zone.key}>
        {Array.from({ length: count }, (_, index) => <rect key={index} x={x + 14 + index * (barW + 10)} y={y + 10} width={barW} height={11} fill={zone.colour} />)}
        <text className="svgt rlabel" x={x + 14} y={y + 36} fontWeight={600}>{zone.label} · {zone.equipment ?? t("plan.equipment")} ({zone.board})</text>
        <text className="svgt rsub" x={x + 14} y={y + 51}>{est(zone)}{zone.alwaysOn ? ` · ${t("plan.alwaysOn")}` : ""}</text>
      </g>;
    })}
    {markers.map(([board, [x, y]]) => {
      const crowded = markers.some(([other, [ox, oy]]) => other !== board && Math.abs(oy - y) < 12 && ox > x && ox < x + 200);
      const words = [...new Set(circuitsOf(board).map(circuit => categoryWord(circuit.category)))];
      return <g key={board}>
        <rect x={x} y={y} width={46} height={20} rx={3} fill={C.ink} />
        <text className="svgt dbtext" x={x + 23} y={y + 14} textAnchor="middle">{board}</text>
        {!crowded && words.length > 0 && <text className="svgt rsub" x={x + 54} y={y + 14}>{words.join(" + ")}</text>}
      </g>;
    })}
    {hasCorridor && <><rect x={leftEdge} y={minY + 4} width={rightEdge - leftEdge} height={maxY - minY - 8} fill="#fff" /><line x1={leftEdge} y1={minY + 4} x2={leftEdge} y2={maxY - 4} stroke={C.line} /><line x1={rightEdge} y1={minY + 4} x2={rightEdge} y2={maxY - 4} stroke={C.line} /></>}
    {entrance && <g>
      {doorOnWall && <path d={`M ${ex + 32} ${maxY} A 64 64 0 0 0 ${ex - 32} ${maxY - 64}`} fill="none" stroke={C.slate} strokeWidth={1} strokeDasharray="3,3" />}
      <text className="svgt rlabel" x={ex} y={maxY + 24} textAnchor="middle" fontWeight={600}>{entrance.label ?? t("plan.entrance")}{entrance.referenceBoard ? ` (${entrance.referenceBoard})` : ""}</text>
      {(left.length > 0 || right.length > 0) && <line x1={ex} y1={maxY - 20} x2={ex} y2={maxY - 120} stroke={C.ink} strokeWidth={1.6} />}
      {left.length > 0 && <><line x1={ex} y1={maxY - 120} x2={ex - 26} y2={maxY - 120} stroke={left[0]!.colour} strokeWidth={1.6} /><path d={`M ${ex - 26} ${maxY - 120} l 8 -5 v 10 z`} fill={left[0]!.colour} />
        <text className="svgt rsub halo" x={ex - 6} y={maxY - 128} textAnchor="end">{t("plan.turnLeft", { zones: zonesText(left) })}</text></>}
      {right.length > 0 && <><line x1={ex} y1={maxY - 120} x2={ex + 26} y2={maxY - 120} stroke={right[0]!.colour} strokeWidth={1.6} /><path d={`M ${ex + 26} ${maxY - 120} l -8 -5 v 10 z`} fill={right[0]!.colour} />
        <text className="svgt rsub halo" x={ex + 6} y={maxY - 128} textAnchor="start">{t("plan.turnRight", { zones: zonesText(right) })}</text></>}
    </g>}
    {legendItems.map(item => <g key={item.zone.key}>
      {item.zone.subgroup ? <rect x={item.x} y={legendY} width={14} height={14} fill={item.zone.colour} /> : <rect x={item.x} y={legendY} width={14} height={14} fill={item.zone.colour} fillOpacity={0.15} stroke={item.zone.colour} />}
      <text className="svgt legend-text" x={item.x + 20} y={legendY + 11}>{item.label}</text>
    </g>)}
    <rect x={badgeX} y={legendY} width={30} height={14} rx={3} fill={C.ink} />
    <text className="svgt legend-text" x={badgeX + 38} y={legendY + 11}>{panelLabel}</text>
    <text className="svgt rsub" x={noteOnOwnLine ? vx + 4 : vx + vw - 4} y={legendY + (noteOnOwnLine ? 32 : 11)} textAnchor={noteOnOwnLine ? "start" : "end"}>{note}</text>
  </svg>;
}

// ---------- 2. donuts ----------
type Slice = { key: string; label: string; value: number; colour: string };
function Donut({ title, slices, caption, report }: { title: string; slices: Slice[]; caption: string; report: SiteReport }) {
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const R = 100, r = 52, c = 120;
  let angle = -Math.PI / 2;
  const point = (radius: number, a: number) => `${(c + radius * Math.cos(a)).toFixed(2)} ${(c + radius * Math.sin(a)).toFixed(2)}`;
  const arcs = slices.filter(slice => slice.value > 0).map(slice => {
    const share = total > 0 ? slice.value / total : 0;
    const a0 = angle, a1 = angle + Math.min(share, 0.9999) * 2 * Math.PI;
    angle += share * 2 * Math.PI;
    const large = a1 - a0 > Math.PI ? 1 : 0, mid = (a0 + a1) / 2;
    return { ...slice, share, mid, d: `M ${point(R, a0)} A ${R} ${R} 0 ${large} 1 ${point(R, a1)} L ${point(r, a1)} A ${r} ${r} 0 ${large} 0 ${point(r, a0)} Z` };
  });
  const shown = arcs.find(arc => arc.key === active);
  const t = reportText(report.locale);
  const cost = (kwh: number) => report.rate == null ? "" : t("donut.cost", { cost: moneyText(kwh * report.rate, report.currency) });
  return <div className="figure">
    <div className="pie-title">{title}</div>
    <svg className="donut" viewBox="0 0 240 240" role="img" aria-label={t("donut.aria", { title, slices: joinText(arcs.map(arc => t("donut.slice", { label: arc.label, pct: pctText(arc.share) })), report.locale) })} onMouseLeave={() => setActive(null)}>
      {arcs.map(arc => <path key={arc.key} d={arc.d} fill={arc.colour} stroke={C.fog} strokeWidth={2} opacity={active && active !== arc.key ? 0.45 : 1} onMouseEnter={() => setActive(arc.key)}>
        <title>{t("donut.sliceTitle", { label: arc.label, kwh: whole(arc.value), pct: pctText(arc.share, 1), cost: cost(arc.value) })}</title>
      </path>)}
      {arcs.filter(arc => arc.share >= 0.06).map(arc => <text key={arc.key} x={c + (R + r) / 2 * Math.cos(arc.mid)} y={c + (R + r) / 2 * Math.sin(arc.mid) + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill={luminance(arc.colour) > 0.35 ? C.ink : "#fff"} pointerEvents="none">{pctText(arc.share)}</text>)}
      {/* A ring with nothing in it printed "0 kWh", which reads as a site that used
          no electricity rather than a split this report could not work out. */}
      {arcs.length === 0
        ? <text x={c} y={c + 4} textAnchor="middle" fontSize={12} fill={C.muted}>{t("donut.unavailable")}</text>
        : <>
          <text x={c} y={c - 4} textAnchor="middle" fontSize={shown ? 17 : 20} fontWeight={800} fill={C.ink}>{whole(shown?.value ?? total)} kWh</text>
          <text x={c} y={c + 14} textAnchor="middle" fontSize={11} fill={C.muted}>{shown ? `${pctText(shown.share, 1)}${cost(shown.value)}` : t("donut.estimate")}</text>
        </>}
    </svg>
    <ul className="donut-legend">{arcs.map(arc => <li key={arc.key} className={active === arc.key ? "active" : undefined} onMouseEnter={() => setActive(arc.key)} onMouseLeave={() => setActive(null)}>
      <i style={{ background: arc.colour }} /><span>{arc.label}</span><b>{whole(arc.value)} kWh · {pctText(arc.share)}</b>
    </li>)}</ul>
    <div className="caption">{caption}</div>
  </div>;
}

// ---------- 3. daily benchmark ----------
function BenchChart({ benchmark, locale, standalone }: { benchmark: SiteReport["benchmark"]; locale: EnergyIqLocale; standalone?: boolean | undefined }) {
  const t = reportText(locale);
  const [ref, width] = useWidth(780);
  const [hover, setHover] = useState<number | null>(null);
  const { days, weekdayAvg, weekendAvg, baseDayKwh, closeToWeekend } = benchmark;
  const height = Math.round(Math.min(360, Math.max(260, width * 0.42)));
  const m = { l: 50, r: 8, t: 12, b: 40 };
  const pw = width - m.l - m.r, ph = height - m.t - m.b;
  const ticks = niceTicks(Math.max(...days.map(day => day.kwh), weekdayAvg ?? 0, baseDayKwh ?? 0) * 1.08);
  const top = ticks.at(-1)!;
  const y = (value: number) => m.t + ph - value / top * ph;
  const band = pw / Math.max(days.length, 1);
  const barW = Math.max(2, band * 0.78);
  const every = band >= 22 ? 1 : band >= 12 ? 2 : 3;
  const closed = (day: ReportDay) => day.dayType !== "weekday";
  const fill = (day: ReportDay) => day.complete ? closed(day) ? C.slate : C.ember : closed(day) ? C.slateSoft : C.emberSoft;
  const lines = [
    weekdayAvg != null ? { value: weekdayAvg, colour: C.ember, dash: undefined, label: t("bench.line.weekday", { kwh: whole(weekdayAvg) }) } : null,
    baseDayKwh != null ? { value: baseDayKwh, colour: C.ink, dash: "6 5", label: closeToWeekend && weekendAvg != null ? t("bench.line.baseWeekend", { kwh: whole(baseDayKwh), weekend: whole(weekendAvg) }) : t("bench.line.base", { kwh: whole(baseDayKwh) }) } : null,
    !closeToWeekend && weekendAvg != null ? { value: weekendAvg, colour: C.muted, dash: "2 4", label: t("bench.line.weekend", { kwh: whole(weekendAvg) }) } : null,
  ].filter((line): line is NonNullable<typeof line> => !!line).sort((a, b) => b.value - a.value);
  let lastLabel = -Infinity;
  const labelled = lines.map(line => { let ly = y(line.value) - 6; if (ly - lastLabel < 14) ly = y(line.value) + 15; lastLabel = ly; return { ...line, ly }; });
  const day = hover == null ? null : days[hover]!;
  const reference = day && (closed(day) ? weekendAvg : weekdayAvg);
  const dayLabel = (item: ReportDay) => t("bench.day", { date: shortDate(item.date, locale), dow: item.dow });
  // Narrow bars show one letter of the weekday; Chinese "周一" keeps its last character, "一".
  const narrowDow = (dow: string) => locale === "zh-Hans" ? dow.slice(-1) : dow[0];
  return <div className="figure">
    <div className="legend" aria-hidden="true">
      <span><i style={{ background: C.ember }} />{t("bench.legend.weekday")}</span><span><i style={{ background: C.slate }} />{t("bench.legend.closed")}</span><span><i style={{ background: C.emberSoft }} />{t("bench.legend.missing")}</span>
      <span><i className="line" />{t("bench.legend.average")}</span><span><i className="dash" />{t("bench.legend.base")}</span>
    </div>
    <div className="chart-scroll" ref={ref}><div className="chart-wrap" style={{ minWidth: width }} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("bench.aria")}>
        {ticks.map(tick => <g key={tick}><line x1={m.l} x2={width - m.r} y1={y(tick)} y2={y(tick)} stroke={C.line} /><text className="tick" x={m.l - 8} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
        <text className="axis-title" transform={`translate(13 ${m.t + ph / 2}) rotate(-90)`} textAnchor="middle">{t("bench.axis")}</text>
        {days.map((item, index) => {
          const x = m.l + band * index + (band - barW) / 2;
          const first = index === 0 || item.date.endsWith("-01");
          return <g key={item.date}>
            <rect x={x} y={y(item.kwh)} width={barW} height={Math.max(0, y(0) - y(item.kwh))} fill={fill(item)} opacity={hover != null && hover !== index ? 0.55 : 1}>
              <title>{[`${dayLabel(item)} · ${num(item.kwh)} kWh`, item.holidayName ? holidayName(item.holidayName, locale) : null, item.complete ? null : t("bench.missing")].filter(Boolean).join(" · ")}</title>
            </rect>
            {index % every === 0 && <text className="tick dark" x={x + barW / 2} y={height - m.b + 15} textAnchor="middle">{band >= 38 || first ? shortDate(item.date, locale) : item.date.slice(8).replace(/^0/, "")}</text>}
            {index % every === 0 && <text className="tick" x={x + barW / 2} y={height - m.b + 29} textAnchor="middle">{band >= 20 ? item.dow : narrowDow(item.dow)}</text>}
            <rect className="hit" x={m.l + band * index} y={m.t} width={band} height={ph} onMouseEnter={() => setHover(index)} />
          </g>;
        })}
        <line x1={m.l} x2={width - m.r} y1={y(0)} y2={y(0)} stroke={C.muted} />
        {labelled.map(line => <g key={line.label} pointerEvents="none">
          <line x1={m.l} x2={width - m.r} y1={y(line.value)} y2={y(line.value)} stroke={line.colour} strokeWidth={1.6} strokeDasharray={line.dash} />
          <text className="chart-label" x={m.l + 6} y={line.ly} fill={line.colour}>{line.label}</text>
        </g>)}
      </svg>
      {!standalone && day && <Tip x={m.l + band * (hover! + 0.5)} y={y(day.kwh)}>
        <b>{dayLabel(day)}{day.holidayName ? ` · ${holidayName(day.holidayName, locale)}` : ""}</b>
        {num(day.kwh)} kWh{reference != null ? ` · ${t(closed(day) ? "bench.vsWeekend" : "bench.vsWeekday", { diff: `${day.kwh >= reference ? "+" : "−"}${num(Math.abs(day.kwh - reference))}` })}` : ""}
        {!day.complete && <><br />{t("bench.understated")}</>}
      </Tip>}
    </div></div>
    <div className="caption">{benchmark.caption}</div>
  </div>;
}

// ---------- 4. weekday hour by hour ----------
function ProfileChart({ pattern, locale, standalone }: { pattern: NonNullable<SiteReport["pattern"]>; locale: EnergyIqLocale; standalone?: boolean | undefined }) {
  const t = reportText(locale);
  const [ref, width] = useWidth(780);
  const [hover, setHover] = useState<number | null>(null);
  const height = Math.round(Math.min(380, Math.max(280, width * 0.46)));
  const m = { l: 50, r: 14, t: 14, b: 30 };
  const pw = width - m.l - m.r, ph = height - m.t - m.b;
  const ticks = niceTicks(Math.max(...pattern.hours) * 1.15);
  const top = ticks.at(-1)!;
  const x = (hour: number) => m.l + hour / 23 * pw;
  const y = (value: number) => m.t + ph - value / top * ph;
  const points = pattern.hours.map((value, hour) => [x(hour), y(value)] as [number, number]);
  const line = monotonePath(points);
  const every = pw / 23 >= 26 ? 2 : pw / 23 >= 14 ? 3 : 4;
  const bandFrom = x(pattern.openFrom), bandTo = x(Math.min(23, pattern.openTo));
  const place = (note: ProfileNote) => {
    const px = x(note.hour), py = y(note.kw), w = textWidth(note.text, 10.5);
    if (note.place === "below") return { px, py, tx: Math.min(Math.max(px, m.l + w / 2), width - m.r - w / 2), ty: py + 20, anchor: "middle" as const };
    if (note.place === "above-right") return px + 6 + w > width - m.r ? { px, py, tx: px - 6, ty: py - 12, anchor: "end" as const } : { px, py, tx: px + 6, ty: py - 12, anchor: "start" as const };
    const dy = note.place === "left" ? -8 : -10;
    return px - 8 - w < m.l ? { px, py, tx: px + 8, ty: py + dy, anchor: "start" as const } : { px, py, tx: px - 8, ty: py + dy, anchor: "end" as const };
  };
  return <div className="figure">
    <div className="chart-scroll" ref={ref}><div className="chart-wrap" style={{ minWidth: width }} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t("profile.aria", { kw: Math.max(...pattern.hours).toFixed(2) })}>
        <rect x={bandFrom} y={m.t} width={bandTo - bandFrom} height={ph} fill={C.ember} fillOpacity={0.06} />
        <line x1={bandFrom} x2={bandFrom} y1={m.t} y2={m.t + ph} stroke={C.ember} strokeOpacity={0.35} strokeDasharray="4 4" />
        <line x1={bandTo} x2={bandTo} y1={m.t} y2={m.t + ph} stroke={C.ember} strokeOpacity={0.35} strokeDasharray="4 4" />
        {ticks.map(tick => <g key={tick}><line x1={m.l} x2={width - m.r} y1={y(tick)} y2={y(tick)} stroke={C.line} /><text className="tick" x={m.l - 8} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
        <text className="chart-label" x={bandFrom + 8} y={m.t + 14} fill={C.muted}>{t("profile.band", { range: hourRange(pattern.openFrom, pattern.openTo, locale) })}</text>
        <text className="axis-title" transform={`translate(13 ${m.t + ph / 2}) rotate(-90)`} textAnchor="middle">{t("profile.axis")}</text>
        {pattern.hours.map((_, hour) => hour % every === 0 && <text key={hour} className="tick dark" x={x(hour)} y={height - 10} textAnchor="middle">{String(hour).padStart(2, "0")}:00</text>)}
        <path d={`${line}L${x(23).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`} fill={C.ember} fillOpacity={0.1} />
        <path d={line} fill="none" stroke={C.ember} strokeWidth={2.5} />
        {pattern.hours.map((value, hour) => <circle key={hour} cx={x(hour)} cy={y(value)} r={6} fill="transparent"><title>{`${String(hour).padStart(2, "0")}:00 · ${value.toFixed(2)} kW`}</title></circle>)}
        {pattern.notes.map(note => { const at = place(note); return <g key={note.text} pointerEvents="none">
          <circle cx={at.px} cy={at.py} r={3} fill={C.ink} />
          <text className="chart-label" x={at.tx} y={at.ty} textAnchor={at.anchor} fill={C.ink} style={{ fontSize: 10.5 }}>{note.text}</text>
        </g>; })}
        {hover != null && <g pointerEvents="none"><line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ph} stroke={C.ink} strokeOpacity={0.35} /><circle cx={x(hover)} cy={y(pattern.hours[hover]!)} r={4.5} fill={C.ember} stroke="#fff" strokeWidth={2} /></g>}
        <rect className="hit" x={m.l} y={m.t} width={pw} height={ph} onMouseMove={event => {
          const box = event.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(23, Math.round((event.clientX - box.left) / box.width * 23))));
        }} />
      </svg>
      {!standalone && hover != null && <Tip x={x(hover)} y={y(pattern.hours[hover]!)}><b>{String(hover).padStart(2, "0")}:00 – {String(hover + 1).padStart(2, "0")}:00</b>{t("profile.average", { kw: pattern.hours[hover]!.toFixed(2) })}</Tip>}
    </div></div>
    <div className="caption">{pattern.caption}</div>
  </div>;
}

// ---------- the document ----------
/**
 * The report itself, from one `SiteReport` and nothing else. `standalone` is for a saved copy: it leaves out the
 * hover readouts, which a file nobody is pointing at would never show anyway.
 */
export function SiteReportDocument({ report, standalone }: { report: SiteReport; standalone?: boolean | undefined }) {
  const { estimate, benchmark, pattern, screening, locale } = report;
  const t = reportText(locale);
  const rate = report.rate;
  return <article className="eiq-report" aria-label={t("doc.aria", { name: report.projectName })}>
    <div className="page">
      <header className="masthead">
        <div className="doc-line">
          <span><strong>{report.masthead.site}</strong> · {report.masthead.detail}</span>
          <span>{rich(t("doc.period", { note: report.masthead.periodNote }), { period: <strong>{report.masthead.period}</strong> })}</span>
        </div>
        <h1>{report.title.before}<span>{report.title.emphasis}</span></h1>
        <p className="lede"><Rich text={report.lede} /></p>
        <div className="keyfigs">{report.keyFigures.map(figure => <div key={figure.label}><b>{figure.value}</b><small>{figure.label}</small></div>)}</div>
      </header>

      <section id="site-profile">
        <div className="sec-head"><span className="num">1</span><h2>{t("doc.section.profile")}</h2></div>
        <p><Rich text={report.profile.intro} /></p>
        <div className="zones">{report.profile.zones.map(zone => <p key={zone.heading}><strong>{zone.heading}</strong>{t("doc.zoneSeparator")}<Rich text={zone.text} /></p>)}</div>
        {report.reference ? <div className="figure"><div className="plan-wrap"><FloorPlan report={report} /></div><div className="caption">{report.profile.caption}</div></div>
          : <div className="table-wrap"><table><thead><tr><th>{t("doc.col.zone")}</th><th>{t("doc.col.board")}</th><th>{t("doc.col.circuits")}</th><th className="r">{t("doc.col.zoneEstimate")}</th></tr></thead>
            <tbody>{report.zones.map(zone => <tr key={zone.key}><td>{zone.label}</td><td>{zone.board}</td><td>{joinText(zone.circuitKeys.map(key => report.circuits.find(circuit => circuit.key === key)?.name ?? ""), locale)}</td><td className="r">{whole(zone.monthKwh)}</td></tr>)}</tbody></table></div>}
      </section>

      <section id="estimate">
        <div className="sec-head"><span className="num">2</span><h2>{t("doc.section.estimate")}</h2></div>
        <p><Rich text={estimate.intro} /></p>
        <div className="table-wrap"><table>
          <thead><tr><th>{t("doc.col.feeds")}</th><th className="r">{t("doc.col.weekday")}</th><th className="r">{t("doc.col.weekend")}</th><th className="r">{t("doc.col.recorded", { days: report.dayCount })}</th><th className="r">{t("doc.col.month")}</th>{rate != null && <th className="r">{t("doc.col.cost")}</th>}</tr></thead>
          <tbody>
            {report.circuits.map((circuit, index) => <tr key={circuit.key}>
              <td>{circuit.label}<small className="code">{circuit.code}</small></td><td className="r">{num(circuit.weekdayPerDay)}</td><td className="r">{num(circuit.weekendPerDay)}</td><td className="r">{whole(circuit.periodKwh)}</td>
              <td className={`r${index === 0 ? " hot" : ""}`}>{whole(circuit.monthKwh)}</td>{rate != null && <td className={`r${index === 0 ? " hot" : ""}`}>{circuit.monthCost == null ? "—" : moneyText(circuit.monthCost, report.currency)}</td>}
            </tr>)}
            <tr className="total"><td>{t(report.siteWord === "office" ? "doc.total.office" : "doc.total.site")}</td><td className="r">{num(report.circuits.reduce((sum, circuit) => sum + (circuit.weekdayPerDay ?? 0), 0))}</td><td className="r">{num(report.circuits.reduce((sum, circuit) => sum + (circuit.weekendPerDay ?? 0), 0))}</td>
              <td className="r">{whole(report.circuits.reduce((sum, circuit) => sum + circuit.periodKwh, 0))}</td><td className="r">{whole(estimate.monthKwh)}</td>{rate != null && <td className="r">{estimate.monthCost == null ? "—" : moneyText(estimate.monthCost, report.currency)}</td>}</tr>
          </tbody>
        </table></div>
        {estimate.comparison && <p><Rich text={estimate.comparison} /></p>}
        <div className="pies">
          <Donut title={t("donut.bySpace")} report={report} caption={estimate.spaceCaption} slices={report.zones.map(zone => ({ key: zone.key, label: zone.area && zone.area !== zone.label ? `${zone.label} · ${zone.area}` : zone.label, value: zone.monthKwh, colour: zone.colour }))} />
          <Donut title={t("donut.byLoad")} report={report} caption={estimate.loadCaption} slices={report.circuits.map(circuit => ({ key: circuit.key, label: circuit.label, value: circuit.monthKwh, colour: circuit.colour }))} />
        </div>
        <p className="note">{estimate.note}</p>
      </section>

      <section id="benchmark">
        <div className="sec-head"><span className="num">3</span><h2>{t("doc.section.benchmark")}</h2></div>
        <p><Rich text={benchmark.intro} /></p>
        {benchmark.days.length > 0 && <BenchChart benchmark={benchmark} locale={locale} standalone={standalone} />}
        {benchmark.rows.length > 0 && <div className="table-wrap"><table>
          <thead><tr><th>{t("doc.col.benchmark")}</th><th className="r">{t("doc.col.rate")}</th><th className="r">{t("doc.col.perDay")}</th><th className="r">{t("doc.col.perMonth")}</th><th className="r">{rate != null ? t("doc.col.benchCostAt", { rate: moneyText(rate, report.currency, 4) }) : t("doc.col.benchCost")}</th></tr></thead>
          <tbody>{benchmark.rows.map(row => <tr key={row.label}><td>{row.label}</td>{[row.rate, row.perDay, row.perMonth, row.cost].map((value, index) => <td key={index} className={`r${row.hot ? " hot" : ""}`}>{value}</td>)}</tr>)}</tbody>
        </table></div>}
        {benchmark.outro && <p><Rich text={benchmark.outro} /></p>}
      </section>

      <section id="weekday-pattern">
        <div className="sec-head"><span className="num">4</span><h2>{t("doc.section.pattern")}</h2></div>
        {pattern ? <>
          <p><Rich text={pattern.intro} /></p>
          {pattern.cause && <p><strong>{t("doc.lunchCause")}</strong> <Rich text={pattern.cause} /></p>}
          <ProfileChart pattern={pattern} locale={locale} standalone={standalone} />
        </> : <p>{t("doc.noPattern")}</p>}
      </section>

      <section id="screening">
        <div className="sec-head"><span className="num">5</span><h2>{t("doc.section.screening")}</h2></div>
        <p><Rich text={screening.intro} /></p>
        <div className="table-wrap"><table>
          <thead><tr><th>{t("doc.col.feeds")}</th><th className="r">{t("doc.col.openBase")}</th><th className="r">{t("doc.col.closedBase")}</th><th>{t("doc.col.result")}</th></tr></thead>
          <tbody>{screening.rows.map(row => <tr key={row.label}><td>{row.label}<small className="code">{row.code}</small></td><td className="r">{row.open}</td><td className="r">{row.closed}</td><td><Rich text={row.finding} /></td></tr>)}</tbody>
        </table></div>
        <div className="callout"><strong>{t("doc.readingScreen")}</strong> <Rich text={screening.callout} /></div>
        <p className="note">{screening.note}</p>
      </section>

      <footer><span>{report.footer.left}</span><span>{report.footer.right}</span></footer>
    </div>
  </article>;
}

const escapeHtml = (text: string) => text.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
/** The report's own markup, with no page around it: the same element the Overview shows, as HTML. */
export const renderSiteReportMarkup = (report: SiteReport) => renderToStaticMarkup(<SiteReportDocument report={report} standalone />);
/**
 * A standalone copy of the report: the document plus its styles, no scripts or external files. Rendered from the
 * report alone, so the browser and the server produce the same file from the same readings.
 */
export function renderSiteReportHtml(report: SiteReport) {
  const title = reportText(report.locale)("file.title", { name: report.projectName, period: report.masthead.period });
  return `<!DOCTYPE html>\n<html lang="${report.locale}">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${escapeHtml(title)}</title>\n<style>body{margin:0;background:#fff}${REPORT_CSS}</style>\n</head>\n<body>\n${renderSiteReportMarkup(report)}\n</body>\n</html>\n`;
}
/** The name the downloaded file is saved under, so the browser and the server agree on it. */
export const siteReportFileName = (report: SiteReport) => `${report.projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-energy-report-${report.from}-to-${report.to}.html`;
