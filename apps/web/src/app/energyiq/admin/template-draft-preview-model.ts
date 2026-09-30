import type {
  EnergyComponentRevisionDto,
  EnergyImportBatchDto,
  EnergyProjectDataCoverageDto,
  EnergyProjectSetupDocumentDto,
  EnergyQueryContextRequestDto,
  EnergyTemplateDefinitionDto,
} from "../../../lib/config-api";
import {
  buildEnergyTemplateRenderPlan,
  type EnergyTemplateRenderPlan,
} from "../_components/energy-template-render-plan";
import { resolveComponentReadiness, type ComponentReadiness } from "./analysis-configuration-model";

export type TemplatePreviewScope = {
  id: string;
  name: string;
  detail: string;
  factsMapped: boolean;
};

export type TemplatePreviewModule = {
  component: EnergyComponentRevisionDto;
  readiness: ComponentReadiness;
};

export type TemplatePreviewPlan = {
  label: string;
  scopes: TemplatePreviewScope[];
  recommendedScopeId: string;
  modules: TemplatePreviewModule[];
  renderPlan: EnergyTemplateRenderPlan;
};

export type EnergyPreviewRange = {
  from: string;
  to: string;
  fromDate: string;
  toDate: string;
  label: string;
  batchId: string;
};

export function buildTemplatePreviewPlan(input: {
  template: EnergyTemplateDefinitionDto;
  document: EnergyProjectSetupDocumentDto;
  catalog: EnergyComponentRevisionDto[];
  selectedMetricRevisionIds: ReadonlySet<string>;
  selectedRuleRevisionIds: ReadonlySet<string>;
  businessCalendarVersion: string;
}): TemplatePreviewPlan {
  const tier = input.document.tiers.find((candidate) => candidate.id === input.template.tier_definition_id);
  const label = input.template.target_kind === "project"
    ? "Project Overview"
    : `${tier?.alias ?? "Tier"} Template`;
  const mappingRows = input.document.meter_mapping?.rows ?? [];
  const parentByNodeId = new Map(input.document.nodes.map((node) => [node.id, node.parent_id]));
  const scopes = input.template.target_kind === "project"
    ? [{
        id: "project",
        name: input.document.project.name,
        detail: mappingRows.length > 0 ? "Whole Project · Meter mapping found" : "Whole Project · No meter mapping",
        factsMapped: mappingRows.length > 0,
      }]
    : input.document.nodes
        .filter((node) => node.tier_definition_id === input.template.tier_definition_id)
        .toSorted((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name))
        .map((node) => {
          const factsMapped = mappingRows.some((row) => isNodeInsideScope(row.scope_id, node.id, parentByNodeId));
          return {
            id: node.id,
            name: node.name,
            detail: `${tier?.alias ?? "Tier scope"} · ${factsMapped ? "Meter mapping found" : "No meter mapping"}`,
            factsMapped,
          };
        });
  const renderPlan = buildEnergyTemplateRenderPlan({
    template: input.template,
    catalog: input.catalog,
    resolveReadiness: (component) => resolveComponentReadiness(
        component,
        input.template,
        input.document,
        input.selectedMetricRevisionIds,
        input.selectedRuleRevisionIds,
        input.businessCalendarVersion,
      ),
  });
  const modules = renderPlan.sections.flatMap((section) => section.modules);
  return {
    label,
    scopes,
    recommendedScopeId: scopes.find((scope) => scope.factsMapped)?.id ?? scopes[0]?.id ?? "",
    modules,
    renderPlan,
  };
}

export function resolveLatestImportedPreviewRange(
  batches: EnergyImportBatchDto[],
  timezone = "Asia/Singapore",
): EnergyPreviewRange | null {
  const candidates = batches
    .filter((batch) => batch.status === "materialized" && batch.inspection.coverageFrom && batch.inspection.coverageTo)
    .toSorted((left, right) => Date.parse(right.materializedAt ?? right.createdAt) - Date.parse(left.materializedAt ?? left.createdAt));
  const latest = candidates[0];
  const from = latest?.inspection.coverageFrom;
  const coverageTo = latest?.inspection.coverageTo;
  if (!latest || !from || !coverageTo) return null;

  const intervalMinutes = latest.inspection.typicalIntervalMinutes ?? 15;
  const to = new Date(Date.parse(coverageTo) + intervalMinutes * 60_000).toISOString();
  const fromDate = localDate(from, timezone);
  const toDate = localDate(coverageTo, timezone);
  return {
    from,
    to,
    fromDate,
    toDate,
    label: `${formatDate(from, timezone)}–${formatDate(coverageTo, timezone)} · ${latest.filename}`,
    batchId: latest.id,
  };
}

export function resolveEnergyPreviewRange(input: {
  coverage: EnergyProjectDataCoverageDto | null;
  batches: EnergyImportBatchDto[];
  timezone: string;
}): EnergyPreviewRange | null {
  if (!input.coverage) return resolveLatestImportedPreviewRange(input.batches, input.timezone);
  const latestBatch = input.batches
    .filter((batch) => batch.status === "materialized")
    .toSorted((left, right) => Date.parse(right.materializedAt ?? right.createdAt) - Date.parse(left.materializedAt ?? left.createdAt))[0];
  const inclusiveEnd = new Date(Date.parse(input.coverage.to) - 1).toISOString();
  return {
    from: input.coverage.from,
    to: input.coverage.to,
    fromDate: localDate(input.coverage.from, input.timezone),
    toDate: localDate(inclusiveEnd, input.timezone),
    label: `${formatDate(input.coverage.from, input.timezone)}–${formatDate(inclusiveEnd, input.timezone)} · ${input.coverage.intervalCount.toLocaleString("en-SG")} intervals`,
    batchId: latestBatch?.id ?? "fact-store",
  };
}

export function buildTemplatePreviewRequest(input: {
  projectId: string;
  scopeId: string;
  period: "Available facts" | "Yesterday" | "Last 7 days" | "Last 30 days" | "Custom";
  previewRange: EnergyPreviewRange | null;
  customFrom: string;
  customTo: string;
  fixedIdentity?: {
    dataSnapshotId: string;
    projectReleaseId: string;
  };
}): EnergyQueryContextRequestDto | null {
  if (!input.projectId || !input.scopeId) return null;
  const fixedPins = input.fixedIdentity
    ? {
        expectedDataSnapshotId: input.fixedIdentity.dataSnapshotId,
        expectedProjectReleaseId: input.fixedIdentity.projectReleaseId,
      }
    : {};
  if (input.period === "Available facts") {
    if (!input.previewRange) return null;
    return {
      projectId: input.projectId,
      scopeId: input.scopeId,
      resource: "electricity",
      period: "Custom",
      from: input.previewRange.from,
      to: input.previewRange.to,
      ...fixedPins,
    };
  }
  if (input.period === "Custom") {
    if (!input.customFrom || !input.customTo) return null;
    return {
      projectId: input.projectId,
      scopeId: input.scopeId,
      resource: "electricity",
      period: "Custom",
      from: input.customFrom,
      to: input.customTo,
      ...fixedPins,
    };
  }
  return {
    projectId: input.projectId,
    scopeId: input.scopeId,
    resource: "electricity",
    period: input.period,
    ...fixedPins,
  };
}

function localDate(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(value));
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
