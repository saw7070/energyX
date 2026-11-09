"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { configApi, type EnergyOperatingCalendarEntryDto, type EnergySavingsCheckDto, type EnergySavingsChecksDto, type EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { deviceStatistics, periodDates, type HourCell } from "./device-statistics";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { friendlyErrorMessage } from "./friendly-error";
import { EnergyIcon } from "./icons";
import { withCurrency } from "./money";
import { combineDays, savingsResult, SAVINGS_BASELINE_DAYS, SAVINGS_MAX_AFTER_DAYS, type SavingsDay, type SavingsResult } from "./savings-check";
import { cardTitle, summariseDevices } from "./site-devices";
import { siteSavingsMessages } from "./site-savings-messages";
import styles from "./site-savings.module.css";

type Device = { id: string; name: string; boardId: string };
type Outcome = { result: SavingsResult; ratePerKwh?: number; currency?: string } | { error: true };

const shift = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const localToday = (timeZone = "Asia/Singapore") => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const analysisRequest = (projectId: string, scopeId: string, from: string, to: string) => ({ projectId, scopeId, resource: "electricity" as const, period: "Custom" as const, from, to, surface: "project-explorer" as const });

/** The days around one change, read from the same readings as the Devices page, and what they show. */
async function evaluateCheck(projectId: string, check: EnergySavingsCheckDto, devices: Device[], calendar: EnergyOperatingCalendarEntryDto[] | null): Promise<Outcome> {
  const yesterday = shift(localToday(), -1);
  const from = shift(check.changeDate, -SAVINGS_BASELINE_DAYS);
  const lastAfter = shift(check.changeDate, SAVINGS_MAX_AFTER_DAYS);
  const to = lastAfter < yesterday ? lastAfter : yesterday;
  if (to <= check.changeDate) return { result: savingsResult([], check.changeDate) };
  const rateOf = (analysis: EnergyScopeAnalysisDto) => analysis.cost.status === "available" && analysis.summary.usageKwh > 0
    ? { ratePerKwh: analysis.cost.amount / analysis.summary.usageKwh, currency: analysis.cost.currency }
    : {};
  const daysOf = (analysis: EnergyScopeAnalysisDto, id: string): SavingsDay[] => {
    const trend = analysis.explorerTrends?.find(candidate => candidate.id === id);
    if (!trend) return [];
    const dates = periodDates(analysis.context.from, analysis.context.to, analysis.context.timezone);
    return deviceStatistics(trend.cells as HourCell[], dates, calendar, trend.expectedMinutesPerHour).daily;
  };
  if (check.meterIds.length === 0) {
    const analysis = await configApi.executeEnergyScopeAnalysis(analysisRequest(projectId, "project", from, to));
    return { result: savingsResult(daysOf(analysis, "__scope__"), check.changeDate), ...rateOf(analysis) };
  }
  const chosen = devices.filter(device => check.meterIds.includes(device.id));
  const boards = [...new Set(chosen.map(device => device.boardId))];
  const analyses = await Promise.all(boards.map(boardId => configApi.executeEnergyScopeAnalysis(analysisRequest(projectId, boardId, from, to))));
  const series = chosen.map(device => daysOf(analyses[boards.indexOf(device.boardId)]!, device.id));
  if (series.some(days => days.length === 0)) return { error: true };
  return { result: savingsResult(combineDays(series), check.changeDate), ...rateOf(analyses[0]!) };
}

export function SiteSavings({ projectId }: { projectId: string }) {
  const t = useMessages(siteSavingsMessages);
  const [data, setData] = useState<EnergySavingsChecksDto | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [calendar, setCalendar] = useState<EnergyOperatingCalendarEntryDto[] | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [checks, site, policies] = await Promise.all([
        configApi.listEnergySavingsChecks(projectId),
        configApi.executeEnergyScopeAnalysis({ projectId, scopeId: "project", resource: "electricity", period: "Custom", analysisWindow: "current-overview-28d", surface: "project-explorer" }),
        configApi.getEnergyOperationalPolicies(projectId).catch(() => null),
      ]);
      const version = site.offHours.status === "available" ? site.offHours.businessCalendarVersion : policies?.published.business_calendar_version;
      setCalendar(policies?.operatingCalendarRevisions.find(item => item.version_id === version)?.entries ?? null);
      setDevices(summariseDevices(site).rows.filter(row => !row.isBoardTotal).map(row => ({ id: row.id, name: row.name, boardId: row.boardId })));
      setData(checks);
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: t("loadFailed") }));
    }
  }, [projectId, t]);
  useEffect(() => { setData(null); setOutcomes({}); void load(); }, [load]);

  useEffect(() => {
    if (!data) return;
    let live = true;
    for (const check of data.checks) {
      if (outcomes[check.id]) continue;
      evaluateCheck(projectId, check, devices, calendar)
        .then(outcome => { if (live) setOutcomes(current => ({ ...current, [check.id]: outcome })); })
        .catch(() => { if (live) setOutcomes(current => ({ ...current, [check.id]: { error: true } })); });
    }
    return () => { live = false; };
    // Each check is worked out once per load; outcomes only gains entries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, devices, calendar, projectId]);

  const save = async (body: { name: string; changeDate: string; meterIds: string[]; note?: string }) => {
    setBusy(true);
    setError(null);
    try {
      setData(await configApi.createEnergySavingsCheck(projectId, body));
      return true;
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: t("saveFailed") }));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const remove = async (checkId: string) => {
    setBusy(true);
    try {
      setData(await configApi.deleteEnergySavingsCheck(projectId, checkId));
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: t("saveFailed") }));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <section className={styles.panel}>{error ? <p role="alert" className={styles.error}>{error}</p> : <p role="status" className={styles.quiet}>{t("loading")}</p>}</section>;
  return <SiteSavingsView data={data} devices={devices} outcomes={outcomes} busy={busy} error={error} onSave={save} onRemove={remove} />;
}

export function SiteSavingsView({ data, devices, outcomes, busy, error, onSave, onRemove }: {
  data: EnergySavingsChecksDto;
  devices: Device[];
  outcomes: Record<string, Outcome>;
  busy: boolean;
  error: string | null;
  onSave: (body: { name: string; changeDate: string; meterIds: string[]; note?: string }) => Promise<boolean>;
  onRemove: (checkId: string) => Promise<void>;
}) {
  const t = useMessages(siteSavingsMessages);
  const [adding, setAdding] = useState(false);
  return (
    <section className={styles.panel} aria-label={t("title")}>
      <header className={styles.header}>
        <div>
          <h3>{t("title")}</h3>
          <p>{t("intro")}</p>
        </div>
        {data.canEdit && !adding && <button type="button" className={styles.primary} onClick={() => setAdding(true)}><EnergyIcon name="plus" className="h-4 w-4" />{t("addButton")}</button>}
      </header>
      {error && <p role="alert" className={styles.error}><EnergyIcon name="alert" className="h-4 w-4" />{error}</p>}
      {adding && <AddChange devices={devices} busy={busy} onCancel={() => setAdding(false)} onSave={async body => { if (await onSave(body)) setAdding(false); }} />}
      {data.checks.length === 0 && !adding && <p className={styles.empty}>{data.canEdit ? t("empty") : t("emptyReadOnly")}</p>}
      <div className={styles.list}>
        {data.checks.map(check => <CheckCard key={check.id} check={check} devices={devices} outcome={outcomes[check.id]} carbon={data.carbon.kgCo2ePerKwh} canEdit={data.canEdit} busy={busy} onRemove={onRemove} />)}
      </div>
      {data.checks.length > 0 && <details className={styles.method}><summary>{t("method").split(":")[0]}</summary><p>{t("method")}</p></details>}
    </section>
  );
}

function AddChange({ devices, busy, onCancel, onSave }: { devices: Device[]; busy: boolean; onCancel: () => void; onSave: (body: { name: string; changeDate: string; meterIds: string[]; note?: string }) => Promise<void> }) {
  const t = useMessages(siteSavingsMessages);
  const today = localToday();
  const [name, setName] = useState("");
  const [date, setDate] = useState(today);
  const [whole, setWhole] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState(false);
  const sorted = useMemo(() => [...devices].sort((a, b) => a.name.localeCompare(b.name)), [devices]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!whole && picked.length === 0) { setMissing(true); return; }
    await onSave({ name: name.trim(), changeDate: date, meterIds: whole ? [] : picked, ...(note.trim() ? { note: note.trim() } : {}) });
  };
  return (
    <form className={styles.add} onSubmit={event => void submit(event)} aria-label={t("addTitle")}>
      <h4>{t("addTitle")}</h4>
      <div className={styles.grid}>
        <label className={styles.field}><span>{t("addName")}</span><input required maxLength={120} autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={t("addNamePlaceholder")} aria-label={t("addName")} /></label>
        <label className={styles.field}><span>{t("addDate")}</span><input type="date" required max={today} value={date} onChange={event => setDate(event.target.value)} aria-label={t("addDate")} /></label>
      </div>
      <fieldset className={styles.devices}>
        <legend>{t("addDevices")}</legend>
        <label className={styles.choice}><input type="radio" name="scope" checked={whole} onChange={() => setWhole(true)} />{t("addWholeSite")}</label>
        <label className={styles.choice}><input type="radio" name="scope" checked={!whole} onChange={() => setWhole(false)} />{t("addSomeDevices")}</label>
        {!whole && <div className={styles.pickList}>{sorted.map(device => (
          <label key={device.id} className={styles.choice}>
            <input type="checkbox" checked={picked.includes(device.id)} onChange={event => { setMissing(false); setPicked(current => event.target.checked ? [...current, device.id] : current.filter(id => id !== device.id)); }} />
            <span title={device.name}>{cardTitle(device.name)}</span>
          </label>
        ))}</div>}
        {missing && <small role="alert" className={styles.bad}>{t("addPickOne")}</small>}
      </fieldset>
      <label className={styles.field}><span>{t("addNote")}</span><input maxLength={500} value={note} onChange={event => setNote(event.target.value)} aria-label={t("addNote")} /></label>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>{t("addCancel")}</button>
        <button type="submit" className={styles.primary} disabled={busy || !name.trim() || !date}>{t("addSave")}</button>
      </div>
    </form>
  );
}

function CheckCard({ check, devices, outcome, carbon, canEdit, busy, onRemove }: {
  check: EnergySavingsCheckDto;
  devices: Device[];
  outcome: Outcome | undefined;
  carbon: number;
  canEdit: boolean;
  busy: boolean;
  onRemove: (checkId: string) => Promise<void>;
}) {
  const t = useMessages(siteSavingsMessages);
  const { locale } = useEnergyIqLocale();
  const kwh = (value: number) => `${Math.abs(value).toLocaleString(intlLocale(locale), { maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 1 })} kWh`;
  const names = check.meterIds.map(id => cardTitle(devices.find(device => device.id === id)?.name ?? id));
  const scope = names.length === 0 ? t("scopeSite") : names.length === 1 ? t("scopeDevice", { name: names[0]! }) : t("scopeDevices", { count: names.length, names: names.join(", ") });
  const date = new Date(`${check.changeDate}T00:00:00Z`).toLocaleDateString(intlLocale(locale), { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  return (
    <article className={styles.card} aria-label={check.name}>
      <header className={styles.cardHeader}>
        <div>
          <h4>{check.name}</h4>
          <p>{t("changedOn", { date })} · {scope}</p>
          {check.note && <p className={styles.quiet}>{check.note}</p>}
        </div>
        {canEdit && <button type="button" className={styles.ghost} disabled={busy} aria-label={t("removeNamed", { name: check.name })} onClick={() => void onRemove(check.id)}>{t("remove")}</button>}
      </header>
      {!outcome ? <p role="status" className={styles.quiet}>{t("calculating")}</p>
        : "error" in outcome ? <p className={styles.quiet}>{t("calcFailed")}</p>
          : <Result outcome={outcome} carbon={carbon} kwh={kwh} />}
    </article>
  );
}

function Result({ outcome, carbon, kwh }: { outcome: Extract<Outcome, { result: SavingsResult }>; carbon: number; kwh: (value: number) => string }) {
  const t = useMessages(siteSavingsMessages);
  const { locale } = useEnergyIqLocale();
  const result = outcome.result;
  if (result.status === "need-baseline") return <p className={styles.quiet}>{t("needBaseline", { days: result.baselineDays })}</p>;
  if (result.status === "too-early") return <p className={styles.quiet}>{t("tooEarly", { days: result.afterDays })}</p>;
  const money = (value: number) => outcome.currency ? withCurrency(outcome.currency, Math.abs(value).toLocaleString(intlLocale(locale), { maximumFractionDigits: 0 })) : "";
  const pct = `${Math.abs(result.savedPct).toLocaleString(intlLocale(locale), { maximumFractionDigits: 1 })}%`;
  const scale = Math.max(result.expectedKwh, result.actualKwh, 1);
  return (
    <div className={styles.result}>
      {result.status === "unclear" ? (
        <>
          <strong className={styles.headline}>{t("unclear")}</strong>
          <p className={styles.quiet}>{t("unclearDetail", { kwh: kwh(result.savedKwh), noise: kwh(result.noiseKwh) })}</p>
        </>
      ) : (
        <>
          <strong className={`${styles.headline} ${result.status === "saving" ? styles.good : styles.badText}`}>{result.status === "saving" ? t("saved", { kwh: kwh(result.savedKwh), pct }) : t("increase", { kwh: kwh(result.savedKwh), pct })}</strong>
          {result.status === "saving" && <ul className={styles.facts}>
            {outcome.ratePerKwh !== undefined && <li>{t("money", { amount: money(result.savedKwh * outcome.ratePerKwh) })}</li>}
            <li>{outcome.ratePerKwh !== undefined ? t("perYear", { kwh: kwh(result.savedKwhPerYear), amount: money(result.savedKwhPerYear * outcome.ratePerKwh) }) : t("perYearKwh", { kwh: kwh(result.savedKwhPerYear) })}</li>
            <li>{t("carbon", { kg: Math.round(result.savedKwh * carbon).toLocaleString(intlLocale(locale)) + " kg" })}</li>
          </ul>}
        </>
      )}
      <div className={styles.bars} role="img" aria-label={`${t("expected")}: ${kwh(result.expectedKwh)}. ${t("actual")}: ${kwh(result.actualKwh)}.`}>
        <div><span>{t("expected")}</span><i style={{ width: `${(result.expectedKwh / scale) * 100}%` }} className={styles.barExpected} /><b>{kwh(result.expectedKwh)}</b></div>
        <div><span>{t("actual")}</span><i style={{ width: `${(result.actualKwh / scale) * 100}%` }} className={styles.barActual} /><b>{kwh(result.actualKwh)}</b></div>
      </div>
      <small className={styles.quiet}>{t("basis", { after: result.afterDays, before: result.baselineDays })}</small>
    </div>
  );
}
