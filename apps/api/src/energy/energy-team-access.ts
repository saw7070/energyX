import {
  ENERGYIQ_PERMISSION_AREAS,
  ENERGYIQ_VIEWER_ROLE_ID,
  type EnergyIqRolePermissions,
  type MetadataStore,
  type UserRecord,
  type WorkspaceRecord
} from "@datafoundry/metadata";
import { randomUUID } from "node:crypto";

import { AuthError, type AuthService } from "../auth/service.js";
import { can, resolveEnergyPermissions } from "./energy-permissions.js";
import { resolveEnergyIqUserRole } from "./energy-user-role.js";

export type EnergyTeamMemberDto = {
  id: string;
  displayName?: string;
  email?: string;
  status: "pending" | "active" | "disabled";
  /** The role this person holds in the Organisation, as a name. */
  roleName: string;
  /** Whether the caller may remove or re-invite this person. Managers and anyone with more power are not theirs to change. */
  canChange: boolean;
  lastLoginAt?: string;
};

export type EnergyTeamRoleDto = {
  id: string;
  name: string;
  description: string;
  permissions: EnergyIqRolePermissions;
  /** How many people hold this role in this Organisation. */
  memberCount: number;
};

export type EnergyTeamDto = {
  organisation: { id: string; name: string };
  members: EnergyTeamMemberDto[];
  /** The roles in use here, plus Viewer, so the page can say what each one allows. */
  roles: EnergyTeamRoleDto[];
};

/**
 * People management for one Organisation, for platform administrators and for anyone whose role gives them
 * "People: write" there (and read-only sight of the list with "People: read"). Every call is confined to the Organisation named by `workspaceId`; the caller's right
 * over that Organisation is re-checked here on each call, never trusted from the page.
 */
export class EnergyTeamAccessService {
  constructor(
    private readonly metadataStore: MetadataStore,
    private readonly authService: AuthService
  ) {}

  list(input: { actor: UserRecord; workspaceId: string }): EnergyTeamDto {
    const organisation = this.requireAccess(input.actor, input.workspaceId, "read");
    return this.teamDto(organisation, input.actor);
  }

  async invite(input: {
    actor: UserRecord;
    workspaceId: string;
    email: string;
    displayName?: string;
  }): Promise<{ invitationUrl?: string; team: EnergyTeamDto }> {
    const organisation = this.requireAccess(input.actor, input.workspaceId, "write");
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
      throw new AuthError(400, "BAD_REQUEST", "Enter a valid email address.");
    }
    const existing = this.metadataStore.users.findByEmail({ email });
    if (existing) {
      if (this.metadataStore.workspaceMemberships.find({ workspace_id: organisation.id, user_id: existing.id })) {
        throw new AuthError(409, "CONFLICT", "This person already has access to this Organisation.");
      }
      if (resolveEnergyIqUserRole(this.metadataStore, existing) === "admin") {
        throw new AuthError(409, "CONFLICT", "This account already has platform-wide access.");
      }
    }
    const invitation = await this.authService.inviteUser({
      email,
      inviterUserId: input.actor.id,
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim().slice(0, 120) } : {})
    });
    // A new account starts as an ordinary customer user; an existing account keeps whatever role it already has.
    if (!this.metadataStore.energyIq.findUserRole(invitation.user.id)) {
      this.metadataStore.energyIq.upsertUserRole({ user_id: invitation.user.id, role: "user" });
    }
    this.metadataStore.workspaceMemberships.upsert({
      workspace_id: organisation.id,
      user_id: invitation.user.id,
      role: "member"
    });
    this.audit("energyiq.team_member_invited", input.actor.id, {
      organisationId: organisation.id,
      targetUserId: invitation.user.id
    });
    return {
      team: this.teamDto(organisation, input.actor),
      ...(invitation.invitationUrl ? { invitationUrl: invitation.invitationUrl } : {})
    };
  }

  async resendInvitation(input: {
    actor: UserRecord;
    workspaceId: string;
    userId: string;
  }): Promise<{ invitationUrl?: string; team: EnergyTeamDto }> {
    const organisation = this.requireAccess(input.actor, input.workspaceId, "write");
    const target = this.requireChangeableMember(input.actor, organisation, input.userId);
    if (!target.email || target.email_verified_at || target.password_updated_at) {
      throw new AuthError(409, "CONFLICT", "Only people who have not signed up yet can receive another invitation.");
    }
    const invitation = await this.authService.inviteUser({
      email: target.email,
      inviterUserId: input.actor.id,
      ...(target.display_name ? { displayName: target.display_name } : {})
    });
    this.audit("energyiq.team_invitation_resent", input.actor.id, {
      organisationId: organisation.id,
      targetUserId: target.id
    });
    return {
      team: this.teamDto(organisation, input.actor),
      ...(invitation.invitationUrl ? { invitationUrl: invitation.invitationUrl } : {})
    };
  }

  /** Removes the person from this Organisation only. Their account, and any other Organisation, are untouched. */
  remove(input: { actor: UserRecord; workspaceId: string; userId: string }): { team: EnergyTeamDto } {
    const organisation = this.requireAccess(input.actor, input.workspaceId, "write");
    const target = this.requireChangeableMember(input.actor, organisation, input.userId);
    this.metadataStore.workspaceMemberships.remove({ workspace_id: organisation.id, user_id: target.id });
    this.audit("energyiq.team_member_removed", input.actor.id, {
      organisationId: organisation.id,
      targetUserId: target.id
    });
    return { team: this.teamDto(organisation, input.actor) };
  }

  private requireAccess(actor: UserRecord, workspaceId: string, needed: "read" | "write"): WorkspaceRecord {
    let organisation: WorkspaceRecord;
    try {
      organisation = this.metadataStore.workspaces.get({ id: workspaceId });
    } catch {
      throw new AuthError(404, "RESOURCE_NOT_FOUND", "Organisation not found.");
    }
    const allowed = !actor.disabled_at
      && organisation.kind === "customer"
      && !organisation.disabled_at
      && can(resolveEnergyPermissions(this.metadataStore, actor, organisation.id), "people", needed);
    // Same answer for "no such Organisation" and "not yours", so a caller cannot probe other clients.
    if (!allowed) throw new AuthError(403, "FORBIDDEN", "You cannot manage people in this Organisation.");
    return organisation;
  }

  private requireChangeableMember(actor: UserRecord, organisation: WorkspaceRecord, userId: string): UserRecord {
    const membership = this.metadataStore.workspaceMemberships.find({ workspace_id: organisation.id, user_id: userId });
    if (!membership) throw new AuthError(404, "RESOURCE_NOT_FOUND", "This person is not in this Organisation.");
    const target = this.metadataStore.users.getById({ user_id: userId });
    if (!this.canChange(actor, organisation.id, membership.role, target)) {
      throw new AuthError(403, "FORBIDDEN", "Only a platform administrator can change this person.");
    }
    return target;
  }

  /**
   * Whoever manages people may change viewers and others below them, never themselves, a platform admin, another
   * manager of people, or anyone allowed to do more than they can.
   */
  private canChange(actor: UserRecord, organisationId: string, membershipRole: string, target: UserRecord): boolean {
    if (target.id === actor.id || membershipRole !== "member") return false;
    if (!can(resolveEnergyPermissions(this.metadataStore, actor, organisationId), "people", "write")) return false;
    if (resolveEnergyIqUserRole(this.metadataStore, target) === "admin") return false;
    if (resolveEnergyIqUserRole(this.metadataStore, actor) === "admin") return true;
    const mine = resolveEnergyPermissions(this.metadataStore, actor, organisationId);
    const theirs = resolveEnergyPermissions(this.metadataStore, target, organisationId);
    if (theirs.people === "write") return false;
    return ENERGYIQ_PERMISSION_AREAS.every((area) => rank(theirs[area]) <= rank(mine[area]));
  }

  private teamDto(organisation: WorkspaceRecord, actor: UserRecord): EnergyTeamDto {
    const memberships = this.metadataStore.workspaceMemberships.listByWorkspace({ workspace_id: organisation.id });
    const members: EnergyTeamMemberDto[] = [];
    for (const membership of memberships) {
      if (membership.role === "owner") continue;
      const user = this.metadataStore.users.getById({ user_id: membership.user_id });
      const lastLoginAt = this.metadataStore.authSessions.latestSeenAt({ user_id: user.id });
      members.push({
        id: user.id,
        ...(user.display_name ? { displayName: user.display_name } : {}),
        ...(user.email ? { email: user.email } : {}),
        status: user.disabled_at
          ? "disabled"
          : user.dev_token || (user.email_verified_at && user.password_updated_at)
            ? "active"
            : "pending",
        roleName: this.metadataStore.energyIq.roles.find(membership.role_id ?? ENERGYIQ_VIEWER_ROLE_ID)?.name ?? "Unknown role",
        canChange: this.canChange(actor, organisation.id, membership.role, user),
        ...(lastLoginAt ? { lastLoginAt } : {})
      });
    }
    const counts = new Map<string, number>();
    for (const membership of memberships) {
      if (membership.role === "owner") continue;
      const roleId = membership.role_id ?? ENERGYIQ_VIEWER_ROLE_ID;
      counts.set(roleId, (counts.get(roleId) ?? 0) + 1);
    }
    const roles = this.metadataStore.energyIq.roles.list()
      .filter((role) => role.id === ENERGYIQ_VIEWER_ROLE_ID || counts.has(role.id))
      .map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        memberCount: counts.get(role.id) ?? 0
      }));
    return { organisation: { id: organisation.id, name: organisation.name }, members, roles };
  }

  private audit(eventType: string, actorUserId: string, metadata: unknown): void {
    this.metadataStore.authAuditEvents.append({
      id: randomUUID(),
      event_type: eventType,
      user_id: actorUserId,
      metadata
    });
  }
}

const rank = (level: EnergyIqRolePermissions[keyof EnergyIqRolePermissions]): number =>
  level === "write" ? 2 : level === "read" ? 1 : 0;
