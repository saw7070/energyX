import type { MetadataStore } from "@datafoundry/metadata";
import { resolveEnergyIqUserRole } from "./energy-user-role.js";

export type EnergyProjectCapabilities = Readonly<{
  readReports: boolean;
  readExplorer: boolean;
  readProjectInformation: boolean;
  /** Still requires the individual session/run's actor ownership check. */
  readOwnHistory: boolean;
  createReport: boolean;
  manageSkills: boolean;
  manageAutomation: boolean;
  editConfiguration: boolean;
  publishConfiguration: boolean;
}>;

const denied: EnergyProjectCapabilities = Object.freeze({
  readReports: false, readExplorer: false, readProjectInformation: false,
  readOwnHistory: false, createReport: false, manageSkills: false,
  manageAutomation: false, editConfiguration: false, publishConfiguration: false,
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
  const admin = resolveEnergyIqUserRole(metadata, user, input.env) === "admin";
  const member = metadata.workspaceMemberships.find({ workspace_id: workspaceId, user_id: userId });
  if (!admin && (!member || workspace.disabled_at)) return denied;
  // Preserve current project visibility. An editor config draft belongs to a published project.
  if (project.status !== "published" && !(admin && project.status === "draft")) return denied;
  // Two roles: administrators manage the project, its settings and its access; everyone else in the workspace reads
  // its charts and reports and may ask the energy advisor for their own reports, without changing any setting.
  const manage = admin;
  return {
    readReports: true, readExplorer: true, readProjectInformation: true,
    readOwnHistory: true, createReport: true, manageSkills: manage,
    manageAutomation: manage, editConfiguration: manage, publishConfiguration: manage,
  };
}
