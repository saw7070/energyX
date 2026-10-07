import type { EnergyIqProjectSetupDocument, MetadataStore } from "@datafoundry/metadata";
import { resolveProjectOverviewProfile } from "./project-analysis-resolver.js";
import { can, resolveEnergyPermissions } from "./energy-permissions.js";
import { resolveEnergyProjectCapabilities } from "./energy-project-capabilities.js";
import { resolveEnergyPublishedHierarchyNodes } from "./energy-query-context.js";

/**
 * The Facility screen for someone who may look but not change anything: the same shape the editor loads, built only
 * from what is live. It never reads or creates the editor's saved draft, and it leaves out unpublished changes and the
 * history of earlier rates and calendars.
 */
export function readEnergyFacilityView(metadata: MetadataStore, userId: string, workspaceId: string, projectId: string) {
  const permissions = resolveEnergyPermissions(metadata, metadata.users.getById({ user_id: userId }), workspaceId);
  if (!resolveEnergyProjectCapabilities({ metadataStore: metadata, userId, workspaceId, projectId }).readProjectInformation) {
    throw Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  const project = metadata.energyIq.getProject(projectId);
  const live = metadata.energyIq.templates.getLatestProjectRevision(projectId);
  const hierarchyId = live?.hierarchy_revision_id ?? project.hierarchy_revision_id;
  const revisions = metadata.energyIq.projectSetup.listHierarchyRevisions(projectId);
  const revision = revisions.find((item) => item.id === hierarchyId);
  if (!revision) throw Error("ENERGYIQ_PUBLISHED_HIERARCHY_REQUIRED");
  const fullDocument = JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument;
  // A role without Facility read sees the project's name but not its locations or meters.
  const document: EnergyIqProjectSetupDocument = can(permissions, "facility", "read")
    ? fullDocument
    : { ...fullDocument, nodes: [], ...(fullDocument.meter_mapping ? { meter_mapping: { ...fullDocument.meter_mapping, rows: [], virtual_meters: [] } } : {}) };
  const calendarVersion = (live ? live.business_calendar_version : project.business_calendar_version) ?? null;
  const tariffVersion = (live ? live.tariff_schedule_version : project.tariff_schedule_version) ?? null;
  const policy = metadata.energyIq.operationalPolicy;
  const liveCalendars = policy.listOperatingCalendars(projectId).filter((item) => item.version_id === calendarVersion);
  const liveTariffs = policy.listTariffSchedules(projectId).filter((item) => item.version_id === tariffVersion);
  return {
    setup: {
      // Nothing here is a draft, so the screen never shows "unsaved" or "publish" states.
      project: { ...project, has_unpublished_changes: false },
      overviewProfile: resolveProjectOverviewProfile(metadata, projectId) ?? null,
      draft: {
        project_id: projectId,
        revision: 0,
        based_on_hierarchy_revision_id: hierarchyId,
        document,
        updated_by: revision.published_by,
        updated_at: revision.published_at
      },
      validation: { blocking: false, issues: [] },
      published: {
        tiers: metadata.energyIq.listTierDefinitions(projectId),
        nodes: can(permissions, "facility", "read") ? resolveEnergyPublishedHierarchyNodes(metadata, projectId, hierarchyId) : [],
        revisions: [revision],
        templateRevisions: live ? [live] : []
      }
    },
    policies: !can(permissions, "hours_rate", "read") ? null : {
      projectId,
      timezone: project.timezone,
      published: {
        tariff_schedule_version: tariffVersion,
        business_calendar_version: calendarVersion,
        ...(live ? { template_revision_id: live.revision_id } : {})
      },
      pending: { tariff_schedule_version: tariffVersion, business_calendar_version: calendarVersion },
      tariffRevisions: liveTariffs,
      operatingCalendarRevisions: liveCalendars,
      hasUnpublishedChanges: false
    }
  };
}
