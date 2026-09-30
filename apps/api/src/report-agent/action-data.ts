import {
  ensureEnergyScopedDataSource,
  readEnergyScopedActionIntervals,
} from "@datafoundry/data-gateway";
import type { MetadataStore } from "@datafoundry/metadata";
import {
  resolveEnergyQueryContext,
  resolveEnergyPublishedMeterRoute,
} from "../energy/energy-query-context.js";
import { resolveEnergyProjectCapabilities } from "../energy/energy-project-capabilities.js";
import {
  validateReportPeriod,
  shiftReportDate,
  type ReportPeriod,
} from "./report-calendar.js";
import type { ActionScope } from "./action-store.js";
import type { ObservedDay } from "./action-analysis.js";
export type ActionEvidence = {
  snapshotId: string;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  timezone: string;
  period: ReportPeriod;
  meterId: string;
  meterIds?: string[];
  components?: ActionEvidence[];
  days: ObservedDay[];
  capturedAt: string;
  actualLastIntervalEnd: string | null;
};
export type Interval = {
  meterId: string;
  startMs: number;
  endMs: number;
  kwh: number | null;
  quality: string;
};
export function localDate(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (key: string) => parts.find((p) => p.type === key)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function midnight(date: string, timezone: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  const f = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const candidates: number[] = [];
  for (let offset = -840; offset <= 840; offset += 15) {
    const candidate = target - offset * 60000;
    if (f.format(new Date(candidate)) === `${date} 00:00`)
      candidates.push(candidate);
  }
  if (candidates.length !== 1)
    throw new Error("ENERGYIQ_ACTION_DAY_BOUNDARY_UNSUPPORTED");
  return candidates[0]!;
}
/** Whole local days only; duplicates, overlaps, gaps, bad quality and coarse intervals invalidate a day. */
export function actionDays(
  rows: Interval[],
  period: ReportPeriod,
  meterId: string,
  timezone: string,
): ObservedDay[] {
  validateReportPeriod(period);
  if (
    (Date.parse(period.toExclusive) - Date.parse(period.from)) / 86400000 >
    90
  )
    throw new Error("ENERGYIQ_ACTION_WINDOW_TOO_LARGE");
  const result: ObservedDay[] = [];
  for (
    let date = period.from;
    date < period.toExclusive;
    date = shiftReportDate(date, 1)
  ) {
    const start = midnight(date, timezone),
      end = midnight(shiftReportDate(date, 1), timezone);
    const intervals = rows
      .filter(
        (r) => r.meterId === meterId && r.startMs < end && r.endMs > start,
      )
      .sort((a, b) => a.startMs - b.startMs);
    let cursor = start,
      valid = true,
      kwh = 0;
    for (const r of intervals) {
      if (
        r.startMs !== cursor ||
        r.endMs <= r.startMs ||
        r.endMs > end ||
        r.endMs - r.startMs > 3600000 ||
        r.quality !== "ok" ||
        r.kwh === null ||
        !Number.isFinite(r.kwh) ||
        r.kwh < 0
      ) {
        valid = false;
        break;
      }
      cursor = r.endMs;
      kwh += r.kwh;
    }
    valid = valid && cursor === end;
    result.push({
      date,
      dayType: `weekday-${new Date(date).getUTCDay()}`,
      expectedMinutes: (end - start) / 60000,
      validMinutes: valid ? (end - start) / 60000 : 0,
      criticalGap: !valid,
      kwh: valid ? kwh : null,
    });
  }
  return result;
}
export async function readActionEvidence(
  metadata: MetadataStore,
  scope: ActionScope,
  meterId: string,
  period: ReportPeriod,
): Promise<ActionEvidence> {
  if (
    !resolveEnergyProjectCapabilities({ metadataStore: metadata, ...scope })
      .readExplorer
  )
    throw new Error("ACTION_NOT_FOUND");
  validateReportPeriod(period);
  if (
    (Date.parse(period.toExclusive) - Date.parse(period.from)) / 86400000 >
    90
  )
    throw new Error("ENERGYIQ_ACTION_WINDOW_TOO_LARGE");
  const context = resolveEnergyQueryContext({
    metadataStore: metadata,
    user: metadata.users.getById({ user_id: scope.userId }),
    workspaceId: scope.workspaceId,
    request: {
      projectId: scope.projectId,
      resource: "electricity",
      period: "Custom",
      from: period.from,
      to: shiftReportDate(period.toExclusive, -1),
    },
  });
  const route = resolveEnergyPublishedMeterRoute({
    metadataStore: metadata,
    projectId: scope.projectId,
    hierarchyRevisionId: context.hierarchyRevisionId,
    scopeId: context.scopeId,
    resource: "electricity",
    expectedMeterMappingRevisionId: context.meterMappingRevisionId,
  });
  const attachment = route.attachments.find((a) => a.meterPointId === meterId);
  if (!attachment) throw new Error("ACTION_METER_INVALID");
  const source = await ensureEnergyScopedDataSource({
    metadataStore: metadata,
    userId: scope.userId,
    context: { ...context, meterAttachments: [attachment] },
  });
  const rows = await readEnergyScopedActionIntervals(source);
  const project = metadata.energyIq.getProject(scope.projectId);
  if (
    project.data_snapshot_id !== context.dataSnapshotId ||
    project.hierarchy_revision_id !== context.hierarchyRevisionId
  )
    throw new Error("ACTION_DATA_CHANGED");
  return {
    snapshotId: context.dataSnapshotId,
    hierarchyRevisionId: context.hierarchyRevisionId,
    meterMappingRevisionId: context.meterMappingRevisionId,
    timezone: project.timezone,
    period,
    meterId,
    days: actionDays(rows, period, meterId, project.timezone),
    capturedAt: new Date().toISOString(),
    actualLastIntervalEnd: rows.length
      ? new Date(Math.max(...rows.map((r) => r.endMs))).toISOString()
      : null,
  };
}

/** Preserve each circuit; aggregate complete common local days only. */
export async function readActionGroupEvidence(metadata: MetadataStore, scope: ActionScope, meterIds: string[], period: ReportPeriod, read = readActionEvidence): Promise<ActionEvidence> {
 const ids=[...new Set(meterIds)].sort();
 if(!ids.length || ids.length>30) throw new Error("ACTION_METER_INVALID");
 const parts:ActionEvidence[]=[];
 for(const id of ids) parts.push(await read(metadata,scope,id,period));
 const first=parts[0]!;
 if(parts.length===1)return first;
 if(parts.some(p=>p.snapshotId!==first.snapshotId || p.hierarchyRevisionId!==first.hierarchyRevisionId || p.meterMappingRevisionId!==first.meterMappingRevisionId || p.timezone!==first.timezone))throw new Error("ACTION_DATA_CHANGED");
 const days=first.days.map(day=>{
 const rows=parts.map(p=>p.days.find(d=>d.date===day.date));
 const complete=rows.every(d=>d && !d.criticalGap && d.validMinutes===d.expectedMinutes && d.expectedMinutes===day.expectedMinutes && d.kwh!==null);
 return {...day,validMinutes:complete?day.expectedMinutes:0,criticalGap:!complete,kwh:complete?rows.reduce((sum,d)=>sum+d!.kwh!,0):null};
 });
 return {...first,meterId:`group:${ids.join(",")}`,meterIds:ids,components:parts,days,actualLastIntervalEnd:parts.every(p=>p.actualLastIntervalEnd)?parts.map(p=>p.actualLastIntervalEnd!).sort()[0]!:null};
}
