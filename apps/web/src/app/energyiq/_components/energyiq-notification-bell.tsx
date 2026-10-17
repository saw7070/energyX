"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { configApi, type EnergyLiveReadingsDto, type EnergyMeterHealthDto, type EnergyProjectAlertsDto } from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import styles from "./energyiq-top-bar.module.css";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { friendlyErrorMessages } from "./friendly-error-messages";
import { meterHealth, stoppedMeters } from "./meter-health-notice";
import { withCurrency } from "./money";
import { notificationMessages } from "./notification-messages";

type Notice = { actionId: string; title: string; runId: string };

export type BellKind = "overnight" | "budget" | "meters" | "sync" | "report" | "action";
export type BellEntry = { key: string; tone: "warning" | "info"; kind: BellKind; title: string; detail: string; href: string; at?: string; readKey?: string; runId?: string };

/** The icon and colour each kind of alert gets in the list, so a reader can tell them apart at a glance. */
const KIND_ICON: Record<BellKind, Parameters<typeof EnergyIcon>[0]["name"]> = {
  overnight: "alert", budget: "dollar", meters: "meter-off", sync: "alert", report: "document", action: "spark",
};

/** "Today, 6:05 am", "Yesterday, 11:00 pm", "Wednesday, 4:15 pm" within a week, then "8 Oct, 4:15 pm". Singapore time. */
export const alertTime = (iso: string, locale: string, words: { today: (time: string) => string; yesterday: (time: string) => string; dayAt: (day: string, time: string) => string }, now = Date.now()): string => {
  const zone = "Asia/Singapore";
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: zone }).format(date);
  const dayKey = (value: number) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date(value));
  const daysAgo = Math.round((Date.parse(dayKey(now)) - Date.parse(dayKey(date.getTime()))) / 86_400_000);
  if (daysAgo <= 0) return words.today(time);
  if (daysAgo === 1) return words.yesterday(time);
  const day = new Intl.DateTimeFormat(locale, daysAgo < 7 ? { weekday: "long", timeZone: zone } : { day: "numeric", month: "short", timeZone: zone }).format(date);
  return words.dayAt(day, time);
};

/** Meter health is a heavier read than the rest, and a stopped meter is not news by the second. */
const HEALTH_REFRESH_MS = 5 * 60_000;

/** A short, stable key for "these meters stopped at these times": a new stoppage is a new alert. */
export const stoppedKey = (meters: ReadonlyArray<{ meterPointId: string; lastReadingAt?: string }>): string => {
  const text = meters.map((meter) => `${meter.meterPointId}@${meter.lastReadingAt ?? ""}`).sort().join("|");
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return `meters:${hash.toString(36)}`;
};

/** "These meters went offline at these times": the same meters going offline again later is a new alert. */
export const offlineKey = (meters: ReadonlyArray<{ meterPointId: string; since: string }>): string =>
  stoppedKey(meters.map((meter) => ({ meterPointId: meter.meterPointId, lastReadingAt: meter.since }))).replace(/^meters:/, "offline:");

/**
 * Alerts for the active project: meters that went offline in the last hour (from the 15-minute live check), meters
 * that stopped sending, a daily live update that failed, automatic reports that
 * are ready, and measured results of actions. Opening an alert marks it read, and any entry, action results included,
 * can be marked read from the list without opening it.
 */
export function EnergyIqNotificationBell({ projectId }: { projectId: string }) {
  const { t, locale } = useEnergyIqLocale();
  const tf = useMessages(friendlyErrorMessages);
  const tn = useMessages(notificationMessages);
  const [items, setItems] = useState<Notice[]>([]);
  const [alerts, setAlerts] = useState<EnergyProjectAlertsDto | null>(null);
  const [health, setHealth] = useState<EnergyMeterHealthDto | null>(null);
  const [offline, setOffline] = useState<NonNullable<EnergyLiveReadingsDto["offline"]>>([]);
  const [readNow, setReadNow] = useState<Set<string>>(new Set());
  const [actionsReadNow, setActionsReadNow] = useState<Set<string>>(new Set());
  // A failed load is not "no new results": say so, and keep whatever was already listed.
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      // Action results exist only where the action pilot is on; elsewhere that list is simply empty.
      // Each source fails on its own: a missing or refused one never takes the others down.
      const [actionResult, alertResult, liveResult] = await Promise.allSettled([
        Promise.resolve().then(() => configApi.reportActionRequest<{ items: Notice[] }>(projectId, "notifications")),
        Promise.resolve().then(() => configApi.getEnergyProjectAlerts(projectId)),
        // Sites without a live connection simply have no offline meters.
        Promise.resolve().then(() => configApi.getEnergyLiveReadings(projectId)),
      ]);
      if (!alive) return;
      setItems(actionResult.status === "fulfilled" ? actionResult.value.items : []);
      setOffline(liveResult.status === "fulfilled" ? liveResult.value?.offline ?? [] : []);
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
  useEffect(() => { setItems([]); setAlerts(null); setHealth(null); setOffline([]); setReadNow(new Set()); setActionsReadNow(new Set()); setFailed(false); }, [projectId]);
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
        key: alerts.sync.key, readKey: alerts.sync.key, tone: "warning", kind: "sync", at: alerts.sync.failedAt,
        title: tn("sync.title"), detail: tn(`sync.${alerts.sync.reason}`),
        href: `/energyiq/project-configuration?${new URLSearchParams({ projectId, connection: "live" })}`,
      });
    }
    if (offline.length) {
      const key = offlineKey(offline);
      const first = offline[0]!;
      list.push({
        key, readKey: key, tone: "warning", kind: "meters", at: first.since,
        title: offline.length === 1 ? tn("offline.one", { name: first.name }) : tn("offline.many", { count: offline.length }),
        detail: offline.length === 1
          ? tn("offline.detail", { when: when(first.since) })
          : tn("offline.detailMany", { names: offline.slice(0, 3).map((meter) => meter.name).join(", ") + (offline.length > 3 ? "…" : ""), when: when(first.since) }),
        href: `/energyiq/project-configuration?${new URLSearchParams({ projectId, tab: "availability" })}`,
      });
    }
    // A meter already shown as offline now is not repeated as stopped.
    const stopped = health ? stoppedMeters(health.meters).filter((meter) => !offline.some((item) => item.meterPointId === meter.meterPointId)) : [];
    if (stopped.length) {
      const key = stoppedKey(stopped);
      const first = stopped[0]!;
      list.push({
        key, readKey: key, tone: "warning", kind: "meters", at: first.lastReadingAt,
        title: stopped.length === 1 ? tn("meters.one", { name: first.name }) : tn("meters.many", { count: stopped.length }),
        detail: stopped.length === 1
          ? tn("meters.detail", { when: when(first.lastReadingAt!) })
          : tn("meters.detailMany", { names: stopped.slice(0, 3).map((meter) => meter.name).join(", ") + (stopped.length > 3 ? "…" : ""), when: when(first.lastReadingAt!) }),
        href: `/energyiq/project-configuration?${new URLSearchParams({ projectId, tab: "devices" })}`,
      });
    }
    for (const alert of alerts?.targets ?? []) {
      const details = alert.details;
      if (alert.kind === "budget") {
        const currency = String(details.currency ?? "");
        const onMoney = typeof details.forecastCost === "number";
        const amount = (value: unknown) => onMoney
          ? withCurrency(currency, Number(value ?? 0).toLocaleString(intlLocale(locale), { maximumFractionDigits: 0 }))
          : `${Number(value ?? 0).toLocaleString(intlLocale(locale), { maximumFractionDigits: 0 })} kWh`;
        const month = new Intl.DateTimeFormat(intlLocale(locale), { month: "long", timeZone: "UTC" }).format(new Date(`${String(details.month ?? "2000-01")}-01T00:00:00Z`));
        list.push({
          key: alert.key, readKey: alert.key, tone: "warning", kind: "budget", at: alert.createdAt,
          title: tn(details.status === "over" ? "budget.over" : "budget.at-risk", { month }),
          detail: tn("budget.detail", { forecast: amount(onMoney ? details.forecastCost : details.forecastKwh), budget: amount(onMoney ? details.budgetAmount : details.budgetKwh) }),
          href: `/energyiq/project-configuration?${new URLSearchParams({ projectId, tab: "targets" })}`,
        });
      } else {
        list.push({
          key: alert.key, readKey: alert.key, tone: "warning", kind: "overnight", at: alert.createdAt,
          title: tn("overnight.title"),
          detail: tn("overnight.detail", { date: day(String(details.night ?? "")), kw: Number(details.nightKw ?? 0), pct: Number(details.abovePct ?? 0) }),
          href: `/energyiq/analysis?${new URLSearchParams({ projectId })}`,
        });
      }
    }
    for (const report of alerts?.reports ?? []) {
      const last = lastDay(report.toExclusive);
      list.push({
        key: report.key, readKey: report.key, tone: "info", kind: "report", at: report.finishedAt,
        title: tn(`report.${report.cadence}`),
        detail: tn("report.detail", { period: report.from === last ? day(report.from) : `${day(report.from)} – ${day(last)}` }),
        href: `/energyiq/library?${new URLSearchParams({ projectId, reportId: report.reportId })}`,
      });
    }
    for (const item of items) {
      list.push({
        key: `action:${item.runId}`, runId: item.runId, tone: "info", kind: "action", title: item.title, detail: t("notifications.newResult"),
        href: `/energyiq/actions?${new URLSearchParams({ projectId, actionId: item.actionId })}`,
      });
    }
    // Newest first; entries without a time (action results) keep their order at the end.
    return list
      .filter((entry) => (!entry.readKey || !read.has(entry.readKey)) && (!entry.runId || !actionsReadNow.has(entry.runId)))
      .map((entry, index) => ({ entry, index, at: entry.at ? Date.parse(entry.at) : Number.NEGATIVE_INFINITY }))
      .sort((left, right) => right.at - left.at || left.index - right.index)
      .map(({ entry }) => entry);
  }, [alerts, health, offline, items, readNow, actionsReadNow, locale, projectId, t, tn]);

  const markRead = (entry: BellEntry) => {
    if (entry.readKey) {
      const key = entry.readKey;
      setReadNow((current) => new Set(current).add(key));
      void Promise.resolve().then(() => configApi.markEnergyProjectAlertRead(projectId, key)).catch(() => undefined);
    }
    if (entry.runId) {
      const runId = entry.runId;
      setActionsReadNow((current) => new Set(current).add(runId));
      void Promise.resolve().then(() => configApi.reportActionRequest(projectId, `notifications/${runId}`, { method: "POST", body: "{}" })).catch(() => undefined);
    }
  };
  // Opening an action result leaves it for the Action plan to mark read, where the result is actually seen.
  const openEntry = (entry: BellEntry) => {
    setOpen(false);
    if (entry.readKey) markRead(entry);
  };
  // The button that was pressed disappears with its entry, so keep keyboard focus inside the list.
  const markOne = (entry: BellEntry) => { markRead(entry); panel.current?.focus(); };
  const markAll = () => { entries.forEach(markRead); panel.current?.focus(); };
  const when = (iso: string) => alertTime(iso, intlLocale(locale), {
    today: (time) => tn("today", { time }),
    yesterday: (time) => tn("yesterday", { time }),
    dayAt: (day, time) => tn("dayAt", { day, time }),
  });

  return <div ref={root} className={styles.bell}>
    <button ref={trigger} type="button" className={styles.iconButton} aria-label={entries.length ? t("notifications.count", { count: entries.length }) : t("notifications.title")} aria-expanded={open} aria-controls="energyiq-notifications" onClick={() => setOpen(value => !value)}>
      <EnergyIcon name="bell" />{entries.length > 0 && <span className={styles.badge} aria-hidden="true">{entries.length > 9 ? "9+" : entries.length}</span>}
    </button>
    {open && <section ref={panel} tabIndex={-1} id="energyiq-notifications" aria-label={t("notifications.title")} className={styles.popover}>
      <div className={styles.popoverHead}>
        <h2>{tn("title")}</h2>
        {entries.length > 0 && <span className={styles.openCount}>{tn("openCount", { count: entries.length })}</span>}
      </div>
      {entries.length ? <ul>{entries.map(entry => <li key={entry.key} data-tone={entry.tone} data-kind={entry.kind} className={styles.entry}>
        <Link href={entry.href} onClick={() => openEntry(entry)} title={entry.detail}>
          <span className={styles.entryIcon} aria-hidden="true"><EnergyIcon name={KIND_ICON[entry.kind]} /></span>
          <span className={styles.entryText}>
            <strong>{entry.title}</strong>
            <small>{entry.at ? when(entry.at) : entry.detail}</small>
            {entry.at && <span className={styles.entryDetail}>{entry.detail}</span>}
          </span>
        </Link>
        <button type="button" className={styles.readButton} title={tn("markRead")} aria-label={tn("markReadNamed", { title: entry.title })} onClick={() => markOne(entry)}><EnergyIcon name="check" aria-hidden="true" /></button>
      </li>)}</ul>
        : failed ? <p role="alert">{tf("notifications.failed")} <button type="button" className="font-medium underline underline-offset-2" onClick={() => setAttempt(value => value + 1)}>{tf("tryAgain")}</button></p>
        : <p>{t("notifications.empty")}</p>}
      {entries.length > 1 && <div className={styles.popoverFoot}><button type="button" className={styles.readAll} onClick={markAll}>{tn("markAllRead")}</button></div>}
    </section>}
  </div>;
}
