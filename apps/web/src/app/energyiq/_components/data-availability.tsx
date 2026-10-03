"use client";
import { useEffect, useMemo, useState } from "react";
import { configApi, type EnergyDataAvailabilityDto, type EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import { applyMeterNotInUse, availabilityCsv, availabilityPeriods, NOT_IN_USE_REASONS, notInUsePreset, notInUseText } from "./data-availability-model";
import { dataAvailabilityMessages } from "./data-availability-messages";
import { intlLocale } from "./energyiq-messages";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { EnergyIcon } from "./icons";
import styles from "./data-availability.module.css";

type Meter = EnergyDataAvailabilityDto["meters"][number];

/** Facility → Data availability: each meter's share of readings received, outages, and readings that look stuck. */
export function DataAvailability({ projectId, siteName, document, canEdit, busy, error, onSave }: {
  projectId: string;
  siteName: string;
  document: EnergyProjectSetupDocumentDto;
  canEdit: boolean;
  busy: boolean;
  error: string;
  onSave: (next: EnergyProjectSetupDocumentDto, message: string) => void;
}) {
  const t = useMessages(dataAvailabilityMessages);
  const { locale } = useEnergyIqLocale();
  const timezone = document.project.timezone;
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), [timezone]);
  const periods = useMemo(() => availabilityPeriods(today), [today]);
  const [periodId, setPeriodId] = useState("last30");
  const period = periods.find(item => item.id === periodId) ?? periods[0]!;
  const [data, setData] = useState<EnergyDataAvailabilityDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Picking a reason saves at once; only "Other reason" asks for typing.
  const [editing, setEditing] = useState<{ meterId: string; other: boolean; reason: string } | null>(null);
  // Marking a meter not in use goes live first; the figures follow once the saved setup says so.
  const notInUseKey = (document.meter_mapping?.rows ?? []).map(row => row.presentation?.not_in_use ? `${row.id}:${row.presentation.not_in_use}` : "").join("|");
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setFailed(false);
    configApi.getEnergyDataAvailability(projectId, period.from && period.to ? { from: period.from, to: period.to } : undefined)
      .then(result => { if (!cancelled) setData(result); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, period.from, period.to, notInUseKey, attempt]);

  const intl = intlLocale(locale);
  const day = (value: string) => new Intl.DateTimeFormat(intl, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00Z`));
  const when = (iso: string) => new Intl.DateTimeFormat(intl, { timeZone: timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const number = (value: number, digits = 1) => new Intl.NumberFormat(intl, { maximumFractionDigits: digits }).format(value);
  const monthName = (id: string) => new Intl.DateTimeFormat(intl, { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${id}-01T00:00:00Z`));
  const target = data?.targetPct ?? 95;
  const statusText = (status: Meter["status"]) => t(`status.${status}`, { target });
  const statusClass = (status: Meter["status"]) => status === "ok" ? styles.chipOk : status === "not_in_use" ? styles.chipMuted : status === "below_target" ? styles.chipWarn : styles.chipBad;
  const reasonText = (stored: string) => notInUseText(stored, reason => t(`reason.${reason}`));
  const checkText = (meter: Meter, check: Meter["checks"][number], short = false) => short
    ? t(`check.short.${check.kind}`, { hours: check.hours, from: when(check.from) })
    : t(`check.${check.kind}`, { name: meter.name, hours: check.hours, from: when(check.from), kwh: number(check.kwhPerHour, 3) });

  const download = () => {
    if (!data) return;
    const csv = availabilityCsv({ ...data, meters: data.meters.map(meter => meter.notInUse ? { ...meter, notInUse: reasonText(meter.notInUse) } : meter) }, siteName, {
      title: t("csv.title"),
      meterColumns: t("csv.meterColumns").split("|") as Parameters<typeof availabilityCsv>[2]["meterColumns"],
      outageTitle: t("csv.outageTitle"),
      outageColumns: t("csv.outageColumns").split("|") as Parameters<typeof availabilityCsv>[2]["outageColumns"],
      status: statusText,
      outageKind: outage => outage.ongoing ? t("outage.ongoing") : outage.kind === "estimated" ? t("outage.estimated", { kwh: number(outage.estimatedKwh, 2) }) : t("outage.missing"),
      check: check => t(`check.short.${check.kind}`, { hours: check.hours, from: when(check.from) }),
    });
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = window.document.createElement("a");
    link.href = url;
    link.download = `${siteName.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "site"}-data-availability-${data.from}-to-${data.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const save = (meter: Meter, reason: string | null) => {
    onSave(applyMeterNotInUse(document, meter.meterPointId, reason), t(reason ? "saved.notInUse" : "saved.inUse", { name: meter.name }));
    setEditing(null);
  };

  const checks = (data?.meters ?? []).flatMap(meter => meter.checks.map(check => ({ meter, check })));
  return <section className={styles.panel} aria-label={t("title")}>
    <header className={styles.header}>
      <div><h3>{t("title")}</h3><p className={styles.muted}>{t("intro", { target })}</p></div>
      <div className={styles.controls}>
        <label>{t("period")}<select value={periodId} onChange={event => setPeriodId(event.target.value)}>
          {periods.map(item => <option key={item.id} value={item.id}>{item.id === "last30" ? t("period.last30") : monthName(item.id)}</option>)}
        </select></label>
        <button type="button" className={styles.secondary} disabled={!data || loading} onClick={download}><EnergyIcon name="download" className="h-4 w-4" aria-hidden="true" />{t("download")}</button>
      </div>
    </header>
    {data && <p className={styles.range}>{t("range", { from: day(data.from), to: day(data.to) })}</p>}
    {failed && <p role="alert" className={styles.error}>{t("failed")}<button type="button" className={styles.link} onClick={() => setAttempt(value => value + 1)}>{t("retry")}</button></p>}
    {!data && loading && <p role="status" className={styles.status}>{t("loading")}</p>}
    {data && <>
      <div className={styles.tiles}>
        <div className={`${styles.tile} ${data.site.availabilityPct === null ? "" : data.site.availabilityPct >= target ? styles.tileGood : styles.tileBelow}`}>
          <span>{t("tile.site")}</span>
          <strong>{data.site.availabilityPct === null ? "—" : `${number(data.site.availabilityPct)}%`}</strong>
          <small>{data.site.availabilityPct === null ? t("tile.siteNone") : t("tile.siteNote", { target })}</small>
        </div>
        <div className={`${styles.tile} ${data.site.metersBelowTarget ? styles.tileBelow : ""}`}>
          <span>{t("tile.below", { target })}</span>
          <strong>{data.site.metersBelowTarget}</strong>
          <small>{t("tile.belowNote", { count: data.site.metersCounted })}</small>
        </div>
        <div className={styles.tile}><span>{t("tile.outages")}</span><strong>{data.site.outageCount}</strong><small>{t("tile.outagesNote")}</small></div>
        <div className={styles.tile}><span>{t("tile.estimated")}</span><strong>{t("kwh", { kwh: number(data.site.estimatedKwh) })}</strong><small>{t("tile.estimatedNote")}</small></div>
      </div>
      {checks.length > 0 && <div className={styles.checks} role="note">
        <h4>{t("checks.title")}</h4>
        <ul>{checks.map(({ meter, check }) => <li key={`${meter.meterPointId}-${check.from}`}>{checkText(meter, check)}</li>)}</ul>
      </div>}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr>
            <th>{t("col.meter")}</th><th>{t("col.received")}</th><th className={styles.number}>{t("col.outage")}</th>
            <th className={styles.number}>{t("col.estimated")}</th><th>{t("col.last")}</th><th>{t("col.status")}</th>{canEdit && <th aria-label={t("action.notInUse")} />}
          </tr></thead>
          <tbody>{data.meters.flatMap(meter => {
            const low = meter.status !== "not_in_use" && meter.availabilityPct < target;
            const row = <tr key={meter.meterPointId}>
              <td>{meter.name}{meter.location && <small>{meter.location}</small>}{meter.checks.map(check => <small key={check.from}>{checkText(meter, check, true)}</small>)}</td>
              <td><span className={styles.received}>
                <span className={`${styles.bar} ${low ? styles.barLow : ""}`} aria-hidden="true"><span style={{ width: `${Math.min(100, meter.availabilityPct)}%` }} /><i className={styles.target} style={{ left: `${target}%` }} /></span>
                {number(meter.availabilityPct)}%
              </span></td>
              <td className={styles.number}>{meter.longestOutageHours >= 1 ? t("hours", { hours: number(meter.longestOutageHours) }) : t("none")}</td>
              <td className={styles.number}>{meter.estimatedKwh > 0 ? t("kwh", { kwh: number(meter.estimatedKwh, 2) }) : "—"}</td>
              <td>{meter.lastReadingAt ? when(meter.lastReadingAt) : "—"}</td>
              <td><span className={`${styles.chip} ${statusClass(meter.status)}`}>{statusText(meter.status)}</span>{meter.notInUse && <small>{reasonText(meter.notInUse)}</small>}</td>
              {canEdit && <td>{meter.status === "not_in_use"
                ? <button type="button" className={styles.link} disabled={busy} onClick={() => save(meter, null)}>{t("action.inUse")}</button>
                : <button type="button" className={styles.link} disabled={busy} onClick={() => setEditing({ meterId: meter.meterPointId, other: false, reason: "" })}>{t("action.notInUse")}</button>}</td>}
            </tr>;
            if (editing?.meterId !== meter.meterPointId) return [row];
            return [row, <tr key={`${meter.meterPointId}-edit`} className={styles.editRow}><td colSpan={canEdit ? 7 : 6}>
              <div className={styles.editForm} role="group" aria-label={t("notInUse.pick")}>
                <p className={styles.pickLabel}>{t("notInUse.pick")}</p>
                <div className={styles.reasons}>
                  {NOT_IN_USE_REASONS.map(reason => <button key={reason} type="button" className={styles.reason} disabled={busy} onClick={() => save(meter, notInUsePreset(reason))}>{t(`reason.${reason}`)}</button>)}
                  <button type="button" className={styles.reason} aria-pressed={editing.other} disabled={busy} onClick={() => setEditing({ ...editing, other: true })}>{t("reason.other")}</button>
                </div>
                {editing.other && <form className={styles.otherForm} onSubmit={event => { event.preventDefault(); if (editing.reason.trim()) save(meter, editing.reason); }}>
                  <label>{t("notInUse.label")}<input autoFocus value={editing.reason} placeholder={t("notInUse.placeholder")} onChange={event => setEditing({ ...editing, reason: event.target.value })} /></label>
                  <button type="submit" className={styles.primary} disabled={busy || !editing.reason.trim()}>{busy ? t("saving") : t("save")}</button>
                </form>}
                <p>{t("notInUse.hint")}</p>
                <div className={styles.editActions}>
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => setEditing(null)}>{t("cancel")}</button>
                </div>
              </div>
            </td></tr>];
          })}</tbody>
        </table>
      </div>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.section}>
        <h4>{t("outages.title")}</h4>
        {data.outages.length ? <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>{t("col.meter")}</th><th>{t("col.from")}</th><th>{t("col.to")}</th><th className={styles.number}>{t("col.duration")}</th><th>{t("col.what")}</th></tr></thead>
          <tbody>{data.outages.map(outage => <tr key={`${outage.meterPointId}-${outage.from}`}>
            <td>{outage.name}</td>
            <td>{when(outage.from)}</td>
            <td>{outage.ongoing ? t("outage.ongoing") : when(outage.to)}</td>
            <td className={styles.number}>{t("hours", { hours: number(outage.hours) })}</td>
            <td>{outage.kind === "estimated" ? t("outage.estimated", { kwh: number(outage.estimatedKwh, 2) }) : t("outage.missing")}</td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.status}>{t("outages.none")}</p>}
      </div>
      <p className={styles.footnote}>{t("footnote")}</p>
    </>}
  </section>;
}
