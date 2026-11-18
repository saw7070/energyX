"use client";
/**
 * The Overview's first picture: energy used each day of the report, with the typical day as a dashed line. The reader
 * sees at a glance that the site uses about the same every day, and which days did not. Pointing at a bar (or tapping
 * it) reads out that day; a day not every meter reported all of is paler, and when meters were offline and sent their
 * energy late a note under the chart says so. Energy or cost, when the site has a price.
 */
// React itself, not only its hooks: tests compile JSX with the classic runtime, so the module needs it in scope.
import React from "react";
import { moneyText, worthSaying, type SiteReport } from "@datafoundry/site-report";
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

export function DailyEnergyChart({ report }: { report: SiteReport }) {
  const t = useMessages(keyPointsMessages);
  const { locale } = useEnergyIqLocale();
  // Reports saved before the daily figures were kept, and partial reports in tests, may have none.
  const days = (report.benchmark as SiteReport["benchmark"] | undefined)?.days ?? [];
  const box = React.useRef<HTMLDivElement>(null);
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
  const chartWidth = Math.max(width, days.length * 30 + 50);
  const height = 210, m = { l: 36, r: 6, t: 22, b: 40 };
  const pw = chartWidth - m.l - m.r, ph = height - m.t - m.b;
  const axis = ticks(Math.max(...days.map(day => valueOf(day.kwh)), typical != null ? valueOf(typical) : 0, 0.001) * 1.15);
  const top = axis.at(-1)!;
  const y = (value: number) => m.t + ph - value / top * ph;
  const band = pw / days.length;
  const barW = Math.min(44, Math.max(4, band * 0.62));
  const every = band >= 40 ? 1 : band >= 20 ? 2 : 7;
  const day = hover == null ? null : days[hover]!;
  const outage = days.filter(item => worthSaying(item.recoveredKwh, item.kwh));
  const label = (kwh: number) => costMode ? num(valueOf(kwh), 2) : num(kwh);
  const tipX = hover == null ? 0 : m.l + band * (hover + 0.5);
  return <figure className={styles.daily}>
    <figcaption className={styles.dailyHead}>
      <span>
        <b>{costMode ? t("dailyCostTitle", { currency: report.currency === "SGD" ? "S$" : report.currency }) : t("dailyTitle")}</b>
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
          {axis.map(tick => <g key={tick}><line className={styles.dailyGrid} x1={m.l} x2={chartWidth - m.r} y1={y(tick)} y2={y(tick)} /><text className={styles.dailyAxis} x={m.l - 8} y={y(tick) + 4} textAnchor="end">{tick}</text></g>)}
          {days.map((item, index) => {
            const x = m.l + band * index + (band - barW) / 2;
            const v = valueOf(item.kwh);
            const show = index % every === 0;
            return <g key={item.date}>
              <rect className={item.complete ? styles.dailyBar : styles.dailyBarPale} x={x} y={y(v)} width={barW} height={Math.max(0, y(0) - y(v))} rx={3} opacity={hover != null && hover !== index ? 0.45 : 1} />
              {band >= 34 && v > 0 && <text className={styles.dailyValue} x={x + barW / 2} y={y(v) - 6} textAnchor="middle">{label(item.kwh)}</text>}
              {show && <text className={styles.dailyDow} x={x + barW / 2} y={height - m.b + 16} textAnchor="middle">{item.dow}</text>}
              {show && <text className={styles.dailyAxis} x={x + barW / 2} y={height - m.b + 30} textAnchor="middle">{shortDay(item.date, locale)}</text>}
              <rect className={styles.dailyHit} x={m.l + band * index} y={m.t} width={band} height={ph} tabIndex={0} aria-label={`${item.dow} ${shortDay(item.date, locale)}: ${num(item.kwh)} kWh`}
                onPointerEnter={() => setHover(index)} onPointerDown={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)} />
            </g>;
          })}
          {typical != null && <line className={styles.dailyTypicalLine} x1={m.l} x2={chartWidth - m.r} y1={y(valueOf(typical))} y2={y(valueOf(typical))} />}
          <line className={styles.dailyBase} x1={m.l} x2={chartWidth - m.r} y1={y(0)} y2={y(0)} />
        </svg>
      </div>
      {day && <div className={`${styles.dailyTip}${tipX < 110 ? ` ${styles.dailyTipLeft}` : tipX > width - 110 ? ` ${styles.dailyTipRight}` : ""}`} role="status" style={{ left: tipX - (box.current?.scrollLeft ?? 0), top: Math.max(y(valueOf(day.kwh)), 8) }}>
        <b>{day.dow} {shortDay(day.date, locale)}</b>
        <span>{t("dailyEnergy")}: {num(day.kwh)} kWh</span>
        {rate != null && <span>{t("dailyCost")}: {moneyText(day.kwh * rate, report.currency, 2)}</span>}
        {typical != null && typical > 0 && <span>{t("dailyAgainst")}: {day.kwh >= typical ? "+" : "−"}{Math.round(Math.abs(day.kwh / typical - 1) * 100)}%</span>}
        {worthSaying(day.recoveredKwh, day.kwh) ? <em>{t("dailyRecovered", { kwh: `${num(day.recoveredKwh)} kWh` })}</em> : !day.complete && <em>{t("dailyPartial")}</em>}
      </div>}
    </div>
    {outage.length > 0 && <p className={styles.dailyAlert} role="note"><b aria-hidden="true">!</b>{t("dailyOutage", { dates: outage.map(item => shortDay(item.date, locale)).join(", "), kwh: `${num(outage.reduce((sum, item) => sum + item.recoveredKwh, 0))} kWh` })}</p>}
  </figure>;
}
