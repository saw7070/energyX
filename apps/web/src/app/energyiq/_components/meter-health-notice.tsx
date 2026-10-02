"use client";
import { useEffect, useState } from "react";
import { configApi, type EnergyMeterHealthDto } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { meterHealthMessages } from "./meter-health-messages";
import styles from "./meter-health-notice.module.css";

type Quiet = EnergyMeterHealthDto["meters"][number];

/** "19 August", or "19 August 2025" once it is far enough back to need the year. */
const readingDay = (value: string | undefined, locale: string, now: Date) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(locale, { day: "numeric", month: "long", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
};

const daysSince = (value: string | undefined, now: Date) =>
  value ? Math.floor((now.getTime() - new Date(value).getTime()) / 86_400_000) : 0;

/**
 * How far behind the newest reading a meter may fall before it counts as
 * stopped, mirroring the server rule in energy-analysis.ts. Half a day: a meter
 * whose equipment is switched off for the night is quiet for hours without
 * anything being wrong, so the bar sits above a normal night.
 */
const STOPPED_AFTER_MS = 12 * 60 * 60_000;

/** The meters that were sending and went quiet, furthest behind first. */
export function stoppedMeters(meters: ReadonlyArray<Quiet>): Quiet[] {
  const sending = meters.filter(meter => meter.status === "usable" && meter.lastReadingAt);
  const newest = sending.reduce((latest, meter) => Math.max(latest, Date.parse(meter.lastReadingAt!)), 0);
  if (!newest) return [];
  return sending
    .filter(meter => newest - Date.parse(meter.lastReadingAt!) >= STOPPED_AFTER_MS)
    .sort((left, right) => left.lastReadingAt!.localeCompare(right.lastReadingAt!));
}

/**
 * Names the meters that are not reporting. A meter that stopped sending is a site problem — a socket
 * switched off, a tripped breaker, a device off the network — so this is shown to everyone who can
 * read the project, not hidden behind an administrator screen.
 */
/** Several notices on one page share a single request per project, reused for a short while. */
const HEALTH_REUSE_MS = 60_000;
const healthRequests = new Map<string, { at: number; pending: Promise<EnergyMeterHealthDto> }>();
export const meterHealth = (projectId: string): Promise<EnergyMeterHealthDto> => {
  const current = healthRequests.get(projectId);
  if (current && Date.now() - current.at < HEALTH_REUSE_MS) return current.pending;
  const pending = configApi.getEnergyProjectMeterHealth(projectId);
  healthRequests.set(projectId, { at: Date.now(), pending });
  pending.catch(() => healthRequests.delete(projectId));
  return pending;
};

/** Forget shared results, e.g. after new readings are published or between tests. */
export const resetMeterHealthRequests = () => healthRequests.clear();

export function useMeterHealth(projectId: string) {
  const [health, setHealth] = useState<EnergyMeterHealthDto | null>(null);
  useEffect(() => {
    let cancelled = false;
    meterHealth(projectId)
      .then(result => { if (!cancelled) setHealth(result); })
      .catch(() => undefined);   // The readings themselves already report their own failures.
    return () => { cancelled = true; };
  }, [projectId]);
  return health;
}

/**
 * Why the newest day is missing. A day counts only once every meter has covered it, and a meter that
 * reports on change alone goes quiet when its equipment is switched off — so the last day usually
 * completes on the next sync. Said plainly, this reads as normal; unsaid, it reads as a broken feed.
 */
export function PendingDayNote({ projectId, lastLocalDay, timezone, className }: { projectId: string; lastLocalDay: string | undefined; timezone: string; className?: string }) {
  const t = useMessages(meterHealthMessages);
  const { locale } = useEnergyIqLocale();
  const health = useMeterHealth(projectId);
  if (!health?.dataThrough || !lastLocalDay) return null;
  const localDay = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  // Readings have arrived for a day the figures do not cover yet.
  if (localDay(health.dataThrough) <= lastLocalDay) return null;
  const pending = new Date(`${lastLocalDay}T00:00:00Z`);
  pending.setUTCDate(pending.getUTCDate() + 1);
  const pendingDay = pending.toISOString().slice(0, 10);
  // A meter covers that day only if it reported after the day ended.
  const waiting = health.meters.filter(meter => meter.status === "usable" && meter.lastReadingAt && localDay(meter.lastReadingAt) <= pendingDay).length;
  const day = new Date(`${pendingDay}T12:00:00Z`).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "long", timeZone: "UTC" });
  // "It arrives with the next daily update" is only true while the meters are
  // still sending. Once one has stopped, the day never completes on its own,
  // and saying otherwise sends the reader away to wait for nothing.
  const stopped = stoppedMeters(health.meters);
  if (stopped.length) return <p className={className}>{t(stopped.length === 1 ? "pendingDayStoppedOne" : "pendingDayStopped", { day, count: String(stopped.length) })}</p>;
  return <p className={className}>{t(waiting ? "pendingDay" : "pendingDayPlain", { day, count: String(waiting) })}</p>;
}

export function MeterHealthNotice({ projectId }: { projectId: string }) {
  const t = useMessages(meterHealthMessages);
  const { locale } = useEnergyIqLocale();
  const health = useMeterHealth(projectId);

  const quiet: Quiet[] = (health?.meters ?? []).filter(meter => meter.status !== "usable");
  if (!health || quiet.length === 0) return null;
  const now = new Date();
  const formatted = intlLocale(locale);
  const stale = quiet.filter(meter => daysSince(meter.lastReadingAt, now) >= 2);

  return <section className={styles.notice} role="status">
    <h3>{t(quiet.length === 1 ? "titleOne" : "title", { count: quiet.length })}</h3>
    <p>{t(stale.length ? "bodyStopped" : "bodyThin")}</p>
    <ul>{quiet.map(meter => {
      const day = readingDay(meter.lastReadingAt, formatted, now);
      const days = daysSince(meter.lastReadingAt, now);
      return <li key={meter.meterPointId}>
        <strong>{meter.name}</strong>
        <span>{!day ? t("neverSent") : days >= 2 ? t("lastSent", { day, days: String(days) }) : t("sendingRarely")}</span>
      </li>;
    })}</ul>
    <p className={styles.what}>{t("whatToDo")}</p>
  </section>;
}

/**
 * On the Overview: the figures below stop where the readings do. Named here
 * because a decision-maker reading a monthly story should not have to notice a
 * missing bar on another page to learn that circuits went dark.
 */
export function StoppedMetersNote({ projectId, className }: { projectId: string; className?: string }) {
  const t = useMessages(meterHealthMessages);
  const { locale } = useEnergyIqLocale();
  const health = useMeterHealth(projectId);
  const stopped = stoppedMeters(health?.meters ?? []);
  if (!health || stopped.length === 0) return null;
  const since = new Date(stopped[0]!.lastReadingAt!).toLocaleString(intlLocale(locale), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return <p className={className} role="note">
    {t(stopped.length === 1 ? "stoppedOverviewOne" : "stoppedOverview", {
      count: String(stopped.length),
      since,
      devices: stopped.map(meter => meter.name).join(", "),
    })}
  </p>;
}
