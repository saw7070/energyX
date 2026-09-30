"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { AnalysisDay } from "./analysis-model";
import { dateWithDay, dateWithDayYear, monthShort } from "./analysis-model";
import { analysisMessages, analysisText, holidayName, joinText } from "./analysis-messages";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import type { EnergyIqLocale } from "./energyiq-messages";
import { EnergyIcon } from "./icons";

type PickerDay = Pick<AnalysisDay, "date" | "dayType" | "holidayName" | "complete" | "totalKwh">;
const DAY_MS = 86_400_000;
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Whole Monday-to-Sunday weeks covering the days; dates outside the period are null. */
export function calendarWeeks(dates: string[]): Array<Array<string | null>> {
  if (!dates.length) return [];
  const inPeriod = new Set(dates);
  const first = dates[0]!, last = dates.at(-1)!;
  let cursor = shift(first, -((new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7));
  const weeks: Array<Array<string | null>> = [];
  while (cursor <= last) {
    weeks.push(Array.from({ length: 7 }, (_, index) => { const date = shift(cursor, index); return inPeriod.has(date) ? date : null; }));
    cursor = shift(cursor, 7);
  }
  return weeks;
}

export function describePickerDay(day: PickerDay, locale: EnergyIqLocale = "en"): string {
  const t = analysisText(locale);
  const tags = [day.dayType === "public_holiday" ? day.holidayName != null ? holidayName(day.holidayName, locale) : t("picker.tagHoliday") : day.dayType === "weekend" ? t("picker.tagWeekend") : null, day.complete ? null : t("picker.tagMissing")].filter((tag): tag is string => !!tag);
  const values = { date: dateWithDayYear(day.date, locale), kwh: Math.round(day.totalKwh).toLocaleString("en-SG") };
  return tags.length ? t("picker.describeTags", { ...values, tags: joinText(tags, locale) }) : t("picker.describe", values);
}

/** A small month calendar for choosing one day of the period, instead of a long drop-down list. */
export function DayPicker({ days, value, onChange }: { days: PickerDay[]; value: string; onChange: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const { locale } = useEnergyIqLocale();
  const t = useMessages(analysisMessages);
  const describe = (day: PickerDay) => describePickerDay(day, locale);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const byDate = new Map(days.map(day => [day.date, day]));
  const picked = byDate.get(value);
  const maxKwh = Math.max(1, ...days.map(day => day.totalKwh));
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus({ preventScroll: true }); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    root.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus({ preventScroll: true });
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  const choose = (date: string) => { onChange(date); setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  let lastMonth = "";
  return <div ref={root} className="relative">
    <button ref={trigger} type="button" aria-label={t("picker.dayToShow", { day: picked ? describe(picked) : t("picker.none") })} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(current => !current)} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-slate-800 hover:bg-slate-100">
      <EnergyIcon name="calendar" className="h-3.5 w-3.5 text-slate-500" />
      <span className="tabular-nums">{picked ? dateWithDayYear(picked.date, locale) : t("picker.choose")}</span>
      {picked && picked.dayType !== "weekday" && <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${picked.dayType === "public_holiday" ? "bg-orange-50 text-orange-700" : "bg-slate-100 text-slate-600"}`}>{picked.dayType === "public_holiday" ? t("picker.holiday") : t("picker.weekend")}</span>}
      <EnergyIcon name="chevron" className={`h-3 w-3 text-slate-400 transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
    </button>
    {open && <div id={panelId} role="dialog" aria-label={t("picker.choose")} className="absolute right-0 top-full z-30 mt-2 w-[300px] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
      <p className="mb-2 text-xs font-semibold text-slate-900">{t("picker.choose")} <span className="font-normal text-slate-500">· {dateWithDay(days[0]!.date, locale)} – {dateWithDay(days.at(-1)!.date, locale)}</span></p>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-slate-500">{t("picker.weekdays").split(",").map(name => <span key={name}>{name}</span>)}</div>
      <div className="mt-1 grid gap-1">{calendarWeeks(days.map(day => day.date)).map(week => <div key={week.find(Boolean) ?? ""} className="grid grid-cols-7 gap-1">{week.map((date, index) => {
        if (!date) return <span key={index} aria-hidden="true" className="h-10" />;
        const day = byDate.get(date)!;
        const month = monthShort(date, locale);
        const showMonth = month !== lastMonth; lastMonth = month;
        const selected = date === value;
        const tone = selected ? "bg-slate-900 text-white" : day.dayType === "public_holiday" ? "bg-orange-50 text-orange-800 hover:bg-orange-100" : day.dayType === "weekend" ? "bg-slate-100 text-slate-500 hover:bg-slate-200" : "text-slate-800 hover:bg-slate-100";
        return <button key={date} type="button" aria-pressed={selected} aria-label={describe(day)} title={describe(day)} onClick={() => choose(date)} className={`relative flex h-10 flex-col items-center justify-center rounded-md text-xs tabular-nums ${tone} ${day.complete ? "" : "outline-dashed outline-1 -outline-offset-2 outline-amber-400"}`}>
          {showMonth && <span className={`absolute left-1 top-0.5 text-[8px] font-semibold uppercase ${selected ? "text-white/80" : "text-slate-400"}`}>{month}</span>}
          <span className="font-medium">{Number(date.slice(8))}</span>
          <span aria-hidden="true" className={`mt-0.5 h-[3px] w-6 overflow-hidden rounded-full ${selected ? "bg-white/25" : "bg-slate-200"}`}><span className={`block h-full rounded-full ${selected ? "bg-white" : "bg-[#2a78d6]"}`} style={{ width: `${Math.max(8, day.totalKwh / maxKwh * 100)}%` }} /></span>
        </button>;
      })}</div>)}</div>
      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-600">
        <li className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-200" />{t("picker.weekend")}</li>
        <li className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-orange-100" />{t("picker.holiday")}</li>
        <li className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm outline-dashed outline-1 outline-amber-400" />{t("picker.readingsMissing")}</li>
        <li className="flex items-center gap-1"><span className="h-[3px] w-3 rounded-full bg-[#2a78d6]" />{t("picker.energyUsed")}</li>
      </ul>
    </div>}
  </div>;
}
