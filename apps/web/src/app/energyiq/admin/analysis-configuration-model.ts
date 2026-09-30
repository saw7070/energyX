import type {
  EnergyComponentRevisionDto,
  EnergyMetricRevisionDto,
  EnergyProjectSetupDocumentDto,
  EnergyRuleRevisionDto,
  EnergyTemplateDefinitionDto,
} from "../../../lib/config-api";

export type MetricReadiness = {
  status: "ready" | "partial" | "missing";
  label: string;
  detail: string;
};

export type RuleReadiness = MetricReadiness;
export type ComponentReadiness = MetricReadiness;

export function resolveMetricReadiness(
  metric: EnergyMetricRevisionDto,
  document: EnergyProjectSetupDocumentDto,
): MetricReadiness {
  if (metric.requirement === "always") {
    return {
      status: "ready",
      label: "Ready",
      detail: "Available from interval facts",
    };
  }

  const tierOrdinalById = new Map(document.tiers.map((tier) => [tier.id, tier.ordinal]));
  const minimumOrdinal = Math.min(...document.tiers.map((tier) => tier.ordinal));
  const analyticalNodes = document.nodes.filter((node) =>
    (tierOrdinalById.get(node.tier_definition_id) ?? minimumOrdinal) > minimumOrdinal
  );
  const candidates = analyticalNodes.length > 0 ? analyticalNodes : document.nodes;
  const readyCount = candidates.filter((node) => metric.requirement === "area"
    ? typeof node.area_sqm === "number" && node.area_sqm > 0
    : typeof node.occupant_count === "number" && node.occupant_count > 0
  ).length;
  const metadataLabel = metric.requirement === "area" ? "area" : "24-hour people";

  if (readyCount === 0) {
    return {
      status: "missing",
      label: "Not ready",
      detail: `Missing ${metadataLabel} metadata`,
    };
  }
  if (readyCount < candidates.length) {
    return {
      status: "partial",
      label: "Partially ready",
      detail: `${readyCount}/${candidates.length} analytical scopes have ${metadataLabel} metadata`,
    };
  }
  return {
    status: "ready",
    label: "Ready",
    detail: `${readyCount}/${candidates.length} analytical scopes have ${metadataLabel} metadata`,
  };
}

export function resolveRuleReadiness(
  rule: EnergyRuleRevisionDto,
  document: EnergyProjectSetupDocumentDto,
  selectedMetricRevisionIds: ReadonlySet<string>,
  businessCalendarVersion: string,
): RuleReadiness {
  const missingMetrics = rule.metric_revision_ids.filter((id) => !selectedMetricRevisionIds.has(id));
  if (missingMetrics.length > 0) {
    return {
      status: "missing",
      label: "Not ready",
      detail: `Enable ${missingMetrics.length} required metric${missingMetrics.length === 1 ? "" : "s"} first`,
    };
  }

  if (rule.requirement === "always") {
    return { status: "ready", label: "Ready", detail: "Required metrics are enabled" };
  }
  if (rule.requirement === "operating_hours") {
    return businessCalendarVersion.trim()
      ? { status: "ready", label: "Ready", detail: `Uses ${businessCalendarVersion}` }
      : { status: "missing", label: "Not ready", detail: "Missing operating-hours calendar" };
  }

  const minimumPeers = numericParameter(rule.parameters.minimum_peers, 2);
  const groups = peerGroups(document, rule.requirement);
  const largestGroup = Math.max(0, ...groups.values());
  if (largestGroup >= minimumPeers) {
    const subject = rule.requirement === "children"
      ? "child scopes"
      : rule.requirement === "area_peers"
        ? "area-comparable sibling scopes"
        : "people-comparable sibling scopes";
    return {
      status: "ready",
      label: "Ready",
      detail: `${largestGroup} ${subject} available`,
    };
  }

  const subject = rule.requirement === "children"
    ? "child scopes"
    : rule.requirement === "area_peers"
      ? "siblings with area metadata"
      : "siblings with people metadata";
  return {
    status: "missing",
    label: "Not ready",
    detail: `${largestGroup}/${minimumPeers} required ${subject}`,
  };
}

export function resolveComponentReadiness(
  component: EnergyComponentRevisionDto,
  template: EnergyTemplateDefinitionDto,
  document: EnergyProjectSetupDocumentDto,
  selectedMetricRevisionIds: ReadonlySet<string>,
  selectedRuleRevisionIds: ReadonlySet<string>,
  businessCalendarVersion: string,
): ComponentReadiness {
  const missingMetrics = component.metric_revision_ids.filter((id) => !selectedMetricRevisionIds.has(id));
  const missingRules = component.rule_revision_ids.filter((id) => !selectedRuleRevisionIds.has(id));
  if (missingMetrics.length + missingRules.length > 0) {
    return {
      status: "missing",
      label: "Not ready",
      detail: `Enable ${missingMetrics.length + missingRules.length} required Metric/Rule revision${missingMetrics.length + missingRules.length === 1 ? "" : "s"}`,
    };
  }
  if (component.requirement === "rules") {
    return selectedRuleRevisionIds.size > 0
      ? { status: "ready", label: "Ready", detail: `${selectedRuleRevisionIds.size} enabled rules can provide findings` }
      : { status: "missing", label: "Not ready", detail: "Enable at least one deterministic rule" };
  }
  if (component.requirement === "operating_hours") {
    return businessCalendarVersion.trim()
      ? { status: "ready", label: "Ready", detail: `Uses ${businessCalendarVersion}` }
      : { status: "missing", label: "Not ready", detail: "Missing operating-hours calendar" };
  }
  if (component.requirement === "always") {
    return { status: "ready", label: "Ready", detail: "Required calculations are enabled" };
  }

  const targetNodes = template.target_kind === "project"
    ? [{ id: "__project__" }]
    : document.nodes
        .filter((node) => node.tier_definition_id === template.tier_definition_id)
        .map((node) => ({ id: node.id }));
  const childGroups = targetNodes.map((target) => target.id === "__project__"
    ? document.nodes.filter((node) => !node.parent_id)
    : document.nodes.filter((node) => node.parent_id === target.id));

  if (component.requirement === "meter_breakdown") {
    const mappingRows = document.meter_mapping?.rows ?? [];
    const parentByNodeId = new Map(document.nodes.map((node) => [node.id, node.parent_id]));
    const readyTargets = targetNodes.filter((target) => target.id !== "__project__" && mappingRows.some((row) =>
      isNodeInsideScope(row.scope_id, target.id, parentByNodeId)
    )).length;
    return readinessForTargetCount(readyTargets, targetNodes.length, "template scopes have mapped meters");
  }

  const minimumPeers = component.requirement === "children" ? 2 : 3;
  const peerCounts = childGroups.map((children) => {
    if (component.requirement === "children") return children.length;
    return children.filter((child) => component.requirement === "area_peers"
      ? typeof child.area_sqm === "number" && child.area_sqm > 0
      : typeof child.occupant_count === "number" && child.occupant_count > 0
    ).length;
  });
  const qualifyingGroups = peerCounts.filter((count) => count >= minimumPeers).length;
  const label = component.requirement === "children"
    ? "template scopes have comparable children"
    : component.requirement === "area_peers"
      ? "template scopes have at least 3 area-comparable children"
      : "template scopes have at least 3 people-comparable children";
  const readiness = readinessForTargetCount(qualifyingGroups, childGroups.length, label);
  if (readiness.status !== "missing") return readiness;
  const bestAvailableGroup = peerCounts.length > 0 ? Math.max(...peerCounts) : 0;
  return {
    ...readiness,
    detail: `${readiness.detail} · best available group ${bestAvailableGroup}/${minimumPeers}`,
  };
}

function readinessForTargetCount(readyCount: number, totalCount: number, detailLabel: string): ComponentReadiness {
  if (totalCount > 0 && readyCount === totalCount) {
    return { status: "ready", label: "Ready", detail: `${readyCount}/${totalCount} ${detailLabel}` };
  }
  if (readyCount > 0) {
    return { status: "partial", label: "Partially ready", detail: `${readyCount}/${totalCount} ${detailLabel}` };
  }
  return { status: "missing", label: "Not ready", detail: `0/${totalCount} ${detailLabel}` };
}

function isNodeInsideScope(
  nodeId: string,
  scopeId: string,
  parentByNodeId: ReadonlyMap<string, string | undefined>,
): boolean {
  let current: string | undefined = nodeId;
  while (current) {
    if (current === scopeId) return true;
    current = parentByNodeId.get(current);
  }
  return false;
}

function peerGroups(
  document: EnergyProjectSetupDocumentDto,
  requirement: EnergyRuleRevisionDto["requirement"],
): Map<string, number> {
  const minimumOrdinal = Math.min(...document.tiers.map((tier) => tier.ordinal));
  const tierOrdinalById = new Map(document.tiers.map((tier) => [tier.id, tier.ordinal]));
  const groups = new Map<string, number>();

  for (const node of document.nodes) {
    const ordinal = tierOrdinalById.get(node.tier_definition_id) ?? minimumOrdinal;
    const hasRequiredMetadata = requirement === "children"
      ? true
      : requirement === "area_peers"
        ? ordinal > minimumOrdinal && typeof node.area_sqm === "number" && node.area_sqm > 0
        : ordinal > minimumOrdinal && typeof node.occupant_count === "number" && node.occupant_count > 0;
    if (!hasRequiredMetadata) continue;

    const groupId = `${node.parent_id ?? "__project__"}:${node.tier_definition_id}`;
    groups.set(groupId, (groups.get(groupId) ?? 0) + 1);
  }
  return groups;
}

function numericParameter(value: number | string | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
