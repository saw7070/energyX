/**
 * The site report's short "Days that stood out" block: the days that used clearly more or less than a usual day of
 * the same kind, each with the meters that account for most of the difference. Kept apart from site-report-model.ts,
 * which only asks for the finished block.
 */
import { listText } from "./analysis-messages.js";
import { scopeDays, shortDate } from "./analysis-model.js";
import type { AnalysisData } from "./analysis-types.js";
import type { EnergyIqLocale } from "./locale.js";
import { explainDays, meterGroupPlaces, standoutDays, standoutMeters } from "./standout-days.js";
import { daySentence, sharedMeterNames, standoutRule, standoutText } from "./standout-messages.js";

/** At most this many days are written out; the rest are counted. */
export const REPORT_STANDOUT_DAYS = 5;

/** Consecutive dates as one span: "3 Nov – 5 Nov", "9 Nov". */
function dateSpans(dates: string[], locale: EnergyIqLocale) {
  const spans: string[][] = [];
  for (const date of [...dates].sort()) {
    const last = spans.at(-1);
    if (last && Date.parse(`${date}T00:00:00Z`) - Date.parse(`${last.at(-1)}T00:00:00Z`) === 86_400_000) last.push(date); else spans.push([date]);
  }
  return spans.map(span => span.length === 1 ? shortDate(span[0]!, locale) : `${shortDate(span[0]!, locale)} – ${shortDate(span.at(-1)!, locale)}`);
}

export type StandoutReport = {
  title: string;
  /** One sentence or two per day, the clearest difference first. */
  items: Array<{ date: string; text: string }>;
  /** "No day stood out…", how many more days stood out, and which days were not compared for missing readings. */
  note: string;
  /** The rule for calling a day out, in one plain sentence. */
  rule: string;
};

export function standoutReport(data: AnalysisData, locale: EnergyIqLocale = "en"): StandoutReport {
  const t = standoutText(locale);
  const lighting = data.hoursMeaning === "lights_on";
  const meters = standoutMeters([data.current.project, ...data.current.spaces]);
  const explained = explainDays({ days: scopeDays(data.current.project, data.holidays), meters, lighting, places: meterGroupPlaces(data.groups) });
  const shared = sharedMeterNames(meters);
  const found = standoutDays(explained);
  const shown = found.slice(0, REPORT_STANDOUT_DAYS);
  // Days with no readings at all are outside the data, not gaps worth naming.
  const missing = explained.filter(item => item.status === "missing" && item.totalKwh > 0).map(item => item.date);
  const runs = dateSpans(missing, locale);
  const note = [
    found.length ? "" : t(lighting ? "lights.none" : "none"),
    found.length > shown.length ? t(found.length - shown.length === 1 ? "moreDays.one" : "moreDays.other", { count: found.length - shown.length }) : "",
    missing.length ? t(missing.length === 1 ? "missingDays.one" : "missingDays.other", { dates: listText(runs, locale) }) : "",
  ].filter(Boolean).join(locale === "zh-Hans" ? "" : " ");
  return {
    title: t("title"),
    items: shown.sort((a, b) => a.date.localeCompare(b.date)).map(item => ({ date: item.date, text: daySentence(item, locale, shared) })),
    note,
    rule: standoutRule(locale, lighting),
  };
}
