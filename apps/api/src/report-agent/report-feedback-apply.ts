/**
 * Applying a suggestion from report feedback: the change is made for real, through the same server functions the
 * Facility page uses, and made live straight away as Facility does.
 *
 * - Hours and holidays: a new operating calendar version is published from the one in use (keeping its start date,
 *   what the hours mean, its other days off and the school terms), then the change is made live. An hours change
 *   writes only the days it changes, and only while the same calendar entry is in use and those days still read as
 *   they did when it was suggested; otherwise it is refused, so a newer edit is never undone.
 * - Electricity rate: a new tariff version adds the project's new rate from the chosen date, keeping its currency and
 *   tax, then the change is made live.
 * - Meter settings: the meter's setting is saved in the shared setup draft (with the draft's revision check), then the
 *   change is made live, which only a platform administrator may do.
 * - Report points not to flag: kept with the feedback; the site's reports leave the point out from then on.
 *
 * Every payload is checked again first, and the target must still exist. A problem is given as a stable code (with
 * the meter's name or the date where the sentence needs one) for the page to word, and in English for the record.
 *
 * Once the change is saved, it counts as applied even when making it live fails: the result then says it is not live
 * yet and why, so the caller records it and nobody applies it a second time.
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
import { localDate, type ApplyProblemDetail, type ReportFeedbackStore, type SuggestionDto, type SuggestionProblem } from "./report-feedback-store.js";
import { activeCalendar, activeTariff, CALENDAR_DAY, projectCalendarEntry, readFeedbackSite, WEEK_DAYS, weeklyFromEntry, type WeeklyHours } from "./report-feedback-site.js";
import { checkSubject, dismissLabel, longDate, PAYLOAD_SCHEMAS, sameRanges, type SuggestionPayloads } from "./report-feedback-suggestions.js";

/** Why a suggestion could not be applied: a stable code for the page, and the same in English. Nothing was changed. */
export class ApplyError extends Error {
  constructor(readonly status: 409 | 422, readonly problem: SuggestionProblem, message: string) {
    super(message);
    this.name = "ApplyError";
  }
}

/**
 * The change was made. `live` false: it is saved but making it live failed (`problem` says why, `message` in English).
 * `label`: the sentence for what was done, when it was written again from the site at apply time.
 */
export type ApplyResult = { live: boolean; problem?: SuggestionProblem; message?: string; label?: string };

const invalid = () => new ApplyError(422, { code: "invalid" }, "This suggestion is no longer valid. Send your feedback again.");

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

export async function applySuggestionChange(input: ApplyInput, suggestion: SuggestionDto): Promise<ApplyResult> {
  const schema = PAYLOAD_SCHEMAS[suggestion.kind];
  const parsed = schema?.safeParse(suggestion.payload);
  if (!parsed?.success) throw invalid();
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
      // The point's title is written again from its key and the site, so what is kept is what the report flags.
      const subject = checkSubject(value.checkKey, readFeedbackSite(metadataOf(input), input.projectId, input.now));
      if (!subject) {
        const name = value.meterName || value.title;
        throw new ApplyError(409, { code: "meter_missing", name }, `${name} is no longer in this site's setup.`);
      }
      input.store.dismissCheck(input.projectId, { key: value.checkKey, title: subject.title, reason: value.reason, suggestionId: suggestion.id }, input.now);
      return { live: true, label: dismissLabel(subject.title) };
    }
  }
  throw invalid();
}

const metadataOf = (input: ApplyInput): MetadataStore => input.context.metadataStore;

async function applyHours(input: ApplyInput, payload: SuggestionPayloads["operating_hours"]): Promise<ApplyResult> {
  const project = metadataOf(input).energyIq.getProject(input.projectId);
  const revision = activeCalendar(metadataOf(input), input.projectId);
  const entry = projectCalendarEntry(revision, localDate(input.now.toISOString(), project.timezone));
  if (!revision || !entry) throw new ApplyError(409, { code: "no_hours" }, "This site has no opening hours yet. Set them in Facility first.");
  const current = weeklyFromEntry(entry);
  const days = WEEK_DAYS.filter(day => payload.weekly[day]);
  const target = (day: (typeof WEEK_DAYS)[number]) => (payload.weekly as WeeklyHours)[day];
  // Another entry in force, or one of these days edited since (to anything but this change): refuse, never overwrite.
  const changedSince = entry.id !== payload.base.entryId
    || days.some(day => !sameRanges(current[day], payload.base.weekly[day] ?? []) && !sameRanges(current[day], target(day)));
  if (changedSince) throw new ApplyError(409, { code: "hours_changed" }, "The hours changed since this suggestion. Send your feedback again.");
  const todo = days.filter(day => !sameRanges(current[day], target(day)));
  // Already as suggested (someone made the same change): nothing to save.
  if (!todo.length) return { live: true };
  const weekly = { ...entry.weekly } as EnergyIqOperatingCalendarEntry["weekly"];
  for (const day of todo) weekly[CALENDAR_DAY[day]] = target(day).map(range => ({ from: range.from, to: range.to }));
  publishCalendar(input, revision, revision.entries.map(item => item.id === entry.id ? { ...item, weekly } : item), "hours_not_saved", "These hours could not be saved.");
  return makeLive(input);
}

async function applyHoliday(input: ApplyInput, payload: SuggestionPayloads["holiday"]): Promise<ApplyResult> {
  const revision = activeCalendar(metadataOf(input), input.projectId);
  // Only an entry that covers the date can hold it; the "latest entry" fallback would put it out of range.
  const entry = (revision?.entries ?? []).find(item => item.owner.kind === "project" && item.effective_from <= payload.date && (!item.effective_to || item.effective_to > payload.date));
  if (!revision || !entry) throw new ApplyError(409, { code: "no_hours_for_date", date: payload.date }, `No opening hours cover ${longDate(payload.date)}. Add hours for that date in Facility first.`);
  const exceptions = [
    ...(entry.exceptions ?? []).filter(item => item.date !== payload.date),
    { date: payload.date, operating: [], label: payload.label, classification: payload.classification ?? "public_holiday" },
  ];
  publishCalendar(input, revision, revision.entries.map(item => item.id === entry.id ? { ...item, exceptions } : item), "day_off_not_saved", "This day off could not be saved.");
  return makeLive(input);
}

function publishCalendar(input: ApplyInput, revision: EnergyIqOperatingCalendarRevision, entries: EnergyIqOperatingCalendarEntry[], code: "hours_not_saved" | "day_off_not_saved", failure: string): void {
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
    throw policyError(code, failure, error);
  }
}

async function applyRate(input: ApplyInput, payload: SuggestionPayloads["electricity_rate"]): Promise<ApplyResult> {
  const project = metadataOf(input).energyIq.getProject(input.projectId);
  const revision = activeTariff(metadataOf(input), input.projectId);
  const own = (revision?.entries ?? []).filter(entry => entry.owner.kind === "project")
    .sort((a, b) => Date.parse(a.effective_from) - Date.parse(b.effective_from));
  if (!revision || !own.length) throw new ApplyError(409, { code: "no_rate" }, "This site has no electricity rate yet. Set it in Facility first.");
  const startMs = localDayStartMs(payload.effectiveFrom, project.timezone);
  const start = new Date(startMs).toISOString();
  const fromMs = (entry: EnergyIqTariffScheduleEntry) => Date.parse(entry.effective_from);
  const toMs = (entry: EnergyIqTariffScheduleEntry) => (entry.effective_to ? Date.parse(entry.effective_to) : Number.POSITIVE_INFINITY);
  const exact = own.find(entry => fromMs(entry) === startMs);
  const covering = own.find(entry => fromMs(entry) <= startMs && toMs(entry) > startMs);
  const template = exact ?? covering ?? [...own].reverse().find(entry => fromMs(entry) < startMs) ?? own[0]!;
  if (template.time_of_use) throw new ApplyError(409, { code: "peak_pricing" }, "This site has peak and off-peak prices. Change the rate in Facility.");
  // The sentence the administrator read named a currency; a rate now kept in another one is not that change.
  if (template.currency !== payload.currency) throw new ApplyError(409, { code: "rate_changed" }, "The electricity rate changed since this suggestion. Send your feedback again.");
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
    throw policyError("rate_not_saved", "This rate could not be saved.", error);
  }
  return makeLive(input);
}

type MeterKind = "meter_not_in_use" | "meter_in_use" | "meter_always_on" | "light_count";

async function applyMeter(input: ApplyInput, kind: MeterKind, payload: { meterId: string; meterName?: string; reason?: string; alwaysOn?: boolean; count?: number }): Promise<ApplyResult> {
  const setup = metadataOf(input).energyIq.projectSetup;
  const draft = setup.getDraft({ project_id: input.projectId, user_id: input.user.id });
  const mapping = draft.document.meter_mapping;
  const rows = mapping?.rows ?? [];
  const index = rows.findIndex(row => row.id === payload.meterId);
  const name = payload.meterName || payload.meterId;
  if (!mapping || index < 0) throw new ApplyError(409, { code: "meter_missing", name }, `${name} is no longer in this site's setup.`);
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
    throw new ApplyError(422, { code: "meter_invalid", name }, `The new setting for ${name} is not valid.`);
  }
  const document: EnergyIqProjectSetupDocument = {
    ...draft.document,
    meter_mapping: { ...mapping, rows: rows.map((row, position) => (position === index ? { ...row, presentation: checked } : row)) },
  };
  try {
    setup.saveDraft({ project_id: input.projectId, expected_revision: draft.revision, user_id: input.user.id, document });
  } catch (error) {
    if (error instanceof Error && error.message === "ENERGYIQ_SETUP_REVISION_CONFLICT") throw new ApplyError(409, { code: "setup_conflict" }, "Someone changed this site's setup at the same time. Try again.");
    throw error;
  }
  return makeLive(input);
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

/**
 * Makes the saved change live, as Facility does after each save. The change is saved either way, so a failure here is
 * not an error: the result says it is not live yet, and why.
 */
async function makeLive(input: ApplyInput): Promise<ApplyResult> {
  try {
    await input.applyProjectChanges(input.context, input.projectId);
    return { live: true };
  } catch (error) {
    const detail = liveDetail(error);
    return { live: false, problem: { code: "not_live", detail }, message: `The change is saved but not live yet. ${LIVE_PROBLEMS[detail]}` };
  }
}

const LIVE_PROBLEMS: Record<Extract<ApplyProblemDetail, "admin_required" | "setup_invalid" | "data_not_ready" | "conflict" | "other">, string> = {
  admin_required: "Only a platform administrator can make changes live.",
  setup_invalid: "The site's setup has a problem. Open Facility to fix it.",
  data_not_ready: "The site's readings are not ready. Try again later.",
  conflict: "Someone changed this site at the same time. Open Facility to make the changes live.",
  other: "Open Facility and choose to make the changes live.",
};

function liveDetail(error: unknown): keyof typeof LIVE_PROBLEMS {
  const text = error instanceof Error ? error.message : "";
  if (/ADMIN|FORBIDDEN/.test(text)) return "admin_required";
  if (/SETUP_INVALID/.test(text)) return "setup_invalid";
  if (/DATA_NOT_READY/.test(text)) return "data_not_ready";
  if (/REVISION|CONFLICT/.test(text)) return "conflict";
  return "other";
}

const POLICY_PROBLEMS = {
  overlap: "It overlaps with other dates.",
  outside_range: "The date is outside the dates these settings cover.",
  bad_time: "One of the times is not valid.",
} as const;

function policyError(code: "hours_not_saved" | "day_off_not_saved" | "rate_not_saved", failure: string, error: unknown): ApplyError {
  const text = error instanceof Error ? error.message : "";
  const detail: keyof typeof POLICY_PROBLEMS | undefined = /OVERLAP/.test(text) ? "overlap"
    : /OUTSIDE_RANGE|EFFECTIVE_RANGE/.test(text) ? "outside_range"
      : /TIME_RANGE|TIME_RANGES|LOCAL_TIME/.test(text) ? "bad_time" : undefined;
  return new ApplyError(422, { code, ...(detail ? { detail } : {}) }, detail ? `${failure} ${POLICY_PROBLEMS[detail]}` : failure);
}
