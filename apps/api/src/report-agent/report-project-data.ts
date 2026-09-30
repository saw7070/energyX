import type { MetadataStore } from "@datafoundry/metadata";
import { readEnergyAnalysisEligibleCoverage } from "@datafoundry/data-gateway";
import { resolveEnergyPublishedMeterRoute } from "../energy/energy-query-context.js";
import { authorizeReportConversation } from "./report-access.js";

export type ReportProjectData = {
  status: "connected" | "not_configured" | "unavailable";
  actualLastIntervalEnd: string | null;
  reason?: string | null;
};
/** Current project binding, independent of report settings, selected files, and previous runs. */
export async function readReportProjectData(metadata: MetadataStore, actorUserId: string, workspaceId: string, projectId: string): Promise<ReportProjectData> {
  authorizeReportConversation(metadata, actorUserId, workspaceId, projectId);
  const unavailable = (reason: string): ReportProjectData => ({ status: "unavailable", actualLastIntervalEnd: null, reason });
  try {
    const project = metadata.energyIq.getProject(projectId);
    const snapshot = metadata.energyIq.findCurrentDataSnapshot(projectId);
    if (!snapshot) return { status: "not_configured", actualLastIntervalEnd: null, reason: "No project data snapshot has been published." };
    if (snapshot.id !== project.data_snapshot_id) return unavailable("The project snapshot changed. Refresh and try again.");
    const route = resolveEnergyPublishedMeterRoute({ metadataStore: metadata, projectId, hierarchyRevisionId: project.hierarchy_revision_id, scopeId: project.root_scope_id, resource: "electricity" });
    const coverage = await readEnergyAnalysisEligibleCoverage({ metadataStore: metadata, workspaceId, projectId, dataSnapshotId: snapshot.id, resource: "electricity", meterAttachments: route.attachments });
    const current = metadata.energyIq.getProject(projectId);
    if (current.data_snapshot_id !== snapshot.id || current.hierarchy_revision_id !== project.hierarchy_revision_id) return unavailable("The project publication changed. Refresh and try again.");
    if (!coverage || coverage.intervalCount <= 0 || !Number.isFinite(Date.parse(coverage.to))) return unavailable("No readable analysis intervals are available in the current project snapshot.");
    return { status: "connected", actualLastIntervalEnd: new Date(coverage.to).toISOString(), reason: null };
  } catch { return unavailable("The published project data could not be read. Check the snapshot and meter mapping."); }
}
