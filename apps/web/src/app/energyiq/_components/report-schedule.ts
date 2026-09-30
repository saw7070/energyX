/**
 * When the next automatic report is due, worked out the same way the server decides to run one:
 * weekly reports start on a Monday, monthly ones on the first of the month, and neither runs before
 * the chosen hour in the project's own timezone. Mirrors dueReportPeriods in the API's report-calendar.
 */
export type ReportFrequency = "off" | "daily" | "weekly" | "monthly" | "weekly-monthly";

/** Today's date in a timezone, as YYYY-MM-DD, plus the hour there. */
function localNow(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}
const addDays = (date: string, days: number) => { const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + days); return next.toISOString().slice(0, 10); };
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** The next date a report of this cadence starts, given today's local date and whether the hour has passed. */
function nextDate(cadence: "daily" | "weekly" | "monthly", today: string, hourPassed: boolean): string {
  if (cadence === "daily") return hourPassed ? addDays(today, 1) : today;
  if (cadence === "weekly") {
    const untilMonday = (8 - weekday(today)) % 7;
    return untilMonday === 0 ? (hourPassed ? addDays(today, 7) : today) : addDays(today, untilMonday);
  }
  const firstOfThisMonth = `${today.slice(0, 7)}-01`;
  if (today === firstOfThisMonth && !hourPassed) return today;
  const [year, month] = today.split("-").map(Number);
  return month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, "0")}-01`;
}

/** The next run as a local date and hour, or null when automatic reports are off. */
export function nextReportRun(now: Date, timezone: string, frequency: ReportFrequency, localHour: number): { date: string; hour: number } | null {
  if (frequency === "off") return null;
  const hour = Number.isInteger(localHour) && localHour >= 0 && localHour <= 23 ? localHour : 3;
  const today = localNow(now, timezone);
  const hourPassed = today.hour >= hour;
  const cadences = frequency === "weekly-monthly" ? (["weekly", "monthly"] as const) : ([frequency] as const);
  const dates = cadences.map(cadence => nextDate(cadence, today.date, hourPassed)).sort();
  return { date: dates[0]!, hour };
}
