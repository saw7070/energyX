"use client";

import { useCallback, useEffect, useState } from "react";

import { configApi, type EnergyAdminAiActivityDto, type EnergyAdminAiDto } from "../../../lib/config-api";
import { friendlyErrorMessage } from "../_components/friendly-error";
import { EnergyIcon } from "../_components/icons";
import styles from "./admin-ai.module.css";

type Organisation = EnergyAdminAiDto["organisations"][number];

const FEATURES: Record<string, string> = { advisor: "Advisor", report: "Reports", overview: "Overview AI", insights: "AI insights", actions: "Action suggestions", other: "Other" };
const number = (value: number) => new Intl.NumberFormat("en-SG").format(value);
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/**
 * Super admins' AI governance: per client, whether AI is on, which tested model its data goes to, a monthly request
 * limit, and this month's use and feedback, with a drill-down into recent requests and comments.
 */
export function AdminAiGovernance() {
  const [data, setData] = useState<EnergyAdminAiDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await configApi.getEnergyAdminAi());
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: "AI settings could not be loaded." }));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const update = async (organisation: Organisation, body: Parameters<typeof configApi.updateEnergyAdminAi>[1], message: string) => {
    setBusy(organisation.id);
    setError(null);
    setNotice(null);
    try {
      setData(await configApi.updateEnergyAdminAi(organisation.id, body));
      setNotice(`${organisation.name}: ${message}`);
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: "That change could not be saved." }));
    } finally {
      setBusy(null);
    }
  };

  if (!data) return <div className={styles.page}>{error ? <p role="alert" className={styles.error}>{error}</p> : <p role="status" className={styles.muted}>Loading AI settings…</p>}</div>;
  const active = data.organisations.filter(organisation => !organisation.disabled);
  const totalRequests = active.reduce((sum, organisation) => sum + organisation.usage.requests, 0);
  const totalBlocked = active.reduce((sum, organisation) => sum + organisation.usage.blocked, 0);
  const helpful = active.reduce((sum, organisation) => sum + organisation.usage.helpful, 0);
  const notHelpful = active.reduce((sum, organisation) => sum + organisation.usage.notHelpful, 0);
  const month = new Date(data.monthStart).toLocaleDateString("en-SG", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <p>Decide, for each client, whether AI is used, which tested model their data goes to, and how many AI requests they may make each month. Every request is also recorded in Audit history. Clients&apos; own administrators can switch AI off for their organisation.</p>
        <a href="/legal/ai-use" target="_blank" rel="noreferrer" className={styles.link}>AI use policy <EnergyIcon name="arrow" className="h-3.5 w-3.5" /></a>
      </header>

      <section className={styles.stats} aria-label={`AI use in ${month}`}>
        <div><span>AI requests in {month}</span><strong>{number(totalRequests)}</strong></div>
        <div><span>Refused (off or over limit)</span><strong className={totalBlocked ? styles.warnText : undefined}>{number(totalBlocked)}</strong></div>
        <div><span>Answer feedback</span><strong><EnergyIcon name="thumb-up" className="h-4 w-4" /> {number(helpful)} <EnergyIcon name="thumb-down" className="ml-2 h-4 w-4" /> {number(notHelpful)}</strong></div>
        <div><span>Platform default model</span><strong className={styles.modelName}>{data.platformModel ?? "Not set"}</strong></div>
      </section>

      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {data.models.length === 0 && <p className={styles.hint}>No tested models yet. Add and test one under Models; until then every client uses the platform default.</p>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr><th>Client</th><th>AI</th><th>Model for advisor &amp; reports</th><th>Monthly limit</th><th>This month</th><th>Feedback</th><th /></tr>
          </thead>
          <tbody>
            {data.organisations.map(organisation => (
              <OrganisationRow key={organisation.id} organisation={organisation} models={data.models} busy={busy === organisation.id}
                expanded={open === organisation.id} onToggleExpanded={() => setOpen(open === organisation.id ? null : organisation.id)} onUpdate={update} />
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.hint}>Overview AI summaries use the platform default model. Switching AI off or reaching the limit also pauses them for that client.</p>
    </div>
  );
}

function OrganisationRow({ organisation, models, busy, expanded, onToggleExpanded, onUpdate }: {
  organisation: Organisation;
  models: EnergyAdminAiDto["models"];
  busy: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onUpdate: (organisation: Organisation, body: Parameters<typeof configApi.updateEnergyAdminAi>[1], message: string) => Promise<void>;
}) {
  const { settings, usage } = organisation;
  const [limit, setLimit] = useState(settings.monthlyRequestLimit === undefined ? "" : String(settings.monthlyRequestLimit));
  useEffect(() => { setLimit(settings.monthlyRequestLimit === undefined ? "" : String(settings.monthlyRequestLimit)); }, [settings.monthlyRequestLimit]);
  const limitChanged = limit.trim() !== (settings.monthlyRequestLimit === undefined ? "" : String(settings.monthlyRequestLimit));
  const share = settings.monthlyRequestLimit ? Math.min(1, usage.requests / settings.monthlyRequestLimit) : 0;
  const tone = !settings.monthlyRequestLimit ? "" : share >= 1 ? styles.full : share >= 0.8 ? styles.near : "";
  const chosen = settings.modelProfileId && !models.some(model => model.id === settings.modelProfileId);
  return (
    <>
      <tr className={organisation.disabled ? styles.dim : undefined}>
        <th scope="row">
          <span className={styles.orgName}>{organisation.name}</span>
          {organisation.disabled && <span className={styles.pill}>Client disabled</span>}
        </th>
        <td>
          <button type="button" role="switch" aria-checked={settings.enabled} aria-label={`AI for ${organisation.name}`} className={styles.switch} disabled={busy}
            onClick={() => void onUpdate(organisation, { enabled: !settings.enabled }, settings.enabled ? "AI switched off." : "AI switched on.")}>
            <span />
          </button>
        </td>
        <td>
          <select className={styles.select} value={settings.modelProfileId ?? ""} disabled={busy} aria-label={`Model for ${organisation.name}`}
            onChange={event => void onUpdate(organisation, { modelProfileId: event.target.value || null }, "model updated.")}>
            <option value="">Platform default</option>
            {models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
            {chosen && <option value={settings.modelProfileId}>Unavailable model</option>}
          </select>
          {chosen && <span className={styles.warnSmall}>The chosen model is no longer tested. Requests are refused until another is picked.</span>}
        </td>
        <td>
          <form className={styles.limit} onSubmit={event => {
            event.preventDefault();
            const value = limit.trim();
            void onUpdate(organisation, { monthlyRequestLimit: value === "" ? null : Number(value) }, value === "" ? "no monthly limit." : `limit set to ${value} a month.`);
          }}>
            <input inputMode="numeric" placeholder="No limit" value={limit} onChange={event => setLimit(event.target.value.replace(/[^0-9]/g, ""))} aria-label={`Monthly AI request limit for ${organisation.name}`} />
            {limitChanged && <button type="submit" disabled={busy}>Save</button>}
          </form>
        </td>
        <td>
          <div className={styles.usage}>
            <span><strong>{number(usage.requests)}</strong>{settings.monthlyRequestLimit !== undefined ? ` / ${number(settings.monthlyRequestLimit)}` : ""} requests</span>
            {settings.monthlyRequestLimit !== undefined && <span className={`${styles.meter} ${tone}`}><i style={{ width: `${share * 100}%` }} /></span>}
            <small>{number(usage.inputTokens + usage.outputTokens)} tokens{usage.blocked ? ` · ${number(usage.blocked)} refused` : ""}</small>
          </div>
        </td>
        <td className={styles.feedback}>
          <span title="Helpful"><EnergyIcon name="thumb-up" className="h-3.5 w-3.5" />{usage.helpful}</span>
          <span title="Not helpful"><EnergyIcon name="thumb-down" className="h-3.5 w-3.5" />{usage.notHelpful}</span>
        </td>
        <td><button type="button" className={styles.ghost} aria-expanded={expanded} onClick={onToggleExpanded}>{expanded ? "Hide" : "Activity"}</button></td>
      </tr>
      {expanded && <tr className={styles.detailRow}><td colSpan={7}><Activity workspaceId={organisation.id} /></td></tr>}
    </>
  );
}

function Activity({ workspaceId }: { workspaceId: string }) {
  const [activity, setActivity] = useState<EnergyAdminAiActivityDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    configApi.getEnergyAdminAiActivity(workspaceId).then(setActivity).catch(reason => setError(friendlyErrorMessage(reason, { fallback: "Activity could not be loaded." })));
  }, [workspaceId]);
  if (error) return <p role="alert" className={styles.error}>{error}</p>;
  if (!activity) return <p role="status" className={styles.muted}>Loading activity…</p>;
  return (
    <div className={styles.activity}>
      <section>
        <h4>Recent AI requests <small>last 90 days</small></h4>
        {activity.usage.length === 0 ? <p className={styles.muted}>No AI requests yet.</p> : (
          <ul>
            {activity.usage.slice(0, 40).map(entry => (
              <li key={entry.id}>
                <span className={styles.time}>{when(entry.createdAt)}</span>
                <span>{FEATURES[entry.feature] ?? entry.feature}{entry.project ? ` · ${entry.project}` : ""}</span>
                <span className={styles.muted}>{entry.user ?? "System"}</span>
                <span className={entry.status === "allowed" ? styles.muted : styles.warnText}>
                  {entry.status === "allowed" ? [entry.model, entry.inputTokens !== undefined || entry.outputTokens !== undefined ? `${number((entry.inputTokens ?? 0) + (entry.outputTokens ?? 0))} tokens` : ""].filter(Boolean).join(" · ") || "—"
                    : entry.status === "blocked-limit" ? "Refused: monthly limit" : "Refused: AI off"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h4>Answer feedback</h4>
        {activity.feedback.length === 0 ? <p className={styles.muted}>No feedback yet.</p> : (
          <ul>
            {activity.feedback.map(entry => (
              <li key={entry.id}>
                <span className={styles.time}>{when(entry.createdAt)}</span>
                <span className={entry.rating === "up" ? styles.okText : styles.warnText}><EnergyIcon name={entry.rating === "up" ? "thumb-up" : "thumb-down"} className="h-3.5 w-3.5" /></span>
                <span>{entry.comment ?? <span className={styles.muted}>No comment</span>}</span>
                <span className={styles.muted}>{[entry.user, entry.project].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
