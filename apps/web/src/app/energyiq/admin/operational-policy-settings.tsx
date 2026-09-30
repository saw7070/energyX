"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  configApi,
  type EnergyOperatingDayDto,
  type EnergyOperationalPolicyConfigurationDto,
  type EnergyProjectSetupDto,
} from "../../../lib/config-api";
import { EnergySelect, type EnergySelectOption } from "../_components/energy-select";
import { useEnergyIqLocale, useMessages } from "../_components/energyiq-locale";
import { weekdayMessages } from "../_components/operating-policy-messages";
import { policySettingsMessages } from "../_components/policy-settings-messages";
import {
  OPERATING_DAYS,
  calendarDraftFromConfiguration,
  calendarPublishEntries,
  createEmptyCalendarEntry,
  createEmptyTariffEntry,
  hasPendingPolicyRelease,
  tariffDraftFromConfiguration,
  tariffPublishEntries,
  type OperatingCalendarEntryDraft,
  type OperatingExceptionDraft,
  type OperatingTimeRangeDraft,
  type PolicyOwnerDraft,
  type TariffEntryDraft,
} from "./operational-policy-model";

export function OperationalPolicySettings({
  projectId,
  setup,
  onChanged,
}: {
  projectId: string;
  setup: EnergyProjectSetupDto;
  onChanged: () => Promise<void>;
}) {
  const [configuration, setConfiguration] = useState<EnergyOperationalPolicyConfigurationDto | null>(null);
  const [tariffEntries, setTariffEntries] = useState<TariffEntryDraft[]>([]);
  const [calendarEntries, setCalendarEntries] = useState<OperatingCalendarEntryDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"tariff" | "calendar" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const t = useMessages(policySettingsMessages);
  const { locale } = useEnergyIqLocale();
  // Read inside the loader so switching language does not reload the policies and drop unsaved edits.
  const loadFailed = useRef(t("loadFailed"));
  useEffect(() => { loadFailed.current = t("loadFailed"); }, [t]);

  const loadConfiguration = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await configApi.getEnergyOperationalPolicies(projectId);
      setConfiguration(next);
      setTariffEntries(tariffDraftFromConfiguration(next));
      setCalendarEntries(calendarDraftFromConfiguration(next));
    } catch (reason) {
      setError(messageFrom(reason, loadFailed.current));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadConfiguration();
  }, [loadConfiguration]);

  const scopeOptions: EnergySelectOption[] = [
    { value: "project", label: t("projectDefault", { project: setup.project.name }) },
    ...setup.published.nodes
      .filter((node) => node.id !== setup.project.root_scope_id)
      .map((node) => ({ value: node.id, label: node.name })),
  ];

  const publishTariff = async () => {
    setError(null);
    setNotice(null);
    try {
      const entries = tariffPublishEntries(tariffEntries, locale);
      if (!window.confirm(t("confirmTariff"))) return;
      setSaving("tariff");
      const result = await configApi.publishEnergyTariffSchedule(projectId, { entries });
      setConfiguration(result.configuration);
      setTariffEntries(tariffDraftFromConfiguration(result.configuration));
      setNotice(t("tariffPending", { version: result.revision.version_id }));
      await onChanged();
    } catch (reason) {
      setError(messageFrom(reason, t("tariffFailed")));
    } finally {
      setSaving(null);
    }
  };

  const publishCalendar = async () => {
    setError(null);
    setNotice(null);
    try {
      const entries = calendarPublishEntries(calendarEntries, locale);
      if (!window.confirm(t("confirmCalendar"))) return;
      setSaving("calendar");
      const result = await configApi.publishEnergyOperatingCalendar(projectId, { entries });
      setConfiguration(result.configuration);
      setCalendarEntries(calendarDraftFromConfiguration(result.configuration));
      setNotice(t("calendarPending", { version: result.revision.version_id }));
      await onChanged();
    } catch (reason) {
      setError(messageFrom(reason, t("calendarFailed")));
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <PolicyState title={t("loading")} detail={t("loadingDetail")} />;
  }
  if (!configuration) {
    return <PolicyState title={t("unavailable")} detail={error ?? t("retry")} />;
  }

  const pendingRelease = hasPendingPolicyRelease(configuration);
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {error ? <PolicyMessage tone="error">{error}</PolicyMessage> : null}
      {notice ? <PolicyMessage tone="success">{notice}</PolicyMessage> : null}

      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">{t("releaseBoundary")}</p>
            <h3 className="mt-1 text-sm font-semibold">{t("title")}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">{t("intro")}</p>
          </div>
          <span className={pendingRelease ? warningBadge : successBadge}>
            {pendingRelease ? t("pendingRelease") : t("matchesRelease")}
          </span>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <PolicyVersionCard
            title={t("tariff")}
            published={configuration.published.tariff_schedule_version}
            pending={configuration.pending.tariff_schedule_version}
          />
          <PolicyVersionCard
            title={t("operatingCalendar")}
            published={configuration.published.business_calendar_version}
            pending={configuration.pending.business_calendar_version}
          />
        </div>
        <p className="mt-4 text-xs text-muted">
          {t("timezone")} <strong className="text-foreground">{configuration.timezone}</strong>
          {configuration.published.template_revision_id
            ? t("publishedTemplate", { id: configuration.published.template_revision_id })
            : t("compatibility")}
        </p>
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <PolicyHeading
          eyebrow={t("costInput")}
          title={t("tariffSchedule")}
          description={t("tariffDescription")}
          action={(
            <button
              type="button"
              className={secondaryButton}
              onClick={() => setTariffEntries((current) => [...current, createEmptyTariffEntry(newKey("tariff"))])}
            >
              {t("addRateWindow")}
            </button>
          )}
        />
        <div className="mt-5 space-y-4">
          {tariffEntries.map((entry, index) => (
            <TariffEntryEditor
              key={entry.key}
              entry={entry}
              index={index}
              scopeOptions={scopeOptions}
              removable={tariffEntries.length > 1}
              onChange={(next) => setTariffEntries((current) => current.map((candidate) =>
                candidate.key === entry.key ? next : candidate))}
              onRemove={() => setTariffEntries((current) => current.filter((candidate) => candidate.key !== entry.key))}
            />
          ))}
        </div>
        <PolicyFooter
          history={t(configuration.tariffRevisions.length === 1 ? "history.one" : "history.other", { count: configuration.tariffRevisions.length })}
          saving={saving === "tariff"}
          disabled={saving !== null}
          label={t("publishTariff")}
          onPublish={() => void publishTariff()}
        />
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <PolicyHeading
          eyebrow={t("operatingInput")}
          title={t("operatingCalendar")}
          description={t("calendarDescription")}
          action={(
            <button
              type="button"
              className={secondaryButton}
              onClick={() => setCalendarEntries((current) => [
                ...current,
                createEmptyCalendarEntry(newKey("calendar")),
              ])}
            >
              {t("addCalendarWindow")}
            </button>
          )}
        />
        <div className="mt-5 space-y-4">
          {calendarEntries.map((entry, index) => (
            <CalendarEntryEditor
              key={entry.key}
              entry={entry}
              index={index}
              scopeOptions={scopeOptions}
              removable={calendarEntries.length > 1}
              onChange={(next) => setCalendarEntries((current) => current.map((candidate) =>
                candidate.key === entry.key ? next : candidate))}
              onRemove={() => setCalendarEntries((current) => current.filter((candidate) => candidate.key !== entry.key))}
            />
          ))}
        </div>
        <PolicyFooter
          history={t(configuration.operatingCalendarRevisions.length === 1 ? "history.one" : "history.other", { count: configuration.operatingCalendarRevisions.length })}
          saving={saving === "calendar"}
          disabled={saving !== null}
          label={t("publishCalendar")}
          onPublish={() => void publishCalendar()}
        />
      </section>
    </div>
  );
}

function TariffEntryEditor({
  entry,
  index,
  scopeOptions,
  removable,
  onChange,
  onRemove,
}: {
  entry: TariffEntryDraft;
  index: number;
  scopeOptions: EnergySelectOption[];
  removable: boolean;
  onChange: (entry: TariffEntryDraft) => void;
  onRemove: () => void;
}) {
  const t = useMessages(policySettingsMessages);
  return (
    <div className="rounded-xl border border-border bg-surface-subtle/50 p-4">
      <EditorHeader label={t("rateWindow", { number: index + 1 })} removable={removable} onRemove={onRemove} />
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OwnerField
          owner={entry.owner}
          options={scopeOptions}
          onChange={(owner) => onChange({ ...entry, owner })}
        />
        <TextField
          label={t("effectiveFrom")}
          value={entry.effectiveFrom}
          placeholder="2026-07-01T00:00:00+08:00"
          onChange={(effectiveFrom) => onChange({ ...entry, effectiveFrom })}
        />
        <TextField
          label={t("effectiveTo")}
          value={entry.effectiveTo}
          placeholder={t("optionalInstant")}
          onChange={(effectiveTo) => onChange({ ...entry, effectiveTo })}
        />
        <TextField
          label={t("currency")}
          value={entry.currency}
          placeholder="SGD"
          onChange={(currency) => onChange({ ...entry, currency })}
        />
        <TextField
          label={t("ratePerKwh")}
          value={entry.ratePerKwh}
          placeholder="0.28"
          inputMode="decimal"
          onChange={(ratePerKwh) => onChange({ ...entry, ratePerKwh })}
        />
        <label className="block">
          <span className={fieldLabel}>{t("rateBasis")}</span>
          <select
            aria-label={t("rateBasisLabel")}
            className={compactInputClass}
            value={entry.rateBasis}
            onChange={(event) => onChange({
              ...entry,
              rateBasis: event.target.value as TariffEntryDraft["rateBasis"],
            })}
          >
            <option value="">{t("basis.none")}</option>
            <option value="tax_inclusive">{t("basis.inclusive")}</option>
            <option value="tax_exclusive">{t("basis.exclusive")}</option>
          </select>
        </label>
        <TextField
          label={t("taxName")}
          value={entry.taxName}
          placeholder="GST"
          onChange={(taxName) => onChange({ ...entry, taxName })}
        />
        <TextField
          label={t("taxRate")}
          value={entry.taxRatePct}
          placeholder="9"
          inputMode="decimal"
          onChange={(taxRatePct) => onChange({ ...entry, taxRatePct })}
        />
      </div>
    </div>
  );
}

export function CalendarEntryEditor({
  entry,
  index,
  scopeOptions,
  removable,
  onChange,
  onRemove,
}: {
  entry: OperatingCalendarEntryDraft;
  index: number;
  scopeOptions: EnergySelectOption[];
  removable: boolean;
  onChange: (entry: OperatingCalendarEntryDraft) => void;
  onRemove: () => void;
}) {
  const t = useMessages(policySettingsMessages);
  return (
    <div className="rounded-xl border border-border bg-surface-subtle/50 p-4">
      <EditorHeader label={t("calendarWindow", { number: index + 1 })} removable={removable} onRemove={onRemove} />
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <OwnerField
          owner={entry.owner}
          options={scopeOptions}
          onChange={(owner) => onChange({ ...entry, owner })}
        />
        <TextField
          label={t("effectiveFrom")}
          type="date"
          value={entry.effectiveFrom}
          onChange={(effectiveFrom) => onChange({ ...entry, effectiveFrom })}
        />
        <TextField
          label={t("effectiveTo")}
          type="date"
          value={entry.effectiveTo}
          onChange={(effectiveTo) => onChange({ ...entry, effectiveTo })}
        />
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-border bg-surface">
        {OPERATING_DAYS.map((day) => (
          <OperatingDayEditor
            key={day}
            day={day}
            ranges={entry.weekly[day]}
            onChange={(ranges) => onChange({
              ...entry,
              weekly: { ...entry.weekly, [day]: ranges },
            })}
          />
        ))}
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h5 className="text-xs font-semibold">{t("holidaysTitle")}</h5>
            <p className="mt-1 text-[11px] text-muted">{t("holidaysHint")}</p>
          </div>
          <button
            type="button"
            className={secondaryButton}
            onClick={() => onChange({
              ...entry,
              exceptions: [...entry.exceptions, {
                key: newKey("exception"),
                date: "",
                label: "",
                classification: "",
                operating: [],
              }],
            })}
          >
            {t("addHoliday")}
          </button>
        </div>
        <div className="mt-3 space-y-3">
          {entry.exceptions.map((exception) => (
            <ExceptionEditor
              key={exception.key}
              exception={exception}
              onChange={(next) => onChange({
                ...entry,
                exceptions: entry.exceptions.map((candidate) =>
                  candidate.key === exception.key ? next : candidate),
              })}
              onRemove={() => onChange({
                ...entry,
                exceptions: entry.exceptions.filter((candidate) => candidate.key !== exception.key),
              })}
            />
          ))}
          {entry.exceptions.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted">
              {t("noHolidays")}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function OperatingDayEditor({
  day,
  ranges,
  onChange,
}: {
  day: EnergyOperatingDayDto;
  ranges: OperatingTimeRangeDraft[];
  onChange: (ranges: OperatingTimeRangeDraft[]) => void;
}) {
  const t = useMessages(policySettingsMessages);
  const weekday = useMessages(weekdayMessages);
  return (
    <div className="grid gap-3 border-b border-border px-3 py-3 last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:items-start">
      <span className="pt-2 text-xs font-medium capitalize">{weekday(`${day}.long`)}</span>
      <div className="space-y-2">
        {ranges.map((range) => (
          <TimeRangeEditor
            key={range.key}
            range={range}
            onChange={(next) => onChange(ranges.map((candidate) => candidate.key === range.key ? next : candidate))}
            onRemove={() => onChange(ranges.filter((candidate) => candidate.key !== range.key))}
          />
        ))}
        {ranges.length === 0 ? <span className="block py-2 text-xs text-muted">{t("closed")}</span> : null}
      </div>
      <button
        type="button"
        className={secondaryButton}
        onClick={() => onChange([...ranges, { key: newKey(day), from: "08:00", to: "18:00" }])}
      >
        {t("addHours")}
      </button>
    </div>
  );
}

function ExceptionEditor({
  exception,
  onChange,
  onRemove,
}: {
  exception: OperatingExceptionDraft;
  onChange: (exception: OperatingExceptionDraft) => void;
  onRemove: () => void;
}) {
  const t = useMessages(policySettingsMessages);
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)_minmax(180px,0.7fr)_auto]">
        <TextField label={t("date")} type="date" value={exception.date} onChange={(date) => onChange({ ...exception, date })} />
        <TextField label={t("name")} value={exception.label} placeholder={t("namePlaceholder")} onChange={(label) => onChange({ ...exception, label })} />
        <label className="block">
          <span className={fieldLabel}>{t("type")}</span>
          <select
            aria-label={t("typeLabel")}
            className={compactInputClass}
            value={exception.classification}
            onChange={(event) => onChange({
              ...exception,
              classification: event.target.value as OperatingExceptionDraft["classification"],
            })}
          >
            <option value="">{t("type.other")}</option>
            <option value="public_holiday">{t("type.public_holiday")}</option>
            <option value="special_closure">{t("type.special_closure")}</option>
            <option value="special_operating_day">{t("type.special_operating_day")}</option>
          </select>
        </label>
        <button type="button" className={`${secondaryButton} self-end`} onClick={onRemove}>{t("remove")}</button>
      </div>
      <div className="mt-3 space-y-2">
        {exception.operating.map((range) => (
          <TimeRangeEditor
            key={range.key}
            range={range}
            onChange={(next) => onChange({
              ...exception,
              operating: exception.operating.map((candidate) => candidate.key === range.key ? next : candidate),
            })}
            onRemove={() => onChange({
              ...exception,
              operating: exception.operating.filter((candidate) => candidate.key !== range.key),
            })}
          />
        ))}
        <button
          type="button"
          className={secondaryButton}
          onClick={() => onChange({
            ...exception,
            operating: [...exception.operating, { key: newKey("exception-range"), from: "08:00", to: "18:00" }],
          })}
        >
          {t("addSpecialHours")}
        </button>
      </div>
    </div>
  );
}

function TimeRangeEditor({
  range,
  onChange,
  onRemove,
}: {
  range: OperatingTimeRangeDraft;
  onChange: (range: OperatingTimeRangeDraft) => void;
  onRemove: () => void;
}) {
  const t = useMessages(policySettingsMessages);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        aria-label={t("operatingFrom")}
        type="time"
        value={range.from}
        onChange={(event) => onChange({ ...range, from: event.target.value })}
        className={compactInputClass}
      />
      <span className="text-xs text-muted">{t("to")}</span>
      <input
        aria-label={t("operatingTo")}
        type="time"
        value={range.to}
        onChange={(event) => onChange({ ...range, to: event.target.value })}
        className={compactInputClass}
      />
      <button type="button" className={linkButton} onClick={onRemove}>{t("remove")}</button>
    </div>
  );
}

function OwnerField({
  owner,
  options,
  onChange,
}: {
  owner: PolicyOwnerDraft;
  options: EnergySelectOption[];
  onChange: (owner: PolicyOwnerDraft) => void;
}) {
  const t = useMessages(policySettingsMessages);
  const value = owner.kind === "project" ? "project" : owner.scopeId;
  return (
    <label className="block">
      <span className={fieldLabel}>{t("appliesTo")}</span>
      <EnergySelect
        ariaLabel={t("ownerLabel")}
        value={value}
        options={options}
        onValueChange={(next) => onChange(next === "project"
          ? { kind: "project", scopeId: "" }
          : { kind: "scope", scopeId: next })}
        size="small"
        className="w-full"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
  placeholder?: string;
  inputMode?: "decimal";
}) {
  return (
    <label className="block min-w-0">
      <span className={fieldLabel}>{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </label>
  );
}

function PolicyVersionCard({ title, published, pending }: { title: string; published: string; pending: string }) {
  const t = useMessages(policySettingsMessages);
  const changed = published !== pending;
  return (
    <div className="rounded-xl border border-border bg-surface-subtle/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-xs font-semibold">{title}</h4>
        <span className={changed ? warningBadge : successBadge}>{changed ? t("pending") : t("published")}</span>
      </div>
      <dl className="mt-3 grid gap-2 text-xs">
        <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-3"><dt className="text-muted">{t("published")}</dt><dd className="truncate font-mono text-[11px]">{published}</dd></div>
        <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-3"><dt className="text-muted">{t("pending")}</dt><dd className="truncate font-mono text-[11px]">{pending}</dd></div>
      </dl>
    </div>
  );
}

function PolicyHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">{eyebrow}</p>
        <h3 className="mt-1 text-sm font-semibold">{title}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

function PolicyFooter({
  history,
  saving,
  disabled,
  label,
  onPublish,
}: {
  history: string;
  saving: boolean;
  disabled: boolean;
  label: string;
  onPublish: () => void;
}) {
  const t = useMessages(policySettingsMessages);
  return (
    <div className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-xs text-muted">{history}</span>
      <button type="button" className={primaryButton} disabled={disabled} onClick={onPublish}>
        {saving ? t("publishing") : label}
      </button>
    </div>
  );
}

function EditorHeader({ label, removable, onRemove }: { label: string; removable: boolean; onRemove: () => void }) {
  const t = useMessages(policySettingsMessages);
  return (
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-xs font-semibold">{label}</h4>
      {removable ? <button type="button" className={linkButton} onClick={onRemove}>{t("remove")}</button> : null}
    </div>
  );
}

function PolicyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto max-w-4xl rounded-xl border border-border bg-surface p-8 text-center">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-xs text-muted">{detail}</p>
    </div>
  );
}

function PolicyMessage({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  return (
    <div className={tone === "error"
      ? "rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-xs text-danger"
      : "rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-700"}
    >
      {children}
    </div>
  );
}

const newKey = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;
const messageFrom = (reason: unknown, fallback: string): string => reason instanceof Error ? reason.message : fallback;
const fieldLabel = "mb-1.5 block text-[11px] font-medium text-muted";
const inputClass = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs outline-none transition-shadow focus:border-primary/30 focus:ring-2 focus:ring-primary/10";
const compactInputClass = "rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10";
const secondaryButton = "inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-40";
const primaryButton = "inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-40";
const linkButton = "text-[11px] font-medium text-primary hover:text-primary-light";
const warningBadge = "inline-flex w-fit items-center rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-semibold text-amber-700";
const successBadge = "inline-flex w-fit items-center rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-700";
