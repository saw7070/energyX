import type { MetadataStore, EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import { resolveEnergyProjectCapabilities } from "./energy-project-capabilities.js";
import { resolveEnergyPublishedHierarchyNodes } from "./energy-query-context.js";

/** Published customer information only; do not return setup documents or policy catalogs. */
export function readEnergyProjectInformation(metadata: MetadataStore, userId: string, workspaceId: string, projectId: string) {
  if (!resolveEnergyProjectCapabilities({ metadataStore: metadata, userId, workspaceId, projectId }).readProjectInformation) throw Error("ENERGYIQ_PROJECT_FORBIDDEN");
  const project = metadata.energyIq.getProject(projectId);
  const published = metadata.energyIq.templates.getLatestProjectRevision(projectId);
  const hierarchyId = published?.hierarchy_revision_id ?? project.hierarchy_revision_id;
  const nodes = resolveEnergyPublishedHierarchyNodes(metadata, projectId, hierarchyId);
  const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(projectId).find(item => item.id === hierarchyId);
  if (!revision) throw Error("ENERGYIQ_PUBLISHED_HIERARCHY_REQUIRED");
  const document = JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument;
  const rows = document.meter_mapping?.rows ?? [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const locationId = (id: string) => byId.get(id)?.node_type === "circuit" ? byId.get(id)?.parent_id ?? project.root_scope_id : id;
  const names = new Map(nodes.map(node => [node.id, node.name]));
  const calendarVersion = published ? published.business_calendar_version : project.business_calendar_version;
  const tariffVersion = published ? published.tariff_schedule_version : project.tariff_schedule_version;
  const policies = metadata.energyIq.operationalPolicy;
  const readPolicy = <T>(load: () => T): T | null => {
    try { return load(); } catch (error) {
      if (error instanceof Error && /^ENERGYIQ_(TARIFF|OPERATING_CALENDAR)_REVISION_NOT_FOUND:/.test(error.message)) return null;
      throw error;
    }
  };
  const calendar = calendarVersion ? readPolicy(() => policies.getOperatingCalendar(calendarVersion)) : null;
  const tariff = tariffVersion ? readPolicy(() => policies.getTariffSchedule(tariffVersion)) : null;
  if ((calendar && calendar.project_id !== projectId) || (tariff && tariff.project_id !== projectId)) throw Error("ENERGYIQ_PROJECT_POLICY_FORBIDDEN");
  const ownerName = (owner: { kind: "project" } | { kind: "scope"; scope_id: string }) => owner.kind === "project" ? document.project.name : names.get(owner.scope_id) ?? "Location";
  return {
    projectId, name: document.project.name, timezone: document.project.timezone, basis: "published" as const,
    locations: nodes.filter(node => node.node_type !== "circuit").map(node => ({ id: node.id, name: node.name, parentId: node.parent_id ?? null })),
    meters: rows.map(meter => ({ id: meter.id, name: meter.presentation?.device_name?.trim() || meter.presentation?.circuit_name?.trim() || meter.display_name || meter.source_label, locationId: locationId(meter.navigation_scope_id ?? meter.scope_id), location: names.get(locationId(meter.navigation_scope_id ?? meter.scope_id)) ?? "Project", officialAggregation: meter.aggregation_usage === "official" })),
    calendar: calendar ? { version: calendar.version_id, entries: calendar.entries.map(entry => ({
      location: ownerName(entry.owner), from: entry.effective_from, toExclusive: entry.effective_to ?? null,
      weekly: Object.fromEntries(Object.entries(entry.weekly).map(([day, ranges]) => [day, ranges.map(range => ({ from: range.from, to: range.to }))])),
      exceptions: (entry.exceptions ?? []).map(item => ({ date: item.date, label: item.label ?? item.classification ?? "Exception", ...(item.classification ? { classification: item.classification } : {}), operating: item.operating.map(range => ({ from: range.from, to: range.to })) })),
    })) } : null,
    tariff: tariff ? { version: tariff.version_id, entries: tariff.entries.map(entry => ({
      location: ownerName(entry.owner), from: entry.effective_from, toExclusive: entry.effective_to ?? null,
      currency: entry.currency, ratePerKwh: entry.rate_per_kwh, taxBasis: entry.rate_basis ?? null,
      tax: entry.tax ? { name: entry.tax.name, ratePct: entry.tax.rate_pct } : null,
    })) } : null,
  };
}
