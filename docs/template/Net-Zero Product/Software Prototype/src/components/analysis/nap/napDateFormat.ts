function parseLocalIsoDate(isoDate: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return null;
  }
  const date = new Date(`${isoDate}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Format ISO date as "4 Jun Wed".
 */
export function formatIsoDateWithWeekday(isoDate: string): string {
  const date = parseLocalIsoDate(isoDate);
  if (!date) {
    return isoDate;
  }
  const monthDay = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  return `${monthDay} ${weekday}`;
}

/**
 * Return short weekday label, e.g. "Mon".
 */
export function getWeekdayShort(isoDate: string): string {
  const date = parseLocalIsoDate(isoDate);
  if (!date) {
    return "";
  }
  return date.toLocaleDateString("en-GB", { weekday: "short" });
}

/**
 * Format ISO date range as "19 May Mon – 17 Jun Tue".
 */
export function formatIsoDateRangeWithWeekday(start: string, end: string): string {
  return `${formatIsoDateWithWeekday(start)} – ${formatIsoDateWithWeekday(end)}`;
}

/**
 * Replace ISO dates embedded in text, e.g. "2026-06-04" -> "4 Jun Wed".
 */
export function formatIsoDatesInText(text: string): string {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (match) => formatIsoDateWithWeekday(match));
}

/**
 * Extract YYYY-MM-DD from strings like "2026-06-04 14:00-15:00".
 */
export function extractIsoDateFromWindow(window: string): string | null {
  const match = window.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}
