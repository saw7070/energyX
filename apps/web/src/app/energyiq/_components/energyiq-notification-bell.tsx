"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { configApi, type EnergyMeterHealthDto, type EnergyProjectAlertsDto } from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import styles from "./energyiq-top-bar.module.css";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { friendlyErrorMessages } from "./friendly-error-messages";
import { meterHealth, stoppedMeters } from "./meter-health-notice";
import { notificationMessages } from "./notification-messages";

type Notice = { actionId: string; title: string; runId: string };

export type BellEntry = { key: string; tone: "warning" | "info"; title: string; detail: string; href: string; readKey?: string };

/** Meter health is a heavier read than the rest, and a stopped meter is not news by the second. */
const HEALTH_REFRESH_MS = 5 * 60_000;

/** A short, stable key for "these meters stopped at these times": a new stoppage is a new alert. */
export const stoppedKey = (meters: ReadonlyArray<{ meterPointId: string; lastReadingAt?: string }>): string => {
  const text = meters.map((meter) => `${meter.meterPointId}@${meter.lastReadingAt ?? ""}`).sort().join("|");
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return `meters:${hash.toString(36)}`;
};

/**
 * Alerts for the active project: meters that stopped sending, a daily live update that failed, automatic reports that
 * are ready, and measured results of actions. Opening one marks it read; action results are marked read in the Action
 * plan, as before.
 */
export function EnergyIqNotificationBell({ projectId }: { projectId: string }) {
  const { t, locale } = useEnergyIqLocale();
  const tf = useMessages(friendlyErrorMessages);
  const tn = useMessages(notificationMessages);
  const [items, setItems] = useState<Notice[]>([]);
  const [alerts, setAlerts] = useState<EnergyProjectAlertsDto | null>(null);
  const [health, setHealth] = useState<EnergyMeterHealthDto | null>(null);
  const [readNow, setReadNow] = useState<Set<string>>(new Set());
  // A failed load is not "no new results": say so, and keep whatever was already listed.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      // Action results exist only where the action pilot is on; elsewhere that list is simply empty.
      // Each source fails on its own: a missing or refused one never takes the others down.
      const [actionResult, alertResult] = await Promise.allSettled([
        Promise.resolve().then(() => configApi.reportActionRequest<{ items: Notice[] }>(projectId, "notifications")),
        Promise.resolve().then(() => configApi.getEnergyProjectAlerts(projectId)),
      ]);
      if (!alive) return;
      setItems(actionResult.status === "fulfilled" ? actionResult.value.items : []);
      if (alertResult.status === "fulfilled") { setAlerts(alertResult.value); setFailed(false); } else setFailed(true);
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [projectId, attempt]);
  useEffect(() => {
    let alive = true;
    const load = () => { Promise.resolve().then(() => meterHealth(projectId)).then((result) => { if (alive) setHealth(result); }).catch(() => undefined); };
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, HEALTH_REFRESH_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [projectId]);
  useEffect(() => { setItems([]); setAlerts(null); setHealth(null); setReadNow(new Set()); setFailed(false); }, [projectId]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const entries = useMemo<BellEntry[]>(() => {
    const read = new Set([...(alerts?.readKeys ?? []), ...readNow]);
    const when = (iso: string) => new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Singapore" }).format(new Date(iso));
    const day = (date: string) => new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
    const lastDay = (toExclusive: string) => new Date(Date.parse(`${toExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const list: BellEntry[] = [];
    if (alerts?.sync) {
      list.push({
        key: alerts.sync.key, readKey: alerts.sync.key, tone: "warning",
        title: tn("sync.title"), detail: tn(`sync.${alerts.sync.reason}`),
        href: `/energyiq/project-configuration?${new URLSearchParams({ projectId, connection: "live" })}`,
      });
    }
    const stopped = health ? stoppedMeters(health.meters) : [];
    if (stopped.length) {
      const key = stoppedKey(stopped);
      const first = stopped[0]!;
      list.push({
        key, readKey: key, tone: "warning",
        title: stopped.length === 1 ? tn("meters.one", { name: first.name }) : tn("meters.many", { count: stopped.length }),
        detail: stopped.length === 1
          ? tn("meters.detail", { when: when(first.lastReadingAt!) })
          : tn("meters.detailMany", { names: stopped.slice(0, 3).map((meter) => meter.name).join(", ") + (stopped.length > 3 ? "…" : ""), when: when(first.lastReadingAt!) }),
        href: `/energyiq/project-configuration?${new URLSearchParams({ projectId, tab: "devices" })}`,
      });
    }
    for (const report of alerts?.reports ?? []) {
      const last = lastDay(report.toExclusive);
      list.push({
        key: report.key, readKey: report.key, tone: "info",
        title: tn(`report.${report.cadence}`),
        detail: tn("report.detail", { period: report.from === last ? day(report.from) : `${day(report.from)} – ${day(last)}` }),
        href: `/energyiq/library?${new URLSearchParams({ projectId, reportId: report.reportId })}`,
      });
    }
    for (const item of items) {
      list.push({
        key: `action:${item.runId}`, tone: "info", title: item.title, detail: t("notifications.newResult"),
        href: `/energyiq/actions?${new URLSearchParams({ projectId, actionId: item.actionId })}`,
      });
    }
    return list.filter((entry) => !entry.readKey || !read.has(entry.readKey));
  }, [alerts, health, items, readNow, locale, projectId, t, tn]);

  const openEntry = (entry: BellEntry) => {
    setOpen(false);
    if (!entry.readKey) return;
    const key = entry.readKey;
    setReadNow((current) => new Set(current).add(key));
    void configApi.markEnergyProjectAlertRead(projectId, key).catch(() => undefined);
  };

  return <div ref={root} className={styles.bell}>
    <button ref={trigger} type="button" className={styles.iconButton} aria-label={entries.length ? t("notifications.count", { count: entries.length }) : t("notifications.title")} aria-expanded={open} aria-controls="energyiq-notifications" onClick={() => setOpen(value => !value)}>
      <EnergyIcon name="bell" />{entries.length > 0 && <span className={styles.badge} aria-hidden="true">{entries.length > 9 ? "9+" : entries.length}</span>}
    </button>
    {open && <section id="energyiq-notifications" aria-label={t("notifications.title")} className={styles.popover}>
      <h2>{t("notifications.title")}</h2>
      {entries.length ? <ul>{entries.map(entry => <li key={entry.key} data-tone={entry.tone}><Link href={entry.href} onClick={() => openEntry(entry)}>
        <strong>{entry.tone === "warning" ? <EnergyIcon name="alert" aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-amber-600" /> : null}{entry.title}</strong>
        <small>{entry.detail}</small>
      </Link></li>)}</ul>
        : failed ? <p role="alert">{tf("notifications.failed")} <button type="button" className="font-medium underline underline-offset-2" onClick={() => setAttempt(value => value + 1)}>{tf("tryAgain")}</button></p>
        : <p>{t("notifications.empty")}</p>}
    </section>}
  </div>;
}
