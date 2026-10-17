"use client";

import { useCallback, useEffect, useState } from "react";

import { configApi, type SystemHealthCheckDto, type SystemHealthDto } from "../../../lib/config-api";
import { friendlyErrorMessage } from "../_components/friendly-error";
import { EnergyIcon } from "../_components/icons";
import styles from "./admin-system-health.module.css";

type Client = Pick<typeof configApi, "getSystemHealth">;

const STATUS_LABEL = { ok: "Working", warning: "Needs attention", problem: "Not working" } as const;
const STATUS_ICON = { ok: "check", warning: "alert", problem: "alert" } as const;

/** Whether the AI advisor, email and each site's data are working, with what to do when they are not. */
export function AdminSystemHealth({ client = configApi }: { client?: Client }) {
  const [health, setHealth] = useState<SystemHealthDto | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { setHealth(await client.getSystemHealth()); }
    catch (reason) { setError(friendlyErrorMessage(reason, { fallback: "Could not check the system. Try again." })); }
    finally { setBusy(false); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const checks = health?.checks ?? [];
  const problems = checks.filter(check => check.status === "problem").length;
  const warnings = checks.filter(check => check.status === "warning").length;
  const groups = [...new Set(checks.map(check => check.group))];
  const overall = problems ? "problem" : warnings ? "warning" : "ok";

  return <div className={styles.page}>
    <section className={styles.summary} data-status={health ? overall : undefined} aria-live="polite">
      <span className={styles.summaryIcon} aria-hidden="true"><EnergyIcon name={health ? STATUS_ICON[overall] : "clock"} /></span>
      <div>
        <h2>{!health ? busy ? "Checking…" : "Not checked yet" : problems ? `${problems} ${problems === 1 ? "thing is" : "things are"} not working` : warnings ? `${warnings} ${warnings === 1 ? "thing needs" : "things need"} attention` : "Everything is working"}</h2>
        <p>{health ? `Checked ${new Date(health.checkedAt).toLocaleString("en-SG", { dateStyle: "medium", timeStyle: "short" })}` : "The AI advisor, email and each site's meter data."}</p>
      </div>
      <button type="button" className={styles.refresh} disabled={busy} onClick={() => void load()}>{busy ? "Checking…" : "Check again"}</button>
    </section>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {groups.map(group => <section key={group} className={styles.group} aria-label={group}>
      <h3>{group}</h3>
      <ul>{checks.filter(check => check.group === group).map(check => <HealthRow key={check.id} check={check} />)}</ul>
    </section>)}
  </div>;
}

function HealthRow({ check }: { check: SystemHealthCheckDto }) {
  return <li className={styles.row} data-status={check.status}>
    <span className={styles.dot} aria-hidden="true" />
    <div className={styles.rowBody}>
      <div className={styles.rowHead}><strong>{check.title}</strong><span className={styles.badge}>{STATUS_LABEL[check.status]}</span></div>
      <p>{check.detail}</p>
      {check.fix && check.status !== "ok" && <p className={styles.fix}><span>What to do:</span> {check.fix}</p>}
    </div>
  </li>;
}
