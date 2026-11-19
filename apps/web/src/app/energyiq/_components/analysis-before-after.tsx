"use client";
import Link from "next/link";
import { Bar, CartesianGrid, Cell, ComposedChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  BEFORE_AFTER_MONTH_DAYS, beforeAfterBaseline, beforeAfterBasis, beforeAfterKwh, beforeAfterStatusNote, beforeAfterTakeaway, dateWithDayYear, forHoursMeaning,
  moneyText, shortDate, type BeforeAfter, type BeforeAfterAmount, type BeforeAfterDay,
} from "@datafoundry/site-report";
import { beforeAfterViewMessages } from "./analysis-before-after-messages";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import type { EnergyIqLocale, Translate } from "./energyiq-messages";
import { formatPeriod } from "./report-period";

/**
 * Analysis's "Before and after" step: for each change recorded on site (Facility → Savings) in or before the chosen
 * dates, what it changed, as one sentence, a chart of every day with the change marked, and a small table. The
 * figures all come from beforeAfter (@datafoundry/site-report), so the reports can say exactly the same.
 */

// Mid-tone fills that read on the light and the dark theme alike; the averages and labels use the text colour.
const BEFORE_FILL = "#6b7a90", AFTER_FILL = "#2f8f68", CHANGE_FILL = "#c27b16";
const LEFT_OUT_OPACITY = 0.32;
type ViewText = Translate<keyof typeof beforeAfterViewMessages.en>;

const num = (value: number, digits: number) => value.toLocaleString("en-SG", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const kwhText = (value: number) => `${num(Math.abs(value), Math.abs(value) >= 100 ? 0 : 1)} kWh`;
const signed = (value: number, text: string) => value < -1e-9 ? `−${text}` : value > 1e-9 ? `+${text}` : text;
const moneyOf = (value: number, currency: string) => moneyText(Math.abs(value), currency, Math.abs(value) >= 100 ? 0 : 2);
const co2Text = (kg: number, t: ViewText) => Math.abs(kg) >= 1000 ? t("tonnes", { value: num(Math.abs(kg) / 1000, 1) }) : t("kilograms", { value: num(Math.abs(kg), 0) });
const periodText = (from: string | null, to: string | null, locale: EnergyIqLocale) => from && to ? formatPeriod(from, to, locale) : "";

export function BeforeAfterSection({ projectId, results }: { projectId: string; results: BeforeAfter[] }) {
  const { locale } = useEnergyIqLocale();
  const t = useMessages(beforeAfterViewMessages);
  if (!results.length) return null;
  const single = results.length === 1;
  return <section id="story-change" aria-labelledby="story-change-title" className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="mb-5">
      <h2 id="story-change-title" className="text-lg font-semibold text-slate-900">{t("title")}</h2>
      <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-600">{single ? beforeAfterTakeaway(results[0]!, locale) : t("intro")}</p>
    </div>
    <div className="space-y-8">
      {results.map(result => <ChangeBlock key={result.change.id} result={result} showTakeaway={!single} />)}
    </div>
    <p className="mt-5 text-sm">
      <Link href={`/energyiq/project-configuration?${new URLSearchParams({ projectId, tab: "savings" })}`} className="text-blue-700 hover:text-blue-800">{t("manage")}</Link>
    </p>
  </section>;
}

function ChangeBlock({ result, showTakeaway }: { result: BeforeAfter; showTakeaway: boolean }) {
  const { locale } = useEnergyIqLocale();
  const plain = useMessages(beforeAfterViewMessages);
  const t: ViewText = forHoursMeaning(plain, beforeAfterViewMessages, result.measure === "lights_on" ? "lights_on" : "opening");
  const { change, figures } = result;
  const waiting = result.status === "upcoming" || result.status === "waiting";
  const scope = result.scope === "site" ? t("scopeSite") : result.meters.length === 1 ? t("scopeMeter", { name: result.meters[0]!.name })
    : t("scopeMeters", { count: result.meters.length, names: result.meters.slice(0, 3).map(meter => meter.name).join(", ") + (result.meters.length > 3 ? "…" : "") });
  const note = beforeAfterStatusNote(result, locale);
  return <article aria-label={change.title} className="space-y-4">
    <header>
      <h3 className="text-base font-semibold text-slate-900">{change.title}</h3>
      <p className="mt-0.5 text-sm text-slate-600">{t(result.status === "upcoming" ? "starts" : "started", { date: dateWithDayYear(change.date, locale) })} · {scope}</p>
      {change.note && <p className="mt-1 text-sm text-slate-500">{change.note}</p>}
    </header>
    {showTakeaway && <p className={`max-w-4xl text-sm leading-relaxed ${figures ? "font-medium text-slate-900" : "text-slate-700"}`}>{beforeAfterTakeaway(result, locale)}</p>}
    {waiting && beforeAfterBaseline(result, locale) && <p className="max-w-4xl text-sm text-slate-600">{beforeAfterBaseline(result, locale)}</p>}
    {!waiting && <DailyChart result={result} t={t} locale={locale} />}
    {figures && <FiguresTable result={result} t={t} />}
    {figures && note && <p className={`max-w-4xl rounded-lg px-3 py-2 text-sm ${result.status === "early" ? "border border-amber-200 bg-amber-50 text-amber-800" : "border border-slate-200 bg-slate-50 text-slate-700"}`}>{note}</p>}
    {figures && result.groups.length > 0 && <GroupsTable result={result} t={t} />}
    {!waiting && <div className="space-y-1 text-xs leading-relaxed text-slate-500">
      {figures && <p>{t("daysBefore", { count: result.beforeDays, period: periodText(result.beforeFrom, result.beforeTo, locale) })} {t("daysAfter", { count: result.afterDays, period: periodText(result.afterFrom, result.afterTo, locale) })}</p>}
      <p>{beforeAfterBasis(result, locale)}</p>
    </div>}
  </article>;
}

type ChartRow = { date: string; kwh: number | null; day: BeforeAfterDay };

function DailyChart({ result, t, locale }: { result: BeforeAfter; t: ViewText; locale: EnergyIqLocale }) {
  const rows: ChartRow[] = result.days.map(day => ({ date: day.date, kwh: day.kwh, day }));
  if (!rows.length) return null;
  const before = result.days.filter(day => day.side === "before");
  const after = result.days.filter(day => day.side === "after");
  const figures = result.figures;
  const fillOf = (day: BeforeAfterDay) => day.side === "change" ? CHANGE_FILL : day.side === "before" ? BEFORE_FILL : AFTER_FILL;
  const label = figures ? t("chartLabel", { from: shortDate(rows[0]!.date, locale), to: shortDate(rows.at(-1)!.date, locale), date: shortDate(result.change.date, locale), before: beforeAfterKwh(figures.beforeKwh), after: beforeAfterKwh(figures.afterKwh) }) : t("chartTitle");
  return <figure className="space-y-2">
    <figcaption className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("chartTitle")}</figcaption>
    <div role="img" aria-label={label} className="h-64 w-full text-slate-900">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          {before.length > 0 && <ReferenceArea x1={before[0]!.date} x2={before.at(-1)!.date} fill={BEFORE_FILL} fillOpacity={0.08} ifOverflow="extendDomain" />}
          {after.length > 0 && <ReferenceArea x1={after[0]!.date} x2={after.at(-1)!.date} fill={AFTER_FILL} fillOpacity={0.09} ifOverflow="extendDomain" />}
          <XAxis dataKey="date" interval="preserveStartEnd" minTickGap={28} tickFormatter={(date: string) => shortDate(date, locale)} stroke="#64748b" tick={{ fontSize: 10 }} />
          <YAxis width={44} stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(value: number) => num(value, 0)} unit="" />
          <Tooltip cursor={{ fill: "rgba(148, 163, 184, 0.14)" }} content={props => <DayTip active={props.active} row={props.payload?.[0]?.payload as ChartRow | undefined} t={t} locale={locale} />} />
          <Bar dataKey="kwh" isAnimationActive={false} radius={[2, 2, 0, 0]} maxBarSize={22}>
            {rows.map(row => <Cell key={row.date} fill={fillOf(row.day)} fillOpacity={row.day.side === "change" || row.day.counted ? 1 : LEFT_OUT_OPACITY} />)}
          </Bar>
          <ReferenceLine x={result.change.date} stroke={CHANGE_FILL} strokeDasharray="3 3" label={{ value: t("changeMark"), position: "top", fill: CHANGE_FILL, fontSize: 11, fontWeight: 600 }} />
          {figures && before.length > 0 && <ReferenceLine segment={[{ x: before[0]!.date, y: figures.beforeKwh }, { x: before.at(-1)!.date, y: figures.beforeKwh }]} stroke="currentColor" strokeWidth={1.75} strokeDasharray="6 4" ifOverflow="extendDomain" />}
          {figures && after.length > 0 && <ReferenceLine segment={[{ x: after[0]!.date, y: figures.afterKwh }, { x: after.at(-1)!.date, y: figures.afterKwh }]} stroke="currentColor" strokeWidth={1.75} strokeDasharray="6 4" ifOverflow="extendDomain" />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-600">
      {figures && <li className="inline-flex items-center gap-1.5"><Swatch colour={BEFORE_FILL} />{t("legendBefore", { kwh: kwhText(figures.beforeKwh) })}</li>}
      {figures && <li className="inline-flex items-center gap-1.5"><Swatch colour={AFTER_FILL} />{t("legendAfter", { kwh: kwhText(figures.afterKwh) })}</li>}
      <li className="inline-flex items-center gap-1.5"><Swatch colour={CHANGE_FILL} solid />{t("legendChange")}</li>
      {result.days.some(day => day.side !== "change" && !day.counted && day.kwh != null) && <li className="inline-flex items-center gap-1.5"><Swatch colour={BEFORE_FILL} solid pale />{t("legendLeftOut")}</li>}
    </ul>
  </figure>;
}

/** A bar's colour, with the dashed average line across it when `solid` is not set. */
function Swatch({ colour, solid = false, pale = false }: { colour: string; solid?: boolean; pale?: boolean }) {
  return <span aria-hidden className="relative inline-block h-3 w-4 rounded-sm text-slate-900" style={{ background: colour, opacity: pale ? LEFT_OUT_OPACITY : 1 }}>
    {!solid && <span className="absolute inset-x-0 top-1/2 border-t-2 border-dashed border-current" />}
  </span>;
}

function DayTip({ active, row, t, locale }: { active?: boolean | undefined; row: ChartRow | undefined; t: ViewText; locale: EnergyIqLocale }) {
  if (!active || !row) return null;
  const why = row.day.side === "change" ? t("tipChange") : row.day.counted ? "" : row.day.complete ? t("tipNotCompared") : t("tipLeftOut");
  return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm">
    <p className="font-medium text-slate-900">{dateWithDayYear(row.date, locale)}</p>
    <p className="tabular-nums">{row.kwh == null ? "—" : kwhText(row.kwh)}</p>
    {why && <p className="text-slate-500">{why}</p>}
  </div>;
}

function FiguresTable({ result, t }: { result: BeforeAfter; t: ViewText }) {
  const figures = result.figures!;
  const currency = result.currency;
  const cell = (amount: BeforeAfterAmount, change = false) => <>
    <span className="block font-medium tabular-nums text-slate-900">{change ? signed(amount.kwh, kwhText(amount.kwh)) : kwhText(amount.kwh)}</span>
    {amount.cost != null && currency && <span className="block tabular-nums text-slate-500">{change ? signed(amount.cost, moneyOf(amount.cost, currency)) : moneyOf(amount.cost, currency)}</span>}
  </>;
  const rows = [
    { label: t("rowDay"), stretch: figures.day },
    { label: t("rowMonth", { days: BEFORE_AFTER_MONTH_DAYS }), stretch: figures.month },
    { label: t("rowYear"), stretch: figures.year },
  ];
  const yearCo2 = figures.year.change.co2Kg;
  // On a phone each period heads its own row, so the three amounts get the whole width; from sm up it is a column.
  return <div className="space-y-2">
    <div className="max-w-3xl overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-left text-[13px] sm:text-sm">
        <caption className="sr-only">{t("tableCaption")}</caption>
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr><th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell"><span className="sr-only">{t("tableCaption")}</span></th><th scope="col" className="px-2.5 py-2 font-medium sm:px-3">{t("tableBefore")}</th><th scope="col" className="px-2.5 py-2 font-medium sm:px-3">{t("tableAfter")}</th><th scope="col" className="px-2.5 py-2 font-medium sm:px-3">{t("tableChange")}</th></tr>
        </thead>
        {rows.map(row => <tbody key={row.label} className="border-t border-slate-200">
          <tr className="sm:hidden"><th scope="colgroup" colSpan={3} className="px-2.5 pt-2 text-xs font-medium text-slate-700">{row.label}</th></tr>
          <tr data-period className="align-top">
            <th scope="row" className="hidden px-3 py-2 font-medium text-slate-700 sm:table-cell">{row.label}</th>
            <td className="px-2.5 py-2 sm:px-3">{cell(row.stretch.before)}</td>
            <td className="px-2.5 py-2 sm:px-3">{cell(row.stretch.after)}</td>
            <td className="px-2.5 py-2 sm:px-3">{cell(row.stretch.change, true)}{row.stretch === figures.day && figures.changePct != null && <span className="block text-xs tabular-nums text-slate-500">{signed(figures.changePct, `${num(Math.abs(figures.changePct), 0)}%`)}</span>}</td>
          </tr>
        </tbody>)}
      </table>
    </div>
    <div className="space-y-0.5 text-xs text-slate-500">
      {yearCo2 != null && result.carbonFactor != null && Math.abs(yearCo2) >= 0.5 && <p>{t(yearCo2 < 0 ? "carbonLess" : "carbonMore", { amount: co2Text(yearCo2, t), factor: result.carbonFactor.toFixed(3) })}</p>}
      {result.rate != null && currency && <p>{result.taxIncluded && result.taxName ? t("rateIncl", { rate: moneyText(result.rate, currency, 4), tax: result.taxName }) : t("rate", { rate: moneyText(result.rate, currency, 4) })}</p>}
    </div>
  </div>;
}

function GroupsTable({ result, t }: { result: BeforeAfter; t: ViewText }) {
  // On a phone only the change is a column; before and after sit under it as one small line.
  return <div className="max-w-3xl space-y-2">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t("groupsTitle")}</h4>
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-left text-[13px] sm:text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr><th scope="col" className="px-2.5 py-2 font-medium sm:px-3">{t("groupsGroup")}</th><th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">{t("tableBefore")}</th><th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">{t("tableAfter")}</th><th scope="col" className="px-2.5 py-2 font-medium sm:px-3">{t("tableChange")}</th></tr>
        </thead>
        <tbody>
          {result.groups.map(group => <tr key={group.id} className="border-t border-slate-200 align-top">
            <th scope="row" className="px-2.5 py-2 font-medium text-slate-800 sm:px-3">{group.name}</th>
            {group.figures ? <>
              <td className="hidden px-3 py-2 tabular-nums text-slate-700 sm:table-cell">{kwhText(group.figures.beforeKwh)}</td>
              <td className="hidden px-3 py-2 tabular-nums text-slate-700 sm:table-cell">{kwhText(group.figures.afterKwh)}</td>
              <td className="px-2.5 py-2 tabular-nums sm:px-3">
                <span className="font-medium text-slate-900">{signed(group.figures.changeKwh, kwhText(group.figures.changeKwh))}</span>
                {group.figures.changePct != null && <span className="ml-1.5 text-xs text-slate-500">({signed(group.figures.changePct, `${num(Math.abs(group.figures.changePct), 0)}%`)})</span>}
                <span className="block text-xs text-slate-500 sm:hidden">{num(group.figures.beforeKwh, 1)} → {kwhText(group.figures.afterKwh)}</span>
              </td>
            </> : <td colSpan={3} className="px-2.5 py-2 text-slate-500 sm:px-3">{t("groupsNotYet")}</td>}
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}
