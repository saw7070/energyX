/**
 * What the report feedback AI is told about a site, and the settings its suggestions change: the meters, the hours
 * and holidays in use, and the electricity rate in use.
 *
 * Hours and rate are read from the version in use for editing (the one Facility edits and makes live), so a
 * suggestion is worded against, and applied to, the same version.
 */
import type {
  EnergyIqOperatingCalendarEntry,
  EnergyIqOperatingCalendarRevision,
  EnergyIqOperatingDay,
  EnergyIqTariffScheduleEntry,
  EnergyIqTariffScheduleRevision,
  MetadataStore,
} from "@datafoundry/metadata";
import { buildEnergyProjectInformation } from "../energy/energy-project-information.js";
import { localDate } from "./report-feedback-store.js";

export const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type WeekDay = (typeof WEEK_DAYS)[number];
export type TimeRange = { from: string; to: string };
export type WeeklyHours = Record<WeekDay, TimeRange[]>;

export const CALENDAR_DAY: Record<WeekDay, EnergyIqOperatingDay> = {
  mon: "monday", tue: "tuesday", wed: "wednesday", thu: "thursday", fri: "friday", sat: "saturday", sun: "sunday",
};

export type FeedbackSiteMeter = { id: string; name: string; group: string; notInUse?: string; alwaysOn?: true; neverUsed?: true; lightCount?: number };

export type FeedbackSite = {
  projectName: string;
  timezone: string;
  today: string;
  meters: FeedbackSiteMeter[];
  /** The project's own hours in use today (or its latest), as the site sees them, and the calendar entry they are in. */
  hours: { meaning: "opening" | "lights_on"; weekly: WeeklyHours; effectiveFrom: string; entryId: string } | null;
  /** Holidays and closures from today on, for the next few months. */
  upcomingClosures: Array<{ date: string; label: string; classification: string | null }>;
  /** The project's own rate in use today (or its latest). */
  electricityRate: { currency: string; ratePerKwh: number; from: string; taxBasis: string | null; peakPricing: boolean } | null;
};

/** Most meters described to the model; a site rarely has more. */
const MAX_METERS = 300;
const CLOSURE_DAYS = 120;

export const shiftDate = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The calendar version Facility edits: the one selected for the project, else the project's original. */
export function activeCalendar(metadata: MetadataStore, projectId: string): EnergyIqOperatingCalendarRevision | null {
  const project = metadata.energyIq.getProject(projectId);
  const version = metadata.energyIq.operationalPolicy.getActivePolicyVersions(projectId).business_calendar_version ?? project.business_calendar_version;
  if (!version) return null;
  try {
    const revision = metadata.energyIq.operationalPolicy.getOperatingCalendar(version);
    return revision.project_id === projectId ? revision : null;
  } catch {
    return null;
  }
}

/** The tariff version Facility edits: the one selected for the project, else the project's original. */
export function activeTariff(metadata: MetadataStore, projectId: string): EnergyIqTariffScheduleRevision | null {
  const project = metadata.energyIq.getProject(projectId);
  const version = metadata.energyIq.operationalPolicy.getActivePolicyVersions(projectId).tariff_schedule_version ?? project.tariff_schedule_version;
  if (!version) return null;
  try {
    const revision = metadata.energyIq.operationalPolicy.getTariffSchedule(version);
    return revision.project_id === projectId ? revision : null;
  } catch {
    return null;
  }
}

/** The project's own calendar entry in force on a date, else its latest one. */
export function projectCalendarEntry(revision: EnergyIqOperatingCalendarRevision | null, date: string): EnergyIqOperatingCalendarEntry | null {
  const own = (revision?.entries ?? []).filter(entry => entry.owner.kind === "project");
  return own.find(entry => entry.effective_from <= date && (!entry.effective_to || entry.effective_to > date))
    ?? [...own].sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0]
    ?? null;
}

/** The project's own tariff entry in force at an instant, else its latest one. */
export function projectTariffEntry(revision: EnergyIqTariffScheduleRevision | null, instantMs: number): EnergyIqTariffScheduleEntry | null {
  const own = (revision?.entries ?? []).filter(entry => entry.owner.kind === "project");
  return own.find(entry => Date.parse(entry.effective_from) <= instantMs && (!entry.effective_to || Date.parse(entry.effective_to) > instantMs))
    ?? [...own].sort((a, b) => Date.parse(b.effective_from) - Date.parse(a.effective_from))[0]
    ?? null;
}

export const weeklyFromEntry = (entry: EnergyIqOperatingCalendarEntry): WeeklyHours =>
  Object.fromEntries(WEEK_DAYS.map(day => [day, (entry.weekly[CALENDAR_DAY[day]] ?? []).map(range => ({ from: range.from, to: range.to }))])) as WeeklyHours;

/** Everything the model is told about the site. Meters come from the published setup, as the reports see them. */
export function readFeedbackSite(metadata: MetadataStore, projectId: string, now = new Date()): FeedbackSite {
  const project = metadata.energyIq.getProject(projectId);
  const timezone = project.timezone || "UTC";
  const today = localDate(now.toISOString(), timezone);
  let meters: FeedbackSiteMeter[] = [];
  let projectName = project.name;
  try {
    const information = buildEnergyProjectInformation(metadata, projectId);
    projectName = information.name;
    meters = information.meters.slice(0, MAX_METERS).map(meter => ({
      id: meter.id, name: meter.name, group: meter.location,
      ...(meter.notInUse ? { notInUse: meter.notInUse } : {}),
      ...(meter.alwaysOn ? { alwaysOn: true as const } : {}),
      ...(meter.neverUsed ? { neverUsed: true as const } : {}),
      ...(meter.lightCount ? { lightCount: meter.lightCount } : {}),
    }));
  } catch {
    // A project with nothing published yet has no meters to describe; the rest still helps.
  }
  const calendar = activeCalendar(metadata, projectId);
  const entry = projectCalendarEntry(calendar, today);
  const until = shiftDate(today, CLOSURE_DAYS);
  const upcomingClosures = (calendar?.entries ?? []).filter(item => item.owner.kind === "project")
    .flatMap(item => item.exceptions ?? [])
    .filter(item => item.date >= today && item.date <= until && item.operating.length === 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 30)
    .map(item => ({ date: item.date, label: item.label ?? "Closed", classification: item.classification ?? null }));
  const tariff = projectTariffEntry(activeTariff(metadata, projectId), now.getTime());
  return {
    projectName, timezone, today, meters,
    hours: entry ? { meaning: entry.hours_meaning === "lights_on" ? "lights_on" : "opening", weekly: weeklyFromEntry(entry), effectiveFrom: entry.effective_from, entryId: entry.id } : null,
    upcomingClosures,
    electricityRate: tariff ? {
      currency: tariff.currency, ratePerKwh: tariff.rate_per_kwh, from: localDate(tariff.effective_from, timezone),
      taxBasis: tariff.rate_basis ?? null, peakPricing: !!tariff.time_of_use,
    } : null,
  };
}
