import { configApi } from "../../../lib/config-api";

/** The Project notes heading the advisor and this page both use for facts about the site. */
export const FACTS_HEADING = "## Things the advisor should know";
export const FACT_KINDS = ["afterHours", "alwaysOn", "changes", "upcoming", "other"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
/** English labels stored in the notes, so the advisor reads the same words whatever language the page is in. */
export const FACT_KIND_LABELS: Record<FactKind, string> = { afterHours: "After working hours", alwaysOn: "Must stay on", changes: "Recent change", upcoming: "Coming up", other: "Note" };
export type SiteFact = { date: string; kind: FactKind; text: string; line: string };

const kindOf = (label: string): FactKind => (Object.entries(FACT_KIND_LABELS).find(([, value]) => value.toLowerCase() === label.trim().toLowerCase())?.[0] as FactKind | undefined) ?? "other";

/** Where the facts section sits in the notes: the heading line and the line after its last entry. */
function section(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex(line => line.trim() === FACTS_HEADING);
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^#{1,6}\s/.test(lines[end]!) && !lines[end]!.startsWith("```")) end += 1;
  while (end > start + 1 && !lines[end - 1]!.trim()) end -= 1;
  return { start, end };
}

/** Facts written as "- 2026-09-22 · After working hours: Cleaners work 7–10 pm"; other bullets in the section are kept as notes. */
export function readFacts(notes: string): SiteFact[] {
  const lines = notes.split("\n");
  const found = section(lines);
  if (!found) return [];
  return lines.slice(found.start + 1, found.end).filter(line => /^\s*[-*]\s+\S/.test(line)).map(line => {
    const body = line.replace(/^\s*[-*]\s+/, "");
    const match = /^(\d{4}-\d{2}-\d{2})\s*·\s*([^:]{1,40}):\s*(.+)$/.exec(body);
    return match ? { date: match[1]!, kind: kindOf(match[2]!), text: match[3]!.trim(), line } : { date: "", kind: "other" as const, text: body.trim(), line };
  });
}

/** Adds one dated fact under the heading, creating the section at the end of the notes when it is missing. */
export function addFact(notes: string, kind: FactKind, text: string, date: string): string {
  const entry = `- ${date} · ${FACT_KIND_LABELS[kind]}: ${text.trim().replace(/\s+/g, " ")}`;
  const lines = notes.split("\n");
  const found = section(lines);
  if (!found) return `${notes.trimEnd()}${notes.trim() ? "\n\n" : ""}${FACTS_HEADING}\n\n${entry}\n`;
  lines.splice(found.end, 0, ...(found.end === found.start + 1 ? ["", entry] : [entry]));
  return lines.join("\n");
}

/** Removes exactly one fact line, leaving the rest of the notes untouched. */
export function removeFact(notes: string, fact: SiteFact): string {
  const lines = notes.split("\n");
  const found = section(lines);
  if (!found) return notes;
  const index = lines.findIndex((line, position) => position > found.start && position < found.end && line === fact.line);
  if (index < 0) return notes;
  lines.splice(index, 1);
  return lines.join("\n");
}

/**
 * Saves new Project notes through the shared report settings, refusing when someone else changed them since the page
 * loaded. Project notes apply straight away: the advisor, the map and this page read the same text.
 */
export async function saveProjectNotes(projectId: string, expected: string, next: string): Promise<"saved" | "changed"> {
  const current = await configApi.reportAgentRequest<{ settings: Record<string, unknown> & { contextNotes: string } }>(projectId, "");
  if (current.settings.contextNotes !== expected) return "changed";
  await configApi.reportAgentRequest(projectId, "settings", { method: "PUT", body: JSON.stringify({ ...current.settings, contextNotes: next }) });
  return "saved";
}

/** The notes without the facts section, for places that show the project brief (the facts have their own card). */
export function withoutFacts(notes: string): string {
  const lines = notes.split("\n");
  const found = section(lines);
  if (!found) return notes;
  lines.splice(found.start, found.end - found.start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}
