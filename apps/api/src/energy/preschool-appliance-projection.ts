import type { ProjectAnalysisPayload } from "./project-analysis-metadata.js";
import type { PublishedProjectRelease } from "./project-analysis-resolver.js";

const PRESCHOOL_PROJECT_ID = "preschool-demo";
const PRESCHOOL_TIMEZONE = "Asia/Singapore";
const EXPECTED_CENTRE_COUNT = 30;
const RECONCILIATION_TOLERANCE_KWH = 0.01;
const EXPECTED_APPLIANCE_BY_ALIAS = new Map<string, { applianceGroup: string; category: string }>([
  ["Aircon 1", { applianceGroup: "Aircon", category: "aircon" }],
  ["Aircon 2", { applianceGroup: "Aircon", category: "aircon" }],
  ["Heater", { applianceGroup: "Heater", category: "load" }],
  ["Kitchen Lighting", { applianceGroup: "Lighting", category: "light" }],
  ["Living Room Lighting", { applianceGroup: "Lighting", category: "light" }],
  ["Other Lighting3", { applianceGroup: "Lighting", category: "light" }],
  ["Kitchen Plug Load", { applianceGroup: "Plugload", category: "load" }],
  ["Living Area Plug Load", { applianceGroup: "Plugload", category: "load" }],
  ["Plug Load3", { applianceGroup: "Plugload", category: "load" }],
]);

export const PRESCHOOL_EXPECTED_APPLIANCE_ALIAS_COUNT = EXPECTED_APPLIANCE_BY_ALIAS.size;

export const preschoolApplianceContractForAlias = (
  alias: string,
): { applianceGroup: string; category: string } | null => {
  const contract = EXPECTED_APPLIANCE_BY_ALIAS.get(alias);
  return contract ? { ...contract } : null;
};

export const preschoolApplianceAliasForPublishedCircuit = (
  name: string,
  parentScopeId: string | undefined,
): string | null => {
  if (!parentScopeId) return null;
  if (EXPECTED_APPLIANCE_BY_ALIAS.has(name)) return name;
  const prefix = `${parentScopeId}:`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : null;
};

export type PreschoolApplianceProjection = {
  status: "available";
  contract: {
    id: "preschool-may-2026-appliance-ranking";
    version: "1";
    aliasContractId: "preschool-circuit-as-appliance-v1";
    sourceKind: "circuit";
  };
  period: {
    start: string;
    endExclusive: string;
    timezone: string;
  };
  totalKwh: number;
  appliances: Array<{
    name: string;
    applianceGroup: string;
    usageKwh: number;
    sharePct: number;
    centreCount: number;
    sourceCircuitIds: string[];
  }>;
  evidence: {
    projectReleaseId: string;
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    sourceQueryIds: string[];
    projectionRecipeId: "preschool-appliance-ranking-v1";
    sourceKind: "circuit";
    reconciliationGapKwh: number;
  };
} | {
  status: "unavailable";
  reason: {
    code: "PRESCHOOL_APPLIANCE_SNAPSHOT_INCOMPLETE"
      | "PRESCHOOL_APPLIANCE_EVIDENCE_MISMATCH"
      | "PRESCHOOL_APPLIANCE_ALIAS_CONTRACT_UNSUPPORTED"
      | "PRESCHOOL_APPLIANCE_RECONCILIATION_FAILED";
    message: string;
  };
  evidence: {
    projectReleaseId: string;
    dataSnapshotId: string;
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    sourceKind: "circuit";
  };
};

export const buildPreschoolApplianceProjection = (input: {
  projectRelease: PublishedProjectRelease;
  period: {
    start: string;
    endExclusive: string;
  };
  timezone: string;
  analysis: ProjectAnalysisPayload;
}): PreschoolApplianceProjection => {
  const evidence = unavailableEvidence(input);
  if (input.analysis.dataHealth.status !== "complete") {
    return unavailable(
      "PRESCHOOL_APPLIANCE_SNAPSHOT_INCOMPLETE",
      "Appliance ranking is unavailable because the current Portfolio window is not complete.",
      evidence,
    );
  }
  if (!hasExpectedEvidencePins(input)) {
    return unavailable(
      "PRESCHOOL_APPLIANCE_EVIDENCE_MISMATCH",
      "Appliance ranking was withheld because the Snapshot, Release, Hierarchy or Mapping pins do not match.",
      evidence,
    );
  }

  const officialCircuits = input.analysis.circuits.filter((circuit) => circuit.includedInOfficialTotal);
  const grouped = new Map<string, {
    applianceGroup: string;
    usageKwh: number;
    centreIds: Set<string>;
    sourceCircuitIds: string[];
  }>();
  for (const circuit of officialCircuits) {
    const alias = preschoolApplianceAliasForPublishedCircuit(circuit.name, circuit.parentScopeId);
    const expected = alias ? EXPECTED_APPLIANCE_BY_ALIAS.get(alias) : undefined;
    if (!alias || !expected || circuit.category !== expected.category || !circuit.parentScopeId) {
      return unavailable(
        "PRESCHOOL_APPLIANCE_ALIAS_CONTRACT_UNSUPPORTED",
        "The published Circuit aliases do not match the accepted Preschool Appliance contract.",
        evidence,
      );
    }
    const row = grouped.get(alias) ?? {
      applianceGroup: expected.applianceGroup,
      usageKwh: 0,
      centreIds: new Set<string>(),
      sourceCircuitIds: [],
    };
    row.usageKwh += circuit.usageKwh;
    row.centreIds.add(circuit.parentScopeId);
    row.sourceCircuitIds.push(circuit.meterNodeId);
    grouped.set(alias, row);
  }
  if (grouped.size !== EXPECTED_APPLIANCE_BY_ALIAS.size
    || officialCircuits.length !== EXPECTED_APPLIANCE_BY_ALIAS.size * EXPECTED_CENTRE_COUNT
    || [...grouped.values()].some((row) => (
      row.centreIds.size !== EXPECTED_CENTRE_COUNT
      || row.sourceCircuitIds.length !== EXPECTED_CENTRE_COUNT
    ))) {
    return unavailable(
      "PRESCHOOL_APPLIANCE_ALIAS_CONTRACT_UNSUPPORTED",
      "Appliance ranking requires the same nine published Circuit aliases across all 30 Centres.",
      evidence,
    );
  }

  const projectedTotalKwh = [...grouped.values()].reduce((sum, row) => sum + row.usageKwh, 0);
  const reconciliationGapKwh = round(projectedTotalKwh - input.analysis.summary.usageKwh);
  if (Math.abs(reconciliationGapKwh) > RECONCILIATION_TOLERANCE_KWH) {
    return unavailable(
      "PRESCHOOL_APPLIANCE_RECONCILIATION_FAILED",
      "Appliance ranking was withheld because its Circuit total does not reconcile to the official Portfolio total.",
      evidence,
    );
  }

  return {
    status: "available",
    contract: {
      id: "preschool-may-2026-appliance-ranking",
      version: "1",
      aliasContractId: "preschool-circuit-as-appliance-v1",
      sourceKind: "circuit",
    },
    period: {
      start: input.period.start,
      endExclusive: input.period.endExclusive,
      timezone: input.timezone,
    },
    totalKwh: round(input.analysis.summary.usageKwh),
    appliances: [...grouped.entries()]
      .map(([name, row]) => ({
        name,
        applianceGroup: row.applianceGroup,
        usageKwh: round(row.usageKwh),
        sharePct: percent(row.usageKwh, input.analysis.summary.usageKwh),
        centreCount: row.centreIds.size,
        sourceCircuitIds: [...row.sourceCircuitIds].sort((left, right) => left.localeCompare(right)),
      }))
      .sort((left, right) => right.usageKwh - left.usageKwh || left.name.localeCompare(right.name)),
    evidence: {
      ...evidence,
      sourceQueryIds: [...input.analysis.provenance.queryIds],
      projectionRecipeId: "preschool-appliance-ranking-v1",
      reconciliationGapKwh,
    },
  };
};

const hasExpectedEvidencePins = (input: Parameters<typeof buildPreschoolApplianceProjection>[0]): boolean => (
  input.projectRelease.projectId === PRESCHOOL_PROJECT_ID
  && input.projectRelease.renderer.key === "preschool-overview"
  && supportedOverviewPeriod(input.period)
  && input.timezone === PRESCHOOL_TIMEZONE
  && input.analysis.context.projectId === PRESCHOOL_PROJECT_ID
  && input.analysis.context.dataSnapshotId === input.analysis.provenance.dataSnapshotId
  && input.analysis.context.hierarchyRevisionId === input.projectRelease.hierarchyRevisionId
  && input.analysis.context.meterMappingRevisionId === input.projectRelease.meterMappingRevisionId
  && input.analysis.provenance.hierarchyRevisionId === input.projectRelease.hierarchyRevisionId
  && input.analysis.provenance.meterMappingRevisionId === input.projectRelease.meterMappingRevisionId
);

const supportedOverviewPeriod = (period: { start: string; endExclusive: string }): boolean => {
  const durationDays = (Date.parse(period.endExclusive) - Date.parse(period.start)) / 86_400_000;
  return Number.isInteger(durationDays) && durationDays >= 28 && durationDays <= 31;
};

const unavailableEvidence = (input: Parameters<typeof buildPreschoolApplianceProjection>[0]) => ({
  projectReleaseId: input.projectRelease.id,
  dataSnapshotId: input.analysis.provenance.dataSnapshotId,
  hierarchyRevisionId: input.projectRelease.hierarchyRevisionId,
  meterMappingRevisionId: input.projectRelease.meterMappingRevisionId,
  sourceKind: "circuit" as const,
});

const unavailable = (
  code: Extract<PreschoolApplianceProjection, { status: "unavailable" }>["reason"]["code"],
  message: string,
  evidence: Extract<PreschoolApplianceProjection, { status: "unavailable" }>["evidence"],
): PreschoolApplianceProjection => ({ status: "unavailable", reason: { code, message }, evidence });

const round = (value: number): number => Math.round(value * 10_000) / 10_000;
const percent = (part: number, total: number): number => total > 0 ? round((part / total) * 100) : 0;
