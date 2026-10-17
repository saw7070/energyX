"use client";

import { useEffect, useState } from "react";

import { configApi, type EnergyProjectDto, type SystemHealthCheckDto, type SystemHealthDto } from "../../../lib/config-api";
import { EnergyIcon, type EnergyIconName } from "../_components/icons";
import type { AdminSection } from "./admin-sidebar";
import styles from "./admin-overview.module.css";

type Client = Pick<typeof configApi, "getSystemHealth">;

const QUICK_ACTIONS: Array<{ section: AdminSection; icon: EnergyIconName; title: string; body: string }> = [
  { section: "users", icon: "user", title: "Invite people", body: "Add users and choose what they can see." },
  { section: "organisations", icon: "building", title: "Organisations", body: "Clients, their sites and who manages them." },
  { section: "ai-governance", icon: "spark", title: "AI governance", body: "AI on or off, model and monthly limits." },
  { section: "models", icon: "settings", title: "AI models", body: "Add and test the model the advisor uses." },
  { section: "audit", icon: "clock", title: "Audit history", body: "Who changed what, and when." },
];

/** Where an administrator fixes each kind of problem the health check finds. */
function fixSection(check: SystemHealthCheckDto): AdminSection {
  if (check.id === "ai-model") return "models";
  if (check.id === "ai-allowance") return "ai-governance";
  if (check.projectId) return "data-sources";
  return "system-health";
}

const ago = (iso: string) => {
  const hours = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  return hours < 1 ? "Under an hour ago" : hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

/** The admin console's front page: how the platform is doing, what needs fixing, every site, and shortcuts. */
export function AdminOverview({ projects, chooseAdminProject, setSection, client = configApi }: {
  projects: EnergyProjectDto[];
  chooseAdminProject: (projectId: string) => void;
  setSection: (section: AdminSection) => void;
  client?: Client;
}) {
  const [health, setHealth] = useState<SystemHealthDto | null>(null);
  const [healthFailed, setHealthFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    client.getSystemHealth().then(result => { if (alive) setHealth(result); }).catch(() => { if (alive) setHealthFailed(true); });
    return () => { alive = false; };
  }, [client]);

  const checks = health?.checks ?? [];
  const attention = checks.filter(check => check.status !== "ok").sort((a, b) => (a.status === b.status ? 0 : a.status === "problem" ? -1 : 1));
  const published = projects.filter(project => project.status === "published").length;
  const organisations = new Set(projects.map(project => project.workspaceId)).size;
  const aiReady = checks.length ? checks.some(check => check.id === "ai-model" && check.status === "ok") && checks.some(check => check.id === "advisor-worker" && check.status === "ok") : null;
  const siteChecks = (projectId: string) => checks.filter(check => check.projectId === projectId);
  const open = (projectId: string, section: AdminSection) => { chooseAdminProject(projectId); setSection(section); };

  return <div className={styles.page}>
    <section className={styles.stats} aria-label="Platform at a glance">
      <Stat icon="building" label="Sites" value={String(projects.length)} note={`${published} published`} />
      <Stat icon="user" label="Organisations" value={String(organisations)} note="with at least one site" />
      <Stat icon="alert" label="Needs attention" value={health ? String(attention.length) : "–"} note={health ? attention.length ? `${attention.filter(check => check.status === "problem").length} not working` : "All clear" : healthFailed ? "Could not check" : "Checking…"} tone={health ? attention.some(check => check.status === "problem") ? "problem" : attention.length ? "warning" : "ok" : undefined} />
      <Stat icon="spark" label="AI advisor" value={aiReady === null ? "–" : aiReady ? "Ready" : "Not ready"} note={aiReady === false ? "See what needs attention" : aiReady ? "Model and worker working" : "Checking…"} tone={aiReady === null ? undefined : aiReady ? "ok" : "problem"} />
    </section>

    <div className={styles.columns}>
      <section className={styles.card}>
        <header className={styles.cardHead}>
          <div><h3>What needs attention</h3><p>Problems first. Each one links to where it is fixed.</p></div>
          <button type="button" className={styles.linkButton} onClick={() => setSection("system-health")}>System health<EnergyIcon name="chevron" /></button>
        </header>
        {!health ? <p className={styles.empty}>{healthFailed ? "Could not run the health check. Open System health to try again." : "Checking the platform…"}</p>
          : !attention.length ? <p className={`${styles.empty} ${styles.allClear}`}><EnergyIcon name="check" />Everything is working.</p>
          : <ul className={styles.attention}>
            {attention.slice(0, 6).map(check => <li key={check.id} data-status={check.status}>
              <span className={styles.dot} aria-hidden="true" />
              <div><strong>{check.projectId ? `${check.group} · ${check.title}` : check.title}</strong><p>{check.detail}</p></div>
              <button type="button" className={styles.smallButton} onClick={() => check.projectId ? open(check.projectId, fixSection(check)) : setSection(fixSection(check))}>Fix</button>
            </li>)}
            {attention.length > 6 && <li className={styles.more}><button type="button" className={styles.linkButton} onClick={() => setSection("system-health")}>{attention.length - 6} more in System health<EnergyIcon name="chevron" /></button></li>}
          </ul>}
      </section>

      <section className={styles.card}>
        <header className={styles.cardHead}><div><h3>Quick actions</h3></div></header>
        <ul className={styles.actions}>
          {QUICK_ACTIONS.map(action => <li key={action.section}><button type="button" onClick={() => setSection(action.section)}>
            <span className={styles.actionIcon} aria-hidden="true"><EnergyIcon name={action.icon} /></span>
            <span><strong>{action.title}</strong><small>{action.body}</small></span>
            <EnergyIcon name="chevron" className={styles.chevron} />
          </button></li>)}
        </ul>
      </section>
    </div>

    <section className={styles.card}>
      <header className={styles.cardHead}><div><h3>Sites</h3><p>Every site in the console, its status and its newest meter reading.</p></div></header>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Site</th><th>Organisation</th><th>Status</th><th>Newest reading</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{projects.map(project => {
            const data = siteChecks(project.id).find(check => check.id.endsWith(":data"));
            const worst = siteChecks(project.id).some(check => check.status === "problem") ? "problem" : siteChecks(project.id).some(check => check.status === "warning") ? "warning" : data ? "ok" : undefined;
            return <tr key={project.id}>
              <td><span className={styles.siteName}><span className={styles.siteIcon} aria-hidden="true"><EnergyIcon name="building" /></span>{project.name}</span></td>
              <td className={styles.muted}>{data?.organisation ?? "—"}</td>
              <td><span className={styles.pill} data-status={project.status}>{project.status === "published" ? "Published" : project.status === "draft" ? "Draft" : "Archived"}</span></td>
              <td><span className={styles.reading} data-status={worst}>{data?.lastReadingAt ? ago(data.lastReadingAt) : health ? "No readings" : "…"}</span></td>
              <td className={styles.rowAction}><button type="button" className={styles.smallButton} onClick={() => open(project.id, "project-overview")}>Open</button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  </div>;
}

function Stat({ icon, label, value, note, tone }: { icon: EnergyIconName; label: string; value: string; note: string; tone?: "ok" | "warning" | "problem" | undefined }) {
  return <div className={styles.stat} data-tone={tone}>
    <span className={styles.statIcon} aria-hidden="true"><EnergyIcon name={icon} /></span>
    <div><span className={styles.statLabel}>{label}</span><strong>{value}</strong><small>{note}</small></div>
  </div>;
}
