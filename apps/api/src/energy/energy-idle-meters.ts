import type { MetadataStore } from "@datafoundry/metadata";
import { readOnlineMeters } from "./energy-live-status.js";

/**
 * Which quiet meters are idle rather than stopped.
 *
 * A Tuya meter sends its running total only when it moves, so a meter that uses nothing goes as quiet as one that lost
 * power. The 15-minute live check tells them apart: a quiet meter Tuya still has online is using nothing (idle). That is
 * only believable for a meter that can rightly use nothing for half a day or more, so two kinds never count as idle and
 * are treated exactly as before (quiet for half a day is stopped):
 * - a meter marked always on by design (presentation.always_on), such as emergency lighting, which must never stop;
 * - lighting on a site that uses lights-on hours. Those lights should come on every night, and the half a day of quiet
 *   it takes to call a meter stopped nearly always reaches into lights-on hours, so a lighting circuit whose total stops
 *   moving most likely has lights that did not come on: the fault such a site most needs to hear about.
 */
export type IdleMeterRow = { id: string; category?: string; presentation?: { always_on?: string } };

/** Of the meters online now, the ones whose quiet spell means they are using nothing (see above). */
export const idleWhenQuietMeters = (online: ReadonlySet<string>, rows: readonly IdleMeterRow[], lightsOnHours: boolean): Set<string> => {
  const mustRun = new Set(rows
    .filter((row) => row.presentation?.always_on === "true" || (lightsOnHours && row.category === "light"))
    .map((row) => row.id));
  return new Set([...online].filter((id) => !mustRun.has(id)));
};

/** The site-local date (YYYY-MM-DD) at an instant. */
const localDate = (instant: number, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));

/** Whether any calendar entry in effect on a site-local date (YYYY-MM-DD) gives lights-on hours. */
export const lightsOnHoursOn = (entries: ReadonlyArray<{ effective_from: string; effective_to?: string; hours_meaning?: string }>, today: string): boolean =>
  entries.some((entry) => entry.hours_meaning === "lights_on" && entry.effective_from <= today && (!entry.effective_to || today < entry.effective_to));

/** Whether the site's published calendar has lights-on hours in effect on a site-local date. */
const usesLightsOnHours = (metadataStore: MetadataStore, projectId: string, today: string): boolean => {
  const project = metadataStore.energyIq.getProject(projectId);
  const published = metadataStore.energyIq.templates.getLatestProjectRevision(projectId);
  const version = published ? published.business_calendar_version : project.business_calendar_version;
  if (!version) return false;
  try {
    return lightsOnHoursOn(metadataStore.energyIq.operationalPolicy.getOperatingCalendar(version).entries, today);
  } catch (error) {
    // A calendar that was never saved means opening hours, as everywhere else.
    if (error instanceof Error && /^ENERGYIQ_OPERATING_CALENDAR_REVISION_NOT_FOUND:/.test(error.message)) return false;
    throw error;
  }
};

/**
 * The meters of a project whose quiet spell, right now, means they are using nothing rather than stopped: online at the
 * latest live check (readOnlineMeters) and able to rightly use nothing (idleWhenQuietMeters). Empty without a live
 * connection or a recent check, so every quiet meter is then treated as stopped, as before.
 */
export const readIdleWhenQuietMeters = (input: { metadataStore: MetadataStore; projectId: string; now?: number }): Set<string> => {
  const now = input.now ?? Date.now();
  const online = readOnlineMeters({ db: input.metadataStore.db, projectId: input.projectId, now });
  if (!online.size) return online;
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const revision = input.metadataStore.energyIq.projectSetup.listHierarchyRevisions(input.projectId).find((candidate) => candidate.id === project.hierarchy_revision_id);
  const rows = revision ? (JSON.parse(revision.snapshot_json) as { meter_mapping?: { rows?: IdleMeterRow[] } }).meter_mapping?.rows ?? [] : [];
  return idleWhenQuietMeters(online, rows, usesLightsOnHours(input.metadataStore, input.projectId, localDate(now, project.timezone)));
};
