"use client";
/**
 * The Overview's first picture: energy used each day of the report, with the typical day as a dashed line. The reader
 * sees at a glance that the site uses about the same every day, and which days did not. Pointing at a bar (or tapping
 * it) reads out that day; a day not every meter reported all of is paler and striped, and when meters were offline and
 * sent their energy late a note under the chart says so and names them. Energy or cost, when the site has a price.
 */
// React itself, not only its hooks: tests compile JSX with the classic runtime, so the module needs it in scope.
import React from "react";
import { listText, moneyText, worthSaying, type SiteReport } from "@datafoundry/site-report";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale, type EnergyIqLocale } from "./energyiq-messages";
import { keyPointsMessages } from "./key-points-messages";
import styles from "./key-points.module.css";

const shortDay = (date: string, locale: EnergyIqLocale) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale === "en" ? "en-GB" : intlLocale(locale), { timeZone: "UTC", day: "numeric", month: "short" }).replace("Sept", "Sep");
const num = (value: number, digits = 1) => value.toLocaleString("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** Round axis steps that reach past the top. */
function ticks(top: number): number[] {
  const raw = top / 4, power = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9))), step = [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= raw)!;
  return Array.from({ length: Math.ceil(top / step) + 1 }, (_, i) => +(i * step).toFixed(6));
}

/** A bar with rounded top corners only, so it stands on the baseline. */
const barPath = (x: number, top: number, w: number, h: number) => {
  if (h <= 0) return "";
  const r = Math.min(5, w / 2, h);
  return `M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${top + h}Z`;
};

/** "Pavilion 2", "Pavilion 2 and Driveway", "A, B, C and 2 more": the meters that sent energy late, largest first. */
function lateNames(days: SiteReport["benchmark"]["days"], locale: EnergyIqLocale, more: (count: number) => string): string[] {
  const total = new Map<string, number>();
  for (const day of days) for (const meter of day.recoveredFrom ?? []) total.set(meter.name, (total.get(meter.name) ?? 0) + meter.kwh);
  const names = [...total].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  return names.length > 3 ? [...names.slice(0, 3), more(names.length - 3)] : names;
}

export function DailyEnergyChart({ report }: { report: SiteReport }) {
  const t = useMessages(keyPointsMessages);
  const { locale } = useEnergyIqLocale();
  // Reports saved before the daily figures were kept, and partial reports in tests, may have none.
  const days = (report.benchmark as SiteReport["benchmark"] | undefined)?.days ?? [];
  const box = React.useRef<HTMLDivElement>(null);
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [width, setWidth] = React.useState(720);
  const [hover, setHover] = React.useState<number | null>(null);
  const [mode, setMode] = React.useState<"kwh" | "cost">("kwh");
  React.useEffect(() => {
    const node = box.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const update = () => { if (node.clientWidth > 0) setWidth(node.clientWidth); };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  if (days.length < 2) return null;
  const rate = report.rate;
  const costMode = rate != null && mode === "cost";
  const valueOf = (kwh: number) => costMode ? kwh * rate! : kwh;
  const typical = report.averageDay?.kwh ?? null;
  const currency = report.currency === "SGD" ? "S$" : report.currency;
  const label = (kwh: number) => costMode ? num(valueOf(kwh), 2) : num(kwh);
  const chartWidth = Math.max(width, days.length * 30 + 50);
  // The right margin holds the typical day's label at the end of its line.
  const height = 236, m = { l: 40, r: typical != null ? 64 : 8, t: 24, b: 44 };
  const pw = chartWidth - m.l - m.r, ph = height - m.t - m.b;
  const axis = ticks(Math.max(...days.map(day => valueOf(day.kwh)), typical != null ? valueOf(typical) : 0, 0.001) * 1.15);
  const top = axis.at(-1)!;
  const y = (value: number) => m.t + ph - value / top * ph;
  const band = pw / days.length;
  const barW = Math.min(40, Math.max(4, band * 0.56));
  const every = band >= 40 ? 1 : band >= 20 ? 2 : 7;
  const day = hover == null ? null : days[hover]!;
  const outage = days.filter(item => worthSaying(item.recoveredKwh, item.kwh));
  const names = lateNames(outage, locale, count => t("dailyOutageMore", { count }));
  const outageText = { dates: outage.map(item => shortDay(item.date, locale)).join(", "), kwh: `${num(outage.reduce((sum, item) => sum + item.recoveredKwh, 0))} kWh` };
  const tipX = hover == null ? 0 : m.l + band * (hover + 0.5);
  const against = day && typical != null && typical > 0 ? day.kwh / typical - 1 : null;
  return <figure className={styles.daily}>
    <figcaption className={styles.dailyHead}>
      <span>
        <b>{costMode ? t("dailyCostTitle", { currency }) : t("dailyTitle")}</b>
        {typical != null && <span className={styles.dailyTypical}><i aria-hidden="true" />{t("dailyTypical", { value: costMode ? moneyText(valueOf(typical), report.currency, 2) : `${num(typical)} kWh` })}</span>}
      </span>
      {rate != null && <span className={styles.dailySwitch} role="group" aria-label={t("dailyShow")}>
        <button type="button" aria-pressed={mode === "kwh"} onClick={() => setMode("kwh")}>{t("dailyEnergy")}</button>
        <button type="button" aria-pressed={mode === "cost"} onClick={() => setMode("cost")}>{t("dailyCost")}</button>
      </span>}
    </figcaption>
    <div className={styles.dailyPlot}>
      <div className={styles.dailyScroll} ref={box}>
        <svg width={chartWidth} height={height} viewBox={`0 0 ${chartWidth} ${height}`} role="img" aria-label={t("dailyTitle")} onPointerLeave={event => { if (event.pointerType === "mouse") setHover(null); }}>
          <defs>
            <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className={styles.dailyStopTop} /><stop offset="1" className={styles.dailyStopBottom} /></linearGradient>
            {/* A day not every meter reported all of: paler, with fine stripes, so it reads as different even in print. */}
            <pattern id={`${uid}-pale`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" className={styles.dailyPaleFill} /><line x1="0" y1="0" x2="0" y2="6" className={styles.dailyPaleStripe} /></pattern>
          </defs>
          {axis.map(tick => <g key={tick}><line className={tick === 0 ? styles.dailyBase : styles.dailyGrid} x1={m.l} x2={chartWidth - m.r} y1={y(tick)} y2={y(tick)} /><text className={styles.dailyAxis} x={m.l - 10} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
          {hover != null && <rect className={styles.dailyColumn} x={m.l + band * hover + 2} y={m.t - 8} width={band - 4} height={ph + 8 + m.b - 4} rx={10} />}
          {days.map((item, index) => {
            const x = m.l + band * index + (band - barW) / 2;
            const v = valueOf(item.kwh);
            const show = index % every === 0;
            const lit = hover === index;
            return <g key={item.date}>
              <path className={styles.dailyBar} d={barPath(x, y(v), barW, Math.max(0, y(0) - y(v)))} fill={`url(#${uid}-${item.complete ? "bar" : "pale"})`} style={{ animationDelay: `${index * 28}ms` }} />
              {band >= 40 && v > 0 && <text className={lit ? styles.dailyValueLit : styles.dailyValue} x={x + barW / 2} y={y(v) - 7} textAnchor="middle">{label(item.kwh)}</text>}
              {show && <text className={lit ? styles.dailyDowLit : styles.dailyDow} x={x + barW / 2} y={height - m.b + 18} textAnchor="middle">{item.dow}</text>}
              {show && <text className={styles.dailyAxis} x={x + barW / 2} y={height - m.b + 33} textAnchor="middle">{shortDay(item.date, locale)}</text>}
              <rect className={styles.dailyHit} x={m.l + band * index} y={m.t} width={band} height={ph} tabIndex={0} aria-label={`${item.dow} ${shortDay(item.date, locale)}: ${num(item.kwh)} kWh`}
                onPointerEnter={() => setHover(index)} onPointerDown={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} />
            </g>;
          })}
          {typical != null && <g className={styles.dailyTypicalMark} aria-hidden="true">
            <line className={styles.dailyTypicalLine} x1={m.l} x2={chartWidth - m.r + 4} y1={y(valueOf(typical))} y2={y(valueOf(typical))} />
            <rect className={styles.dailyTypicalPill} x={chartWidth - m.r + 6} y={y(valueOf(typical)) - 10} width={m.r - 8} height={20} rx={10} />
            <text className={styles.dailyTypicalText} x={chartWidth - m.r + 6 + (m.r - 8) / 2} y={y(valueOf(typical)) + 4} textAnchor="middle">{label(typical)}</text>
          </g>}
        </svg>
      </div>
      {day && <div className={`${styles.dailyTip}${tipX < 120 ? ` ${styles.dailyTipLeft}` : tipX > width - 120 ? ` ${styles.dailyTipRight}` : ""}`} role="status" style={{ left: tipX - (box.current?.scrollLeft ?? 0), top: Math.max(y(valueOf(day.kwh)), 8) }}>
        <b>{day.dow} {shortDay(day.date, locale)}</b>
        <span><i>{t("dailyEnergy")}</i><strong>{num(day.kwh)} kWh</strong></span>
        {rate != null && <span><i>{t("dailyCost")}</i><strong>{moneyText(day.kwh * rate, report.currency, 2)}</strong></span>}
        {against != null && <span><i>{t("dailyAgainst")}</i><strong className={Math.abs(against) < 0.03 ? undefined : against > 0 ? styles.dailyUp : styles.dailyDown}>{against >= 0 ? "+" : "−"}{Math.round(Math.abs(against) * 100)}%</strong></span>}
        {worthSaying(day.recoveredKwh, day.kwh)
          ? <em>{day.recoveredFrom?.length ? t("dailyRecoveredFrom", { kwh: `${num(day.recoveredKwh)} kWh`, names: listText(day.recoveredFrom.map(item => item.name), locale) }) : t("dailyRecovered", { kwh: `${num(day.recoveredKwh)} kWh` })}</em>
          : !day.complete && <em>{t("dailyPartial")}</em>}
      </div>}
    </div>
    {outage.length > 0 && <p className={styles.dailyAlert} role="note"><b aria-hidden="true">!</b><span>{names.length === 0 ? t("dailyOutage", outageText)
      : names.length === 1 ? withName(t("dailyOutageOne", { ...outageText, name: "{name}" }), "{name}", names[0]!)
      : withName(t("dailyOutageMany", { ...outageText, names: "{names}" }), "{names}", listText(names, locale))}</span></p>}
  </figure>;
}

/** The sentence with the meter names in bold, so the reader sees at once which meter it was. */
function withName(sentence: string, placeholder: string, value: string) {
  const [before, after = ""] = sentence.split(placeholder);
  return <>{before}<strong>{value}</strong>{after}</>;
}
