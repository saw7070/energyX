import type {
  EnergyOperatingCalendarEntryInputDto,
  EnergyOperatingDayDto,
  EnergyTariffFixedChargeDto,
  EnergyTariffScheduleEntryInputDto,
} from "../../../lib/config-api";
import { zonedMidnight } from "./electricity-rate-editor";
import { COUNTRY_DEFAULTS, publicHolidaysFor, usualOpeningDays, type CountryCode, type PublicHoliday, type TariffPlanId } from "./site-region";

/** Settings a new project starts with, as the person sees and edits them before it is created. */
export type SiteSettings = {
  country: CountryCode;
  /** Malaysian state code; empty until chosen, and always empty in Singapore. */
  state: string;
  timezone: string;
  currency: string;
  tax: { name: string; pct: string; basis: "tax_exclusive" | "tax_inclusive" } | null;
  /** null when the price is left for later. */
  price: null | {
    planId: TariffPlanId;
    rate: string;
    peak: null | { rate: string; days: EnergyOperatingDayDto[]; from: string; to: string; holidaysOffPeak: boolean };
    fixedCharges: EnergyTariffFixedChargeDto[];
  };
  /** null when opening hours are left for later; public holidays then wait too. */
  hours: null | { days: EnergyOperatingDayDto[]; from: string; to: string };
  holidays: null | Array<PublicHoliday & { chosen: boolean }>;
};

export const CUSTOM_PLAN: TariffPlanId = "custom";
/** Settings cover every reading a site might upload; dated changes are added later on the Facility pages. */
export const SETTINGS_START = "2020-01-01";
export const DAYS: EnergyOperatingDayDto[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const priceText = (value: number) => value.toFixed(4);

export function defaultSiteSettings(country: CountryCode, state = ""): SiteSettings {
  const defaults = COUNTRY_DEFAULTS[country];
  const regionState = country === "MY" ? state : "";
  const settings: SiteSettings = {
    country,
    state: regionState,
    timezone: defaults.timezone,
    currency: defaults.currency,
    tax: defaults.tax ? { name: defaults.tax.name, pct: String(defaults.tax.pct), basis: defaults.tax.basis } : null,
    price: null,
    hours: { days: usualOpeningDays(country, regionState || undefined), from: "09:00", to: "18:00" },
    holidays: holidayChoices(country, regionState),
  };
  return choosePlan(settings, defaults.tariffs[0]?.id ?? CUSTOM_PLAN);
}

/** Moves to another state: its own holidays and working week, keeping prices and tax as they are. */
export function chooseState(settings: SiteSettings, state: string): SiteSettings {
  return {
    ...settings,
    state,
    ...(settings.hours ? { hours: { ...settings.hours, days: usualOpeningDays(settings.country, state || undefined) } } : {}),
    ...(settings.holidays ? { holidays: holidayChoices(settings.country, state) } : {}),
  };
}

const holidayChoices = (country: CountryCode, state: string) =>
  publicHolidaysFor(country, state || undefined).map(holiday => ({ ...holiday, chosen: true }));

/** Restore a skipped section with what the site's country and state would give it. */
export function includeHolidays(settings: SiteSettings): SiteSettings {
  return { ...settings, holidays: holidayChoices(settings.country, settings.state) };
}

/** Fills the prices from a published tariff; "My own price" keeps whatever is already typed. */
export function choosePlan(settings: SiteSettings, planId: TariffPlanId): SiteSettings {
  const preset = COUNTRY_DEFAULTS[settings.country].tariffs.find(tariff => tariff.id === planId);
  if (!preset) {
    return {
      ...settings,
      price: { planId: CUSTOM_PLAN, rate: settings.price?.rate ?? "", peak: settings.price?.peak ?? null, fixedCharges: [] },
    };
  }
  return {
    ...settings,
    price: {
      planId: preset.id,
      rate: priceText(preset.rate),
      peak: preset.peak
        ? { rate: priceText(preset.peak.rate), days: [...preset.peak.days], from: preset.peak.from, to: preset.peak.to, holidaysOffPeak: true }
        : null,
      fixedCharges: preset.fixedCharges.map(charge => ({ ...charge })),
    },
  };
}

export type SettingsProblem = "stateRequired" | "priceInvalid" | "peakInvalid" | "peakHoursInvalid" | "taxInvalid" | "hoursInvalid";

const positive = (value: string) => {
  const number = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(number) && number > 0 ? number : null;
};

/** The first thing that stops the settings being saved, or null when everything is ready. */
export function settingsProblem(settings: SiteSettings): SettingsProblem | null {
  if (settings.country === "MY" && !settings.state) return "stateRequired";
  if (settings.tax && (!settings.tax.name.trim() || !(Number(settings.tax.pct) >= 0) || settings.tax.pct.trim() === "")) return "taxInvalid";
  if (settings.price) {
    if (positive(settings.price.rate) === null) return "priceInvalid";
    const peak = settings.price.peak;
    if (peak) {
      if (positive(peak.rate) === null) return "peakInvalid";
      if (!peak.days.length || peak.to <= peak.from) return "peakHoursInvalid";
    }
  }
  if (settings.hours && (!settings.hours.days.length || settings.hours.to <= settings.hours.from)) return "hoursInvalid";
  return null;
}

/** The electricity rate to publish, or null when the price was left for later. */
export function tariffEntryForSave(settings: SiteSettings, planLabel: (planId: TariffPlanId) => string): EnergyTariffScheduleEntryInputDto | null {
  const price = settings.price;
  if (!price) return null;
  const preset = COUNTRY_DEFAULTS[settings.country].tariffs.find(tariff => tariff.id === price.planId);
  return {
    owner: { kind: "project" },
    effectiveFrom: zonedMidnight(SETTINGS_START, settings.timezone),
    currency: settings.currency.trim().toUpperCase(),
    ratePerKwh: Number(price.rate),
    ...(settings.tax ? { rateBasis: settings.tax.basis, tax: { name: settings.tax.name.trim(), ratePct: Number(settings.tax.pct) } } : {}),
    ...(price.peak ? {
      timeOfUse: {
        peakRatePerKwh: Number(price.peak.rate),
        peakWindows: [{ days: DAYS.filter(day => price.peak!.days.includes(day)), from: price.peak.from, to: price.peak.to }],
        holidaysOffPeak: price.peak.holidaysOffPeak,
      },
    } : {}),
    ...(price.fixedCharges.length ? { fixedCharges: price.fixedCharges } : {}),
    plan: { id: price.planId, label: planLabel(price.planId), ...(preset ? { source: preset.source } : {}) },
  };
}

/** Opening hours with the chosen public holidays as closed days, or null when hours were left for later. */
export function calendarEntryForSave(settings: SiteSettings): EnergyOperatingCalendarEntryInputDto | null {
  const hours = settings.hours;
  if (!hours) return null;
  const weekly = Object.fromEntries(DAYS.map(day => [day, hours.days.includes(day) ? [{ from: hours.from, to: hours.to }] : []])) as EnergyOperatingCalendarEntryInputDto["weekly"];
  const holidays = (settings.holidays ?? []).filter(holiday => holiday.chosen && holiday.date >= SETTINGS_START);
  return {
    owner: { kind: "project" },
    effectiveFrom: SETTINGS_START,
    weekly,
    ...(holidays.length ? {
      exceptions: holidays.map(holiday => ({ date: holiday.date, operating: [], label: holiday.name, classification: "public_holiday" as const })),
    } : {}),
  };
}
