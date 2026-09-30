import type {
  EnergyOperatingCalendarEntryInputDto,
  EnergyOperatingCalendarRevisionDto,
  EnergyOperatingDayDto,
  EnergyOperationalPolicyConfigurationDto,
  EnergyOperationalPolicyOwnerInputDto,
  EnergyTariffScheduleEntryInputDto,
} from "../../../lib/config-api";
import { translatorFor, type EnergyIqLocale } from "../_components/energyiq-messages";
import { weekdayMessages } from "../_components/operating-policy-messages";
import { policySettingsMessages } from "../_components/policy-settings-messages";

export const OPERATING_DAYS: EnergyOperatingDayDto[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export type PolicyOwnerDraft = { kind: "project" | "scope"; scopeId: string };

export type TariffEntryDraft = {
  key: string;
  owner: PolicyOwnerDraft;
  effectiveFrom: string;
  effectiveTo: string;
  currency: string;
  ratePerKwh: string;
  rateBasis: "tax_inclusive" | "tax_exclusive" | "";
  taxName: string;
  taxRatePct: string;
};

export type OperatingTimeRangeDraft = { key: string; from: string; to: string };

export type OperatingExceptionDraft = {
  key: string;
  date: string;
  label: string;
  classification: "" | "public_holiday" | "special_closure" | "special_operating_day";
  operating: OperatingTimeRangeDraft[];
};

export type OperatingCalendarEntryDraft = {
  key: string;
  owner: PolicyOwnerDraft;
  effectiveFrom: string;
  effectiveTo: string;
  weekly: Record<EnergyOperatingDayDto, OperatingTimeRangeDraft[]>;
  exceptions: OperatingExceptionDraft[];
};

export const createEmptyTariffEntry = (key: string): TariffEntryDraft => ({
  key,
  owner: { kind: "project", scopeId: "" },
  effectiveFrom: "",
  effectiveTo: "",
  currency: "SGD",
  ratePerKwh: "",
  rateBasis: "",
  taxName: "",
  taxRatePct: "",
});

export const createEmptyCalendarEntry = (key: string): OperatingCalendarEntryDraft => ({
  key,
  owner: { kind: "project", scopeId: "" },
  effectiveFrom: "",
  effectiveTo: "",
  weekly: {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  },
  exceptions: [],
});

export const tariffDraftFromConfiguration = (
  configuration: EnergyOperationalPolicyConfigurationDto,
): TariffEntryDraft[] => {
  const revision = configuration.tariffRevisions.find(
    (candidate) => candidate.version_id === configuration.pending.tariff_schedule_version,
  );
  if (!revision) return [createEmptyTariffEntry("tariff-new-1")];
  return revision.entries.map((entry) => ({
    key: entry.id,
    owner: ownerToDraft(entry.owner),
    effectiveFrom: entry.effective_from,
    effectiveTo: entry.effective_to ?? "",
    currency: entry.currency,
    ratePerKwh: String(entry.rate_per_kwh),
    rateBasis: entry.rate_basis ?? "",
    taxName: entry.tax?.name ?? "",
    taxRatePct: entry.tax ? String(entry.tax.rate_pct) : "",
  }));
};

export const calendarDraftFromConfiguration = (
  configuration: EnergyOperationalPolicyConfigurationDto,
): OperatingCalendarEntryDraft[] => {
  const revision = configuration.operatingCalendarRevisions.find(
    (candidate) => candidate.version_id === configuration.pending.business_calendar_version,
  );
  return revision ? calendarDraftFromRevision(revision) : [createEmptyCalendarEntry("calendar-new-1")];
};

export const calendarDraftFromRevision = (
  revision: EnergyOperatingCalendarRevisionDto,
): OperatingCalendarEntryDraft[] => revision.entries.map((entry) => ({
  key: entry.id,
  owner: ownerToDraft(entry.owner),
  effectiveFrom: entry.effective_from,
  effectiveTo: entry.effective_to ?? "",
  weekly: Object.fromEntries(OPERATING_DAYS.map((day) => [
    day,
    entry.weekly[day].map((range, index) => ({
      key: `${entry.id}-${day}-${index}`,
      ...range,
    })),
  ])) as Record<EnergyOperatingDayDto, OperatingTimeRangeDraft[]>,
  exceptions: (entry.exceptions ?? []).map((exception, exceptionIndex) => ({
    key: `${entry.id}-exception-${exceptionIndex}`,
    date: exception.date,
    label: exception.label ?? "",
    classification: exception.classification ?? "",
    operating: exception.operating.map((range, rangeIndex) => ({
      key: `${entry.id}-exception-${exceptionIndex}-${rangeIndex}`,
      ...range,
    })),
  })),
}));

export const tariffPublishEntries = (
  entries: TariffEntryDraft[],
  locale: EnergyIqLocale = "en",
): EnergyTariffScheduleEntryInputDto[] => entries.map((entry, index) => {
  const t = translatorFor(policySettingsMessages, locale);
  const number = index + 1;
  const rate = Number(entry.ratePerKwh);
  const taxRate = Number(entry.taxRatePct);
  if (!entry.effectiveFrom) throw new Error(t("error.tariffStart", { number }));
  if (!entry.currency.trim()) throw new Error(t("error.tariffCurrency", { number }));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(t("error.tariffRate", { number }));
  if (entry.rateBasis && (!entry.taxName.trim() || !Number.isFinite(taxRate) || taxRate < 0)) {
    throw new Error(t("error.tariffTax", { number }));
  }
  return {
    owner: ownerToInput(entry.owner, () => t("error.tariffScope", { number })),
    effectiveFrom: entry.effectiveFrom,
    ...(entry.effectiveTo ? { effectiveTo: entry.effectiveTo } : {}),
    currency: entry.currency.trim().toUpperCase(),
    ratePerKwh: rate,
    ...(entry.rateBasis ? {
      rateBasis: entry.rateBasis,
      tax: { name: entry.taxName.trim(), ratePct: taxRate },
    } : {}),
  };
});

export const calendarPublishEntries = (
  entries: OperatingCalendarEntryDraft[],
  locale: EnergyIqLocale = "en",
): EnergyOperatingCalendarEntryInputDto[] => entries.map((entry, index) => {
  const t = translatorFor(policySettingsMessages, locale);
  // English names the day as the API spells it; other languages use the weekday's name.
  const dayName = (day: EnergyOperatingDayDto) => locale === "en" ? day : translatorFor(weekdayMessages, locale)(`${day}.long`);
  const number = index + 1;
  if (!entry.effectiveFrom) throw new Error(t("error.calendarStart", { number }));
  return {
    owner: ownerToInput(entry.owner, () => t("error.calendarScope", { number })),
    effectiveFrom: entry.effectiveFrom,
    ...(entry.effectiveTo ? { effectiveTo: entry.effectiveTo } : {}),
    weekly: Object.fromEntries(OPERATING_DAYS.map((day) => [
      day,
      entry.weekly[day].map((range, rangeIndex) => {
        if (!range.from || !range.to) {
          throw new Error(t("error.rangeIncomplete", { number, day: dayName(day), range: rangeIndex + 1 }));
        }
        return { from: range.from, to: range.to };
      }),
    ])) as EnergyOperatingCalendarEntryInputDto["weekly"],
    ...(entry.exceptions.length > 0 ? {
      exceptions: entry.exceptions.map((exception, exceptionIndex) => {
        if (!exception.date) {
          throw new Error(t("error.exceptionDate", { number, exception: exceptionIndex + 1 }));
        }
        return {
          date: exception.date,
          operating: exception.operating.map((range, rangeIndex) => {
            if (!range.from || !range.to) {
              throw new Error(t("error.exceptionRange", { number, exception: exceptionIndex + 1, range: rangeIndex + 1 }));
            }
            return { from: range.from, to: range.to };
          }),
          ...(exception.label.trim() ? { label: exception.label.trim() } : {}),
          ...(exception.classification ? { classification: exception.classification } : {}),
        };
      }),
    } : {}),
  };
});

export const hasPendingPolicyRelease = (
  configuration: EnergyOperationalPolicyConfigurationDto,
): boolean => configuration.pending.tariff_schedule_version !== configuration.published.tariff_schedule_version
  || configuration.pending.business_calendar_version !== configuration.published.business_calendar_version;

const ownerToDraft = (
  owner: { kind: "project" } | { kind: "scope"; scope_id: string },
): PolicyOwnerDraft => owner.kind === "project"
  ? { kind: "project", scopeId: "" }
  : { kind: "scope", scopeId: owner.scope_id };

const ownerToInput = (
  owner: PolicyOwnerDraft,
  missingScope: () => string,
): EnergyOperationalPolicyOwnerInputDto => {
  if (owner.kind === "project") return { kind: "project" };
  if (!owner.scopeId) throw new Error(missingScope());
  return { kind: "scope", scopeId: owner.scopeId };
};
