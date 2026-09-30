import type { EnergyIqRole, MetadataStore, UserRecord, WorkspaceRecord } from "@datafoundry/metadata";
import { randomUUID } from "node:crypto";

import { AuthError, type AuthService } from "../auth/service.js";

export type EnergyAdminOrganisationDto = {
  id: string;
  name: string;
  status: "active" | "disabled";
  userCount: number;
  projectCount: number;
  projects: Array<{ id: string; name: string; status: string }>;
  createdAt: string;
};

export type EnergyAdminUserDto = {
  id: string;
  displayName?: string;
  email?: string;
  role: EnergyIqRole;
  status: "pending" | "active" | "disabled";
  organisationIds: string[];
  organisations: Array<{ id: string; name: string }>;
  projectIds: string[];
  lastLoginAt?: string;
  createdAt: string;
};

export class EnergyAdminAccessService {
  constructor(
    private readonly metadataStore: MetadataStore,
    private readonly authService: AuthService
  ) {}

  listOrganisations(): EnergyAdminOrganisationDto[] {
    return this.metadataStore.workspaces.list()
      .filter((workspace) => workspace.kind === "customer")
      .map((workspace) => this.organisationDto(workspace));
  }

  createOrganisation(input: { actorUserId: string; name: string }): EnergyAdminOrganisationDto {
    const name = requireName(input.name, "Organisation name");
    const organisation = this.metadataStore.workspaces.upsert({
      id: `organisation-${slug(name)}-${randomUUID().slice(0, 8)}`,
      owner_user_id: input.actorUserId,
      name,
      kind: "customer"
    });
    this.audit("energyiq.organisation_created", input.actorUserId, {
      organisationId: organisation.id,
      name
    });
    return this.organisationDto(organisation);
  }

  updateOrganisation(input: {
    actorUserId: string;
    disabled: boolean;
    id: string;
    name: string;
  }): EnergyAdminOrganisationDto {
    const current = this.requireCustomerWorkspace(input.id);
    const updated = this.metadataStore.workspaces.setCustomerDetails({
      id: current.id,
      name: requireName(input.name, "Organisation name"),
      disabled: input.disabled
    });
    this.audit("energyiq.organisation_updated", input.actorUserId, {
      organisationId: updated.id,
      disabled: input.disabled,
      name: updated.name
    });
    return this.organisationDto(updated);
  }

  listUsers(): EnergyAdminUserDto[] {
    return this.metadataStore.users.list().map((user) => this.userDto(user));
  }

  async inviteUser(input: {
    actorUserId: string;
    displayName?: string;
    email: string;
    organisationIds: string[];
    role: EnergyIqRole;
  }): Promise<{ invitationUrl?: string; user: EnergyAdminUserDto }> {
    const organisationIds = this.validateMemberships(input.organisationIds, input.role);
    const invitation = await this.authService.inviteUser({
      email: input.email,
      inviterUserId: input.actorUserId,
      ...(input.displayName ? { displayName: input.displayName } : {})
    });
    this.metadataStore.energyIq.upsertUserRole({ user_id: invitation.user.id, role: input.role });
    this.replaceCustomerMemberships(invitation.user.id, organisationIds);
    this.audit("energyiq.user_access_assigned", input.actorUserId, {
      targetUserId: invitation.user.id,
      organisationIds,
      role: input.role
    });
    return {
      user: this.userDto(this.metadataStore.users.getById({ user_id: invitation.user.id })),
      ...(invitation.invitationUrl ? { invitationUrl: invitation.invitationUrl } : {})
    };
  }

  async resendInvitation(input: {
    actorUserId: string;
    userId: string;
  }): Promise<{ invitationUrl?: string; user: EnergyAdminUserDto }> {
    const current = this.metadataStore.users.getById({ user_id: input.userId });
    if (!current.email || current.email_verified_at || current.password_updated_at) {
      throw new AuthError(409, "CONFLICT", "Only pending users can receive another invitation.");
    }
    const invitation = await this.authService.inviteUser({
      email: current.email,
      inviterUserId: input.actorUserId,
      ...(current.display_name ? { displayName: current.display_name } : {})
    });
    return {
      user: this.userDto(this.metadataStore.users.getById({ user_id: current.id })),
      ...(invitation.invitationUrl ? { invitationUrl: invitation.invitationUrl } : {})
    };
  }

  updateUser(input: {
    actorUserId: string;
    disabled: boolean;
    displayName: string;
    organisationIds: string[];
    role: EnergyIqRole;
    userId: string;
  }): EnergyAdminUserDto {
    const current = this.metadataStore.users.getById({ user_id: input.userId });
    if (current.id === input.actorUserId && (input.disabled || input.role !== "admin")) {
      throw new AuthError(409, "CONFLICT", "You cannot disable or demote your current administrator account.");
    }
    const organisationIds = this.validateMemberships(input.organisationIds, input.role);
    this.metadataStore.users.updateDisplayName({
      user_id: current.id,
      display_name: requireName(input.displayName, "Display name")
    });
    this.metadataStore.energyIq.upsertUserRole({ user_id: current.id, role: input.role });
    this.replaceCustomerMemberships(current.id, organisationIds);
    this.metadataStore.users.setDisabled({ user_id: current.id, disabled: input.disabled });
    if (input.disabled) {
      this.metadataStore.authSessions.revokeByUser({ user_id: current.id });
    }
    this.audit("energyiq.user_updated", input.actorUserId, {
      targetUserId: current.id,
      disabled: input.disabled,
      organisationIds,
      role: input.role
    });
    return this.userDto(this.metadataStore.users.getById({ user_id: current.id }));
  }

  private organisationDto(workspace: WorkspaceRecord): EnergyAdminOrganisationDto {
    const projects = this.metadataStore.energyIq.listProjectsByWorkspace(workspace.id);
    return {
      id: workspace.id,
      name: workspace.name,
      status: workspace.disabled_at ? "disabled" : "active",
      userCount: this.metadataStore.workspaceMemberships.listByWorkspace({ workspace_id: workspace.id }).length,
      projectCount: projects.length,
      projects: projects.map((project) => ({ id: project.id, name: project.name, status: project.status })),
      createdAt: workspace.created_at
    };
  }

  private userDto(user: UserRecord): EnergyAdminUserDto {
    const organisations = this.metadataStore.workspaces.listByUser({ user_id: user.id })
      .filter((workspace) => workspace.kind === "customer")
      .map((workspace) => ({ id: workspace.id, name: workspace.name }));
    const projectIds = organisations.flatMap((organisation) =>
      this.metadataStore.energyIq.listVisibleProjects({
        user_id: user.id,
        workspace_id: organisation.id,
        is_admin: false
      }).map((project) => project.id)
    );
    const storedRole = this.metadataStore.energyIq.findUserRole(user.id)?.role ?? "user";
    const lastLoginAt = this.metadataStore.authSessions.latestSeenAt({ user_id: user.id });
    return {
      id: user.id,
      ...(user.display_name ? { displayName: user.display_name } : {}),
      ...(user.email ? { email: user.email } : {}),
      role: storedRole,
      status: user.disabled_at
        ? "disabled"
        : user.dev_token || (user.email_verified_at && user.password_updated_at)
          ? "active"
          : "pending",
      organisationIds: organisations.map((organisation) => organisation.id),
      organisations,
      projectIds,
      ...(lastLoginAt ? { lastLoginAt } : {}),
      createdAt: user.created_at
    };
  }

  private validateMemberships(input: string[], role: EnergyIqRole): string[] {
    const ids = [...new Set(input.map((id) => id.trim()).filter(Boolean))];
    if (role === "user" && ids.length === 0) {
      throw new AuthError(400, "BAD_REQUEST", "A customer user must belong to at least one Organisation.");
    }
    for (const id of ids) {
      const workspace = this.requireCustomerWorkspace(id);
      if (workspace.disabled_at) {
        throw new AuthError(409, "CONFLICT", `Organisation is disabled: ${workspace.name}`);
      }
    }
    return ids;
  }

  private replaceCustomerMemberships(userId: string, organisationIds: string[]): void {
    const requested = new Set(organisationIds);
    for (const workspace of this.metadataStore.workspaces.listByUser({ user_id: userId })) {
      if (workspace.kind === "customer" && !requested.has(workspace.id)) {
        this.metadataStore.workspaceMemberships.remove({ workspace_id: workspace.id, user_id: userId });
      }
    }
    for (const workspaceId of requested) {
      this.metadataStore.workspaceMemberships.upsert({
        workspace_id: workspaceId,
        user_id: userId,
        role: "member"
      });
    }
  }

  private requireCustomerWorkspace(id: string): WorkspaceRecord {
    let workspace: WorkspaceRecord;
    try {
      workspace = this.metadataStore.workspaces.get({ id });
    } catch {
      throw new AuthError(404, "RESOURCE_NOT_FOUND", "Organisation not found.");
    }
    if (workspace.kind !== "customer") {
      throw new AuthError(400, "BAD_REQUEST", "Personal Workspaces cannot be managed as Organisations.");
    }
    return workspace;
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

const requireName = (value: string, label: string): string => {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized) throw new AuthError(400, "BAD_REQUEST", `${label} is required.`);
  return normalized.slice(0, 120);
};

const slug = (value: string): string => value
  .toLowerCase()
  .replace(/[^a-z0-9]+/gu, "-")
  .replace(/^-|-$/gu, "")
  .slice(0, 32) || "customer";
