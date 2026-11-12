/** How often automatic reports come out. The combined choices publish each of their cadences when it falls due. */
export type ReportFrequency = "off" | "daily" | "weekly" | "monthly" | "weekly-monthly" | "daily-weekly-monthly";
/** One cadence a report can be issued at. */
export type ReportCadence = "daily" | "weekly" | "monthly";
export type ReportPeriod = { from: string; toExclusive: string };

export function validateReportPeriod(period: ReportPeriod): ReportPeriod {
  for (const value of [period.from, period.toExclusive]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new Error("REPORT_INVALID_DATE");
    }
  }
  if (period.from >= period.toExclusive) throw new Error("REPORT_INVALID_PERIOD");
  return period;
}

/** Calendar boundaries are local dates; dataset preparation converts them to instants. */
export function completedReportPeriod(now: Date, timezone: string, frequency: ReportCadence | "off", hour = 3): ReportPeriod | undefined {
  if (frequency === "off") return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)!.value;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("REPORT_INVALID_SCHEDULE_HOUR");
  if (Number(part("hour")) < hour) return undefined;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  if (frequency === "daily") return { from: shiftReportDate(today, -1), toExclusive: today };
  if (frequency === "weekly") {
    const monday = shiftReportDate(today, -((new Date(today).getUTCDay() + 6) % 7));
    return { from: shiftReportDate(monday, -7), toExclusive: monday };
  }
  const end = `${today.slice(0, 7)}-01`;
  const previous = new Date(end);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return { from: previous.toISOString().slice(0, 10), toExclusive: end };
}

export function shiftReportDate(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The cadences a frequency publishes, shortest first. */
export const reportCadences = (frequency: ReportFrequency): ReportCadence[] =>
  frequency === "daily-weekly-monthly" ? ["daily", "weekly", "monthly"] : frequency === "weekly-monthly" ? ["weekly", "monthly"] : frequency === "off" ? [] : [frequency];

/**
 * Only enqueue on the configured local publication day. Period calculation remains reusable. A daily report is due
 * every day and covers the day before; weekly ones fall due on Mondays and monthly ones on the first.
 */
export function dueReportPeriods(now: Date, timezone: string, frequency: ReportFrequency, hour = 3) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const frequencies = reportCadences(frequency);
  return frequencies.flatMap(cadence => {
    if (cadence === "weekly" && new Date(date).getUTCDay() !== 1) return [];
    if (cadence === "monthly" && !date.endsWith("-01")) return [];
    const period = completedReportPeriod(now, timezone, cadence, hour);
    return period ? [{ cadence, period }] : [];
  });
}
