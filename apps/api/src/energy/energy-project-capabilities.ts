import type { MetadataStore } from "@datafoundry/metadata";
import { resolveEnergyIqUserRole } from "./energy-user-role.js";
import { can, resolveEnergyPermissions } from "./energy-permissions.js";

export type EnergyProjectCapabilities = Readonly<{
  readReports: boolean;
  readExplorer: boolean;
  readProjectInformation: boolean;
  /** Still requires the individual session/run's actor ownership check. */
  readOwnHistory: boolean;
  createReport: boolean;
  manageSkills: boolean;
  manageAutomation: boolean;
  /** True when the person may change anything on the Facility page (any of the three below). */
  editConfiguration: boolean;
  /** Locations, meters, floor layout and uploading data. */
  editFacility: boolean;
  /** Operating hours, holidays and electricity rate. */
  editHoursRate: boolean;
  editNotes: boolean;
  /** Connect, test and schedule the live meter feed. */
  manageLiveConnection: boolean;
  publishConfiguration: boolean;
}>;

const denied: EnergyProjectCapabilities = Object.freeze({
  readReports: false, readExplorer: false, readProjectInformation: false,
  readOwnHistory: false, createReport: false, manageSkills: false,
  manageAutomation: false, editConfiguration: false, editFacility: false, editHoursRate: false,
  editNotes: false, manageLiveConnection: false, publishConfiguration: false,
});

/** Read-only, current authorization. Contains no resource visibility or Action grant. */
export function resolveEnergyProjectCapabilities(input: {
  metadataStore: MetadataStore;
  userId: string;
  workspaceId: string;
  projectId: string;
  env?: Record<string, string | undefined>;
}): EnergyProjectCapabilities {
  const { metadataStore: metadata, userId, workspaceId, projectId } = input;
  let user, workspace, project;
  try {
    user = metadata.users.getById({ user_id: userId });
    workspace = metadata.workspaces.get({ id: workspaceId });
    project = metadata.energyIq.getProject(projectId);
  } catch (error) {
    // Missing scope is denied; operational database failures still reach the caller.
    if (error instanceof Error && [
      `User not found: ${userId}`, `WORKSPACE_NOT_FOUND:${workspaceId}`,
      `ENERGYIQ_PROJECT_NOT_FOUND:${projectId}`,
    ].includes(error.message)) return denied;
    throw error;
  }
  if (user.disabled_at || workspace.kind !== "customer" || project.workspace_id !== workspaceId) return denied;
  const permissions = resolveEnergyPermissions(metadata, user, workspaceId, input.env);
  const admin = resolveEnergyIqUserRole(metadata, user, input.env) === "admin";
  const member = metadata.workspaceMemberships.find({ workspace_id: workspaceId, user_id: userId });
  if (!admin && (!member || workspace.disabled_at)) return denied;
  // Preserve current project visibility. An editor config draft belongs to a published project.
  if (project.status !== "published" && !(admin && project.status === "draft")) return denied;
  // Super admins manage everything. Everyone else gets what their role allows in this Organisation: reading and
  // asking the advisor, and changing the Facility's structure, hours and rate, or notes. Skills, automatic reports
  // and making a project live stay with super admins.
  const readsInformation = can(permissions, "facility", "read") || can(permissions, "hours_rate", "read") || can(permissions, "notes", "read");
  const editFacility = can(permissions, "facility", "write");
  const editHoursRate = can(permissions, "hours_rate", "write");
  const editNotes = can(permissions, "notes", "write");
  return {
    readReports: can(permissions, "reports", "read"), readExplorer: can(permissions, "reports", "read"),
    readProjectInformation: readsInformation, readOwnHistory: can(permissions, "reports", "read"),
    createReport: can(permissions, "reports", "write"), manageSkills: admin,
    manageAutomation: admin, editConfiguration: editFacility || editHoursRate || editNotes,
    editFacility, editHoursRate, editNotes, manageLiveConnection: can(permissions, "live_connection", "write"),
    publishConfiguration: admin,
  };
}
