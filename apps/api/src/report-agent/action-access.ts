import type { MetadataStore } from "@datafoundry/metadata";
import { resolveEnergyProjectCapabilities } from "../energy/energy-project-capabilities.js";
import { resolveEnergyIqUserRole } from "../energy/energy-user-role.js";
import type { ActionScope } from "./action-store.js";

/** Action access is not implied by permission to create an ordinary report. */
export function assertPrivateActionAccess(metadata: MetadataStore, scope: ActionScope): void {
  const caps = resolveEnergyProjectCapabilities({ metadataStore: metadata, ...scope });
  if (process.env.ENERGYIQ_ACTIONS_PILOT_ENABLED !== "true" || !caps.readReports ||
    resolveEnergyIqUserRole(metadata, metadata.users.getById({ user_id: scope.userId })) !== "admin")
    throw new Error("REPORT_ACTION_ACCESS_FORBIDDEN");
}

/** Report reading grants a bounded Action workflow, never arbitrary Agent execution. */
export function canUseActions(metadata: MetadataStore, scope: ActionScope): boolean {
  if (process.env.ENERGYIQ_ACTIONS_PILOT_ENABLED !== "true") return false;
  const caps = resolveEnergyProjectCapabilities({ metadataStore: metadata, ...scope });
  if (!caps.readReports) return false;
  return process.env.ENERGYIQ_ACTIONS_CUSTOMER_ENABLED === "true" ||
    resolveEnergyIqUserRole(metadata, metadata.users.getById({ user_id: scope.userId })) === "admin";
}
export function assertActionAccess(metadata: MetadataStore, scope: ActionScope): void {
  if (!canUseActions(metadata, scope)) throw new Error("REPORT_ACTION_ACCESS_FORBIDDEN");
}
