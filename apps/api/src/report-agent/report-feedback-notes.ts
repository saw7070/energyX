/**
 * What the report feedback AI remembers also goes to the advisor: each active memory item, and each open follow-up,
 * is one line in the project's notes under "## Things the advisor should know", the section every advisor run reads
 * and the Project notes page lists as facts. Lines use the format of apps/web/.../advisor-facts-model.ts:
 *
 *   - 2026-11-18 · Note: The pavilion fan must never run.
 *   - 2026-11-18 · Coming up: Follow up: Check the pavilion lights go off at 7:10 am.
 *
 * Notes are saved through the report settings with their revision check, so an edit someone made at the same time
 * is never overwritten. When the report agent is not running on this server, the notes are left alone.
 */
import type { MetadataStore } from "@datafoundry/metadata";
import { findReportService } from "./report-service.js";
import type { ReportSettings, ReportStore } from "./report-store.js";
import { oneLine } from "./report-feedback-suggestions.js";

export const FACTS_HEADING = "## Things the advisor should know";
/** The advisor-facts labels for "other" and "upcoming" facts (FACT_KIND_LABELS in advisor-facts-model.ts). */
const MEMORY_LABEL = "Note";
const FOLLOW_UP_LABEL = "Coming up";
/** Report settings refuse notes longer than this. */
const MAX_NOTES = 100_000;

export const memoryNoteLine = (date: string, text: string): string => `- ${date} · ${MEMORY_LABEL}: ${oneLine(text)}`;
export const followUpNoteLine = (date: string, text: string): string => `- ${date} · ${FOLLOW_UP_LABEL}: Follow up: ${oneLine(text)}`;

/** Where the facts section sits: the heading line and the line after its last entry (as advisor-facts-model.ts). */
function section(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex(line => line.trim() === FACTS_HEADING);
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end]!) && !lines[end]!.startsWith("```")) end += 1;
  while (end > start + 1 && !lines[end - 1]!.trim()) end -= 1;
  return { start, end };
}

/** Adds one line under the heading, creating the section at the end of the notes when it is missing. */
export function addNoteLine(notes: string, line: string): string {
  const lines = notes.split("\n");
  const found = section(lines);
  if (!found) return `${notes.trimEnd()}${notes.trim() ? "\n\n" : ""}${FACTS_HEADING}\n\n${line}\n`;
  if (lines.slice(found.start + 1, found.end).includes(line)) return notes;
  lines.splice(found.end, 0, ...(found.end === found.start + 1 ? ["", line] : [line]));
  return lines.join("\n");
}

/** Removes exactly one line from the section; a line someone has since edited by hand is left as they wrote it. */
export function removeNoteLine(notes: string, line: string): string {
  const lines = notes.split("\n");
  const found = section(lines);
  if (!found) return notes;
  const index = lines.findIndex((candidate, position) => position > found.start && position < found.end && candidate === line);
  if (index < 0) return notes;
  lines.splice(index, 1);
  return lines.join("\n");
}

export type NotesStore = Pick<ReportStore, "settings" | "saveSettings">;

/**
 * Adds and removes lines in the project's notes. Retries once when someone else saved the settings at the same time.
 * Never throws: the feedback itself is already saved, and the notes are a convenience for the advisor.
 */
export function updateAdvisorNotes(input: {
  metadata: MetadataStore;
  projectId: string;
  workspaceId: string;
  actorUserId: string;
  add: string[];
  remove: string[];
  store?: NotesStore | undefined;
}): boolean {
  if (!input.add.length && !input.remove.length) return true;
  const store = input.store ?? findReportService(input.metadata)?.store;
  if (!store) return false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const current = store.settings(input.projectId) ?? defaultSettings(input);
      let next = current.contextNotes ?? "";
      for (const line of input.remove) next = removeNoteLine(next, line);
      for (const line of input.add) next = addNoteLine(next, line);
      if (next === current.contextNotes) return true;
      if (next.length > MAX_NOTES) return false;
      // The settings keep their owner, so a notes change never changes who the automatic reports run as.
      store.saveSettings({ ...current, contextNotes: next });
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === "REPORT_SETTINGS_CHANGED" && attempt === 0) continue;
      console.warn(`[report-feedback] project notes not updated project=${input.projectId} code=${error instanceof Error ? error.message : "unknown"}`);
      return false;
    }
  }
  return false;
}

function defaultSettings(input: { metadata: MetadataStore; projectId: string; actorUserId: string }): ReportSettings {
  const project = input.metadata.energyIq.getProject(input.projectId);
  return {
    projectId: input.projectId, workspaceId: project.workspace_id, actorUserId: input.actorUserId, timezone: project.timezone,
    contextNotes: "", fileRefIds: [], useProjectData: true, skill: "", revision: 0, frequency: "off", localHour: 3, scheduledPrompt: "",
  };
}
