import type {
  EnergyImportBatchDto,
  EnergyMeterCategoryDto,
  EnergyMeterMappingDraftDto,
  EnergyMeterMappingRowDto,
  EnergyProjectSetupDocumentDto,
  EnergyProjectSetupNodeDto,
  EnergyTierDefinitionDto,
} from "../../../lib/config-api";

export const tiersTopDown = (
  document: EnergyProjectSetupDocumentDto,
): EnergyTierDefinitionDto[] =>
  [...document.tiers].sort((left, right) => right.ordinal - left.ordinal);

export const nodesForTierAndParent = (
  document: EnergyProjectSetupDocumentDto,
  tierId: string,
  parentId?: string,
): EnergyProjectSetupNodeDto[] =>
  document.nodes
    .filter((node) => (
      node.tier_definition_id === tierId
      && (parentId ? node.parent_id === parentId : !node.parent_id)
    ))
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));

export const initialTierSelection = (
  document: EnergyProjectSetupDocumentDto,
): Record<string, string> => {
  const selected: Record<string, string> = {};
  let parentId: string | undefined;
  for (const tier of tiersTopDown(document)) {
    const first = nodesForTierAndParent(document, tier.id, parentId)[0];
    if (!first) break;
    selected[tier.id] = first.id;
    parentId = first.id;
  }
  return selected;
};

export type EnergyAggregationReview = {
  key: string;
  scopeId: string;
  scopeName: string;
  resource: EnergyMeterMappingRowDto["resource"];
  category: EnergyMeterCategoryDto;
  officialTotals: EnergyMeterMappingRowDto[];
  officialComponents: EnergyMeterMappingRowDto[];
  excluded: EnergyMeterMappingRowDto[];
  recommendation: "direct total" | "selected components" | "reference only";
  conflict: boolean;
};

export const addParentTier = (
  document: EnergyProjectSetupDocumentDto,
  projectId: string,
): EnergyProjectSetupDocumentDto => {
  const ordinal = Math.max(0, ...document.tiers.map((tier) => tier.ordinal)) + 1;
  if (ordinal > 7) return document;
  const id = uniqueId(
    `${projectId}-tier-${ordinal}`,
    new Set(document.tiers.map((tier) => tier.id)),
  );
  return {
    ...document,
    tiers: [
      ...document.tiers,
      {
        id,
        ordinal,
        alias: ordinal === 1 ? "Scope" : `Parent scope ${ordinal}`,
        description: "Rename this tier to the customer-facing business term.",
      },
    ],
  };
};

export const removeHighestTier = (
  document: EnergyProjectSetupDocumentDto,
): EnergyProjectSetupDocumentDto => {
  if (document.nodes.length > 0 || document.tiers.length === 0) return document;
  const highestOrdinal = Math.max(...document.tiers.map((tier) => tier.ordinal));
  return {
    ...document,
    tiers: document.tiers.filter((tier) => tier.ordinal !== highestOrdinal),
  };
};

export const canLockTierStructure = (
  document: EnergyProjectSetupDocumentDto,
): boolean => {
  if (document.tiers.length === 0 || document.tiers.length > 7) return false;
  const aliases = new Set<string>();
  for (const tier of document.tiers) {
    const alias = tier.alias.trim().replace(/\s+/g, " ").toLocaleLowerCase();
    if (!alias || aliases.has(alias)) return false;
    aliases.add(alias);
  }
  return true;
};

export const isTierStructureLocked = (
  document: EnergyProjectSetupDocumentDto,
): boolean => typeof document.tier_structure_locked === "boolean"
  ? document.tier_structure_locked
  : document.nodes.length > 0;

export const branchNodeCount = (
  document: EnergyProjectSetupDocumentDto,
  nodeId: string,
): number => document.nodes.length - removeNodeAndDescendants(document, nodeId).nodes.length;

export const nodePathLabel = (
  document: EnergyProjectSetupDocumentDto,
  nodeId: string,
): string => {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const names: string[] = [];
  let current = nodesById.get(nodeId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parent_id ? nodesById.get(current.parent_id) : undefined;
  }
  return names.join(" / ");
};

export const createInitialMeterMapping = (
  document: EnergyProjectSetupDocumentDto,
): EnergyMeterMappingDraftDto => {
  const lowestOrdinal = Math.min(...document.tiers.map((tier) => tier.ordinal));
  const lowestTierIds = new Set(
    document.tiers.filter((tier) => tier.ordinal === lowestOrdinal).map((tier) => tier.id),
  );
  const sourceNodes = document.nodes.filter((node) => lowestTierIds.has(node.tier_definition_id));
  const nameCounts = new Map<string, number>();
  for (const node of sourceNodes) {
    const key = node.name.trim().toLocaleLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const rows = sourceNodes
    .map((node): EnergyMeterMappingRowDto => {
      const category = inferMeterCategory(node.name);
      const configuredMeterRole = stringMetadata(node.metadata?.meterRole);
      const representsDesignatedTotal = configuredMeterRole === "total"
        || (configuredMeterRole !== "submeter" && /^total\b/i.test(node.name));
      const duplicateName = (nameCounts.get(node.name.trim().toLocaleLowerCase()) ?? 0) > 1;
      return {
        id: `mapping-${node.id}`,
        source_label: duplicateName ? nodePathLabel(document, node.id) : node.name,
        scope_id: node.id,
        navigation_scope_id: node.id,
        display_name: node.name,
        resource: "electricity",
        category,
        coverage: representsDesignatedTotal ? "whole" : "partial",
        meter_role: representsDesignatedTotal ? "total" : "component",
        aggregation_usage: representsDesignatedTotal ? "official" : "excluded",
      };
    })
    .sort((left, right) => left.source_label.localeCompare(right.source_label));
  return {
    schema_version: 2,
    source_kind: "excel",
    rows,
    official_aggregation_routes: buildOfficialAggregationRoutes(document, rows),
    confirmed: false
  };
};

export const createMeterMappingFromSourceLabels = (
  document: EnergyProjectSetupDocumentDto,
  labels: string[],
  existingMapping?: EnergyMeterMappingDraftDto,
): EnergyMeterMappingDraftDto => {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const existingByLabel = new Map((existingMapping?.rows ?? []).map((row) => [
    normaliseDisplayName(row.source_label),
    row,
  ]));
  const rows = [...new Set(labels.map((label) => label.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((sourceLabel, index): EnergyMeterMappingRowDto => {
      const parsed = parseSourceLabel(sourceLabel);
      const meterName = normaliseDisplayName(parsed.meterName);
      const meterNameBeforeDetails = normaliseDisplayName(parsed.meterName.split(":", 1)[0] ?? parsed.meterName);
      const exactCandidates = document.nodes.filter((node) => normaliseDisplayName(node.name) === meterName);
      const candidates = exactCandidates.length > 0
        ? exactCandidates
        : document.nodes.filter((node) => {
          const nodeName = normaliseDisplayName(node.name);
          return nodeName === meterNameBeforeDetails
            || nodeName.startsWith(`${meterNameBeforeDetails} `)
            || nodeName.startsWith(`${meterNameBeforeDetails}:`);
        });
      const scopedCandidates = parsed.locationName
        ? candidates.filter((node) => ancestorNames(node, nodesById)
          .some((name) => normaliseDisplayName(name) === normaliseDisplayName(parsed.locationName!)))
        : candidates;
      const matched = scopedCandidates.length === 1
        ? scopedCandidates[0]
        : candidates.length === 1
          ? candidates[0]
          : undefined;
      const existing = existingByLabel.get(normaliseDisplayName(sourceLabel));
      if (!matched && existing) return existing;
      const configuredMeterRole = stringMetadata(matched?.metadata?.meterRole);
      const representsDesignatedTotal = configuredMeterRole === "total"
        || (configuredMeterRole !== "submeter" && /^total\b/i.test(parsed.meterName));
      const representsComponent = !representsDesignatedTotal;
      const scopeId = matched?.id ?? "";
      const configuredCategory = meterCategoryMetadata(matched?.metadata?.category);
      return {
        id: existing?.id ?? `mapping-${slug(sourceLabel)}-${index + 1}`,
        source_label: sourceLabel,
        scope_id: scopeId,
        ...(matched ? { navigation_scope_id: matched.id } : {}),
        display_name: matched?.name ?? parsed.meterName,
        resource: "electricity",
        category: configuredCategory ?? inferMeterCategory(parsed.meterName),
        coverage: representsComponent ? "partial" : "whole",
        meter_role: representsComponent ? "component" : "total",
        aggregation_usage: representsComponent ? "excluded" : "official",
      };
    });
  return {
    schema_version: 2,
    source_kind: "excel",
    rows,
    official_aggregation_routes: buildOfficialAggregationRoutes(document, rows),
    ...resolveNgeeAnnVirtualMeters(rows, existingMapping),
    confirmed: false,
  };
};

export const buildOfficialAggregationRoutes = (
  document: EnergyProjectSetupDocumentDto,
  rows: EnergyMeterMappingRowDto[],
): NonNullable<EnergyMeterMappingDraftDto["official_aggregation_routes"]> => {
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const routeMembers = new Map<string, Set<string>>();
  const add = (scopeId: string, row: EnergyMeterMappingRowDto) => {
    const key = `${scopeId}\u0000${row.resource}\u0000${row.category}`;
    const members = routeMembers.get(key) ?? new Set<string>();
    members.add(row.id);
    routeMembers.set(key, members);
  };
  for (const row of rows) {
    const navigationScopeId = row.navigation_scope_id ?? row.scope_id;
    if (!navigationScopeId || !nodesById.has(navigationScopeId)) continue;
    add(navigationScopeId, row);
    if (row.aggregation_usage !== "official") continue;
    let current = nodesById.get(navigationScopeId);
    const visited = new Set<string>();
    while (current?.parent_id && !visited.has(current.parent_id)) {
      visited.add(current.parent_id);
      add(current.parent_id, row);
      current = nodesById.get(current.parent_id);
    }
    add("project", row);
  }
  return [...routeMembers.entries()]
    .map(([key, members]) => {
      const [scopeId = "", resource = "electricity", category = "other"] = key.split("\u0000");
      const routeCategory: EnergyMeterCategoryDto = category === "overall"
        || category === "load"
        || category === "light"
        || category === "aircon"
        ? category
        : "other";
      return {
        scope_id: scopeId,
        resource: resource === "water" ? "water" as const : "electricity" as const,
        category: routeCategory,
        meter_point_ids: [...members].sort(),
      };
    })
    .sort((left, right) => left.scope_id.localeCompare(right.scope_id)
      || left.resource.localeCompare(right.resource));
};

export const applyMeterMappingRowEdit = (
  document: EnergyProjectSetupDocumentDto,
  mapping: EnergyMeterMappingDraftDto,
  editedRow: EnergyMeterMappingRowDto,
): EnergyMeterMappingDraftDto => {
  const authoritativeRow = {
    ...editedRow,
    navigation_scope_id: editedRow.scope_id,
  };
  const rows = mapping.rows.map((row) => row.id === authoritativeRow.id ? authoritativeRow : row);
  return {
    ...mapping,
    rows,
    official_aggregation_routes: buildOfficialAggregationRoutes(document, rows),
    confirmed: false,
  };
};

export const sourceLabelsAcrossImportBatches = (
  batches: EnergyImportBatchDto[],
): string[] => [...new Map(batches.flatMap((batch) => batch.inspection.sourceLabels)
  .map((source) => [normaliseDisplayName(source.label), source.label.trim()])).values()]
  .sort((left, right) => left.localeCompare(right));

export const pinEnergySourceManifest = async (
  batches: EnergyImportBatchDto[],
): Promise<NonNullable<EnergyProjectSetupDocumentDto["source_manifest"]>> => {
  const sourceSha256 = [...new Set(batches.map((batch) => batch.sourceSha256.trim().toLocaleLowerCase()))].sort();
  const material = JSON.stringify({ version: 1, source_sha256: sourceSha256 });
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  const fingerprint = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return {
    id: `source-manifest-${fingerprint.slice(0, 24)}`,
    source_sha256: sourceSha256,
    confirmed: true,
  };
};

export const evaluateEnergyImportMaterializationGuard = (input: {
  document: EnergyProjectSetupDocumentDto;
  savedDocument: EnergyProjectSetupDocumentDto;
  batches: EnergyImportBatchDto[];
}): { ready: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  const currentSourceSha256 = [...new Set(input.batches
    .map((batch) => batch.sourceSha256.trim().toLocaleLowerCase()))].sort();
  const savedManifest = input.savedDocument.source_manifest;
  if (input.batches.length === 0) reasons.push("IMPORT_BATCH_REQUIRED");
  if (!savedManifest?.confirmed) reasons.push("SOURCE_MANIFEST_NOT_CONFIRMED");
  else if (JSON.stringify([...new Set(savedManifest.source_sha256
    .map((sha256) => sha256.trim().toLocaleLowerCase()))].sort()) !== JSON.stringify(currentSourceSha256)) {
    reasons.push("SOURCE_MANIFEST_MISMATCH");
  }
  if (JSON.stringify(input.document.source_manifest) !== JSON.stringify(savedManifest)) {
    reasons.push("SOURCE_MANIFEST_UNSAVED");
  }

  const savedMapping = input.savedDocument.meter_mapping;
  if (!savedMapping?.confirmed) reasons.push("METER_MAPPING_NOT_CONFIRMED");
  if (JSON.stringify(input.document.meter_mapping) !== JSON.stringify(savedMapping)) {
    reasons.push("METER_MAPPING_UNSAVED");
  }
  if (input.document.project.timezone !== input.savedDocument.project.timezone) {
    reasons.push("PROJECT_TIMEZONE_UNSAVED");
  }
  if (savedMapping) {
    const sourceKeys = new Set(sourceLabelsAcrossImportBatches(input.batches).map(normaliseDisplayName));
    const mappingKeys = new Set(savedMapping.rows.map((row) => normaliseDisplayName(row.source_label)));
    if (mappingKeys.size !== savedMapping.rows.length) reasons.push("SOURCE_LABEL_DUPLICATE");
    if ([...sourceKeys].some((key) => !mappingKeys.has(key))) reasons.push("SOURCE_LABEL_UNMAPPED");
    if ([...mappingKeys].some((key) => !sourceKeys.has(key))) reasons.push("MAPPING_SOURCE_INACTIVE");
  }
  const uniqueReasons = [...new Set(reasons)];
  return { ready: uniqueReasons.length === 0, reasons: uniqueReasons };
};

export const inferMeterCategory = (label: string): EnergyMeterCategoryDto => {
  const value = label.toLocaleLowerCase();
  if (/air\s*con|aircon|a\/c/.test(value)) return "aircon";
  if (/light|lighting/.test(value)) return "light";
  if (/load|socket|power/.test(value)) return "load";
  return "other";
};

export const buildAggregationReview = (
  document: EnergyProjectSetupDocumentDto,
  mapping: EnergyMeterMappingDraftDto,
): EnergyAggregationReview[] => {
  const rowsById = new Map(mapping.rows.map((row) => [row.id, row]));
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const withinScope = (row: EnergyMeterMappingRowDto, scopeId: string): boolean => {
    if (scopeId === "project") return true;
    let current = nodesById.get(row.navigation_scope_id ?? row.scope_id);
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (current.id === scopeId) return true;
      visited.add(current.id);
      current = current.parent_id ? nodesById.get(current.parent_id) : undefined;
    }
    return false;
  };
  return (mapping.official_aggregation_routes ?? []).map((route): EnergyAggregationReview => {
    const rows = route.meter_point_ids.flatMap((meterPointId) => {
      const row = rowsById.get(meterPointId);
      return row ? [row] : [];
    });
    const officialTotals = rows.filter((row) => row.meter_role === "total");
    const officialComponents = rows.filter((row) => row.meter_role === "component");
    const selectedIds = new Set(route.meter_point_ids);
    const excluded = mapping.rows.filter((row) =>
      row.resource === route.resource
      && row.category === route.category
      && withinScope(row, route.scope_id)
      && !selectedIds.has(row.id));
    return {
      key: `${route.scope_id}:${route.resource}:${route.category}`,
      scopeId: route.scope_id,
      scopeName: route.scope_id === "project"
        ? document.project.name
        : document.nodes.some((node) => node.id === route.scope_id)
          ? nodePathLabel(document, route.scope_id)
          : "Missing Scope",
      resource: route.resource,
      category: route.category,
      officialTotals,
      officialComponents,
      excluded,
      recommendation: officialTotals.length === 1
        ? "direct total"
        : officialComponents.length > 0
          ? "selected components"
          : "reference only",
      conflict: officialTotals.length > 1,
    };
  }).sort((left, right) => left.scopeName.localeCompare(right.scopeName) || left.category.localeCompare(right.category));
};

export const addNode = (
  document: EnergyProjectSetupDocumentDto,
  input: { projectId: string; tierId: string; parentId?: string },
): { document: EnergyProjectSetupDocumentDto; nodeId: string } => {
  const tier = document.tiers.find((candidate) => candidate.id === input.tierId);
  if (!tier) return { document, nodeId: "" };
  const existingIds = new Set(document.nodes.map((node) => node.id));
  const siblingCount = document.nodes.filter(
    (node) => node.tier_definition_id === tier.id && node.parent_id === input.parentId,
  ).length;
  let displayIndex = siblingCount + 1;
  let displayName = `${tier.alias} ${displayIndex}`;
  while (hasSiblingNameConflict(document, {
    tierId: tier.id,
    parentId: input.parentId,
    name: displayName,
  })) {
    displayIndex += 1;
    displayName = `${tier.alias} ${displayIndex}`;
  }
  const nodeId = uniqueId(
    `${input.projectId}-${slug(tier.alias)}-${displayIndex}`,
    existingIds,
  );
  const next: EnergyProjectSetupNodeDto = {
    id: nodeId,
    tier_definition_id: tier.id,
    ...(input.parentId ? { parent_id: input.parentId } : {}),
    name: displayName,
    sort_order: (siblingCount + 1) * 10,
    metadata_status: "provisional",
  };
  return {
    document: { ...document, nodes: [...document.nodes, next] },
    nodeId,
  };
};

export const hasSiblingNameConflict = (
  document: EnergyProjectSetupDocumentDto,
  input: {
    tierId: string;
    parentId?: string;
    name: string;
    excludeNodeId?: string;
  },
): boolean => {
  const candidate = normaliseDisplayName(input.name);
  if (!candidate) return false;
  return document.nodes.some((node) => (
    node.id !== input.excludeNodeId
    && node.tier_definition_id === input.tierId
    && node.parent_id === input.parentId
    && normaliseDisplayName(node.name) === candidate
  ));
};

export const removeNodeAndDescendants = (
  document: EnergyProjectSetupDocumentDto,
  nodeId: string,
): EnergyProjectSetupDocumentDto => {
  const removed = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of document.nodes) {
      if (node.parent_id && removed.has(node.parent_id) && !removed.has(node.id)) {
        removed.add(node.id);
        changed = true;
      }
    }
  }
  return { ...document, nodes: document.nodes.filter((node) => !removed.has(node.id)) };
};

const slug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "scope";

const normaliseDisplayName = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase();

const parseSourceLabel = (label: string): { locationName?: string; meterName: string } => {
  const match = label.trim().match(/^(?:lvl|level|floor)\s+([^\s]+)\s+(.+)$/i);
  if (!match) return { meterName: label.trim() };
  return { locationName: `Level ${match[1]}`, meterName: match[2]!.trim() };
};

const resolveNgeeAnnVirtualMeters = (
  rows: EnergyMeterMappingRowDto[],
  existingMapping?: EnergyMeterMappingDraftDto,
): Pick<EnergyMeterMappingDraftDto, "virtual_meters"> | Record<string, never> => {
  const load1SourceLabel = normaliseDisplayName("Lvl 6 Office Load 1: L1P1-L3P6");
  const load2SourceLabel = normaliseDisplayName("Lvl 6 Office Load 2: L1P7-L3P12");
  const hasNgeeAnnLoadSource = rows.some((row) => {
    const sourceLabel = normaliseDisplayName(row.source_label);
    return sourceLabel === load1SourceLabel || sourceLabel === load2SourceLabel;
  });
  const load1 = rows.find((row) =>
    row.scope_id === "l6-load-1" && normaliseDisplayName(row.source_label) === load1SourceLabel);
  const load2 = rows.find((row) =>
    row.scope_id === "l6-load-2" && normaliseDisplayName(row.source_label) === load2SourceLabel);
  if (!load1 || !load2) {
    if (hasNgeeAnnLoadSource) return {};
    return existingMapping?.virtual_meters?.length
      ? { virtual_meters: existingMapping.virtual_meters }
      : {};
  }
  const retained = (existingMapping?.virtual_meters ?? []).filter((meter) =>
    normaliseDisplayName(meter.display_name) !== "load 12"
    && meter.id !== "ngee-ann-load-12-v1");
  return {
    virtual_meters: [...retained, {
      id: "ngee-ann-load-12-v1",
      display_name: "Load 12",
      scope_id: "level-6",
      resource: "electricity",
      category: "load",
      terms: [
        { mapping_row_id: load1.id, coefficient: 1 },
        { mapping_row_id: load2.id, coefficient: 1 },
      ],
    }],
  };
};

const stringMetadata = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const meterCategoryMetadata = (value: unknown): EnergyMeterCategoryDto | undefined =>
  value === "overall" || value === "load" || value === "light" || value === "aircon" || value === "other"
    ? value
    : undefined;

const ancestorNames = (
  node: EnergyProjectSetupNodeDto,
  nodesById: Map<string, EnergyProjectSetupNodeDto>,
): string[] => {
  const names: string[] = [];
  const visited = new Set<string>();
  let current = node.parent_id ? nodesById.get(node.parent_id) : undefined;
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.push(current.name);
    current = current.parent_id ? nodesById.get(current.parent_id) : undefined;
  }
  return names;
};

const uniqueId = (candidate: string, existing: Set<string>): string => {
  let value = candidate;
  let suffix = 2;
  while (existing.has(value)) {
    value = `${candidate}-${suffix}`;
    suffix += 1;
  }
  return value;
};
