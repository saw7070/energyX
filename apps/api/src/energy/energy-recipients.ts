import type { EnergyIqRolePermissions, MetadataStore, UserRecord } from "@datafoundry/metadata";

import { can, resolveEnergyPermissions } from "./energy-permissions.js";

/**
 * Who in a company hears about what. Alerts about budgets and overnight use go to the people who run the site
 * (allowed to change its facility set-up or its hours and rates, or the client's owners); scheduled reports go only
 * to team members the report was addressed to who can still read reports.
 */
export type TeamMember = {
  user: UserRecord;
  email: string;
  owner: boolean;
  permissions: EnergyIqRolePermissions;
};

export const workspaceTeam = (metadataStore: MetadataStore, workspaceId: string): TeamMember[] =>
  metadataStore.workspaceMemberships.listByWorkspace({ workspace_id: workspaceId }).flatMap((membership) => {
    try {
      const user = metadataStore.users.getById({ user_id: membership.user_id });
      if (!user.email || user.disabled_at) return [];
      return [{ user, email: user.email.toLowerCase(), owner: membership.role === "owner", permissions: resolveEnergyPermissions(metadataStore, user, workspaceId) }];
    } catch {
      return [];
    }
  });

export const siteAlertRecipients = (metadataStore: MetadataStore, projectId: string): string[] => {
  const project = metadataStore.energyIq.getProject(projectId);
  return [...new Set(workspaceTeam(metadataStore, project.workspace_id)
    .filter((member) => member.owner || can(member.permissions, "hours_rate", "write") || can(member.permissions, "facility", "write"))
    .map((member) => member.email))].sort();
};

/**
 * Someone the server can read a site's figures as when no one is signed in: a team member who can read its reports,
 * owners first, or the configured service account.
 */
export const readerForWorkspace = (metadataStore: MetadataStore, workspaceId: string, fallbackUserId?: string): UserRecord | undefined => {
  const team = workspaceTeam(metadataStore, workspaceId)
    .filter((member) => can(member.permissions, "reports", "read"))
    .sort((left, right) => Number(right.owner) - Number(left.owner) || left.user.id.localeCompare(right.user.id));
  if (team[0]) return team[0].user;
  if (!fallbackUserId) return undefined;
  try {
    const user = metadataStore.users.getById({ user_id: fallbackUserId });
    return can(resolveEnergyPermissions(metadataStore, user, workspaceId), "reports", "read") ? user : undefined;
  } catch {
    return undefined;
  }
};
