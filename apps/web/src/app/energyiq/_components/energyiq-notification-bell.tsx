"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { configApi } from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import styles from "./energyiq-top-bar.module.css";
import { useEnergyIqLocale } from "./energyiq-locale";

type Notice = { actionId: string; title: string; runId: string };

/** New action results for the active project; opening a result in the Action plan marks it read. */
export function EnergyIqNotificationBell({ projectId }: { projectId: string }) {
  const { t } = useEnergyIqLocale();
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const result = await configApi.reportActionRequest<{ items: Notice[] }>(projectId, "notifications"); if (alive) setItems(result.items); } catch { if (alive) setItems([]); } };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, [projectId]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={root} className={styles.bell}>
    <button ref={trigger} type="button" className={styles.iconButton} aria-label={items.length ? t("notifications.count", { count: items.length }) : t("notifications.title")} aria-expanded={open} aria-controls="energyiq-notifications" onClick={() => setOpen(value => !value)}>
      <EnergyIcon name="bell" />{items.length > 0 && <span className={styles.badge} aria-hidden="true">{items.length > 9 ? "9+" : items.length}</span>}
    </button>
    {open && <section id="energyiq-notifications" aria-label={t("notifications.title")} className={styles.popover}>
      <h2>{t("notifications.title")}</h2>
      {items.length ? <ul>{items.map(item => <li key={item.runId}><Link href={`/energyiq/actions?${new URLSearchParams({ projectId, actionId: item.actionId })}`} onClick={() => setOpen(false)}><strong>{item.title}</strong><small>{t("notifications.newResult")}</small></Link></li>)}</ul>
        : <p>{t("notifications.empty")}</p>}
    </section>}
  </div>;
}
