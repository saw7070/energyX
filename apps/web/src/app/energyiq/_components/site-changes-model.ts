/**
 * Facility → Savings: the changes made on site whose before and after Analysis shows, and what the form needs to
 * record one: the site's groups and meters as the reports know them, the checks a change must pass, and a plain
 * description of what it affects.
 *
 * The shapes match the API (`/api/v1/energy/projects/:id/savings-checks`, and the published project information's
 * `locations` and `meters`) field for field.
 */
import { groupsFromLocations } from "@datafoundry/site-report";

export type SiteChangeDto = { id: string; projectId: string; name: string; changeDate: string; meterIds: string[]; note?: string; createdAt: string };
export type SiteChangesDto = { projectId: string; checks: SiteChangeDto[]; canEdit: boolean };
export type SiteChangeInput = { name: string; changeDate: string; meterIds: string[]; note?: string };
/** The parts of the published project information the form reads. */
export type SiteChangeInformation = {
  meters?: Array<{ id: string; name?: string; location?: string; locationId?: string }>;
  locations?: Array<{ id: string; name: string; parentId?: string | null; sortOrder?: number }>;
};

/** A change may start up to a year ahead: planned work can be recorded before it is done. */
export const MAX_DAYS_AHEAD = 366;
export const MAX_NAME_LENGTH = 120;
export const MAX_NOTE_LENGTH = 500;

export type PickerMeter = { id: string; name: string };
/** A top-level group with every meter filed anywhere inside it. */
export type PickerGroup = { id: string; name: string; meters: PickerMeter[] };
export type Picker = { groups: PickerGroup[]; ungrouped: PickerMeter[] };

const byName = (a: PickerMeter, b: PickerMeter) => a.name.localeCompare(b.name, undefined, { numeric: true });

/** The site's meters by top-level group, in the groups' saved order, for picking what a change affects. */
export function pickerFrom(information: SiteChangeInformation | null): Picker {
  const meters = (information?.meters ?? []).map(meter => ({ id: meter.id, name: meter.name?.trim() || meter.id, groupId: meter.locationId ?? null }));
  const list = groupsFromLocations(information?.locations ?? []);
  const byId = new Map(list.map(group => [group.id, group]));
  const topOf = (id: string | null) => {
    let group = id ? byId.get(id) : undefined;
    for (let depth = 0; group?.parentId && byId.has(group.parentId) && depth < 64; depth += 1) group = byId.get(group.parentId);
    return group ?? null;
  };
  const tops = list.filter(group => !group.parentId)
    .map((group, index) => ({ group, index })).sort((a, b) => (a.group.order ?? Number.MAX_SAFE_INTEGER) - (b.group.order ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map(({ group }) => ({ id: group.id, name: group.name, meters: [] as PickerMeter[] }));
  const ungrouped: PickerMeter[] = [];
  for (const meter of meters) {
    const top = topOf(meter.groupId);
    const target = top ? tops.find(group => group.id === top.id) : undefined;
    (target ? target.meters : ungrouped).push({ id: meter.id, name: meter.name });
  }
  return { groups: tops.filter(group => group.meters.length).map(group => ({ ...group, meters: group.meters.sort(byName) })), ungrouped: ungrouped.sort(byName) };
}

/** Today's date at the site, and the last date a change may start. */
export const localToday = (timeZone = "Asia/Singapore", now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
export const latestStart = (today: string) => new Date(Date.parse(`${today}T00:00:00Z`) + MAX_DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);

export type ChangeDraft = { name: string; changeDate: string; whole: boolean; meterIds: string[]; note: string };
export type ChangeProblem = "name" | "date" | "dateAhead" | "meters";

/** What stops a change from being saved: no name, no real date, a date more than a year ahead, or no meter picked. */
export function changeProblems(draft: ChangeDraft, today: string): ChangeProblem[] {
  const problems: ChangeProblem[] = [];
  if (!draft.name.trim()) problems.push("name");
  const parsed = Date.parse(`${draft.changeDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.changeDate) || Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== draft.changeDate) problems.push("date");
  else if (draft.changeDate > latestStart(today)) problems.push("dateAhead");
  if (!draft.whole && !draft.meterIds.length) problems.push("meters");
  return problems;
}

/** What the API is sent for a draft that passed the checks. */
export const changeInput = (draft: ChangeDraft): SiteChangeInput => ({
  name: draft.name.trim().slice(0, MAX_NAME_LENGTH), changeDate: draft.changeDate, meterIds: draft.whole ? [] : draft.meterIds,
  ...(draft.note.trim() ? { note: draft.note.trim().slice(0, MAX_NOTE_LENGTH) } : {}),
});

export const draftFor = (change: SiteChangeDto | null, today: string): ChangeDraft => change
  ? { name: change.name, changeDate: change.changeDate, whole: change.meterIds.length === 0, meterIds: change.meterIds, note: change.note ?? "" }
  : { name: "", changeDate: today, whole: true, meterIds: [], note: "" };

/**
 * What a change affects, in parts: whole groups named once ("Block 264E"), then the other meters by name. An empty
 * list is the whole site. A meter no longer on the site keeps its id.
 */
export function affectedParts(meterIds: readonly string[], picker: Picker): { site: boolean; groups: string[]; meters: string[] } {
  if (!meterIds.length) return { site: true, groups: [], meters: [] };
  const chosen = new Set(meterIds);
  const whole = picker.groups.filter(group => group.meters.length && group.meters.every(meter => chosen.has(meter.id)));
  const covered = new Set(whole.flatMap(group => group.meters.map(meter => meter.id)));
  const names = new Map([...picker.groups.flatMap(group => group.meters), ...picker.ungrouped].map(meter => [meter.id, meter.name]));
  return { site: false, groups: whole.map(group => group.name), meters: meterIds.filter(id => !covered.has(id)).map(id => names.get(id) ?? id) };
}
