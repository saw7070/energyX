import {
  ALL_PERMISSIONS,
  NO_PERMISSIONS,
  permissionAllows,
  type EnergyIqPermissionArea,
  type EnergyIqRolePermissions,
  type MetadataStore,
  type UserRecord
} from "@datafoundry/metadata";
import { resolveEnergyIqUserRole } from "./energy-user-role.js";

/**
 * What one person may do inside one Organisation: everything for a super admin, otherwise whatever the role they
 * hold there allows. Disabled accounts and Organisations, and people who are not members, get nothing.
 */
export const resolveEnergyPermissions = (
  metadataStore: MetadataStore,
  user: UserRecord,
  workspaceId: string,
  env?: Record<string, string | undefined>
): EnergyIqRolePermissions => {
  if (user.disabled_at || !workspaceId) return NO_PERMISSIONS;
  let workspace;
  try {
    workspace = metadataStore.workspaces.get({ id: workspaceId });
  } catch {
    return NO_PERMISSIONS;
  }
  if (workspace.kind !== "customer") return NO_PERMISSIONS;
  if (resolveEnergyIqUserRole(metadataStore, user, env) === "admin") return ALL_PERMISSIONS;
  if (workspace.disabled_at) return NO_PERMISSIONS;
  return metadataStore.energyIq.roles.permissionsFor({ workspace_id: workspaceId, user_id: user.id }) ?? NO_PERMISSIONS;
};

export const can = (
  permissions: EnergyIqRolePermissions,
  area: EnergyIqPermissionArea,
  needed: "read" | "write"
): boolean => permissionAllows(permissions, area, needed);
