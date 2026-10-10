"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

import { configApi, type EnergyReportScheduleDto, type EnergyReportScheduleInputDto, type EnergyReportSchedulesDto } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "../_components/energyiq-locale";
import { intlLocale } from "../_components/energyiq-messages";
import { friendlyErrorMessage } from "../_components/friendly-error";
import { EnergyIcon } from "../_components/icons";
import { portfolioMessages } from "./portfolio-messages";
import styles from "./portfolio.module.css";

/** Scheduled report emails for the active client, for people who manage its team. */
export function ReportSchedules() {
  const t = useMessages(portfolioMessages);
  const [data, setData] = useState<EnergyReportSchedulesDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await configApi.listEnergyReportSchedules());
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: t("saveFailed") }));
    }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<EnergyReportSchedulesDto>, success?: (result: EnergyReportSchedulesDto) => string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      setData(result);
      if (success) setNotice(success(result));
      return true;
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: t("saveFailed") }));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <p role="alert" className={styles.error}>{error}</p> : null;
  return (
    <ReportSchedulesView
      data={data}
      busy={busy}
      error={error}
      notice={notice}
      onCreate={body => run(() => configApi.createEnergyReportSchedule(body), () => t("saved"))}
      onUpdate={(id, body) => run(() => configApi.updateEnergyReportSchedule(id, body), () => t("saved"))}
      onDelete={id => run(() => configApi.deleteEnergyReportSchedule(id))}
      onSend={id => run(async () => {
        const result = await configApi.sendEnergyReportScheduleNow(id);
        if (result.outcome.status === "failed") throw new Error(t("sendFailed", { reason: result.outcome.error ?? "" }));
        return result;
      }, result => {
        const outcome = (result as EnergyReportSchedulesDto & { outcome?: { status: string; recipientCount: number } }).outcome;
        return outcome?.status === "skipped" ? t("sendSkipped") : t("sentNow", { count: outcome?.recipientCount ?? 0 });
      })}
    />
  );
}

type Draft = EnergyReportScheduleInputDto & { allSites: boolean };

export function ReportSchedulesView({ data, busy, error, notice, onCreate, onUpdate, onDelete, onSend }: {
  data: EnergyReportSchedulesDto;
  busy: boolean;
  error: string | null;
  notice: string | null;
  onCreate: (body: EnergyReportScheduleInputDto) => Promise<boolean>;
  onUpdate: (id: string, body: Partial<EnergyReportScheduleInputDto>) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onSend: (id: string) => Promise<boolean>;
}) {
  const t = useMessages(portfolioMessages);
  const [editing, setEditing] = useState<{ id?: string; draft: Draft } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const readers = data.team.filter(member => member.canReadReports);
  const blank = (): Draft => ({ name: t("scheduleNameDefault"), frequency: "monthly", projectIds: [], recipientUserIds: [], localHour: 8, allSites: true });
  const fromSchedule = (schedule: EnergyReportScheduleDto): Draft => ({
    name: schedule.name, frequency: schedule.frequency, projectIds: schedule.projectIds, recipientUserIds: schedule.recipientUserIds,
    localHour: schedule.localHour, allSites: schedule.projectIds.length === 0,
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const { allSites, ...draft } = editing.draft;
    const body = { ...draft, projectIds: allSites ? [] : draft.projectIds };
    const ok = editing.id ? await onUpdate(editing.id, body) : await onCreate(body);
    if (ok) setEditing(null);
  };

  return (
    <section className={styles.schedules} aria-labelledby="report-schedules-title">
      <header className={styles.sectionHeader}>
        <div>
          <h2 id="report-schedules-title">{t("schedulesTitle")}</h2>
          <p>{t("schedulesIntro")}</p>
        </div>
        {!editing && <button type="button" className={styles.secondary} onClick={() => setEditing({ draft: blank() })}><EnergyIcon name="plus" className="h-4 w-4" />{t("schedulesNew")}</button>}
      </header>
      {data.emailMode !== "smtp" && <p className={styles.hint}>{data.emailMode === "test" ? t("schedulesTestMode") : t("schedulesOff")}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}

      {editing && (
        <form className={styles.scheduleForm} onSubmit={event => void submit(event)} aria-label={editing.id ? t("edit") : t("schedulesNew")}>
          <div className={styles.formGrid}>
            <label className={styles.field}><span>{t("scheduleName")}</span>
              <input required maxLength={120} value={editing.draft.name} onChange={event => setEditing({ ...editing, draft: { ...editing.draft, name: event.target.value } })} />
            </label>
            <label className={styles.field}><span>{t("scheduleFrequency")}</span>
              <select value={editing.draft.frequency} onChange={event => setEditing({ ...editing, draft: { ...editing.draft, frequency: event.target.value as Draft["frequency"] } })}>
                <option value="weekly">{t("weekly")}</option>
                <option value="monthly">{t("monthly")}</option>
              </select>
            </label>
            <label className={styles.field}><span>{t("scheduleHour")}</span>
              <select value={editing.draft.localHour} onChange={event => setEditing({ ...editing, draft: { ...editing.draft, localHour: Number(event.target.value) } })}>
                {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
              </select>
            </label>
          </div>
          <fieldset className={styles.fieldset}>
            <legend>{t("scheduleSites")}</legend>
            <label className={styles.check}><input type="radio" checked={editing.draft.allSites} onChange={() => setEditing({ ...editing, draft: { ...editing.draft, allSites: true } })} />{t("allSites")}</label>
            <label className={styles.check}><input type="radio" checked={!editing.draft.allSites} onChange={() => setEditing({ ...editing, draft: { ...editing.draft, allSites: false } })} />{t("chosenSites")}</label>
            {!editing.draft.allSites && <div className={styles.choices}>{data.sites.map(site => (
              <label key={site.id} className={styles.check}>
                <input type="checkbox" checked={editing.draft.projectIds.includes(site.id)} onChange={event => setEditing({ ...editing, draft: { ...editing.draft, projectIds: toggle(editing.draft.projectIds, site.id, event.target.checked) } })} />{site.name}
              </label>
            ))}</div>}
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend>{t("scheduleRecipients")}</legend>
            <small className={styles.muted}>{t("recipientsHint")}</small>
            {readers.length === 0 ? <p className={styles.muted}>{t("noRecipients")}</p> : <div className={styles.choices}>{readers.map(member => (
              <label key={member.userId} className={styles.check}>
                <input type="checkbox" checked={editing.draft.recipientUserIds.includes(member.userId)} onChange={event => setEditing({ ...editing, draft: { ...editing.draft, recipientUserIds: toggle(editing.draft.recipientUserIds, member.userId, event.target.checked) } })} />
                <span>{member.name ?? member.email}{member.name && <small className={styles.muted}> {member.email}</small>}</span>
              </label>
            ))}</div>}
          </fieldset>
          <div className={styles.formActions}>
            <button type="button" className={styles.secondary} onClick={() => setEditing(null)}>{t("cancel")}</button>
            <button type="submit" className={styles.primary} disabled={busy || editing.draft.recipientUserIds.length === 0 || !editing.draft.name.trim() || (!editing.draft.allSites && editing.draft.projectIds.length === 0)}>{t("save")}</button>
          </div>
        </form>
      )}

      {data.schedules.length === 0 && !editing ? <p className={styles.muted}>{t("schedulesEmpty")}</p> : (
        <ul className={styles.scheduleList}>
          {data.schedules.map(schedule => (
            <li key={schedule.id} className={styles.schedule}>
              <div className={styles.scheduleMain}>
                <strong>{schedule.name}{!schedule.enabled && <span className={styles.pill}>{t("paused")}</span>}</strong>
                <span className={styles.muted}>{t("scheduleSummary", {
                  frequency: t(schedule.frequency),
                  recipients: schedule.recipientUserIds.length,
                  sites: schedule.projectIds.length === 0 ? t("scheduleSitesAll") : t("scheduleSitesSome", { count: schedule.projectIds.length }),
                  hour: hourLabel(schedule.localHour),
                })}</span>
                <DeliveryLine schedule={schedule} />
              </div>
              {confirming === schedule.id ? (
                <div className={styles.confirm} role="group" aria-label={t("remove")}>
                  <span>{t("removeConfirm", { name: schedule.name })}</span>
                  <button type="button" className={styles.secondary} onClick={() => setConfirming(null)}>{t("keep")}</button>
                  <button type="button" className={styles.danger} disabled={busy} onClick={() => void onDelete(schedule.id).then(() => setConfirming(null))}>{t("remove")}</button>
                </div>
              ) : (
                <div className={styles.scheduleActions}>
                  <button type="button" className={styles.link} disabled={busy || !schedule.enabled} onClick={() => { setSendingId(schedule.id); void onSend(schedule.id).finally(() => setSendingId(null)); }}>{sendingId === schedule.id ? t("sending") : t("sendNow")}</button>
                  <button type="button" className={styles.link} disabled={busy} onClick={() => void onUpdate(schedule.id, { enabled: !schedule.enabled })}>{schedule.enabled ? t("pause") : t("resume")}</button>
                  <button type="button" className={styles.link} disabled={busy} onClick={() => setEditing({ id: schedule.id, draft: fromSchedule(schedule) })}>{t("edit")}</button>
                  <button type="button" className={`${styles.link} ${styles.linkDanger}`} disabled={busy} onClick={() => setConfirming(schedule.id)}>{t("remove")}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeliveryLine({ schedule }: { schedule: EnergyReportScheduleDto }) {
  const t = useMessages(portfolioMessages);
  const { locale } = useEnergyIqLocale();
  const day = (iso: string) => new Date(iso).toLocaleDateString(intlLocale(locale), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const period = (from: string, to: string) => {
    const format = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(intlLocale(locale), { timeZone: "UTC", day: "numeric", month: "short" });
    return `${format(from)} – ${format(to)}`;
  };
  const last = schedule.lastDelivery;
  return (
    <span className={styles.muted}>
      {last ? (last.status === "failed" ? t("lastFailed", { date: day(last.updatedAt) }) : t("lastSent", { date: day(last.updatedAt) })) + " · " : ""}
      {t("nextPeriod", { period: period(schedule.nextPeriod.from, schedule.nextPeriod.to) })}
    </span>
  );
}

const toggle = (list: string[], id: string, on: boolean) => on ? [...new Set([...list, id])] : list.filter(item => item !== id);
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
