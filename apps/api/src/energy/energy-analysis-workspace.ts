import {
  ensureEnergyScopedDataSource,
  type EnergyScopedDataSource,
  type EnergyScopedScopeDimension,
} from "@datafoundry/data-gateway";
import type { EnergyAnalysisSemantics } from "@datafoundry/agent-runtime";
import type {
  EnergyIqProjectSetupDocument,
  MetadataStore,
} from "@datafoundry/metadata";

import type {
  EnergyPublishedMeterRoute,
  EnergyQueryContext,
} from "./energy-query-context.js";

export type EnergyIqAnalysisWorkspace = {
  identity: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    resource: EnergyQueryContext["resource"];
    dataSnapshotId: string;
    dataCutoff: string;
    hierarchyRevisionId: string;
  };
  scopedDatasource: EnergyScopedDataSource;
  scopeDimensions: EnergyScopedScopeDimension[];
  semantics: EnergyAnalysisSemantics;
};

/**
 * Build the server-authoritative EnergyIQ read workspace used by the full
 * Analyst. The Interface keeps authorization and hierarchy pins together so a
 * caller cannot accidentally expose current facts with metadata from another
 * Project release.
 */
export const ensureEnergyIqAnalysisWorkspace = async (input: {
  metadataStore: MetadataStore;
  userId: string;
  context: EnergyQueryContext;
  publishedMeterRoute: EnergyPublishedMeterRoute;
  databasePath?: string;
}): Promise<EnergyIqAnalysisWorkspace> => {
  const scopeDimensions = resolveEnergyIqPublishedScopeDimensions({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    scopeId: input.context.scopeId,
    hierarchyRevisionId: input.context.hierarchyRevisionId,
  });
  const scopedDatasource = await ensureEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    context: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      meterAttachments: input.publishedMeterRoute.attachments,
      scopeDimensions,
      resource: input.context.resource,
      from: input.context.from,
      to: input.context.to,
      timezone: input.context.timezone,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      meterMappingRevisionId: input.publishedMeterRoute.meterMappingRevisionId,
      meterFormulaRevisionId: input.context.meterFormulaRevisionId,
      dataSnapshotId: input.context.dataSnapshotId,
      metricVersion: input.context.metricVersion,
    },
  });
  if (!scopedDatasource.metadataViewName) {
    throw new Error("ENERGYIQ_ANALYSIS_WORKSPACE_METADATA_UNAVAILABLE");
  }
  const semantics = createEnergyIqAnalysisSemantics({
    projectId: input.context.projectId,
    factsRelation: scopedDatasource.viewName,
    scopeMetadataRelation: scopedDatasource.metadataViewName,
    scopeDimensions,
  });
  return {
    identity: {
      workspaceId: input.context.workspaceId,
      projectId: input.context.projectId,
      scopeId: input.context.scopeId,
      resource: input.context.resource,
      dataSnapshotId: input.context.dataSnapshotId,
      dataCutoff: input.context.to,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
    },
    scopedDatasource,
    scopeDimensions,
    semantics,
  };
};

export const createEnergyIqAnalysisSemantics = (input: {
  projectId: string;
  factsRelation: string;
  scopeMetadataRelation: string;
  scopeDimensions: EnergyScopedScopeDimension[];
}): EnergyAnalysisSemantics => ({
  contract: "energyiq-analysis-semantics@1",
  relations: {
    facts: {
      relation: input.factsRelation,
      usageColumn: "usage_kwh",
      qualityStatusColumn: "quality_status",
      officialAggregationColumn: "official_aggregation_eligible",
    },
    scopeMetadata: {
      relation: input.scopeMetadataRelation,
      scopeIdColumn: "scope_id",
      scopeTypeColumn: "scope_type",
      facilityTypeColumn: "facility_type",
      metadataStatusColumn: "metadata_status",
      publishedFacilityTypes: [...new Set(input.scopeDimensions.flatMap((dimension) =>
        dimension.facilityType ? [dimension.facilityType] : []))]
        .sort((left, right) => left.localeCompare(right)),
    },
  },
  measureAuthorities: [
    {
      id: "energy.usage_kwh",
      authority: "queryable",
      source: "facts",
      unit: "kWh",
    },
    {
      id: "metadata.centre_count",
      authority: "queryable",
      source: "scope-metadata",
    },
    ...(input.projectId === "preschool-demo"
      ? [
          {
            id: "preschool.benchmark.eui",
            authority: "deterministic-evidence" as const,
            source: "project-analysis-snapshot" as const,
            unit: "kWh/m2/yr",
          },
          {
            id: "preschool.benchmark.per_pax",
            authority: "deterministic-evidence" as const,
            source: "project-analysis-snapshot" as const,
            unit: "kWh/person/month",
          },
        ]
      : []),
  ],
});

export const resolveEnergyIqPublishedScopeDimensions = (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  scopeId: string;
  hierarchyRevisionId: string;
}): EnergyScopedScopeDimension[] => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  if (project.workspace_id !== input.workspaceId) {
    throw new Error("ENERGYIQ_ANALYSIS_WORKSPACE_PROJECT_FORBIDDEN");
  }
  const revision = input.metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(input.projectId)
    .find((candidate) => candidate.id === input.hierarchyRevisionId);
  if (!revision) {
    throw new Error(`ENERGYIQ_PUBLISHED_HIERARCHY_REVISION_REQUIRED:${input.hierarchyRevisionId}`);
  }
  const document = parsePublishedDocument(revision.snapshot_json);
  const tiersById = new Map(document.tiers.map((tier) => [tier.id, tier]));
  const highestOrdinal = Math.max(...document.tiers.map((tier) => tier.ordinal));
  const parentByNodeId = new Map(document.nodes.map((node) => {
    const tier = tiersById.get(node.tier_definition_id);
    if (!tier) throw new Error(`ENERGYIQ_PUBLISHED_HIERARCHY_TIER_INVALID:${node.tier_definition_id}`);
    return [
      node.id,
      tier.ordinal === highestOrdinal ? project.root_scope_id : node.parent_id,
    ] as const;
  }));
  const allScopeIds = new Set([project.root_scope_id, ...document.nodes.map((node) => node.id)]);
  if (!allScopeIds.has(input.scopeId)) {
    throw new Error(`ENERGYIQ_SCOPE_NOT_FOUND:${input.scopeId}`);
  }
  const includedScopeIds = descendantScopeIds(input.scopeId, parentByNodeId);
  const root: EnergyScopedScopeDimension = {
    scopeId: project.root_scope_id,
    scopeName: document.project.name,
    scopeType: "project",
    metadataStatus: "confirmed",
    hierarchyRevisionId: input.hierarchyRevisionId,
  };
  const dimensions = document.nodes.map((node): EnergyScopedScopeDimension => {
    const tier = tiersById.get(node.tier_definition_id);
    if (!tier) throw new Error(`ENERGYIQ_PUBLISHED_HIERARCHY_TIER_INVALID:${node.tier_definition_id}`);
    const parentScopeId = parentByNodeId.get(node.id);
    return {
      scopeId: node.id,
      ...(parentScopeId ? { parentScopeId } : {}),
      scopeName: node.name,
      scopeType: normalizeScopeType(tier.alias),
      tierDefinitionId: node.tier_definition_id,
      ...optionalStringDimension("centreCode", node.metadata?.centreCode),
      ...optionalStringDimension("facilityType", node.metadata?.facilityType),
      ...(node.area_sqm === undefined ? {} : { areaSqm: node.area_sqm }),
      ...(node.occupant_count === undefined ? {} : { occupantCount: node.occupant_count }),
      metadataStatus: node.metadata_status,
      hierarchyRevisionId: input.hierarchyRevisionId,
    };
  });
  return [root, ...dimensions]
    .filter((dimension) => includedScopeIds.has(dimension.scopeId))
    .sort((left, right) => left.scopeId.localeCompare(right.scopeId));
};

const descendantScopeIds = (
  rootScopeId: string,
  parentByNodeId: Map<string, string | undefined>,
): Set<string> => {
  const included = new Set([rootScopeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [scopeId, parentScopeId] of parentByNodeId) {
      if (parentScopeId && included.has(parentScopeId) && !included.has(scopeId)) {
        included.add(scopeId);
        changed = true;
      }
    }
  }
  return included;
};

const parsePublishedDocument = (value: string): EnergyIqProjectSetupDocument => {
  const parsed = JSON.parse(value) as Partial<EnergyIqProjectSetupDocument>;
  if (!parsed.project || !Array.isArray(parsed.tiers) || parsed.tiers.length === 0
    || !Array.isArray(parsed.nodes)) {
    throw new Error("ENERGYIQ_PUBLISHED_HIERARCHY_INVALID");
  }
  return parsed as EnergyIqProjectSetupDocument;
};

const normalizeScopeType = (value: string): string => value.trim().toLocaleLowerCase();

const optionalStringDimension = <K extends "centreCode" | "facilityType">(
  key: K,
  value: unknown,
): Partial<Record<K, string>> =>
  typeof value === "string" && value.trim() ? { [key]: value.trim() } as Record<K, string> : {};
