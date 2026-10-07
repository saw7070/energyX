import {
  ENERGYIQ_VIEWER_ROLE_ID,
  type EnergyIqAccessRoleRecord,
  type EnergyIqRole,
  type EnergyIqRolePermissions,
  type MetadataStore,
  type UserRecord,
  type WorkspaceRecord
} from "@datafoundry/metadata";
import { randomUUID } from "node:crypto";

import { AuthError, type AuthService } from "../auth/service.js";
import { BOOTSTRAP_WORKSPACE_IDS } from "./energy-bootstrap.js";
import { deleteEnergyProject, setEnergyProjectArchived } from "./energy-project-lifecycle.js";
import {
  moveEnergyProjectToWorkspace,
  type EnergyProjectMoveFactStore,
  type EnergyProjectMoveResult
} from "./energy-project-move.js";

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
  /** The access role this user holds in each of their Organisations. */
  organisationRoles: Record<string, { roleId: string; roleName: string }>;
  projectIds: string[];
  lastLoginAt?: string;
  createdAt: string;
};

export type EnergyAdminRoleDto = {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  permissions: EnergyIqRolePermissions;
  /** How many people hold this role, so a role in use is not deleted by accident. */
  assignedCount: number;
};

export class EnergyAdminAccessService {
  constructor(
    private readonly metadataStore: MetadataStore,
    private readonly authService: AuthService,
    private readonly factStore?: EnergyProjectMoveFactStore
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

  async moveProject(input: {
    actorUserId: string;
    projectId: string;
    organisationId: string;
  }): Promise<{ result: EnergyProjectMoveResult; organisations: EnergyAdminOrganisationDto[] }> {
    const result = await moveEnergyProjectToWorkspace({
      metadataStore: this.metadataStore,
      projectId: input.projectId,
      targetWorkspaceId: input.organisationId,
      ...(this.factStore ? { factStore: this.factStore } : {})
    });
    this.audit("energyiq.project_moved", input.actorUserId, result);
    return { result, organisations: this.listOrganisations() };
  }

  /** Permanently deletes an empty customer Organisation: no projects (including archived) and no members. */
  deleteOrganisation(input: { actorUserId: string; id: string }): { organisations: EnergyAdminOrganisationDto[] } {
    const organisation = this.requireCustomerWorkspace(input.id);
    if (BOOTSTRAP_WORKSPACE_IDS.has(organisation.id)) {
      throw new AuthError(409, "CONFLICT", "This built-in Organisation is re-created on every startup and cannot be deleted.");
    }
    if (this.metadataStore.energyIq.listProjectsByWorkspace(organisation.id).length > 0) {
      throw new AuthError(409, "CONFLICT", "Move, or delete, this Organisation's projects first.");
    }
    if (this.metadataStore.workspaceMemberships.listByWorkspace({ workspace_id: organisation.id }).length > 0) {
      throw new AuthError(409, "CONFLICT", "Remove this Organisation's users first.");
    }
    const db = this.metadataStore.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      // Workspace-scoped settings created alongside the Organisation go with it.
      for (const table of ["config_resources", "encrypted_secrets", "workspace_default_model_profiles"]) {
        const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
        if (exists) db.prepare(`DELETE FROM "${table}" WHERE workspace_id = ?`).run(organisation.id);
      }
      db.prepare("DELETE FROM workspaces WHERE id = ?").run(organisation.id);
      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
      throw new AuthError(409, "CONFLICT", "This Organisation still holds files or history and cannot be deleted. Disable it instead.");
    }
    this.audit("energyiq.organisation_deleted", input.actorUserId, { organisationId: organisation.id, name: organisation.name });
    return { organisations: this.listOrganisations() };
  }

  setProjectArchived(input: { actorUserId: string; projectId: string; archived: boolean }): { organisations: EnergyAdminOrganisationDto[] } {
    const result = setEnergyProjectArchived({ metadataStore: this.metadataStore, projectId: input.projectId, archived: input.archived });
    this.audit(input.archived ? "energyiq.project_archived" : "energyiq.project_restored", input.actorUserId, result);
    return { organisations: this.listOrganisations() };
  }

  async deleteProject(input: { actorUserId: string; projectId: string; confirmName: string }): Promise<{ organisations: EnergyAdminOrganisationDto[] }> {
    const result = await deleteEnergyProject({
      metadataStore: this.metadataStore,
      projectId: input.projectId,
      confirmName: input.confirmName,
      ...(this.factStore ? { purgeFacts: this.factStore.purge, resolveFactStorePath: this.factStore.resolvePath } : {})
    });
    this.audit("energyiq.project_deleted", input.actorUserId, result);
    return { organisations: this.listOrganisations() };
  }

  listRoles(): EnergyAdminRoleDto[] {
    return this.metadataStore.energyIq.roles.list().map((role) => this.roleDto(role));
  }

  createRole(input: { actorUserId: string; name: string; description?: string; permissions: unknown }): EnergyAdminRoleDto {
    const role = this.roleChange(() => this.metadataStore.energyIq.roles.create({
      id: `role-${randomUUID().slice(0, 12)}`,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      permissions: input.permissions
    }));
    this.audit("energyiq.role_created", input.actorUserId, { roleId: role.id, name: role.name, permissions: role.permissions });
    return this.roleDto(role);
  }

  updateRole(input: { actorUserId: string; id: string; name: string; description?: string; permissions: unknown }): EnergyAdminRoleDto {
    const role = this.roleChange(() => this.metadataStore.energyIq.roles.update({
      id: input.id,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      permissions: input.permissions
    }));
    this.audit("energyiq.role_updated", input.actorUserId, { roleId: role.id, name: role.name, permissions: role.permissions });
    return this.roleDto(role);
  }

  deleteRole(input: { actorUserId: string; id: string }): { roles: EnergyAdminRoleDto[] } {
    const role = this.roleChange(() => this.metadataStore.energyIq.roles.require(input.id));
    this.roleChange(() => this.metadataStore.energyIq.roles.delete(input.id));
    this.audit("energyiq.role_deleted", input.actorUserId, { roleId: role.id, name: role.name });
    return { roles: this.listRoles() };
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
    /** Organisation id -> role id. Organisations left out keep their current role, or Viewer when new. */
    organisationRoles?: Record<string, string>;
  }): Promise<{ invitationUrl?: string; user: EnergyAdminUserDto }> {
    const organisationIds = this.validateMemberships(input.organisationIds, input.role);
    const invitation = await this.authService.inviteUser({
      email: input.email,
      inviterUserId: input.actorUserId,
      ...(input.displayName ? { displayName: input.displayName } : {})
    });
    this.metadataStore.energyIq.upsertUserRole({ user_id: invitation.user.id, role: input.role });
    this.replaceCustomerMemberships(invitation.user.id, organisationIds, input.role, input.organisationRoles);
    this.audit("energyiq.user_access_assigned", input.actorUserId, {
      targetUserId: invitation.user.id,
      organisationIds,
      role: input.role,
      organisationRoles: input.organisationRoles ?? null
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
    organisationRoles?: Record<string, string>;
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
    this.replaceCustomerMemberships(current.id, organisationIds, input.role, input.organisationRoles);
    this.metadataStore.users.setDisabled({ user_id: current.id, disabled: input.disabled });
    if (input.disabled) {
      this.metadataStore.authSessions.revokeByUser({ user_id: current.id });
    }
    this.audit("energyiq.user_updated", input.actorUserId, {
      targetUserId: current.id,
      disabled: input.disabled,
      organisationIds,
      role: input.role,
      organisationRoles: input.organisationRoles ?? null
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
    const organisationRoles = Object.fromEntries(organisations.map((organisation) => {
      const roleId = this.metadataStore.workspaceMemberships.find({ workspace_id: organisation.id, user_id: user.id })?.role_id
        ?? ENERGYIQ_VIEWER_ROLE_ID;
      return [organisation.id, { roleId, roleName: this.metadataStore.energyIq.roles.find(roleId)?.name ?? "Unknown role" }];
    }));
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
      organisationRoles,
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

  /**
   * Makes the user's customer Organisations exactly `organisationIds`, each with an access role. A role that is not
   * named keeps what the person already has, or Viewer for a new member. Super admins hold no per-Organisation role.
   */
  private replaceCustomerMemberships(
    userId: string,
    organisationIds: string[],
    role: EnergyIqRole,
    roles: Record<string, string> = {}
  ): void {
    const requested = new Set(organisationIds);
    for (const [organisationId, roleId] of Object.entries(roles)) {
      if (!requested.has(organisationId)) continue;
      if (!this.metadataStore.energyIq.roles.find(roleId)) throw new AuthError(400, "BAD_REQUEST", "That role no longer exists.");
    }
    for (const workspace of this.metadataStore.workspaces.listByUser({ user_id: userId })) {
      if (workspace.kind === "customer" && !requested.has(workspace.id)) {
        this.metadataStore.workspaceMemberships.remove({ workspace_id: workspace.id, user_id: userId });
      }
    }
    for (const workspaceId of requested) {
      const existing = this.metadataStore.workspaceMemberships.find({ workspace_id: workspaceId, user_id: userId });
      if (existing?.role === "owner") continue;
      const chosen = role === "admin" ? undefined : roles[workspaceId];
      this.metadataStore.workspaceMemberships.upsert({
        workspace_id: workspaceId,
        user_id: userId,
        role: "member",
        ...(chosen !== undefined ? { role_id: chosen === ENERGYIQ_VIEWER_ROLE_ID ? null : chosen } : {})
      });
    }
  }

  private roleDto(role: EnergyIqAccessRoleRecord): EnergyAdminRoleDto {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      builtin: role.builtin,
      permissions: role.permissions,
      assignedCount: this.metadataStore.energyIq.roles.countAssignments(role.id)
    };
  }

  private roleChange<T>(action: () => T): T {
    try {
      return action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("ENERGYIQ_ROLE_NOT_FOUND")) throw new AuthError(404, "RESOURCE_NOT_FOUND", "Role not found.");
      if (message === "ENERGYIQ_ROLE_NAME_REQUIRED") throw new AuthError(400, "BAD_REQUEST", "Give the role a name.");
      if (message === "ENERGYIQ_ROLE_NAME_TAKEN") throw new AuthError(409, "CONFLICT", "A role with that name already exists.");
      if (message === "ENERGYIQ_ROLE_BUILTIN") throw new AuthError(409, "CONFLICT", "Built-in roles cannot be changed or deleted.");
      if (message === "ENERGYIQ_ROLE_IN_USE") throw new AuthError(409, "CONFLICT", "Someone still holds this role. Change their role first.");
      throw error;
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
