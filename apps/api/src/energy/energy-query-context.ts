import { resolveEnergyProjectCapabilities, type EnergyProjectCapabilities } from "./energy-project-capabilities.js";
import { ensureEnergyIqUserRole, resolveEnergyIqUserRole } from "./energy-user-role.js";
export { ensureEnergyIqUserRole } from "./energy-user-role.js";
import type {
  EnergyIqMeterMappingDraft,
  EnergyIqProjectNodeRecord,
  EnergyIqProjectSetupDocument,
  EnergyIqProjectRecord,
  EnergyIqRole,
  MetadataStore,
  UserRecord,
  WorkspaceRecord
} from "@datafoundry/metadata";
import { energyIqPublishedMeterRoutingRevisionId } from "@datafoundry/metadata";

export type EnergyResource = "electricity" | "water";
export type EnergyPeriod = "Yesterday" | "Last 7 days" | "Last 30 days" | "Previous week" | "Previous month" | "Custom";

export type EnergyAccessContext = {
  role: EnergyIqRole;
  user: {
    id: string;
    email?: string;
    displayName?: string;
  };
  activeWorkspaceId: string;
  workspaces: Array<{
    id: string;
    name: string;
    kind: WorkspaceRecord["kind"];
    disabled: boolean;
  }>;
  projects: Array<{
    id: string;
    workspaceId: string;
    name: string;
    status: EnergyIqProjectRecord["status"];
    timezone: string;
    capabilities: EnergyProjectCapabilities;
    /** Where readings come from: a live meter connection, uploaded files, or nothing yet. */
    dataSource: EnergyProjectDataSource;
  }>;
};

export type EnergyProjectDataSource = "live" | "upload" | "none";

/**
 * "live" while a meter connection updates the project by itself (connected in the app with daily updates on, or the
 * server's own Tuya settings with their sync on); otherwise "upload" once any readings have been published from
 * files, or "none". A site that was live and was disconnected keeps its data but counts as "upload" from then on.
 */
export const resolveEnergyProjectDataSource = (
  metadataStore: MetadataStore,
  projectId: string,
  env: Record<string, string | undefined> = process.env,
): EnergyProjectDataSource => {
  if (metadataStore.energyIq.liveConnectors.find(projectId)?.sync_enabled) return "live";
  if (env.ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim() === projectId
    && env.ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON?.trim()
    && env.ENERGYIQ_TUYA_SYNC_ENABLED?.trim() === "true"
    && !metadataStore.energyIq.liveConnectors.find(projectId)) return "live";
  return metadataStore.energyIq.listImportBatches(projectId).some((batch) => batch.status === "materialized") ? "upload" : "none";
};

export type EnergyQueryContextRequest = {
  projectId: string;
  scopeId?: string;
  resource?: EnergyResource;
  period?: EnergyPeriod;
  from?: string;
  to?: string;
  analysisWindow?: "all-available" | "latest-complete-day" | "latest-complete-7d" | "current-project-overview" | "current-overview-28d" | "current-month-to-date";
  expectedDataSnapshotId?: string;
  expectedProjectReleaseId?: string | null;
  expectedHierarchyRevisionId?: string;
  expectedMeterMappingRevisionId?: string;
  expectedMeterFormulaRevisionId?: string;
};

export type EnergyQueryContext = {
  userId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  scopeType: string;
  resource: EnergyResource;
  timezone: string;
  from: string;
  to: string;
  endExclusive: true;
  period: EnergyPeriod;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  dataSnapshotId: string;
  metricVersion: string;
  businessCalendarVersion: string;
  tariffScheduleVersion: string;
  resolvedAt: string;
};

export type EnergyPublishedMeterRoute = {
  source: "published";
  meterMappingRevisionId: string;
  attachments: Array<{ meterPointId: string; scopeId: string; officialAggregation: boolean }>;
  officialMeterPointIds?: string[];
  officialMeterRoles?: string[];
  componentMeterPointIds: string[];
};

export const resolveEnergyAccessContext = (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  requestedWorkspaceId?: string;
  env?: Record<string, string | undefined>;
  rolePersistence?: "ensure" | "read-only";
}): EnergyAccessContext => {
  const role = input.rolePersistence === "read-only"
    ? resolveEnergyIqUserRole(input.metadataStore, input.user, input.env)
    : ensureEnergyIqUserRole(input.metadataStore, input.user, input.env);
  const workspaces = (
    role === "admin"
      ? input.metadataStore.workspaces.list()
      : input.metadataStore.workspaces.listByUser({ user_id: input.user.id })
  ).filter((workspace) => workspace.kind === "customer" && (role === "admin" || !workspace.disabled_at));
  if (workspaces.length === 0) {
    return {
      role,
      user: {
        id: input.user.id,
        ...(input.user.email ? { email: input.user.email } : {}),
        ...(input.user.display_name ? { displayName: input.user.display_name } : {})
      },
      activeWorkspaceId: "",
      workspaces: [],
      projects: []
    };
  }
  const activeWorkspace = input.requestedWorkspaceId
    ? workspaces.find((workspace) => workspace.id === input.requestedWorkspaceId)
    : workspaces[0];
  if (!activeWorkspace) {
    throw new Error("ENERGYIQ_WORKSPACE_FORBIDDEN");
  }
  const projects = input.metadataStore.energyIq.listVisibleProjects({
    user_id: input.user.id,
    workspace_id: activeWorkspace.id,
    is_admin: role === "admin"
  });
  return {
    role,
    user: {
      id: input.user.id,
      ...(input.user.email ? { email: input.user.email } : {}),
      ...(input.user.display_name ? { displayName: input.user.display_name } : {})
    },
    activeWorkspaceId: activeWorkspace.id,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      kind: workspace.kind,
      disabled: Boolean(workspace.disabled_at)
    })),
    projects: projects.map((project) => ({
      id: project.id,
      workspaceId: project.workspace_id,
      name: project.name,
      status: project.status,
      timezone: project.timezone,
      capabilities: resolveEnergyProjectCapabilities({ metadataStore: input.metadataStore, userId: input.user.id, workspaceId: activeWorkspace.id, projectId: project.id, ...(input.env ? { env: input.env } : {}) }),
      dataSource: resolveEnergyProjectDataSource(input.metadataStore, project.id, input.env)
    }))
  };
};

export const resolveEnergyQueryContext = (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
  request: EnergyQueryContextRequest;
  now?: Date;
  env?: Record<string, string | undefined>;
  releasePins?: {
    hierarchyRevisionId: string;
    meterMappingRevisionId: string;
    meterFormulaRevisionId: string;
    timezone: string;
    metricVersion: string;
    businessCalendarVersion: string;
    tariffScheduleVersion: string;
  };
  allowUnconfigured?: boolean;
}): EnergyQueryContext => {
  const access = resolveEnergyAccessContext({
    metadataStore: input.metadataStore,
    user: input.user,
    requestedWorkspaceId: input.workspaceId,
    ...(input.env ? { env: input.env } : {})
  });
  const project = access.projects.find((candidate) => candidate.id === input.request.projectId);
  if (!project || project.workspaceId !== access.activeWorkspaceId) {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  if (project.status !== "published" && access.role !== "admin") {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  const projectRecord = input.metadataStore.energyIq.getProject(project.id);
  const hierarchyRevisionId = input.releasePins?.hierarchyRevisionId ?? projectRecord.hierarchy_revision_id;
  const nodes = input.allowUnconfigured
    ? input.metadataStore.energyIq.listProjectNodes(project.id)
    : resolveEnergyPublishedHierarchyNodes(input.metadataStore, project.id, hierarchyRevisionId);
  const root = nodes.find((node) =>
    node.id === projectRecord.root_scope_id && !node.parent_id
  );
  if (!root) {
    throw new Error("ENERGYIQ_PROJECT_ROOT_REQUIRED");
  }
  const requestedScopeId = input.request.scopeId;
  const scope = !requestedScopeId || requestedScopeId === "project"
    ? root
    : nodes.find((node) => node.id === requestedScopeId);
  if (!scope) {
    throw new Error("ENERGYIQ_SCOPE_FORBIDDEN");
  }
  const period = input.request.period ?? "Last 30 days";
  const resolvedAt = input.now ?? new Date();
  const timezone = input.releasePins?.timezone ?? projectRecord.timezone;
  const range = resolvePeriodRange({
    period,
    timezone,
    ...(input.request.from ? { from: input.request.from } : {}),
    ...(input.request.to ? { to: input.request.to } : {}),
    now: resolvedAt
  });
  const publishedMeterRoute = input.allowUnconfigured
    ? undefined
    : resolveEnergyPublishedMeterRoute({
        metadataStore: input.metadataStore,
        projectId: projectRecord.id,
        hierarchyRevisionId,
        scopeId: scope.id,
        resource: input.request.resource ?? "electricity",
        ...(input.releasePins
          ? { expectedMeterMappingRevisionId: input.releasePins.meterMappingRevisionId }
          : {})
      });
  const dataSnapshotId = projectRecord.data_snapshot_id;
  if (input.request.expectedDataSnapshotId
    && input.request.expectedDataSnapshotId !== dataSnapshotId) {
    throw new Error("ENERGYIQ_DATA_SNAPSHOT_MISMATCH");
  }
  const meterMappingRevisionId = publishedMeterRoute?.meterMappingRevisionId
    ?? "meter-routing-unconfigured";
  const meterFormulaRevisionId = input.releasePins?.meterFormulaRevisionId
    ?? projectRecord.meter_formula_revision_id;
  assertExpectedRevision(
    "hierarchyRevisionId",
    input.request.expectedHierarchyRevisionId,
    hierarchyRevisionId,
  );
  assertExpectedRevision(
    "meterMappingRevisionId",
    input.request.expectedMeterMappingRevisionId,
    meterMappingRevisionId,
  );
  assertExpectedRevision(
    "meterFormulaRevisionId",
    input.request.expectedMeterFormulaRevisionId,
    meterFormulaRevisionId,
  );
  return {
    userId: input.user.id,
    workspaceId: access.activeWorkspaceId,
    projectId: projectRecord.id,
    projectName: projectRecord.name,
    scopeId: scope.id,
    scopeName: scope.name,
    scopeType: scope.node_type,
    resource: input.request.resource ?? "electricity",
    timezone,
    from: range.from,
    to: range.to,
    endExclusive: true,
    period,
    hierarchyRevisionId,
    meterMappingRevisionId,
    meterFormulaRevisionId,
    dataSnapshotId,
    metricVersion: input.releasePins?.metricVersion ?? projectRecord.metric_version,
    businessCalendarVersion: input.releasePins?.businessCalendarVersion
      ?? projectRecord.business_calendar_version,
    tariffScheduleVersion: input.releasePins?.tariffScheduleVersion
      ?? projectRecord.tariff_schedule_version,
    resolvedAt: resolvedAt.toISOString()
  };
};

const assertExpectedRevision = (
  field: "hierarchyRevisionId" | "meterMappingRevisionId" | "meterFormulaRevisionId",
  expected: string | undefined,
  actual: string,
): void => {
  if (expected !== undefined && expected !== actual) {
    throw new Error(`ENERGYIQ_PUBLISHED_CONTEXT_CONFLICT:${field}:${expected}:${actual}`);
  }
};

export const resolveEnergyPublishedHierarchyNodes = (
  metadataStore: MetadataStore,
  projectId: string,
  hierarchyRevisionId: string
): EnergyIqProjectNodeRecord[] => {
  const revision = metadataStore.energyIq.projectSetup.listHierarchyRevisions(projectId)
    .find((candidate) => candidate.id === hierarchyRevisionId);
  if (!revision) throw new Error(`ENERGYIQ_PUBLISHED_HIERARCHY_REVISION_REQUIRED:${hierarchyRevisionId}`);
  const document = JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument;
  const project = metadataStore.energyIq.getProject(projectId);
  const tiersById = new Map(document.tiers.map((tier) => [tier.id, tier]));
  const highestOrdinal = Math.max(...document.tiers.map((tier) => tier.ordinal));
  const now = revision.published_at;
  const root: EnergyIqProjectNodeRecord = {
    id: project.root_scope_id,
    project_id: projectId,
    name: document.project.name,
    node_type: "project",
    sort_order: 0,
    metadata_status: "confirmed",
    hierarchy_revision_id: hierarchyRevisionId,
    created_at: now,
    updated_at: now,
  };
  return [root, ...document.nodes.map((node): EnergyIqProjectNodeRecord => {
    const tier = tiersById.get(node.tier_definition_id);
    if (!tier) throw new Error(`ENERGYIQ_PUBLISHED_HIERARCHY_TIER_INVALID:${node.tier_definition_id}`);
    const parentId = tier.ordinal === highestOrdinal ? project.root_scope_id : node.parent_id;
    return {
      id: node.id,
      project_id: projectId,
      ...(parentId ? { parent_id: parentId } : {}),
      name: node.name,
      node_type: tier.alias.trim().toLocaleLowerCase(),
      tier_definition_id: node.tier_definition_id,
      hierarchy_revision_id: hierarchyRevisionId,
      sort_order: node.sort_order,
      ...(node.area_sqm === undefined ? {} : { area_sqm: node.area_sqm }),
      ...(node.occupant_count === undefined ? {} : { occupant_count: node.occupant_count }),
      ...(node.metadata ? { metadata_json: JSON.stringify(node.metadata) } : {}),
      metadata_status: node.metadata_status,
      ...(node.effective_from ? { effective_from: node.effective_from } : {}),
      ...(node.effective_to ? { effective_to: node.effective_to } : {}),
      ...(node.independent_reason ? { independent_reason: node.independent_reason } : {}),
      created_at: now,
      updated_at: now,
    };
  })];
};

export const resolveEnergyPublishedHierarchyTimezone = (
  metadataStore: MetadataStore,
  projectId: string,
  hierarchyRevisionId: string,
): string => {
  const revision = metadataStore.energyIq.projectSetup.listHierarchyRevisions(projectId)
    .find((candidate) => candidate.id === hierarchyRevisionId);
  if (!revision) throw new Error(`ENERGYIQ_PUBLISHED_HIERARCHY_REVISION_REQUIRED:${hierarchyRevisionId}`);
  const document = JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument;
  if (typeof document.project?.timezone !== "string" || document.project.timezone.trim().length === 0) {
    throw new Error(`ENERGYIQ_PUBLISHED_HIERARCHY_TIMEZONE_REQUIRED:${hierarchyRevisionId}`);
  }
  return document.project.timezone;
};

export const resolveEnergyPublishedMeterPoints = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  resource: EnergyResource;
}): Array<{ meterPointId: string; sourceLabel: string }> => {
  const revision = input.metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(input.projectId)
    .find((candidate) => candidate.id === input.hierarchyRevisionId);
  if (!revision) {
    throw new Error(`ENERGYIQ_PUBLISHED_MAPPING_REVISION_REQUIRED:${input.hierarchyRevisionId}`);
  }
  const document = JSON.parse(revision.snapshot_json) as {
    meter_mapping?: EnergyIqMeterMappingDraft;
  };
  const mapping = document.meter_mapping;
  if (mapping?.schema_version !== 2 || !mapping.confirmed) {
    throw new Error(`ENERGYIQ_PUBLISHED_MAPPING_ROUTE_REQUIRED:${input.hierarchyRevisionId}`);
  }
  return mapping.rows
    .filter((row) => row.resource === input.resource)
    .map((row) => ({ meterPointId: row.id, sourceLabel: row.source_label }));
};

export const resolveEnergyPublishedMeterRoute = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  hierarchyRevisionId: string;
  scopeId: string;
  resource: EnergyResource;
  expectedMeterMappingRevisionId?: string;
}): EnergyPublishedMeterRoute => {
  const revision = input.metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(input.projectId)
    .find((candidate) => candidate.id === input.hierarchyRevisionId);
  if (!revision) {
    throw new Error(`ENERGYIQ_PUBLISHED_MAPPING_REVISION_REQUIRED:${input.hierarchyRevisionId}`);
  }
  const document = JSON.parse(revision.snapshot_json) as {
    meter_mapping?: EnergyIqMeterMappingDraft;
  };
  const mapping = document.meter_mapping;
  if (mapping?.schema_version !== 2 || !mapping.confirmed || !mapping.official_aggregation_routes) {
    throw new Error(`ENERGYIQ_PUBLISHED_MAPPING_ROUTE_REQUIRED:${input.hierarchyRevisionId}`);
  }
  const hierarchy = resolveEnergyPublishedHierarchyNodes(
    input.metadataStore,
    input.projectId,
    input.hierarchyRevisionId
  );
  const includedScopeIds = new Set(resolveScopeNodeIds(hierarchy, input.scopeId));
  const rows = mapping.rows.filter((row) => row.resource === input.resource);
  const attachments = rows.flatMap((row) => {
    const scopeId = row.navigation_scope_id ?? row.scope_id;
    return includedScopeIds.has(scopeId) ? [{ meterPointId: row.id, scopeId }] : [];
  });
  const selectedNode = hierarchy.find((node) => node.id === input.scopeId);
  const routeScopeId = selectedNode && !selectedNode.parent_id ? "project" : input.scopeId;
  const routes = mapping.official_aggregation_routes.filter((candidate) =>
    candidate.scope_id === routeScopeId
    && candidate.resource === input.resource);
  if (routes.length === 0) {
    throw new Error(`ENERGYIQ_PUBLISHED_METER_ROUTE_REQUIRED:${input.scopeId}:${input.resource}`);
  }
  const routeCategories = new Set<string>();
  for (const route of routes) {
    if (routeCategories.has(route.category)) {
      throw new Error(`ENERGYIQ_PUBLISHED_METER_ROUTE_DUPLICATE:${input.scopeId}:${input.resource}:${route.category}`);
    }
    routeCategories.add(route.category);
  }
  if (routeCategories.has("overall") && routeCategories.size > 1) {
    throw new Error(`ENERGYIQ_PUBLISHED_METER_ROUTE_OVERALL_CONFLICT:${input.scopeId}:${input.resource}`);
  }
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const attachedIds = new Set(attachments.map((attachment) => attachment.meterPointId));
  const officialMeterPointIds: string[] = [];
  for (const route of routes) {
    for (const meterPointId of route.meter_point_ids) {
      const row = rowsById.get(meterPointId);
      if (
        !row
        || !attachedIds.has(meterPointId)
        || (route.category !== "overall" && route.category !== row.category)
      ) {
        throw new Error(`ENERGYIQ_PUBLISHED_METER_ROUTE_INVALID:${input.scopeId}:${meterPointId}`);
      }
      officialMeterPointIds.push(meterPointId);
    }
  }
  if (new Set(officialMeterPointIds).size !== officialMeterPointIds.length) {
    throw new Error(`ENERGYIQ_PUBLISHED_METER_ROUTE_OVERLAP:${input.scopeId}:${input.resource}`);
  }
  const meterMappingRevisionId = energyIqPublishedMeterRoutingRevisionId(mapping);
  if (
    input.expectedMeterMappingRevisionId
    && input.expectedMeterMappingRevisionId !== meterMappingRevisionId
  ) {
    throw new Error(
      `ENERGYIQ_PUBLISHED_MAPPING_REVISION_MISMATCH:${input.expectedMeterMappingRevisionId}:${meterMappingRevisionId}`
    );
  }
  const componentMeterPointIds = attachments
    .map((attachment) => rowsById.get(attachment.meterPointId))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter((row) => (
      row.meter_role === "component"
      && row.aggregation_usage === "excluded"
      && !officialMeterPointIds.includes(row.id)
    ))
    .map((row) => row.id)
    .sort();
  return {
    source: "published",
    meterMappingRevisionId,
    attachments: attachments.map((attachment) => ({
      ...attachment,
      officialAggregation: officialMeterPointIds.includes(attachment.meterPointId)
    })),
    officialMeterPointIds,
    componentMeterPointIds,
    officialMeterRoles: [...new Set(officialMeterPointIds.map((meterPointId) =>
      rowsById.get(meterPointId)?.meter_role ?? "standalone"))]
  };
};

export const resolveEnergyScopeMeterNodeIds = (
  metadataStore: MetadataStore,
  projectId: string,
  scopeId: string
): string[] => {
  const nodes = metadataStore.energyIq.listProjectNodes(projectId);
  return resolveScopeNodeIds(nodes, scopeId);
};

const resolveScopeNodeIds = (
  nodes: EnergyIqProjectNodeRecord[],
  scopeId: string
): string[] => {
  const byParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parent_id) continue;
    const children = byParent.get(node.parent_id) ?? [];
    children.push(node.id);
    byParent.set(node.parent_id, children);
  }
  const included = new Set<string>();
  const pending = [scopeId];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || included.has(nodeId)) continue;
    included.add(nodeId);
    pending.push(...(byParent.get(nodeId) ?? []));
  }
  return nodes
    .filter((node) => included.has(node.id))
    .map((node) => node.id);
};

const resolvePeriodRange = (input: {
  period: EnergyPeriod;
  timezone: string;
  from?: string;
  to?: string;
  now: Date;
}): { from: string; to: string } => {
  if (input.period === "Custom") {
    if (!input.from || !input.to) {
      throw new Error("ENERGYIQ_CUSTOM_RANGE_REQUIRED");
    }
    const from = parseRangeBoundary(input.from, input.timezone, false);
    const to = parseRangeBoundary(input.to, input.timezone, true);
    if (Date.parse(from) >= Date.parse(to)) {
      throw new Error("ENERGYIQ_INVALID_RANGE");
    }
    return { from, to };
  }
  const today = localDate(input.now, input.timezone);
  if (input.period === "Previous week") {
    const localWeekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    const daysSinceMonday = (localWeekday + 6) % 7;
    const currentMonday = shiftDate(today, -daysSinceMonday);
    return {
      from: zonedStartOfDay(shiftDate(currentMonday, -7), input.timezone),
      to: zonedStartOfDay(currentMonday, input.timezone),
    };
  }
  if (input.period === "Previous month") {
    const currentMonthStart = `${today.slice(0, 7)}-01`;
    const previousMonthEnd = shiftDate(currentMonthStart, -1);
    const previousMonthStart = `${previousMonthEnd.slice(0, 7)}-01`;
    return {
      from: zonedStartOfDay(previousMonthStart, input.timezone),
      to: zonedStartOfDay(currentMonthStart, input.timezone),
    };
  }
  const endDate = today;
  const days = input.period === "Yesterday" ? 1 : input.period === "Last 7 days" ? 7 : 30;
  return {
    from: zonedStartOfDay(shiftDate(endDate, -days), input.timezone),
    to: zonedStartOfDay(endDate, input.timezone)
  };
};

const parseRangeBoundary = (
  value: string,
  timezone: string,
  inclusiveDateEnd: boolean
): string => {
  if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return zonedStartOfDay(inclusiveDateEnd ? shiftDate(value, 1) : value, timezone);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("ENERGYIQ_INVALID_RANGE");
  }
  return new Date(timestamp).toISOString();
};

const localDate = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const shiftDate = (date: string, days: number): string => {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const zonedStartOfDay = (date: string, timezone: string): string => {
  const [year, month, day] = date.split("-").map(Number);
  const targetUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  let candidate = targetUtc;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(new Date(candidate));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const observedAsUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
    candidate += targetUtc - observedAsUtc;
  }
  return new Date(candidate).toISOString();
};
