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
  const reasonText = (stored: string) => notInUseText(stored, reason => t(`reason.${reason}`));
  const checkText = (meter: Meter, check: Meter["checks"][number], short = false) => short
    ? t(`check.short.${check.kind}`, { hours: check.hours, from: when(check.from) })
    : `${meter.name} — ${t(`check.${check.kind}`, { hours: check.hours, from: when(check.from), kwh: number(check.kwhPerHour, 3) })}`;

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
  // Meters that need attention first; within each, the least received first.
  const severity: Record<Meter["status"], number> = { no_readings: 0, stopped: 1, below_target: 2, ok: 3, not_in_use: 4 };
  const meters = [...(data?.meters ?? [])].sort((left, right) => severity[left.status] - severity[right.status] || left.availabilityPct - right.availabilityPct || left.name.localeCompare(right.name));
  const locations = new Map((data?.meters ?? []).map(meter => [meter.meterPointId, meter.location]));
  const sitePct = data?.site.availabilityPct ?? null;
  const meets = sitePct !== null && sitePct >= target;
  const badgeClass = (status: Meter["status"]) => status === "ok" ? styles.badgeOk : status === "not_in_use" ? styles.badgeMuted : status === "no_readings" ? styles.badgeBad : styles.badgeWarn;
  const columns = canEdit ? 7 : 6;

  return <section className={styles.panel} aria-label={t("title")}>
    <header className={styles.header}>
      <div>
        <h3>{t("title")}</h3>
        <p className={styles.muted}>{t("intro", { target })}</p>
        {data && <span className={styles.range}><EnergyIcon name="calendar" className="h-3.5 w-3.5" aria-hidden="true" />{t("range", { from: day(data.from), to: day(data.to) })}</span>}
      </div>
      <div className={styles.controls}>
        <label>{t("period")}<select value={periodId} onChange={event => setPeriodId(event.target.value)}>
          {periods.map(item => <option key={item.id} value={item.id}>{item.id === "last30" ? t("period.last30") : monthName(item.id)}</option>)}
        </select></label>
        <button type="button" className={styles.secondary} disabled={!data || loading} onClick={download}><EnergyIcon name="download" className="h-4 w-4" aria-hidden="true" />{t("download")}</button>
      </div>
    </header>
    {failed && <p role="alert" className={styles.error}>{t("failed")}<button type="button" className={styles.link} onClick={() => setAttempt(value => value + 1)}>{t("retry")}</button></p>}
    {!data && loading && <p role="status" className={styles.status}>{t("loading")}</p>}
    {data && <>
      <div className={styles.summary}>
        <div className={styles.hero}>
          <div className={styles.heroTop}>
            <span>{t("tile.site")}</span>
            {sitePct !== null && <span className={`${styles.badge} ${meets ? styles.badgeOk : styles.badgeWarn}`}><i aria-hidden="true" />{meets ? t("status.ok") : t("hero.below")}</span>}
          </div>
          <strong className={styles.heroValue}>{sitePct === null ? "—" : `${number(sitePct)}%`}</strong>
          {sitePct !== null && <span className={`${styles.heroBar} ${meets ? "" : styles.heroBarLow}`} aria-hidden="true"><span style={{ width: `${Math.min(100, sitePct)}%` }} /><i className={styles.heroTarget} style={{ left: `${target}%` }} /></span>}
          <small className={styles.heroNote}>{sitePct === null ? t("tile.siteNone")
            : t(meets ? "hero.gapAbove" : "hero.gapBelow", { points: number(Math.abs(sitePct - target)), target })}</small>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}><span>{t("tile.below", { target })}</span><strong>{data.site.metersBelowTarget}<em>/ {data.site.metersCounted}</em></strong><small>{t("tile.belowNote", { target })}</small></div>
          <div className={styles.stat}><span>{t("tile.outages")}</span><strong>{data.site.outageCount}</strong><small>{t("tile.outagesNote")}</small></div>
          <div className={styles.stat}><span>{t("tile.estimated")}</span><strong>{number(data.site.estimatedKwh)}<em>kWh</em></strong><small>{t("tile.estimatedNote")}</small></div>
        </div>
      </div>

      {checks.length > 0 && <div className={styles.checks} role="note">
        <EnergyIcon name="alert" className={`h-5 w-5 ${styles.checksIcon}`} aria-hidden="true" />
        <h4>{t("checks.title")}</h4>
        <ul>{checks.map(({ meter, check }) => <li key={`${meter.meterPointId}-${check.from}`}><strong>{meter.name}</strong> — {t(`check.${check.kind}`, { hours: check.hours, from: when(check.from), kwh: number(check.kwhPerHour, 3) })}</li>)}</ul>
      </div>}

      <div className={styles.section}>
        <div className={styles.sectionHead}><h4>{t("meters.title")}</h4><span>{t("meters.note", { count: meters.length })}</span></div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr>
              <th>{t("col.meter")}</th><th>{t("col.received")}</th><th className={styles.number}>{t("col.outage")}</th>
              <th className={styles.number}>{t("col.estimated")}</th><th>{t("col.last")}</th><th>{t("col.status")}</th>{canEdit && <th aria-label={t("action.notInUse")} />}
            </tr></thead>
            <tbody>{meters.flatMap(meter => {
              const low = meter.status !== "not_in_use" && meter.availabilityPct < target;
              const row = <tr key={meter.meterPointId}>
                <td><span className={styles.name}><b>{meter.name}</b>{meter.location && <small>{meter.location}</small>}{meter.checks.map(check => <small key={check.from} className={styles.flag}>{checkText(meter, check, true)}</small>)}</span></td>
                <td><span className={styles.received}>
                  <span className={`${styles.bar} ${low ? styles.barLow : ""}`} aria-hidden="true"><span style={{ width: `${Math.min(100, meter.availabilityPct)}%` }} /><i className={styles.target} style={{ left: `${target}%` }} /></span>
                  <b>{number(meter.availabilityPct)}%</b>
                </span></td>
                <td className={styles.number}>{meter.longestOutageHours >= 1 ? t("hours", { hours: number(meter.longestOutageHours) }) : <span className={styles.quiet}>{t("none")}</span>}</td>
                <td className={styles.number}>{meter.estimatedKwh > 0 ? t("kwh", { kwh: number(meter.estimatedKwh, 2) }) : <span className={styles.quiet}>—</span>}</td>
                <td>{meter.lastReadingAt ? when(meter.lastReadingAt) : <span className={styles.quiet}>—</span>}</td>
                <td><span className={`${styles.badge} ${badgeClass(meter.status)}`}><i aria-hidden="true" />{statusText(meter.status)}</span>{meter.notInUse && <small className={styles.note}>{reasonText(meter.notInUse)}</small>}</td>
                {canEdit && <td className={styles.actionCell}>{meter.status === "not_in_use"
                  ? <button type="button" className={styles.rowAction} disabled={busy} onClick={() => save(meter, null)}>{t("action.inUse")}</button>
                  : <button type="button" className={styles.rowAction} disabled={busy} aria-expanded={editing?.meterId === meter.meterPointId} onClick={() => setEditing(editing?.meterId === meter.meterPointId ? null : { meterId: meter.meterPointId, other: false, reason: "" })}>{t("action.notInUse")}</button>}</td>}
              </tr>;
              if (editing?.meterId !== meter.meterPointId) return [row];
              return [row, <tr key={`${meter.meterPointId}-edit`} className={styles.pickerRow}><td colSpan={columns}>
                <div className={styles.picker} role="group" aria-label={t("notInUse.pick")}>
                  <span className={styles.pickLabel}>{t("notInUse.pick")}</span>
                  <div className={styles.reasons}>
                    {NOT_IN_USE_REASONS.map(reason => <button key={reason} type="button" className={styles.reason} disabled={busy} onClick={() => save(meter, notInUsePreset(reason))}>{t(`reason.${reason}`)}</button>)}
                    <button type="button" className={styles.reason} aria-pressed={editing.other} disabled={busy} onClick={() => setEditing({ ...editing, other: true })}>{t("reason.other")}</button>
                    <button type="button" className={styles.textButton} disabled={busy} onClick={() => setEditing(null)}>{t("cancel")}</button>
                  </div>
                  {editing.other && <form className={styles.otherForm} onSubmit={event => { event.preventDefault(); if (editing.reason.trim()) save(meter, editing.reason); }}>
                    <label>{t("notInUse.label")}<input autoFocus value={editing.reason} placeholder={t("notInUse.placeholder")} onChange={event => setEditing({ ...editing, reason: event.target.value })} /></label>
                    <button type="submit" className={styles.primary} disabled={busy || !editing.reason.trim()}>{busy ? t("saving") : t("save")}</button>
                  </form>}
                  <p className={styles.hint}>{t("notInUse.hint")}</p>
                </div>
              </td></tr>];
            })}</tbody>
          </table>
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}><h4>{t("outages.title")}</h4>{data.outages.length > 0 && <span>{t("outages.count", { count: data.outages.length })}</span>}</div>
        {data.outages.length ? <div className={styles.tableWrap}><table className={styles.table}>
          <thead><tr><th>{t("col.meter")}</th><th>{t("col.from")}</th><th>{t("col.to")}</th><th className={styles.number}>{t("col.duration")}</th><th>{t("col.what")}</th></tr></thead>
          <tbody>{data.outages.map(outage => <tr key={`${outage.meterPointId}-${outage.from}`}>
            <td><span className={styles.name}><b>{outage.name}</b>{locations.get(outage.meterPointId) && <small>{locations.get(outage.meterPointId)}</small>}</span></td>
            <td>{when(outage.from)}</td>
            <td>{outage.ongoing ? <span className={`${styles.badge} ${styles.badgeWarn}`}><i aria-hidden="true" />{t("outage.ongoing")}</span> : when(outage.to)}</td>
            <td className={styles.number}>{t("hours", { hours: number(outage.hours) })}</td>
            <td>{outage.kind === "estimated"
              ? <><span className={`${styles.badge} ${styles.badgeMuted}`}>{t("kind.estimated")}</span><small className={styles.note}>{t("outage.estimatedShort", { kwh: number(outage.estimatedKwh, 2) })}</small></>
              : <span className={`${styles.badge} ${styles.badgeBad}`}>{t("kind.missing")}</span>}</td>
          </tr>)}</tbody>
        </table></div> : <p className={styles.empty}>{t("outages.none")}</p>}
      </div>
      <p className={styles.footnote}>{t("footnote")}</p>
    </>}
  </section>;
}
