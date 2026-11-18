import type { MetadataStore } from "@datafoundry/metadata";

const FALLBACK_TIMEZONE = "Asia/Singapore";

const zonedParts = (ms: number, timezone: string): Record<string, number> => {
  const format = (zone: string) => new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = format(timezone || FALLBACK_TIMEZONE);
  } catch {
    formatter = format(FALLBACK_TIMEZONE);
  }
  return Object.fromEntries(formatter.formatToParts(new Date(ms))
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
};

/** How far the zone is ahead of UTC at this instant, in milliseconds. */
const zoneOffsetMs = (ms: number, timezone: string): number => {
  const parts = zonedParts(ms, timezone);
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return asUtc - Math.floor(ms / 1000) * 1000;
};

/** The instant a local calendar day starts in the zone. */
const zonedMidnight = (year: number, month: number, day: number, timezone: string): number => {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - zoneOffsetMs(guess, timezone);
  return guess - zoneOffsetMs(first, timezone);
};

/**
 * The oldest instant a client with this limit keeps: local midnight, in the site's time zone, of the same calendar
 * day `months` months ago (the last day of that month when it is shorter). Readings before it are removed.
 */
export const readingRetentionCutoff = (months: number, timezone: string, nowMs: number): string => {
  if (!Number.isInteger(months) || months < 1) throw new Error("ENERGYIQ_READING_RETENTION_INVALID");
  const today = zonedParts(nowMs, timezone);
  let year = today.year!;
  let month = today.month! - months;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(zonedMidnight(year, month, Math.min(today.day!, lastDay), timezone)).toISOString();
};

/** The retention cutoff for a site of this client, or undefined when the client keeps readings for good. */
export const resolveReadingRetainFrom = (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  timezone: string;
  nowMs: number;
}): string | undefined => {
  const months = input.metadataStore.energyIq.readingRetention.get(input.workspaceId);
  return months ? readingRetentionCutoff(months, input.timezone, input.nowMs) : undefined;
};
