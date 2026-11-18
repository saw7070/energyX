/**
 * Applying a suggestion from report feedback: the change is made for real, through the same server functions the
 * Facility page uses, and made live straight away as Facility does.
 *
 * - Hours and holidays: a new operating calendar version is published from the one in use (keeping its start date,
 *   what the hours mean, its other days off and the school terms), then the change is made live.
 * - Electricity rate: a new tariff version adds the project's new rate from the chosen date, keeping its currency and
 *   tax, then the change is made live.
 * - Meter settings: the meter's setting is saved in the shared setup draft (with the draft's revision check), then the
 *   change is made live, which only a platform administrator may do.
 * - Report points not to flag: kept with the feedback; the site's reports leave the point out from then on.
 *
 * Every payload is checked again first, and the target must still exist.
 */
import { randomUUID } from "node:crypto";
import type {
  EnergyIqOperatingCalendarEntry,
  EnergyIqOperatingCalendarRevision,
  EnergyIqProjectSetupDocument,
  EnergyIqTariffScheduleEntry,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import type { ConfigApiContext } from "../routes/types.js";
import { localDayStartMs } from "../energy/energy-data-availability.js";
import { localDate, type ReportFeedbackStore, type SuggestionDto } from "./report-feedback-store.js";
import { activeCalendar, activeTariff, CALENDAR_DAY, projectCalendarEntry, WEEK_DAYS, type WeeklyHours } from "./report-feedback-site.js";
import { longDate, PAYLOAD_SCHEMAS, type SuggestionPayloads } from "./report-feedback-suggestions.js";

/** Why a suggestion could not be applied, in words an administrator can act on. */
export class ApplyError extends Error {
  constructor(readonly status: 409 | 422, message: string) {
    super(message);
    this.name = "ApplyError";
  }
}

export type ApplyInput = {
  context: Required<ConfigApiContext>;
  projectId: string;
  user: UserRecord;
  store: ReportFeedbackStore;
  /** Makes saved Facility changes live (applyProjectChangesNow). */
  applyProjectChanges: (context: Required<ConfigApiContext>, projectId: string) => Promise<unknown>;
  now: Date;
};

/** Most light points one meter can feed; matches the meter form. */
const MAX_METER_LIGHT_COUNT = 9999;

export async function applySuggestionChange(input: ApplyInput, suggestion: SuggestionDto): Promise<void> {
  const schema = PAYLOAD_SCHEMAS[suggestion.kind];
  const parsed = schema?.safeParse(suggestion.payload);
  if (!parsed?.success) throw new ApplyError(422, "This suggestion is no longer valid. Send your feedback again.");
  switch (suggestion.kind) {
    case "operating_hours": return applyHours(input, parsed.data as SuggestionPayloads["operating_hours"]);
    case "holiday": return applyHoliday(input, parsed.data as SuggestionPayloads["holiday"]);
    case "electricity_rate": return applyRate(input, parsed.data as SuggestionPayloads["electricity_rate"]);
    case "meter_not_in_use":
    case "meter_in_use":
    case "meter_always_on":
    case "light_count":
      return applyMeter(input, suggestion.kind, parsed.data as SuggestionPayloads["meter_in_use"] & Partial<SuggestionPayloads["meter_not_in_use"] & SuggestionPayloads["meter_always_on"] & SuggestionPayloads["light_count"]>);
    case "dismiss_check": {
      const value = parsed.data as SuggestionPayloads["dismiss_check"];
      input.store.dismissCheck(input.projectId, { key: value.checkKey, title: value.title, reason: value.reason, suggestionId: suggestion.id }, input.now);
      return;
    }
  }
}

const metadataOf = (input: ApplyInput): MetadataStore => input.context.metadataStore;

async function applyHours(input: ApplyInput, payload: SuggestionPayloads["operating_hours"]): Promise<void> {
  if (WEEK_DAYS.some(day => !payload.weekly[day])) throw new ApplyError(422, "This suggestion is no longer valid. Send your feedback again.");
  const project = metadataOf(input).energyIq.getProject(input.projectId);
  const revision = activeCalendar(metadataOf(input), input.projectId);
  const entry = projectCalendarEntry(revision, localDate(input.now.toISOString(), project.timezone));
  if (!revision || !entry) throw new ApplyError(409, "This site has no opening hours yet. Set them in Facility first.");
  const weekly = Object.fromEntries(WEEK_DAYS.map(day => [CALENDAR_DAY[day], (payload.weekly as WeeklyHours)[day].map(range => ({ from: range.from, to: range.to }))])) as EnergyIqOperatingCalendarEntry["weekly"];
  publishCalendar(input, revision, revision.entries.map(item => item.id === entry.id ? { ...item, weekly } : item), "These hours could not be saved.");
  await makeLive(input);
}

async function applyHoliday(input: ApplyInput, payload: SuggestionPayloads["holiday"]): Promise<void> {
  const revision = activeCalendar(metadataOf(input), input.projectId);
  // Only an entry that covers the date can hold it; the "latest entry" fallback would put it out of range.
  const entry = (revision?.entries ?? []).find(item => item.owner.kind === "project" && item.effective_from <= payload.date && (!item.effective_to || item.effective_to > payload.date));
  if (!revision || !entry) throw new ApplyError(409, `No opening hours cover ${longDate(payload.date)}. Add hours for that date in Facility first.`);
  const exceptions = [
    ...(entry.exceptions ?? []).filter(item => item.date !== payload.date),
    { date: payload.date, operating: [], label: payload.label, classification: payload.classification ?? "public_holiday" },
  ];
  publishCalendar(input, revision, revision.entries.map(item => item.id === entry.id ? { ...item, exceptions } : item), "This day off could not be saved.");
  await makeLive(input);
}

function publishCalendar(input: ApplyInput, revision: EnergyIqOperatingCalendarRevision, entries: EnergyIqOperatingCalendarEntry[], failure: string): void {
  try {
    metadataOf(input).energyIq.operationalPolicy.publishOperatingCalendar({
      version_id: `calendar-${randomUUID()}`,
      project_id: input.projectId,
      entries,
      academic_periods: revision.academic_periods ?? [],
      published_by: input.user.id,
      activate: true,
    });
  } catch (error) {
    throw new ApplyError(422, `${failure} ${policyProblem(error)}`.trim());
  }
}

async function applyRate(input: ApplyInput, payload: SuggestionPayloads["electricity_rate"]): Promise<void> {
  const project = metadataOf(input).energyIq.getProject(input.projectId);
  const revision = activeTariff(metadataOf(input), input.projectId);
  const own = (revision?.entries ?? []).filter(entry => entry.owner.kind === "project")
    .sort((a, b) => Date.parse(a.effective_from) - Date.parse(b.effective_from));
  if (!revision || !own.length) throw new ApplyError(409, "This site has no electricity rate yet. Set it in Facility first.");
  const startMs = localDayStartMs(payload.effectiveFrom, project.timezone);
  const start = new Date(startMs).toISOString();
  const fromMs = (entry: EnergyIqTariffScheduleEntry) => Date.parse(entry.effective_from);
  const toMs = (entry: EnergyIqTariffScheduleEntry) => (entry.effective_to ? Date.parse(entry.effective_to) : Number.POSITIVE_INFINITY);
  const exact = own.find(entry => fromMs(entry) === startMs);
  const covering = own.find(entry => fromMs(entry) <= startMs && toMs(entry) > startMs);
  const template = exact ?? covering ?? [...own].reverse().find(entry => fromMs(entry) < startMs) ?? own[0]!;
  if (template.time_of_use) throw new ApplyError(409, "This site has peak and off-peak prices. Change the rate in Facility.");
  // The new rate keeps the currency, tax and basis (and any fixed charges kept for reference); it is no longer a
  // published plan's price, so the plan is not carried over.
  const priced = (entry: EnergyIqTariffScheduleEntry): EnergyIqTariffScheduleEntry => {
    const next: EnergyIqTariffScheduleEntry = { ...entry, rate_per_kwh: payload.ratePerKwh };
    delete next.plan;
    return next;
  };
  let entries: EnergyIqTariffScheduleEntry[];
  if (exact) {
    entries = revision.entries.map(entry => (entry.id === exact.id ? priced(entry) : entry));
  } else {
    const next = own.find(entry => fromMs(entry) > startMs);
    const end = covering ? covering.effective_to : next?.effective_from;
    const added: EnergyIqTariffScheduleEntry = {
      id: `tariff-entry-${randomUUID()}`,
      owner: { kind: "project" },
      effective_from: start,
      ...(end ? { effective_to: end } : {}),
      currency: template.currency,
      rate_per_kwh: payload.ratePerKwh,
      ...(template.rate_basis && template.tax ? { rate_basis: template.rate_basis, tax: { ...template.tax } } : {}),
      ...(template.fixed_charges?.length ? { fixed_charges: template.fixed_charges.map(charge => ({ ...charge })) } : {}),
    };
    entries = [...revision.entries.map(entry => (covering && entry.id === covering.id ? { ...entry, effective_to: start } : entry)), added];
  }
  try {
    metadataOf(input).energyIq.operationalPolicy.publishTariffSchedule({
      version_id: `tariff-${randomUUID()}`,
      project_id: input.projectId,
      entries,
      published_by: input.user.id,
      activate: true,
    });
  } catch (error) {
    throw new ApplyError(422, `This rate could not be saved. ${policyProblem(error)}`.trim());
  }
  await makeLive(input);
}

type MeterKind = "meter_not_in_use" | "meter_in_use" | "meter_always_on" | "light_count";

async function applyMeter(input: ApplyInput, kind: MeterKind, payload: { meterId: string; meterName?: string; reason?: string; alwaysOn?: boolean; count?: number }): Promise<void> {
  const setup = metadataOf(input).energyIq.projectSetup;
  const draft = setup.getDraft({ project_id: input.projectId, user_id: input.user.id });
  const mapping = draft.document.meter_mapping;
  const rows = mapping?.rows ?? [];
  const index = rows.findIndex(row => row.id === payload.meterId);
  const name = payload.meterName || payload.meterId;
  if (!mapping || index < 0) throw new ApplyError(409, `${name} is no longer in this site's setup.`);
  const presentation: Record<string, string> = { ...(rows[index]!.presentation ?? {}) } as Record<string, string>;
  if (kind === "meter_not_in_use") presentation.not_in_use = payload.reason ?? "";
  if (kind === "meter_in_use") delete presentation.not_in_use;
  if (kind === "meter_always_on") {
    if (payload.alwaysOn) presentation.always_on = "true";
    else delete presentation.always_on;
  }
  if (kind === "light_count") presentation.light_count = String(payload.count);
  let checked: Record<string, string>;
  try {
    checked = checkMeterPresentation(presentation);
  } catch {
    throw new ApplyError(422, `The new setting for ${name} is not valid.`);
  }
  const document: EnergyIqProjectSetupDocument = {
    ...draft.document,
    meter_mapping: { ...mapping, rows: rows.map((row, position) => (position === index ? { ...row, presentation: checked } : row)) },
  };
  try {
    setup.saveDraft({ project_id: input.projectId, expected_revision: draft.revision, user_id: input.user.id, document });
  } catch (error) {
    if (error instanceof Error && error.message === "ENERGYIQ_SETUP_REVISION_CONFLICT") throw new ApplyError(409, "Someone changed this site's setup at the same time. Try again.");
    throw error;
  }
  await makeLive(input);
}

/** The meter form's rules for these settings (parseMeterPresentation in energy-api.ts). */
export function checkMeterPresentation(presentation: Record<string, unknown>): Record<string, string> {
  const keys = ["device_name", "circuit_name", "group", "not_in_use", "off_with_lights", "short_name", "panel", "always_on", "light_count"];
  return Object.fromEntries(keys.flatMap(key => {
    const value = presentation[key];
    if (value === undefined) return [];
    if (typeof value !== "string") throw new Error(`ENERGYIQ_METER_PRESENTATION_INVALID:${key}`);
    const label = value.trim().slice(0, 160);
    if (key === "always_on") return label === "true" ? [[key, label]] : [];
    if (key === "light_count" && label) {
      const count = /^\d+$/u.test(label) ? Number(label) : Number.NaN;
      if (!(count >= 1 && count <= MAX_METER_LIGHT_COUNT)) throw new Error(`ENERGYIQ_METER_PRESENTATION_INVALID:${key}`);
      return [[key, String(count)]];
    }
    return label ? [[key, label]] : [];
  }));
}

/** Makes the saved change live, as Facility does after each save. */
async function makeLive(input: ApplyInput): Promise<void> {
  try {
    await input.applyProjectChanges(input.context, input.projectId);
  } catch (error) {
    throw new ApplyError(409, `The change is saved but not live yet. ${liveProblem(error)}`);
  }
}

function liveProblem(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (/ADMIN|FORBIDDEN/.test(text)) return "Only a platform administrator can make changes live.";
  if (/SETUP_INVALID/.test(text)) return "The site's setup has a problem. Open Facility to fix it.";
  if (/DATA_NOT_READY/.test(text)) return "The site's readings are not ready. Try again later.";
  if (/REVISION|CONFLICT/.test(text)) return "Someone changed this site at the same time. Try again.";
  return "Open Facility and choose to make the changes live.";
}

function policyProblem(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (/OVERLAP/.test(text)) return "It overlaps with other dates.";
  if (/OUTSIDE_RANGE|EFFECTIVE_RANGE/.test(text)) return "The date is outside the dates these settings cover.";
  if (/TIME_RANGE|TIME_RANGES|LOCAL_TIME/.test(text)) return "One of the times is not valid.";
  return "";
}
