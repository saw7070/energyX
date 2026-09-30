import type { FileAssetService } from "@datafoundry/files";
import type { MetadataStore } from "@datafoundry/metadata";
import { readEnergyAnalysisEligibleCoverage } from "@datafoundry/data-gateway";
import { resolveEnergyPublishedMeterRoute } from "../energy/energy-query-context.js";
import { shiftReportDate, validateReportPeriod, type ReportPeriod } from "./report-calendar.js";
import type { ReportSettings } from "./report-store.js";

export type ReportPeriodPreset = "recent" | "previous-month" | "previous-week" | "previous-day" | "all" | "custom";
export type AvailableReportPeriod = ReportPeriod & { actualLastIntervalEnd: string | null };
const localDate = (instant: number) => new Date(instant + 8 * 3600000).toISOString().slice(0, 10);
export function presetReportPeriod(preset: Exclude<ReportPeriodPreset, "all" | "custom">, now = new Date()): ReportPeriod {
  const today = localDate(now.getTime());
  const month = today.slice(0, 7) + "-01";
  const previousMonth = shiftReportDate(month, -1).slice(0, 7) + "-01";
  if (preset === "recent") return { from: shiftReportDate(today, -28), toExclusive: today };
  if (preset === "previous-month") return { from: previousMonth, toExclusive: month };
  if (preset === "previous-day") return { from: shiftReportDate(today, -1), toExclusive: today };
  const monday = shiftReportDate(today, -((new Date(today).getUTCDay() + 6) % 7));
  return { from: shiftReportDate(monday, -7), toExclusive: monday };
}
/** Interval coverage is a cutoff, not proof that every meter has complete readings. */
export function latestReportPeriod(available: (ReportPeriod & { actualLastIntervalEnd?: string | null }) | null | undefined, now = new Date()): ReportPeriod {
  const today = localDate(now.getTime());
  const cutoff = available?.actualLastIntervalEnd ? localDate(Date.parse(available.actualLastIntervalEnd)) : available?.toExclusive;
  const end = cutoff && cutoff < today ? cutoff : today;
  return { from: shiftReportDate(end, -28), toExclusive: end };
}
function instant(value: string, assumeUtc = false): number {
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) return NaN;
  const date = value.slice(0, 10);
  const day = Date.parse(date + "T00:00:00Z");
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date) return NaN;
  return Date.parse(value.length === 10 ? value + "T00:00:00" + (assumeUtc ? "Z" : "+08:00") : /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value.replace(" ", "T") : value.replace(" ", "T") + (assumeUtc ? "Z" : "+08:00"));
}
function boundsPeriod(start: number, end: number, hasIntervalEnd = true): AvailableReportPeriod | null {
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { from: localDate(start), toExclusive: shiftReportDate(localDate(end - 1), 1), actualLastIntervalEnd: hasIntervalEnd ? new Date(end).toISOString() : null } : null;
}
/** Streaming-style CSV state machine: quoted commas/newlines are not mistaken for rows or columns. */
export function csvAvailablePeriod(text: string): AvailableReportPeriod | null {
  let row: string[] = [], value = "", quoted = false, headers: string[] | undefined;
  let startIndex = -1, endIndex = -1, minimum = Infinity, maximum = -Infinity, invalid = false;
  const record = () => {
    row.push(value); value = "";
    if (!headers) {
      headers = row.map(cell => cell.trim().replace(/^\uFEFF/, "").toLowerCase());
      for (const [start, end] of [["interval_start_utc", "interval_end_utc"], ["interval_start_sgt", "interval_end_sgt"], ["interval_start", "interval_end"], ["timestamp", ""], ["datetime", ""], ["date", ""], ["event_time", ""]]) {
        startIndex = headers.indexOf(start!); if (startIndex >= 0) { endIndex = end ? headers.indexOf(end) : -1; break; }
      }
    } else if (row.some(cell => cell.trim()) && startIndex >= 0) {
      const start = instant((row[startIndex] ?? "").trim(), headers[startIndex]?.endsWith("_utc"));
      const endText = endIndex >= 0 ? (row[endIndex] ?? "").trim() : "";
      const end = endIndex >= 0 ? instant(endText, headers[endIndex]?.endsWith("_utc")) : start + ((row[startIndex]?.trim().length === 10) ? 86400000 : 1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) invalid = true;
      else { minimum = Math.min(minimum, start); maximum = Math.max(maximum, end); }
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
    } else if (character === "," && !quoted) { row.push(value); value = ""; }
    else if (character === "\n" && !quoted) record();
    else if (character !== "\r" || quoted) value += character;
    if (value.length > 1024 * 1024) return null;
  }
  if (value || row.length) record();
  return invalid || quoted ? null : boundsPeriod(minimum, maximum, endIndex >= 0);
}
const cache = new WeakMap<MetadataStore, Map<string, { expires: number; result: Promise<AvailableReportPeriod | null> }>>();
export async function availableReportPeriod(metadata: MetadataStore, files: FileAssetService, settings: ReportSettings, actorUserId: string): Promise<AvailableReportPeriod | null> {
  try {
    const project = metadata.energyIq.getProject(settings.projectId);
    const selected = settings.fileRefIds.map(id => files.getRef({ user_id: actorUserId, workspace_id: settings.workspaceId, id }));
    const key = JSON.stringify([actorUserId, settings.projectId, settings.workspaceId, settings.revision, settings.useProjectData, project.data_snapshot_id, project.hierarchy_revision_id, selected.map(item => [item.ref.id, item.asset.id])]);
    let entries = cache.get(metadata); if (!entries) { entries = new Map(); cache.set(metadata, entries); }
    const saved = entries.get(key); if (saved && saved.expires > Date.now()) return saved.result;
    const result = (async (): Promise<AvailableReportPeriod | null> => {
      const periods: AvailableReportPeriod[] = [];
      if (settings.useProjectData) {
        const route = resolveEnergyPublishedMeterRoute({ metadataStore: metadata, projectId: settings.projectId, hierarchyRevisionId: project.hierarchy_revision_id, scopeId: project.root_scope_id, resource: "electricity" });
        const coverage = await readEnergyAnalysisEligibleCoverage({ metadataStore: metadata, workspaceId: settings.workspaceId, projectId: settings.projectId, dataSnapshotId: project.data_snapshot_id, resource: "electricity", meterAttachments: route.attachments });
        if (!coverage) return null;
        const period = boundsPeriod(Date.parse(coverage.from), Date.parse(coverage.to)); if (!period) return null; periods.push(period);
        if (metadata.energyIq.getProject(settings.projectId).data_snapshot_id !== project.data_snapshot_id) return null;
      }
      for (const item of selected) {
        if (!item.ref.filename.toLowerCase().endsWith(".csv")) continue;
        if (item.asset.size_bytes > 50 * 1024 * 1024) return null;
        const period = csvAvailablePeriod(files.readRef({ user_id: actorUserId, workspace_id: settings.workspaceId, id: item.ref.id }).body.toString("utf8"));
        if (!period) return null; periods.push(period);
      }
      return periods.length ? { from: periods.map(period => period.from).sort()[0]!, toExclusive: periods.map(period => period.toExclusive).sort().at(-1)!, actualLastIntervalEnd: periods.every(period => period.actualLastIntervalEnd) ? periods.map(period => period.actualLastIntervalEnd!).sort().at(-1)! : null } : null;
    })().catch(() => null);
    if (entries.size >= 32) entries.delete(entries.keys().next().value!);
    entries.set(key, { expires: Date.now() + 5 * 60000, result });
    return result;
  } catch { return null; }
}
export function resolveRequestedReportPeriod(input: { period?: ReportPeriod | undefined; preset?: ReportPeriodPreset | undefined; inherited?: ReportPeriod | undefined; available?: (ReportPeriod & { actualLastIntervalEnd?: string | null }) | null | undefined; now?: Date }): ReportPeriod {
  if (input.period) return validateReportPeriod(input.period);
  if (!input.preset && input.inherited) return validateReportPeriod(input.inherited);
  if (input.preset === "custom") throw new Error("REPORT_PERIOD_REQUIRED");
  if (input.preset === "all") {
    if (!input.available) throw new Error("REPORT_AVAILABLE_PERIOD_UNAVAILABLE");
    return validateReportPeriod({ from: input.available.from, toExclusive: input.available.toExclusive });
  }
  return !input.preset || input.preset === "recent" ? latestReportPeriod(input.available, input.now) : presetReportPeriod(input.preset, input.now);
}
