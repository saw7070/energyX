import type { MetadataStore } from "@datafoundry/metadata";
import { resolveEnergyProjectCapabilities } from "../energy/energy-project-capabilities.js";

/** Reading an actor's history remains separate from starting a new execution. */
export function authorizeReportConversation(metadata: MetadataStore, userId: string, workspaceId: string, projectId: string) {
  const capabilities = resolveEnergyProjectCapabilities({ metadataStore: metadata, userId, workspaceId, projectId });
  if (!capabilities.readOwnHistory) throw new Error("REPORT_PROJECT_FORBIDDEN");
  return { canChat: capabilities.createReport, canManageProject: capabilities.manageSkills, capabilities };
}

export function authorizeReportExecution(metadata: MetadataStore, userId: string, workspaceId: string, projectId: string) {
  const access = authorizeReportConversation(metadata, userId, workspaceId, projectId);
  if (!access.canChat) throw new Error("REPORT_EXECUTION_FORBIDDEN");
  return access;
}
