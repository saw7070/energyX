import type { EnergyIqLocale } from "./locale.js";
export type ReportPeriod = { from: string; toExclusive: string };
export type PeriodOptions = { defaultPeriod: ReportPeriod; calendarToday?: string; availablePeriod: (ReportPeriod & { actualLastIntervalEnd?: string | null }) | null; availablePeriodReason?: string | null };
export type PeriodPreset = "current-month" | "recent" | "previous-month" | "previous-week" | "previous-day" | "all" | "custom";
export function shiftDate(value: string, days: number) { if (!value) return ""; const date = new Date(`${value}T00:00:00Z`); if (!Number.isFinite(date.getTime())) return ""; date.setUTCDate(date.getUTCDate()+days); return date.toISOString().slice(0,10); }
const MONTHS: Record<Exclude<EnergyIqLocale, "zh-Hans">, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ms: ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ogo", "Sep", "Okt", "Nov", "Dis"],
};
/**
 * Inclusive dates for people: "16 Aug – 13 Sep 2026", "1–31 Aug 2026", or "1 Dec 2025 – 3 Jan 2026" across years.
 * Chinese reads year first: "2026年8月16日 – 9月13日".
 */
export function formatPeriod(from: string, to: string, locale: EnergyIqLocale = "en"): string {
  const [fy, fm, fd] = from.split("-").map(Number), [ty, tm, td] = to.split("-").map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return `${from} – ${to}`;
  if (locale === "zh-Hans") {
    if (fy === ty && fm === tm) return fd === td ? `${fy}年${fm}月${fd}日` : `${fy}年${fm}月${fd}日–${td}日`;
    return `${fy}年${fm}月${fd}日 – ${fy === ty ? "" : `${ty}年`}${tm}月${td}日`;
  }
  const months = MONTHS[locale];
  if (fy === ty && fm === tm) return fd === td ? `${fd} ${months[fm - 1]} ${fy}` : `${fd}–${td} ${months[fm - 1]} ${fy}`;
  return `${fd} ${months[fm - 1]}${fy === ty ? "" : ` ${fy}`} – ${td} ${months[tm - 1]} ${ty}`;
}
export function presetPeriod(preset: PeriodPreset, options: PeriodOptions): ReportPeriod | null {
  if (preset === "recent") return options.defaultPeriod;
  if (preset === "all") return options.availablePeriod;
  if (preset === "custom") return null;
  const today = options.calendarToday ?? new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  if (preset === "previous-day") return { from: shiftDate(today,-1), toExclusive: today };
  const monthStart = `${today.slice(0,7)}-01`;
  if (preset === "current-month") return { from: monthStart, toExclusive: shiftDate(today,1) };
  if (preset === "previous-month") return { from: `${shiftDate(monthStart,-1).slice(0,7)}-01`, toExclusive: monthStart };
  const day = new Date(`${today}T00:00:00Z`).getUTCDay(); const monday = shiftDate(today,-((day+6)%7));
  return { from: shiftDate(monday,-7), toExclusive: monday };
}

/** The server resolves the default against the project data cutoff. */
export function initialReportPeriod(options: PeriodOptions): { period: ReportPeriod; preset: PeriodPreset } {
  return { period: options.defaultPeriod, preset: "recent" };
}
