"use client";
import { useState } from "react";
import { configApi, type EnergyTariffScheduleEntryInputDto, type EnergyTariffScheduleRevisionDto } from "../../../lib/config-api";
import type { EnergySelectOption } from "./energy-select";
import { localDay, ratePeriod } from "./electricity-rate-view";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale, translatorFor, type EnergyIqLocale, type Translate } from "./energyiq-messages";
import { dateRange } from "./operating-hours-view";
import { electricityRateMessages } from "./operating-policy-messages";
import styles from "./project-configuration-view.module.css";

/** One rate period as a person reads it off the bill: local calendar days, end day included. */
export type RateDraft = {
  key: string;
  owner: string; // "project" or a location id
  from: string;
  to: string;
  currency: string;
  rate: string;
  basis: "" | "tax_exclusive" | "tax_inclusive";
  taxName: string;
  taxPct: string;
};

const DAY_MS = 86_400_000;
export const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Midnight at the start of `date` in the project's time zone, written with its UTC offset (e.g. 2026-10-01T00:00:00+08:00). */
export function zonedMidnight(date: string, timeZone: string): string {
  const wallClock = (instant: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  };
  const guess = Date.parse(`${date}T00:00:00Z`);
  let offset = wallClock(guess) - guess;
  offset = wallClock(guess - offset) - (guess - offset);
  const minutes = Math.round(offset / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const pad = (value: number) => String(Math.floor(Math.abs(value))).padStart(2, "0");
  return `${date}T00:00:00${sign}${pad(minutes / 60)}:${pad(Math.abs(minutes) % 60)}`;
}

export function rateDraftsFromRevision(revision: EnergyTariffScheduleRevisionDto | undefined, timeZone: string): RateDraft[] {
  if (!revision?.entries.length) return [{ key: "rate-new-1", owner: "project", from: "", to: "", currency: "SGD", rate: "", basis: "tax_exclusive", taxName: "GST", taxPct: "9" }];
  return [...revision.entries].sort((a, b) => a.effective_from.localeCompare(b.effective_from)).map(entry => {
    const period = ratePeriod(entry, timeZone);
    return {
      key: entry.id,
      owner: entry.owner.kind === "project" ? "project" : entry.owner.scope_id,
      from: period.from,
      to: period.to ?? "",
      currency: entry.currency,
      rate: String(entry.rate_per_kwh),
      basis: entry.rate_basis ?? "",
      taxName: entry.tax?.name ?? "GST",
      taxPct: entry.tax ? String(entry.tax.rate_pct) : "9",
    };
  });
}

/** A new period that starts the day after the latest one ends, keeping its currency, tax and location. */
export function nextRateDraft(drafts: RateDraft[], key: string): RateDraft {
  const last = [...drafts].sort((a, b) => (a.to || a.from).localeCompare(b.to || b.from)).at(-1);
  return { key, owner: last?.owner ?? "project", from: last?.to ? addDays(last.to, 1) : "", to: "", currency: last?.currency ?? "SGD", rate: "", basis: last?.basis ?? "tax_exclusive", taxName: last?.taxName ?? "GST", taxPct: last?.taxPct ?? "9" };
}

/** Checks the periods in plain words and converts them to what the server stores (instants, end exclusive). */
export function rateEntriesForSave(drafts: RateDraft[], timeZone: string, locale: EnergyIqLocale = "en"): EnergyTariffScheduleEntryInputDto[] {
  const t = translatorFor(electricityRateMessages, locale);
  if (!drafts.length) throw new Error(t("error.none"));
  drafts.forEach((draft, index) => {
    const number = index + 1;
    if (!draft.from) throw new Error(t("error.start", { number }));
    if (draft.to && draft.to < draft.from) throw new Error(t("error.order", { number }));
    const rate = Number(draft.rate);
    if (!draft.rate.trim() || !Number.isFinite(rate) || rate <= 0) throw new Error(t("error.price", { number }));
    const tax = Number(draft.taxPct);
    if (draft.basis && (!draft.taxPct.trim() || !Number.isFinite(tax) || tax < 0 || tax > 100)) throw new Error(t("error.tax", { number, tax: draft.taxName || t("error.taxFallback") }));
  });
  const numbered = drafts.map((draft, index) => ({ draft, number: index + 1 }));
  for (const owner of new Set(drafts.map(draft => draft.owner))) {
    const sameArea = numbered.filter(item => item.draft.owner === owner).sort((a, b) => a.draft.from.localeCompare(b.draft.from));
    for (let index = 1; index < sameArea.length; index += 1) {
      const before = sameArea[index - 1]!, after = sameArea[index]!;
      if (!before.draft.to) throw new Error(t("error.openEnded", { before: before.number, after: after.number, date: dateRange(addDays(after.draft.from, -1), addDays(after.draft.from, -1), locale) }));
      if (before.draft.to >= after.draft.from) throw new Error(t("error.overlap", { before: before.number, after: after.number }));
    }
  }
  return drafts.map(draft => ({
    owner: draft.owner === "project" ? { kind: "project" } : { kind: "scope", scopeId: draft.owner },
    effectiveFrom: zonedMidnight(draft.from, timeZone),
    ...(draft.to ? { effectiveTo: zonedMidnight(addDays(draft.to, 1), timeZone) } : {}),
    currency: draft.currency.trim().toUpperCase() || "SGD",
    ratePerKwh: Number(draft.rate),
    ...(draft.basis ? { rateBasis: draft.basis, tax: { name: draft.taxName.trim() || "GST", ratePct: Number(draft.taxPct) } } : {}),
  }));
}

const money = (currency: string, value: number, digits: number, locale: EnergyIqLocale) => `${currency} ${value.toLocaleString(intlLocale(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
function pricePreview(draft: RateDraft, t: Translate<keyof typeof electricityRateMessages.en>, locale: EnergyIqLocale): string {
  const rate = Number(draft.rate), tax = Number(draft.taxPct);
  if (!draft.rate.trim() || !Number.isFinite(rate) || rate <= 0) return t("preview.enterPrice");
  const example = t("example", { kwh: (1000).toLocaleString(intlLocale(locale)), price: money(draft.currency, rate * 1000, 2, locale) });
  if (!draft.basis || !Number.isFinite(tax)) return example;
  const tag = draft.taxName || "GST";
  return draft.basis === "tax_exclusive"
    ? t("preview.withTax", { price: money(draft.currency, rate * (1 + tax / 100), 4, locale), pct: tax, tax: tag, example })
    : t("preview.beforeTax", { price: money(draft.currency, rate / (1 + tax / 100), 4, locale), pct: tax, tax: tag, example });
}

/** Edits the electricity rate on the page; saving makes the new rate live across the app. */
export function ElectricityRateEditor({ projectId, revision, timezone, scopeOptions, addNext = false, onSaved, onCancel }: {
  projectId: string; revision?: EnergyTariffScheduleRevisionDto; timezone: string; scopeOptions: EnergySelectOption[]; addNext?: boolean; onSaved: () => void; onCancel: () => void;
}) {
  const [drafts, setDrafts] = useState<RateDraft[]>(() => {
    const initial = rateDraftsFromRevision(revision, timezone);
    return addNext && revision?.entries.length ? [...initial, nextRateDraft(initial, "rate-new-1")] : initial;
  });
  const [counter, setCounter] = useState(2);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const t = useMessages(electricityRateMessages);
  const { locale } = useEnergyIqLocale();
  const today = localDay(new Date().toISOString(), timezone);
  const update = (key: string, patch: Partial<RateDraft>) => setDrafts(current => current.map(draft => draft.key === key ? { ...draft, ...patch } : draft));
  const save = async () => {
    setError("");
    let entries: EnergyTariffScheduleEntryInputDto[];
    try { entries = rateEntriesForSave(drafts, timezone, locale); } catch (reason) { setError(reason instanceof Error ? reason.message : t("error.missing")); return; }
    setSaving(true);
    try { await configApi.publishEnergyTariffSchedule(projectId, { entries }); onSaved(); }
    catch { setError(t("error.saveFailed")); }
    finally { setSaving(false); }
  };
  return <div className={styles.calendarEditor}>
    <p className={styles.editorIntro}>{t("editor.intro")}</p>
    {drafts.map((draft, index) => {
      const state = !draft.from ? "new" : draft.from > today ? "upcoming" : draft.to && draft.to < today ? "ended" : "current";
      const tax = draft.taxName || "GST";
      return <fieldset key={draft.key} className={styles.rateEditorPeriod}>
        <legend>{t("editor.period", { number: index + 1 })}<span>{t(`state.${state}`)}</span></legend>
        {drafts.length > 1 && <button type="button" className={styles.rateEditorRemove} onClick={() => setDrafts(current => current.filter(item => item.key !== draft.key))}>{t("remove")}</button>}
        <div className={styles.rateEditorGrid}>
          <label><span>{t("startDate")}</span><input type="date" value={draft.from} onChange={event => update(draft.key, { from: event.target.value })} /></label>
          <label><span>{t("endDate")}</span><input type="date" value={draft.to} min={draft.from || undefined} onChange={event => update(draft.key, { to: event.target.value })} /><small>{t("endDateHint")}</small></label>
          <label><span>{t("pricePerKwh")}</span><div className={styles.rateEditorMoney}><b>{draft.currency}</b><input type="number" inputMode="decimal" step="0.0001" min="0" placeholder="0.3191" value={draft.rate} onChange={event => update(draft.key, { rate: event.target.value })} /></div></label>
          <label><span>{t("billBasis")}</span><select value={draft.basis} onChange={event => update(draft.key, { basis: event.target.value as RateDraft["basis"] })}>
            <option value="tax_exclusive">{t("basis.before", { tax })}</option>
            <option value="tax_inclusive">{t("basis.including", { tax })}</option>
            <option value="">{t("basis.notStated")}</option>
          </select></label>
          {draft.basis && <label><span>{t("taxRate", { tax })}</span><div className={styles.rateEditorMoney}><input type="number" inputMode="decimal" step="0.1" min="0" max="100" value={draft.taxPct} onChange={event => update(draft.key, { taxPct: event.target.value })} /><b>%</b></div></label>}
          {scopeOptions.length > 1 && <label><span>{t("appliesTo")}</span><select value={draft.owner} onChange={event => update(draft.key, { owner: event.target.value })}>{scopeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
        </div>
        <p className={styles.rateEditorPreview}>{pricePreview(draft, t, locale)}</p>
      </fieldset>;
    })}
    <button type="button" className={styles.rateEditorAdd} onClick={() => { setDrafts(current => [...current, nextRateDraft(current, `rate-new-${counter}`)]); setCounter(value => value + 1); }}>{t("addPeriod")}</button>
    {error && <p role="alert" className={styles.editorError}>{error}</p>}
    <div className={styles.editorActions}>
      <button type="button" className={styles.secondaryAction} disabled={saving} onClick={onCancel}>{t("cancel")}</button>
      <button type="button" className={styles.primaryAction} disabled={saving} onClick={() => void save()}>{saving ? t("saving") : t("saveRate")}</button>
    </div>
  </div>;
}
