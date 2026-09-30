import type { EnergyOperatingCalendarRevisionDto } from "../../../lib/config-api";
import { isOpenDay } from "./device-statistics";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { dayMessages } from "./site-devices-messages";

export type DayKind = "open" | "weekend" | "closed" | "public_holiday" | "special_closure" | "special_operating_day";
export type SchoolPhase = "teaching" | "term_break" | "study_exam" | "vacation";
export type DayContext = { date: string; kind: DayKind; open: boolean; name?: string; school?: { phase: SchoolPhase; label?: string } };

export const DAY_KIND_LABELS: Record<DayKind, string> = {
  open: "Normal open day",
  weekend: "Weekend",
  closed: "Closed by the weekly schedule",
  public_holiday: "Public holiday",
  special_closure: "Planned closure",
  special_operating_day: "Special hours",
};
export const SCHOOL_PHASE_LABELS: Record<SchoolPhase, string> = { teaching: "Teaching weeks", term_break: "Term break", study_exam: "Study & exam weeks", vacation: "School vacation" };
/** Short chart badges; the legend spells them out. */
export const DAY_KIND_BADGES: Partial<Record<DayKind, string>> = { public_holiday: "PH", special_closure: "PC", special_operating_day: "SH" };

/** The kind of day in the reader's language (English matches DAY_KIND_LABELS). */
export const dayKindLabel = (kind: DayKind, locale: EnergyIqLocale = "en") => translatorFor(dayMessages, locale)(`kind.${kind}`);
/** The chart badge in the reader's language, or undefined for kinds without one. */
export const dayKindBadge = (kind: DayKind, locale: EnergyIqLocale = "en") => DAY_KIND_BADGES[kind] ? translatorFor(dayMessages, locale)(`badge.${kind as "public_holiday" | "special_closure" | "special_operating_day"}`) : undefined;
export const schoolPhaseLabel = (phase: SchoolPhase, locale: EnergyIqLocale = "en") => translatorFor(dayMessages, locale)(`phase.${phase}`);

/** What kind of day a local date was, from the published calendar the analysis used. */
export function dayContext(revision: Pick<EnergyOperatingCalendarRevisionDto, "entries" | "academic_periods"> | null, date: string): DayContext {
  const entries = revision?.entries ?? [];
  const entry = entries.find(item => item.owner.kind === "project" && item.effective_from.slice(0, 10) <= date && (!item.effective_to || date < item.effective_to.slice(0, 10)));
  const open = entries.length ? isOpenDay(entries, date) : true;
  const period = revision?.academic_periods?.find(item => item.from.slice(0, 10) <= date && date < item.to.slice(0, 10));
  const school = period ? { school: { phase: period.phase, ...(period.label ? { label: period.label } : {}) } } : {};
  const exception = entry?.exceptions?.find(item => item.date === date);
  if (exception) {
    const kind: DayKind = exception.classification === "public_holiday" ? "public_holiday" : exception.classification === "special_operating_day" || exception.operating.length ? "special_operating_day" : "special_closure";
    return { date, kind, open, ...(exception.label ? { name: exception.label } : {}), ...school };
  }
  const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
  return { date, kind: open ? "open" : weekend ? "weekend" : "closed", open, ...school };
}

/** "National Day · public holiday, closed" style wording for tooltips and lists. */
export function describeDay(day: DayContext, includeName = true, locale: EnergyIqLocale = "en"): string {
  const t = translatorFor(dayMessages, locale);
  const kind = dayKindLabel(day.kind, locale);
  const what = day.name && includeName ? t("day.named", { name: day.name, kind: kind.toLowerCase() }) : kind;
  const school = day.school && day.school.phase !== "teaching" ? ` · ${schoolPhaseLabel(day.school.phase, locale)}` : "";
  return `${what}${day.kind === "open" || day.kind === "weekend" ? "" : ` · ${t(day.open ? "day.open" : "day.closed")}`}${school}`;
}

export type SpecialDay = DayContext & { kwh: number | null; comparedWith: "open" | "closed"; baselineKwh: number | null; sharePct: number | null; verdict: string };
/**
 * Public holidays, planned closures and special-hours days in the window, each compared with a normal day it should
 * resemble, so readers can tell an expected dip from equipment left running.
 */
export function specialDays(days: DayContext[], dailyKwh: Map<string, number | null>, averages: { openDayKwh: number | null; closedDayKwh: number | null }, locale: EnergyIqLocale = "en"): SpecialDay[] {
  const t = translatorFor(dayMessages, locale);
  return days.filter(day => day.kind === "public_holiday" || day.kind === "special_closure" || day.kind === "special_operating_day").map(day => {
    const kwh = dailyKwh.get(day.date) ?? null;
    const comparedWith = day.open ? "open" : "closed";
    const baselineKwh = day.open ? averages.openDayKwh : averages.closedDayKwh;
    const sharePct = kwh !== null && averages.openDayKwh ? kwh / averages.openDayKwh * 100 : null;
    let verdict = t("verdict.noReadings");
    if (kwh !== null && !day.open) {
      verdict = t(averages.openDayKwh && kwh >= 0.8 * averages.openDayKwh ? "verdict.closedBusy"
        : averages.closedDayKwh && kwh <= 1.2 * averages.closedDayKwh ? "verdict.closedNormal"
        : "verdict.closedBetween");
    } else if (kwh !== null) {
      verdict = t(averages.openDayKwh && kwh < 0.6 * averages.openDayKwh ? "verdict.openLow" : "verdict.openNormal");
    }
    return { ...day, kwh, comparedWith, baselineKwh, sharePct, verdict };
  });
}

/** Contiguous school-calendar phases inside the window, e.g. teaching weeks then study & exam weeks. */
export function schoolPhases(days: DayContext[]): Array<{ phase: SchoolPhase; label?: string; from: string; to: string; dates: string[] }> {
  const phases: Array<{ phase: SchoolPhase; label?: string; from: string; to: string; dates: string[] }> = [];
  for (const day of days) {
    if (!day.school) continue;
    const last = phases[phases.length - 1];
    if (last && last.phase === day.school.phase && last.label === day.school.label) { last.to = day.date; last.dates.push(day.date); }
    else phases.push({ phase: day.school.phase, ...(day.school.label ? { label: day.school.label } : {}), from: day.date, to: day.date, dates: [day.date] });
  }
  return phases;
}
