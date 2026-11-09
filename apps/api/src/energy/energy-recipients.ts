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

/** Addresses mail cannot reach, such as the built-in admin account's: sending to them only bounces. */
export const isDeliverableEmail = (email: string): boolean => {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return domain.includes(".") && !/\.(local|localhost|invalid)$/u.test(domain);
};

/**
 * Who a site's alerts go to: the list chosen on its Budget & carbon page, or else the people who run it (owners and
 * anyone allowed to change its facility set-up or hours and rates). Addresses mail cannot reach are left out.
 */
export const siteAlertRecipients = (metadataStore: MetadataStore, projectId: string): string[] => {
  const project = metadataStore.energyIq.getProject(projectId);
  const chosen = metadataStore.energyIq.targets.getTargets(projectId).alertEmails;
  const emails = chosen && chosen.length > 0
    ? chosen
    : workspaceTeam(metadataStore, project.workspace_id)
      .filter((member) => member.owner || can(member.permissions, "hours_rate", "write") || can(member.permissions, "facility", "write"))
      .map((member) => member.email);
  return [...new Set(emails.map((email) => email.toLowerCase()))].filter(isDeliverableEmail).sort();
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
