import { gridEmissionFactorFor, type MetadataStore, type EnergyIqMeterPresentation, type EnergyIqProjectSetupDocument } from "@datafoundry/metadata";
import { resolveEnergyProjectCapabilities } from "./energy-project-capabilities.js";
import { resolveEnergyPublishedHierarchyNodes } from "./energy-query-context.js";
import { ReportFeedbackStore } from "../report-agent/report-feedback-store.js";

/** presentation.always_on === "true": the meter form's "Always on by design" tick; the meter is meant to run day and night. */
const alwaysOn = (presentation: EnergyIqMeterPresentation | undefined) => presentation?.always_on === "true";
/** presentation.never_used === "true": "Should never use power (alert me if it does)"; any use raises an alert. */
const neverUsed = (presentation: EnergyIqMeterPresentation | undefined) => presentation?.never_used === "true";
/** presentation.occasional_use === "true": "Used now and then"; its quiet spells are normal, never an outage. */
const occasionalUse = (presentation: EnergyIqMeterPresentation | undefined) => presentation?.occasional_use === "true";
/** presentation.light_count: how many light points the meter feeds, a positive whole number kept as text. Anything else: not recorded. */
const lightCount = (presentation: EnergyIqMeterPresentation | undefined): number | null => {
  const value: unknown = presentation?.light_count;
  const text = typeof value === "string" ? value.trim() : "";
  const count = /^\d+$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(count) && count > 0 ? count : null;
};

type GroupNode = { id: string; name: string; node_type?: string | null; parent_id?: string | null };
type GroupMeter = { scope_id: string; navigation_scope_id?: string | null; display_name?: string; source_label?: string; presentation?: EnergyIqMeterPresentation };
const sameName = (left: string | undefined | null, right: string | undefined | null) => !!left && !!right && left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

/**
 * Circuit nodes that are really groups people made. A circuit node used to stand for one meter (named after it), and
 * reports file that meter under the node's parent. Groups made in Facility → Floor layout can carry the circuit tier
 * too ("Ground floor", "Block lighting" inside a block), so a circuit node counts as a group when it holds more than one
 * meter, has groups inside it, or is named differently from the one meter it holds.
 */
export function circuitGroupIds(nodes: GroupNode[], meters: GroupMeter[]): Set<string> {
  const groups = new Set<string>();
  for (const node of nodes) {
    if (node.node_type !== "circuit") continue;
    const inside = meters.filter(meter => (meter.navigation_scope_id ?? meter.scope_id) === node.id);
    const hasChildren = nodes.some(other => other.parent_id === node.id);
    const namedAfterItsMeter = inside.length === 1 && [inside[0]!.presentation?.device_name, inside[0]!.presentation?.circuit_name, inside[0]!.presentation?.short_name, inside[0]!.display_name, inside[0]!.source_label].some(name => sameName(name, node.name));
    if (inside.length > 1 || hasChildren || (inside.length === 1 && !namedAfterItsMeter)) groups.add(node.id);
  }
  return groups;
}

/**
 * Published customer information only; do not return setup documents or policy catalogs.
 *
 * Also carries what people told the AI about the site's reports (report feedback): active memory, follow-ups that are
 * open or closed in the last 31 days, and report points the site said not to flag. The site's own reports read them.
 * They belong to the reports, so only someone who may read the reports gets them; anyone else gets empty lists.
 */
export function readEnergyProjectInformation(metadata: MetadataStore, userId: string, workspaceId: string, projectId: string) {
  const capabilities = resolveEnergyProjectCapabilities({ metadataStore: metadata, userId, workspaceId, projectId });
  if (!capabilities.readProjectInformation) throw Error("ENERGYIQ_PROJECT_FORBIDDEN");
  const information = buildEnergyProjectInformation(metadata, projectId);
  const feedback = capabilities.readReports
    ? new ReportFeedbackStore(metadata.db).reportInputs(projectId, new Date(), information.timezone)
    : { feedbackMemory: [], followUps: [], dismissedChecks: [] };
  return { ...information, ...feedback };
}

/**
 * The published information itself, without any access check. Only for server-side use after the caller has checked
 * access in its own way (for example, the report feedback AI describing the site to the model).
 */
export function buildEnergyProjectInformation(metadata: MetadataStore, projectId: string) {
  const project = metadata.energyIq.getProject(projectId);
  const published = metadata.energyIq.templates.getLatestProjectRevision(projectId);
  const hierarchyId = published?.hierarchy_revision_id ?? project.hierarchy_revision_id;
  const nodes = resolveEnergyPublishedHierarchyNodes(metadata, projectId, hierarchyId);
  const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(projectId).find(item => item.id === hierarchyId);
  if (!revision) throw Error("ENERGYIQ_PUBLISHED_HIERARCHY_REQUIRED");
  const document = JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument;
  const rows = document.meter_mapping?.rows ?? [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const groupCircuits = circuitGroupIds(nodes, rows);
  const isLocation = (node: { id: string; node_type?: string | null }) => node.node_type !== "circuit" || groupCircuits.has(node.id);
  const locationId = (id: string) => { const node = byId.get(id); return node && !isLocation(node) ? node.parent_id ?? project.root_scope_id : id; };
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
  // The grid emission factor the site's carbon figures use: the one set in Facility → Budget & carbon, else the country's.
  const carbonSetting = (() => { try { return metadata.energyIq.targets.getTargets(projectId).carbon ?? gridEmissionFactorFor(project.region); } catch { return gridEmissionFactorFor(project.region); } })();
  return {
    projectId, name: document.project.name, timezone: document.project.timezone, basis: "published" as const,
    // `sortOrder`: the order someone saved among the groups beside it, so reports list groups the same way.
    locations: nodes.filter(isLocation).map(node => ({ id: node.id, name: node.name, parentId: node.parent_id ?? null, sortOrder: node.sort_order })),
    meters: rows.map(meter => ({ id: meter.id, name: meter.presentation?.short_name?.trim() || meter.presentation?.device_name?.trim() || meter.presentation?.circuit_name?.trim() || meter.display_name || meter.source_label,
      ...(meter.presentation?.short_name?.trim() ? { fullName: meter.presentation?.device_name?.trim() || meter.presentation?.circuit_name?.trim() || meter.display_name || meter.source_label } : {}),
      ...(meter.presentation?.panel?.trim() ? { panel: meter.presentation.panel.trim() } : {}),
      // Someone confirmed on Data availability that this meter is not in use; reports leave it out of complete-day checks.
      ...(meter.presentation?.not_in_use?.trim() ? { notInUse: meter.presentation.not_in_use.trim() } : {}),
      // Meant to run day and night (emergency lighting): reports keep it in totals but never call its daytime use a finding.
      ...(alwaysOn(meter.presentation) ? { alwaysOn: true as const } : {}),
      // Should never use power: any use is someone using it without leave, and raises an alert.
      ...(neverUsed(meter.presentation) ? { neverUsed: true as const } : {}),
      // Used only now and then: it reports only when it uses power, so its quiet spells are normal, never an outage.
      ...(occasionalUse(meter.presentation) ? { occasionalUse: true as const } : {}),
      // How many light points it feeds, when someone recorded it: reports show energy per light for these meters only.
      ...(lightCount(meter.presentation) ? { lightCount: lightCount(meter.presentation)! } : {}),
      locationId: locationId(meter.navigation_scope_id ?? meter.scope_id), location: names.get(locationId(meter.navigation_scope_id ?? meter.scope_id)) ?? "Project", officialAggregation: meter.aggregation_usage === "official" })),
    calendar: calendar ? { version: calendar.version_id, entries: calendar.entries.map(entry => ({
      location: ownerName(entry.owner), from: entry.effective_from, toExclusive: entry.effective_to ?? null,
      ...(entry.hours_meaning === "lights_on" ? { hoursMeaning: "lights_on" as const } : {}),
      weekly: Object.fromEntries(Object.entries(entry.weekly).map(([day, ranges]) => [day, ranges.map(range => ({ from: range.from, to: range.to }))])),
      exceptions: (entry.exceptions ?? []).map(item => ({ date: item.date, label: item.label ?? item.classification ?? "Exception", ...(item.classification ? { classification: item.classification } : {}), operating: item.operating.map(range => ({ from: range.from, to: range.to })) })),
    })) } : null,
    carbon: { kgCo2ePerKwh: carbonSetting.kgCo2ePerKwh, year: carbonSetting.year, source: carbonSetting.source },
    tariff: tariff ? { version: tariff.version_id, entries: tariff.entries.map(entry => ({
      location: ownerName(entry.owner), from: entry.effective_from, toExclusive: entry.effective_to ?? null,
      currency: entry.currency, ratePerKwh: entry.rate_per_kwh, taxBasis: entry.rate_basis ?? null,
      tax: entry.tax ? { name: entry.tax.name, ratePct: entry.tax.rate_pct } : null,
    })) } : null,
  };
}
