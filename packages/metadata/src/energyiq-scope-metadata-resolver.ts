import type { DatabaseSync } from "node:sqlite";

import type { EnergyIqMetadataStatus } from "./energyiq-project-setup-store.js";

export type EnergyIqAnalysisPeriod = {
  start: string;
  endExclusive: string;
};

export type EnergyIqScopeMetadataEvidence = {
  metadataRevisionId: string;
  hierarchyRevisionId: string;
  dimension: "area" | "headcount";
  value: number | null;
  status: EnergyIqMetadataStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  timezone: string;
};

export type EnergyIqScopeMetadataMissingReason =
  | "not-configured"
  | "not-effective-for-period"
  | "ambiguous-effective-revisions"
  | "value-changes-within-period"
  | "invalid-value";

export type EnergyIqResolvedScopeMetadataValue =
  | {
    status: EnergyIqMetadataStatus;
    value: number;
    unit: "m2" | "people";
    metadataRevisionIds: string[];
    hierarchyRevisionIds: string[];
    evidence: EnergyIqScopeMetadataEvidence[];
  }
  | {
    status: "missing";
    value: null;
    unit: "m2" | "people";
    reason: EnergyIqScopeMetadataMissingReason;
    guidance: string;
    metadataRevisionIds: string[];
    hierarchyRevisionIds: string[];
    evidence: EnergyIqScopeMetadataEvidence[];
  };

export type EnergyIqScopeMetadataResolution = {
  projectId: string;
  scopeId: string;
  hierarchyRevisionId: string;
  period: EnergyIqAnalysisPeriod;
  timezone: string;
  status: EnergyIqMetadataStatus | "missing";
  area: EnergyIqResolvedScopeMetadataValue;
  headcount: EnergyIqResolvedScopeMetadataValue;
};

export type EnergyIqNormalisedMetricResult =
  | {
    status: EnergyIqMetadataStatus;
    metricId: "energy.usage_per_sqm" | "energy.usage_per_person";
    value: number;
    unit: "kWh/m2" | "kWh/person";
    metadataRevisionIds: string[];
    hierarchyRevisionIds: string[];
    evidence: EnergyIqScopeMetadataEvidence[];
  }
  | {
    status: "missing";
    metricId: "energy.usage_per_sqm" | "energy.usage_per_person";
    value: null;
    unit: "kWh/m2" | "kWh/person";
    reason: EnergyIqScopeMetadataMissingReason | "invalid-energy";
    guidance: string;
    metadataRevisionIds: string[];
    hierarchyRevisionIds: string[];
    evidence: EnergyIqScopeMetadataEvidence[];
  };

export type EnergyIqEnergyNormalisations = {
  eui: EnergyIqNormalisedMetricResult;
  perPax: EnergyIqNormalisedMetricResult;
};

type MetadataRevision = {
  id: string;
  hierarchyRevisionId: string;
  hierarchySequence: number;
  areaSqm: number | null;
  occupantCount: number | null;
  metadataStatus: EnergyIqMetadataStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

type EffectiveMetadataRevision = MetadataRevision & {
  effectiveFromMs: number;
  effectiveToMs: number;
};

type PeriodRevisionResolution = {
  revisions: MetadataRevision[];
  failureReason?: "not-configured" | "not-effective-for-period" | "ambiguous-effective-revisions";
};

export class EnergyIqScopeMetadataResolver {
  constructor(private readonly db: DatabaseSync) {}

  resolveForPeriod(input: {
    projectId: string;
    scopeId: string;
    hierarchyRevisionId: string;
    period: EnergyIqAnalysisPeriod;
    expectedTimezone?: string;
  }): EnergyIqScopeMetadataResolution {
    const release = this.resolvePinnedRelease(input.projectId, input.hierarchyRevisionId);
    if (!release.scopeIds.has(input.scopeId)) {
      throw new Error(`ENERGYIQ_SCOPE_NOT_IN_HIERARCHY_REVISION:${input.scopeId}`);
    }
    const timezone = release.timezone;
    if (input.expectedTimezone && input.expectedTimezone !== timezone) {
      throw new Error("ENERGYIQ_METADATA_TIMEZONE_MISMATCH");
    }
    const periodStart = parseInstant(input.period.start, "ENERGYIQ_METADATA_PERIOD_INVALID");
    const periodEnd = parseInstant(input.period.endExclusive, "ENERGYIQ_METADATA_PERIOD_INVALID");
    if (periodStart >= periodEnd) {
      throw new Error("ENERGYIQ_METADATA_PERIOD_INVALID");
    }
    assertTimeZone(timezone);

    const revisions = this.listRevisions(input.projectId, input.scopeId, release.sequence);
    const periodRevisions = resolvePeriodRevisions({
      revisions,
      periodStart,
      periodEnd,
      timezone,
    });

    const area = resolveDimension({
      dimension: "Area",
      scopeId: input.scopeId,
      unit: "m2",
      timezone,
      revisions: periodRevisions.revisions,
      value: (revision) => revision.areaSqm,
      ...(periodRevisions.failureReason ? { failureReason: periodRevisions.failureReason } : {}),
    });
    const headcount = resolveDimension({
      dimension: "Headcount",
      scopeId: input.scopeId,
      unit: "people",
      timezone,
      revisions: periodRevisions.revisions,
      value: (revision) => revision.occupantCount,
      ...(periodRevisions.failureReason ? { failureReason: periodRevisions.failureReason } : {}),
    });

    return {
      projectId: input.projectId,
      scopeId: input.scopeId,
      hierarchyRevisionId: input.hierarchyRevisionId,
      period: input.period,
      timezone,
      status: combineStatus(area.status, headcount.status),
      area,
      headcount,
    };
  }

  calculateEnergyNormalisations(input: {
    energyKwh: number;
    metadata: EnergyIqScopeMetadataResolution;
  }): EnergyIqEnergyNormalisations {
    return {
      eui: calculateNormalisedMetric({
        energyKwh: input.energyKwh,
        metadata: input.metadata.area,
        metricId: "energy.usage_per_sqm",
        unit: "kWh/m2",
      }),
      perPax: calculateNormalisedMetric({
        energyKwh: input.energyKwh,
        metadata: input.metadata.headcount,
        metricId: "energy.usage_per_person",
        unit: "kWh/person",
      }),
    };
  }

  private resolvePinnedRelease(projectId: string, hierarchyRevisionId: string): {
    sequence: number;
    timezone: string;
    scopeIds: Set<string>;
  } {
    const row = this.db.prepare(`
      SELECT sequence, snapshot_json
      FROM energyiq_hierarchy_revisions
      WHERE project_id = ? AND id = ?
    `).get(projectId, hierarchyRevisionId);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_HIERARCHY_REVISION_NOT_FOUND:${hierarchyRevisionId}`);
    }
    const snapshot = parseRecord(requiredString(row, "snapshot_json"));
    const project = snapshot.project;
    if (!isRecord(project)) throw new Error("ENERGYIQ_HIERARCHY_REVISION_INVALID:project");
    const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];
    return {
      sequence: requiredNumber(row, "sequence"),
      timezone: requiredString(project, "timezone"),
      scopeIds: new Set(nodes.flatMap((node) =>
        isRecord(node) && typeof node.id === "string" ? [node.id] : []
      )),
    };
  }

  private listRevisions(projectId: string, scopeId: string, maximumHierarchySequence: number): MetadataRevision[] {
    return this.db.prepare(`
      SELECT metadata.id, metadata.hierarchy_revision_id, hierarchy.sequence,
             metadata.area_sqm, metadata.occupant_count, metadata.metadata_status,
             metadata.effective_from, metadata.effective_to
      FROM energyiq_node_metadata_revisions metadata
      INNER JOIN energyiq_hierarchy_revisions hierarchy
        ON hierarchy.id = metadata.hierarchy_revision_id
      WHERE metadata.project_id = ? AND metadata.node_id = ?
        AND hierarchy.project_id = ? AND hierarchy.sequence <= ?
      ORDER BY hierarchy.sequence, metadata.id
    `).all(projectId, scopeId, projectId, maximumHierarchySequence).flatMap((row) => {
      if (!isRecord(row)) return [];
      return [{
        id: requiredString(row, "id"),
        hierarchyRevisionId: requiredString(row, "hierarchy_revision_id"),
        hierarchySequence: requiredNumber(row, "sequence"),
        areaSqm: optionalNumber(row.area_sqm),
        occupantCount: optionalNumber(row.occupant_count),
        metadataStatus: requiredMetadataStatus(row.metadata_status),
        effectiveFrom: optionalString(row.effective_from),
        effectiveTo: optionalString(row.effective_to),
      }];
    });
  }
}

const resolveDimension = (input: {
  dimension: "Area" | "Headcount";
  scopeId: string;
  unit: "m2" | "people";
  timezone: string;
  revisions: MetadataRevision[];
  value: (revision: MetadataRevision) => number | null;
  failureReason?: "not-configured" | "not-effective-for-period" | "ambiguous-effective-revisions";
}): EnergyIqResolvedScopeMetadataValue => {
  const dimension = input.dimension === "Area" ? "area" : "headcount";
  const evidence = input.revisions.map((revision) => toEvidence({
    revision,
    dimension,
    value: input.value(revision),
    timezone: input.timezone,
  }));
  const metadataRevisionIds = evidence.map((item) => item.metadataRevisionId);
  const hierarchyRevisionIds = evidence.map((item) => item.hierarchyRevisionId);
  if (input.failureReason) {
    return missingDimension(input, input.failureReason, evidence, metadataRevisionIds, hierarchyRevisionIds);
  }

  const values = input.revisions.map(input.value);
  if (values.some((value) => value === null)) {
    return missingDimension(input, "not-configured", evidence, metadataRevisionIds, hierarchyRevisionIds);
  }
  const numericValues = values.filter((value): value is number => typeof value === "number");
  if (numericValues.length !== values.length
    || numericValues.some((value) => !Number.isFinite(value) || value <= 0)) {
    return missingDimension(input, "invalid-value", evidence, metadataRevisionIds, hierarchyRevisionIds);
  }
  const distinctValues = new Set(numericValues);
  if (distinctValues.size > 1) {
    return missingDimension(input, "value-changes-within-period", evidence, metadataRevisionIds, hierarchyRevisionIds);
  }
  const value = numericValues[0];
  if (value === undefined) {
    return missingDimension(input, "not-configured", evidence, metadataRevisionIds, hierarchyRevisionIds);
  }
  return {
    status: input.revisions.some((revision) => revision.metadataStatus === "provisional")
      ? "provisional"
      : "confirmed",
    value,
    unit: input.unit,
    metadataRevisionIds,
    hierarchyRevisionIds,
    evidence,
  };
};

const resolvePeriodRevisions = (input: {
  revisions: MetadataRevision[];
  periodStart: number;
  periodEnd: number;
  timezone: string;
}): PeriodRevisionResolution => {
  if (input.revisions.length === 0) {
    return { revisions: [], failureReason: "not-configured" };
  }
  const effective = input.revisions.map((revision): EffectiveMetadataRevision => {
    const effectiveFromMs = revision.effectiveFrom
      ? parseEffectiveBoundary(revision.effectiveFrom, input.timezone)
      : Number.NEGATIVE_INFINITY;
    const effectiveToMs = revision.effectiveTo
      ? parseEffectiveBoundary(revision.effectiveTo, input.timezone)
      : Number.POSITIVE_INFINITY;
    if (effectiveFromMs >= effectiveToMs) {
      throw new Error(`ENERGYIQ_METADATA_EFFECTIVE_RANGE_INVALID:${revision.id}`);
    }
    return { ...revision, effectiveFromMs, effectiveToMs };
  });
  const intersecting = effective.filter((revision) =>
    revision.effectiveFromMs < input.periodEnd && input.periodStart < revision.effectiveToMs
  );
  const boundaries = [...new Set([
    input.periodStart,
    input.periodEnd,
    ...intersecting.flatMap((revision) => [revision.effectiveFromMs, revision.effectiveToMs])
      .filter((boundary) => input.periodStart < boundary && boundary < input.periodEnd),
  ])].sort((left, right) => left - right);
  const selected: MetadataRevision[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const segmentStart = boundaries[index]!;
    const segmentEnd = boundaries[index + 1]!;
    const active = effective.filter((revision) =>
      revision.effectiveFromMs <= segmentStart && segmentEnd <= revision.effectiveToMs
    );
    if (active.length === 0) {
      return {
        revisions: uniqueRevisions(intersecting),
        failureReason: "not-effective-for-period",
      };
    }
    if (active.length > 1) {
      const coalesced = coalesceEquivalentRevisions(active);
      if (coalesced) {
        selected.push(coalesced);
        continue;
      }
      return {
        revisions: uniqueRevisions(active),
        failureReason: "ambiguous-effective-revisions",
      };
    }
    selected.push(active[0]!);
  }
  return { revisions: uniqueRevisions(selected) };
};

const coalesceEquivalentRevisions = (
  revisions: EffectiveMetadataRevision[],
): MetadataRevision | null => {
  const first = revisions[0];
  if (!first) return null;
  const equivalent = revisions.every((revision) =>
    revision.areaSqm === first.areaSqm
    && revision.occupantCount === first.occupantCount
    && revision.metadataStatus === first.metadataStatus
    && revision.effectiveFromMs === first.effectiveFromMs
    && revision.effectiveToMs === first.effectiveToMs
  );
  if (!equivalent) return null;
  return [...revisions].sort((left, right) =>
    right.hierarchySequence - left.hierarchySequence || right.id.localeCompare(left.id)
  )[0] ?? null;
};

const uniqueRevisions = (revisions: MetadataRevision[]): MetadataRevision[] => {
  const byId = new Map<string, MetadataRevision>();
  for (const revision of revisions) byId.set(revision.id, revision);
  return [...byId.values()];
};

const missingDimension = (
  input: { dimension: "Area" | "Headcount"; scopeId: string; unit: "m2" | "people" },
  reason: EnergyIqScopeMetadataMissingReason,
  evidence: EnergyIqScopeMetadataEvidence[],
  metadataRevisionIds: string[],
  hierarchyRevisionIds: string[],
): EnergyIqResolvedScopeMetadataValue => ({
  status: "missing",
  value: null,
  unit: input.unit,
  reason,
  guidance: completionGuidance(input.dimension, input.scopeId, reason),
  metadataRevisionIds,
  hierarchyRevisionIds,
  evidence,
});

const completionGuidance = (
  dimension: "Area" | "Headcount",
  scopeId: string,
  reason: EnergyIqScopeMetadataMissingReason,
): string => {
  const field = dimension === "Area" ? "comparison area (m2)" : "24-hour representative headcount";
  if (reason === "ambiguous-effective-revisions") {
    return `Resolve overlapping ${dimension} effective dates for Scope ${scopeId} in Admin > Projects > Structure, then publish a new Project Release.`;
  }
  if (reason === "value-changes-within-period") {
    return `${dimension} changes inside the selected Period for Scope ${scopeId}; split the analysis at the effective-date boundary before calculating this metric.`;
  }
  if (reason === "invalid-value") {
    return `Set ${field} to a value greater than zero for Scope ${scopeId} in Admin > Projects > Structure, then publish a new Project Release.`;
  }
  return `Add ${field} for Scope ${scopeId} in Admin > Projects > Structure, set effective dates that cover the selected Period, then publish a new Project Release.`;
};

const calculateNormalisedMetric = (input: {
  energyKwh: number;
  metadata: EnergyIqResolvedScopeMetadataValue;
  metricId: "energy.usage_per_sqm" | "energy.usage_per_person";
  unit: "kWh/m2" | "kWh/person";
}): EnergyIqNormalisedMetricResult => {
  if (!Number.isFinite(input.energyKwh) || input.energyKwh < 0) {
    return {
      status: "missing",
      metricId: input.metricId,
      value: null,
      unit: input.unit,
      reason: "invalid-energy",
      guidance: "Provide a finite, non-negative total energy value for the selected Scope and Period before calculating this metric.",
      metadataRevisionIds: input.metadata.metadataRevisionIds,
      hierarchyRevisionIds: input.metadata.hierarchyRevisionIds,
      evidence: input.metadata.evidence,
    };
  }
  if (input.metadata.status === "missing") {
    return {
      status: "missing",
      metricId: input.metricId,
      value: null,
      unit: input.unit,
      reason: input.metadata.reason,
      guidance: input.metadata.guidance,
      metadataRevisionIds: input.metadata.metadataRevisionIds,
      hierarchyRevisionIds: input.metadata.hierarchyRevisionIds,
      evidence: input.metadata.evidence,
    };
  }
  return {
    status: input.metadata.status,
    metricId: input.metricId,
    value: input.energyKwh / input.metadata.value,
    unit: input.unit,
    metadataRevisionIds: input.metadata.metadataRevisionIds,
    hierarchyRevisionIds: input.metadata.hierarchyRevisionIds,
    evidence: input.metadata.evidence,
  };
};

const toEvidence = (input: {
  revision: MetadataRevision;
  dimension: "area" | "headcount";
  value: number | null;
  timezone: string;
}): EnergyIqScopeMetadataEvidence => ({
  metadataRevisionId: input.revision.id,
  hierarchyRevisionId: input.revision.hierarchyRevisionId,
  dimension: input.dimension,
  value: input.value,
  status: input.revision.metadataStatus,
  effectiveFrom: input.revision.effectiveFrom,
  effectiveTo: input.revision.effectiveTo,
  timezone: input.timezone,
});

const combineStatus = (
  left: EnergyIqMetadataStatus | "missing",
  right: EnergyIqMetadataStatus | "missing",
): EnergyIqMetadataStatus | "missing" => {
  if (left === "missing" || right === "missing") return "missing";
  if (left === "provisional" || right === "provisional") return "provisional";
  return "confirmed";
};

const parseEffectiveBoundary = (value: string, timezone: string): number => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return zonedStartOfDay(value, timezone);
  }
  return parseInstant(value, "ENERGYIQ_METADATA_EFFECTIVE_DATE_INVALID");
};

const zonedStartOfDay = (date: string, timezone: string): number => {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) throw new Error("ENERGYIQ_METADATA_EFFECTIVE_DATE_INVALID");
  const localAsUtc = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(localAsUtc);
  if (roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() !== month - 1
    || roundTrip.getUTCDate() !== day) {
    throw new Error("ENERGYIQ_METADATA_EFFECTIVE_DATE_INVALID");
  }
  let guess = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const valueOf = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const zonedAsUtc = Date.UTC(
      valueOf("year"),
      valueOf("month") - 1,
      valueOf("day"),
      valueOf("hour"),
      valueOf("minute"),
      valueOf("second"),
    );
    guess = localAsUtc - (zonedAsUtc - guess);
  }
  return guess;
};

const assertTimeZone = (timezone: string): void => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new Error("ENERGYIQ_METADATA_TIMEZONE_INVALID");
  }
};

const parseInstant = (value: string, errorCode: string): number => {
  const calendar = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!calendar) throw new Error(errorCode);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = calendar;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const roundTrip = new Date(0);
  roundTrip.setUTCFullYear(year, month - 1, day);
  roundTrip.setUTCHours(hour, minute, second, 0);
  if (roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() !== month - 1
    || roundTrip.getUTCDate() !== day
    || roundTrip.getUTCHours() !== hour
    || roundTrip.getUTCMinutes() !== minute
    || roundTrip.getUTCSeconds() !== second) {
    throw new Error(errorCode);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(errorCode);
  return parsed;
};

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const optionalNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const requiredMetadataStatus = (value: unknown): EnergyIqMetadataStatus => {
  if (value === "confirmed" || value === "provisional") return value;
  throw new Error("ENERGYIQ_SCOPE_METADATA_INVALID:metadata_status");
};

const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`ENERGYIQ_SCOPE_METADATA_INVALID:${key}`);
  }
  return value;
};

const requiredNumber = (row: Record<string, unknown>, key: string): number => {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`ENERGYIQ_SCOPE_METADATA_INVALID:${key}`);
  }
  return value;
};

const parseRecord = (value: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) return parsed;
  } catch {
    // The stable domain error below is safer than exposing a JSON parser detail.
  }
  throw new Error("ENERGYIQ_HIERARCHY_REVISION_INVALID:snapshot_json");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
