"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  configApi,
  type EnergyAdminOrganisationDto,
  type EnergyAdminRoleDto,
  type EnergyAdminUserDto,
  type EnergyPermissionArea,
  type EnergyPermissionLevel,
  type EnergyRolePermissionsDto,
} from "../../../lib/config-api";
import { EnergyIcon, type EnergyIconName } from "../_components/icons";
import { EnergySelect } from "../_components/energy-select";
import { friendlyErrorMessage } from "../_components/friendly-error";

type AdminAccessPagesProps = {
  initialView: "organisations" | "users" | "roles";
};

export function AdminAccessPages({ initialView }: AdminAccessPagesProps) {
  const [organisations, setOrganisations] = useState<EnergyAdminOrganisationDto[]>([]);
  const [users, setUsers] = useState<EnergyAdminUserDto[]>([]);
  const [roles, setRoles] = useState<EnergyAdminRoleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "organisation"; organisation?: EnergyAdminOrganisationDto }
    | { kind: "user"; user?: EnergyAdminUserDto }
    | { kind: "role"; role?: EnergyAdminRoleDto }
    | { kind: "move"; project: MovableProject }
    | { kind: "deleteProject"; project: MovableProject }
    | { kind: "deleteOrganisation"; organisation: EnergyAdminOrganisationDto }
    | { kind: "deleteRole"; role: EnergyAdminRoleDto }
    | null
  >(null);
  const [deletingRole, setDeletingRole] = useState(false);
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [organisationResult, userResult, roleResult] = await Promise.all([
        configApi.listEnergyAdminOrganisations(),
        configApi.listEnergyAdminUsers(),
        configApi.listEnergyAdminRoles(),
      ]);
      setOrganisations(organisationResult.organisations);
      setUsers(userResult.users);
      setRoles(roleResult.roles);
    } catch (reason) {
      setError(messageFrom(reason, "Failed to load access management"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const finishMutation = async (message: string, nextInvitationUrl?: string) => {
    setDialog(null);
    setNotice(message);
    setInvitationUrl(nextInvitationUrl ?? null);
    await load();
  };

  if (loading && organisations.length === 0 && users.length === 0) {
    return <AccessState icon="settings" title="Loading access management…" />;
  }

  return (
    <div className="space-y-4">
      {error ? <AccessBanner tone="error">{error}</AccessBanner> : null}
      {notice ? <AccessBanner tone="success">{notice}</AccessBanner> : null}
      {invitationUrl ? (
        <InvitationLinkCard
          url={invitationUrl}
          onDismiss={() => setInvitationUrl(null)}
        />
      ) : null}

      {initialView === "organisations" ? (
        <OrganisationsView
          organisations={organisations}
          onCreate={() => setDialog({ kind: "organisation" })}
          onEdit={(organisation) => setDialog({ kind: "organisation", organisation })}
          onMoveProject={(project) => setDialog({ kind: "move", project })}
          onDeleteProject={(project) => setDialog({ kind: "deleteProject", project })}
          onDeleteOrganisation={(organisation) => setDialog({ kind: "deleteOrganisation", organisation })}
          onArchiveProject={async (project, archived) => {
            setError(null);
            try {
              await configApi.setEnergyAdminProjectArchived(project.id, archived);
              await finishMutation(archived
                ? `${project.name} was archived. Customers no longer see it; its data is kept.`
                : `${project.name} was restored.`);
            } catch (reason) {
              setError(messageFrom(reason, archived ? "Failed to archive project" : "Failed to restore project"));
            }
          }}
        />
      ) : initialView === "roles" ? (
        <RolesView
          roles={roles}
          onCreate={() => setDialog({ kind: "role" })}
          onEdit={(role) => setDialog({ kind: "role", role })}
          onDelete={(role) => setDialog({ kind: "deleteRole", role })}
        />
      ) : (
        <UsersView
          users={users}
          organisations={organisations}
          onInvite={() => setDialog({ kind: "user" })}
          onEdit={(user) => setDialog({ kind: "user", user })}
          onResend={async (user) => {
            setError(null);
            try {
              const result = await configApi.resendEnergyAdminInvitation(user.id);
              await finishMutation(`A new invitation was created for ${user.email ?? "this user"}.`, result.invitationUrl);
            } catch (reason) {
              setError(messageFrom(reason, "Failed to resend invitation"));
            }
          }}
        />
      )}

      {dialog?.kind === "role" ? (
        <RoleDialog
          role={dialog.role}
          onClose={() => setDialog(null)}
          onSaved={async (role) => finishMutation(dialog.role ? `The role "${role.name}" was updated.` : `The role "${role.name}" was created.`)}
        />
      ) : null}
      {dialog?.kind === "organisation" ? (
        <OrganisationDialog
          organisation={dialog.organisation}
          onClose={() => setDialog(null)}
          onSaved={async (organisation) => finishMutation(
            dialog.organisation
              ? `${organisation.name} was updated.`
              : `${organisation.name} was created.`,
          )}
        />
      ) : null}
      {dialog?.kind === "move" ? (
        <MoveProjectDialog
          project={dialog.project}
          organisations={organisations}
          onClose={() => setDialog(null)}
          onMoved={async (target) => finishMutation(`${dialog.project.name} now belongs to ${target.name}.`)}
        />
      ) : null}
      {dialog?.kind === "deleteProject" ? (
        <DeleteProjectDialog
          project={dialog.project}
          onClose={() => setDialog(null)}
          onDeleted={async () => finishMutation(`${dialog.project.name} was permanently deleted.`)}
        />
      ) : null}
      {dialog?.kind === "deleteOrganisation" ? (
        <DeleteOrganisationDialog
          organisation={dialog.organisation}
          onClose={() => setDialog(null)}
          onDeleted={async () => finishMutation(`${dialog.organisation.name} was deleted.`)}
        />
      ) : null}
      {dialog?.kind === "deleteRole" ? (
        <ConfirmDialog
          danger
          busy={deletingRole}
          title="Delete this role?"
          message={`"${dialog.role.name}" will be removed from Role access. Nobody holds it, so no one loses access.`}
          confirmLabel={deletingRole ? "Deleting…" : "Delete role"}
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const role = dialog.role;
            setDeletingRole(true);
            setError(null);
            try {
              await configApi.deleteEnergyAdminRole(role.id);
              await finishMutation(`The role "${role.name}" was deleted.`);
            } catch (reason) {
              setDialog(null);
              setError(messageFrom(reason, "Failed to delete role"));
            } finally {
              setDeletingRole(false);
            }
          }}
        />
      ) : null}
      {dialog?.kind === "user" ? (
        <UserDialog
          user={dialog.user}
          organisations={organisations}
          roles={roles}
          onClose={() => setDialog(null)}
          onSaved={async (result) => finishMutation(
            dialog.user
              ? `${result.user.displayName ?? result.user.email ?? "User"} was updated.`
              : `Invitation created for ${result.user.email ?? "the new user"}.`,
            result.invitationUrl,
          )}
        />
      ) : null}
    </div>
  );
}

type MovableProject = { id: string; name: string; organisationId: string };

function OrganisationsView({
  organisations,
  onCreate,
  onEdit,
  onMoveProject,
  onArchiveProject,
  onDeleteProject,
  onDeleteOrganisation,
}: {
  organisations: EnergyAdminOrganisationDto[];
  onCreate: () => void;
  onEdit: (organisation: EnergyAdminOrganisationDto) => void;
  onMoveProject: (project: MovableProject) => void;
  onArchiveProject: (project: MovableProject, archived: boolean) => Promise<void>;
  onDeleteProject: (project: MovableProject) => void;
  onDeleteOrganisation: (organisation: EnergyAdminOrganisationDto) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <AccessSectionHeader
        title="Customer organisations"
        description="Each Organisation is an isolated customer Workspace containing its users and Projects."
        actionLabel="Create organisation"
        onAction={onCreate}
      />
      {organisations.length === 0 ? (
        <AccessState icon="building" title="No customer organisations yet" body="Create the customer boundary before inviting users or creating Projects." />
      ) : (
        <div className="divide-y divide-border">
          {organisations.map((organisation) => (
            <article key={organisation.id} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] md:items-center">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-sm font-semibold">{organisation.name}</h3>
                  <StatusBadge status={organisation.status} />
                </div>
                <p className="mt-1 truncate text-[11px] text-muted-light">{organisation.id}</p>
              </div>
              <Stat label="Users" value={organisation.userCount} />
              <Stat label="Projects" value={organisation.projectCount} />
              <button type="button" onClick={() => onEdit(organisation)} className={secondaryButton}>Edit</button>
              <button
                type="button"
                onClick={() => onDeleteOrganisation(organisation)}
                disabled={organisation.projectCount > 0 || organisation.userCount > 0}
                title={organisation.projectCount > 0 || organisation.userCount > 0
                  ? "Move or delete its projects and remove its users first"
                  : "Delete this organisation"}
                className={dangerButton}
              >
                Delete
              </button>
              {organisation.projects.length > 0 ? (
                <ul className="space-y-1.5 md:col-span-5" aria-label={`${organisation.name} projects`}>
                  {organisation.projects.map((project) => (
                    <li key={project.id} className="flex items-center justify-between gap-3 rounded-lg bg-surface-subtle/60 px-3 py-2">
                      <span className="min-w-0 truncate text-xs">
                        <span className="font-medium">{project.name}</span>
                        <span className="ml-2 capitalize text-muted-light">{project.status}</span>
                      </span>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => onMoveProject({ id: project.id, name: project.name, organisationId: organisation.id })}
                          className={secondaryButton}
                        >
                          Move to…
                        </button>
                        <button
                          type="button"
                          onClick={() => void onArchiveProject({ id: project.id, name: project.name, organisationId: organisation.id }, project.status !== "archived")}
                          className={secondaryButton}
                        >
                          {project.status === "archived" ? "Restore" : "Archive"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteProject({ id: project.id, name: project.name, organisationId: organisation.id })}
                          className={dangerButton}
                        >
                          Delete…
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function UsersView({
  users,
  organisations,
  onInvite,
  onEdit,
  onResend,
}: {
  users: EnergyAdminUserDto[];
  organisations: EnergyAdminOrganisationDto[];
  onInvite: () => void;
  onEdit: (user: EnergyAdminUserDto) => void;
  onResend: (user: EnergyAdminUserDto) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [organisationId, setOrganisationId] = useState("all");
  const visibleUsers = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesText = !normalized
        || user.displayName?.toLowerCase().includes(normalized)
        || user.email?.toLowerCase().includes(normalized);
      const matchesOrganisation = organisationId === "all" || user.organisationIds.includes(organisationId);
      return matchesText && matchesOrganisation;
    });
  }, [organisationId, query, users]);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <AccessSectionHeader
        title="User accounts"
        description="Invite people once, then assign one or more Organisations. Published Projects are inherited from Membership."
        actionLabel="Invite user"
        onAction={onInvite}
      />
      <div className="grid gap-3 border-b border-border bg-surface-subtle/50 px-5 py-3 md:grid-cols-[minmax(0,1fr)_240px]">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or email"
          aria-label="Search users"
          className={inputClass}
        />
        <EnergySelect
          ariaLabel="Filter by organisation"
          value={organisationId}
          options={[
            { value: "all", label: "All organisations" },
            ...organisations.map((organisation) => ({ value: organisation.id, label: organisation.name })),
          ]}
          onValueChange={setOrganisationId}
          className="w-full"
        />
      </div>
      {visibleUsers.length === 0 ? (
        <AccessState icon="user" title="No users match this view" />
      ) : (
        <div className="divide-y divide-border">
          {visibleUsers.map((user) => (
            <article key={user.id} className="grid gap-4 px-5 py-4 xl:grid-cols-[minmax(220px,1.2fr)_minmax(220px,1fr)_110px_140px_auto] xl:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{user.displayName ?? "Pending name"}</p>
                <p className="mt-1 truncate text-xs text-muted">{user.email ?? "Development identity"}</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {user.organisations.length > 0
                  ? user.organisations.map((organisation) => <Tag key={organisation.id}>{organisation.name}</Tag>)
                  : <span className="text-xs text-muted-light">Platform access only</span>}
              </div>
              <span className="text-xs font-medium capitalize">{user.role === "admin" ? "Admin" : [...new Set(Object.values(user.organisationRoles).map((entry) => entry.roleName))].join(", ") || "User"}</span>
              <div><StatusBadge status={user.status} /><p className="mt-1 text-[10px] text-muted-light">{formatLastLogin(user.lastLoginAt)}</p></div>
              <div className="flex justify-end gap-2">
                {user.status === "pending" ? (
                  <button type="button" onClick={() => void onResend(user)} className={secondaryButton}>Resend</button>
                ) : null}
                <button type="button" onClick={() => onEdit(user)} className={secondaryButton}>Edit</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function OrganisationDialog({
  organisation,
  onClose,
  onSaved,
}: {
  organisation?: EnergyAdminOrganisationDto;
  onClose: () => void;
  onSaved: (organisation: EnergyAdminOrganisationDto) => Promise<void>;
}) {
  const [name, setName] = useState(organisation?.name ?? "");
  const [disabled, setDisabled] = useState(organisation?.status === "disabled");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = organisation
        ? await configApi.updateEnergyAdminOrganisation(organisation.id, { name, disabled })
        : await configApi.createEnergyAdminOrganisation({ name });
      await onSaved(result);
    } catch (reason) {
      setError(messageFrom(reason, "Failed to save Organisation"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <AccessDialog title={organisation ? "Edit organisation" : "Create organisation"} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <Field label="Organisation name"><input autoFocus value={name} onChange={(event) => setName(event.target.value)} className={inputClass} required /></Field>
        {organisation ? <Toggle label="Disable this Organisation" checked={disabled} onChange={setDisabled} hint="Customer users immediately lose access; admins retain repair access." /> : null}
        {error ? <AccessBanner tone="error">{error}</AccessBanner> : null}
        <DialogActions onClose={onClose} saving={saving} submitLabel={organisation ? "Save changes" : "Create organisation"} />
      </form>
    </AccessDialog>
  );
}

function MoveProjectDialog({
  project,
  organisations,
  onClose,
  onMoved,
}: {
  project: MovableProject;
  organisations: EnergyAdminOrganisationDto[];
  onClose: () => void;
  onMoved: (target: EnergyAdminOrganisationDto) => Promise<void>;
}) {
  const targets = organisations.filter((organisation) => organisation.id !== project.organisationId && organisation.status === "active");
  const current = organisations.find((organisation) => organisation.id === project.organisationId);
  const [organisationId, setOrganisationId] = useState(targets[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((organisation) => organisation.id === organisationId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!target) return;
    setSaving(true);
    setError(null);
    try {
      await configApi.moveEnergyAdminProject(project.id, { organisationId: target.id });
      await onMoved(target);
    } catch (reason) {
      setError(messageFrom(reason, "Failed to move project"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <AccessDialog title={`Move ${project.name}`} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="text-xs text-muted">
          Readings, reports and actions move with the project. Only members of the new Organisation will see it; users of {current?.name ?? "the current Organisation"} lose access.
        </p>
        {targets.length === 0 ? (
          <AccessBanner tone="error">Create the destination Organisation first.</AccessBanner>
        ) : (
          <Field label="Move to organisation">
            <EnergySelect
              ariaLabel="Destination organisation"
              value={organisationId}
              options={targets.map((organisation) => ({ value: organisation.id, label: organisation.name }))}
              onValueChange={setOrganisationId}
              className="w-full"
            />
          </Field>
        )}
        {error ? <AccessBanner tone="error">{error}</AccessBanner> : null}
        <DialogActions onClose={onClose} saving={saving} submitLabel="Move project" />
      </form>
    </AccessDialog>
  );
}

function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: MovableProject;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === project.name.trim();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!matches) return;
    setSaving(true);
    setError(null);
    try {
      await configApi.deleteEnergyAdminProject(project.id, typed.trim());
      await onDeleted();
    } catch (reason) {
      setError(messageFrom(reason, "Failed to delete project"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <AccessDialog title={`Delete ${project.name}`} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <AccessBanner tone="error">
          This permanently deletes the project with all of its readings, reports, actions and history. It cannot be undone.
          To keep the data but hide the project, use Archive instead.
        </AccessBanner>
        <Field label={`Type "${project.name}" to confirm`}>
          <input autoFocus value={typed} onChange={(event) => setTyped(event.target.value)} className={inputClass} autoComplete="off" />
        </Field>
        {error ? <AccessBanner tone="error">{error}</AccessBanner> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button type="submit" disabled={!matches || saving} className={dangerSolidButton}>{saving ? "Deleting…" : "Delete permanently"}</button>
        </div>
      </form>
    </AccessDialog>
  );
}

function DeleteOrganisationDialog({
  organisation,
  onClose,
  onDeleted,
}: {
  organisation: EnergyAdminOrganisationDto;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await configApi.deleteEnergyAdminOrganisation(organisation.id);
      await onDeleted();
    } catch (reason) {
      setError(messageFrom(reason, "Failed to delete organisation"));
    } finally {
      setSaving(false);
    }
  };
  return (
    <AccessDialog title={`Delete ${organisation.name}`} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <p className="text-sm text-muted">
          {organisation.name} has no projects and no users. Deleting it removes the customer permanently.
        </p>
        {error ? <AccessBanner tone="error">{error}</AccessBanner> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button type="submit" disabled={saving} className={dangerSolidButton}>{saving ? "Deleting…" : "Delete organisation"}</button>
        </div>
      </form>
    </AccessDialog>
  );
}

type AccountRole = "user" | "admin";
const VIEWER_ROLE_ID = "role-viewer";

function UserDialog({
  user,
  organisations,
  roles,
  onClose,
  onSaved,
}: {
  user?: EnergyAdminUserDto;
  organisations: EnergyAdminOrganisationDto[];
  roles: EnergyAdminRoleDto[];
  onClose: () => void;
  onSaved: (result: { invitationUrl?: string; user: EnergyAdminUserDto }) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<AccountRole>(user?.role === "admin" ? "admin" : "user");
  const [organisationIds, setOrganisationIds] = useState<string[]>(user?.organisationIds ?? []);
  // The role held in each client. A client with no entry yet is a Viewer.
  const [organisationRoles, setOrganisationRoles] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(user?.organisationRoles ?? {}).map(([id, entry]) => [id, entry.roleId])),
  );
  const [disabled, setDisabled] = useState(user?.status === "disabled");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  // Only a change that hands out platform-wide access, or locks someone out, needs a second look.
  const disabling = disabled && user?.status !== "disabled";
  const promoting = role === "admin" && user?.role !== "admin";
  const who = displayName.trim() || email.trim() || "This person";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (role === "user" && organisationIds.length === 0) {
      setError("Select at least one Organisation for a customer user.");
      return;
    }
    if (disabling || promoting) {
      setConfirming(true);
      return;
    }
    void save();
  };

  const save = async () => {
    setConfirming(false);
    const chosenRoles = Object.fromEntries(organisationIds.map((id) => [id, organisationRoles[id] ?? VIEWER_ROLE_ID]));
    setSaving(true);
    setError(null);
    try {
      if (user) {
        const updated = await configApi.updateEnergyAdminUser(user.id, {
          displayName,
          role,
          organisationIds,
          disabled,
          organisationRoles: chosenRoles,
        });
        await onSaved({ user: updated });
      } else {
        await onSaved(await configApi.inviteEnergyAdminUser({
          displayName,
          email,
          role,
          organisationIds,
          organisationRoles: chosenRoles,
        }));
      }
    } catch (reason) {
      setError(messageFrom(reason, "Failed to save user"));
    } finally {
      setSaving(false);
    }
  };

  const toggleOrganisation = (id: string, checked: boolean) => {
    setOrganisationIds((current) => checked
      ? [...new Set([...current, id])]
      : current.filter((candidate) => candidate !== id));
  };

  return (
    <AccessDialog title={user ? "Edit user" : "Invite user"} onClose={onClose}>
      {confirming ? (
        <ConfirmDialog
          danger
          title={disabling ? "Disable this account?" : "Give super admin access?"}
          message={disabling
            ? `${who} is signed out everywhere straight away and can't sign in again until you turn the account back on. Their history is kept.`
            : `${who} will be able to open every client and change every setting, including who else has access.`}
          confirmLabel={disabling ? "Disable account" : "Make super admin"}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void save()}
        />
      ) : null}
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><input autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} className={inputClass} required /></Field>
          <Field label="Email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} required disabled={Boolean(user)} /></Field>
        </div>
        <Field label="Account role">
          <EnergySelect
            ariaLabel="Account role"
            value={role}
            options={[
              { value: "user", label: "User — customer product access" },
              { value: "admin", label: "Super admin — platform-wide access" },
            ]}
            onValueChange={(nextRole) => setRole(nextRole === "admin" ? "admin" : "user")}
            className="w-full"
          />
        </Field>
        <fieldset>
          <legend className="text-xs font-semibold">Organisations{role === "user" ? " and roles" : ""}</legend>
          <p className="mt-1 text-[11px] text-muted">
            {role === "admin"
              ? "Super admins can open every Organisation."
              : "Choose each Organisation this person can open, and the role they hold there. Roles are managed under Role access."}
          </p>
          <div className="mt-2 max-h-56 space-y-2 overflow-auto rounded-lg border border-border p-3">
            {organisations.filter((organisation) => organisation.status === "active").map((organisation) => (
              <div key={organisation.id} className="flex items-center gap-3 text-xs">
                <label className="flex flex-1 cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={organisationIds.includes(organisation.id)} onChange={(event) => toggleOrganisation(organisation.id, event.target.checked)} />
                  <span className="flex-1">{organisation.name}</span>
                </label>
                {role === "user" && organisationIds.includes(organisation.id) ? (
                  <EnergySelect
                    ariaLabel={`Role at ${organisation.name}`}
                    value={organisationRoles[organisation.id] ?? VIEWER_ROLE_ID}
                    options={roles.map((entry) => ({ value: entry.id, label: entry.name }))}
                    onValueChange={(next) => setOrganisationRoles((current) => ({ ...current, [organisation.id]: next }))}
                    className="w-44"
                  />
                ) : <span className="text-[10px] text-muted-light">{organisation.projectCount} Projects</span>}
              </div>
            ))}
          </div>
        </fieldset>
        {user ? <Toggle label="Disable this account" checked={disabled} onChange={setDisabled} hint="All active sessions are revoked immediately; historical records remain." /> : null}
        {error ? <AccessBanner tone="error">{error}</AccessBanner> : null}
        <DialogActions onClose={onClose} saving={saving} submitLabel={user ? "Save changes" : "Create invitation"} />
      </form>
    </AccessDialog>
  );
}

type AreaDefinition = {
  area: EnergyPermissionArea;
  icon: EnergyIconName;
  title: string;
  /** Where in the product this shows up, so a super admin knows what they are switching on. */
  where: string;
  /** Exactly what holders can do at each level. Write always includes read. */
  effect: Record<EnergyPermissionLevel, string>;
};

const PERMISSION_AREAS: AreaDefinition[] = [
  {
    area: "reports", icon: "analysis", title: "Overview, Analysis and Reports",
    where: "Overview, Analysis, Reports and the energy advisor",
    effect: {
      none: "Cannot open the overview, analysis, reports or the advisor.",
      read: "Can see the overview, analysis charts, device usage and finished reports.",
      write: "Everything in Read, plus ask the advisor questions and create reports.",
    },
  },
  {
    area: "facility", icon: "building", title: "Facility structure",
    where: "Facility → Floor layout, Devices, Data availability",
    effect: {
      none: "Cannot see the site's locations or meters.",
      read: "Can see the locations, meters and floor layout.",
      write: "Can add and rename locations and meters, change the floor layout and upload data. Changes go live straight away.",
    },
  },
  {
    area: "hours_rate", icon: "clock", title: "Operating hours, holidays and rate",
    where: "Facility → Operating hours, Holidays, Electricity rate",
    effect: {
      none: "Cannot see opening hours, holidays or the electricity rate.",
      read: "Can see when the site is open, its holidays and the electricity rate.",
      write: "Can change hours, holidays and the rate. This changes cost and after-hours figures across the app.",
    },
  },
  {
    area: "notes", icon: "info", title: "Project notes",
    where: "Facility → Project notes",
    effect: {
      none: "Cannot read the notes written about the site.",
      read: "Can read the background notes the advisor uses about the site.",
      write: "Can edit the notes and the floor-plan reference. The advisor uses them in its answers.",
    },
  },
  {
    area: "live_connection", icon: "bolt", title: "Live connection",
    where: "Facility → Live connection",
    effect: {
      none: "Cannot see or change how the site's meters are connected.",
      read: "Can see how the site's meters are connected.",
      write: "Can connect the site's meter account, test the connection, match meters and set the daily update.",
    },
  },
  {
    area: "people", icon: "user", title: "People",
    where: "Team page in the client portal",
    effect: {
      none: "Has no Team page.",
      read: "Can see who has access to the client and the role each holds.",
      write: "Can invite viewers, resend invitations and remove viewers. Cannot change roles, or touch anyone with equal or more access.",
    },
  },
];

const LEVELS: Array<{ level: EnergyPermissionLevel; label: string }> = [
  { level: "none", label: "None" },
  { level: "read", label: "Read" },
  { level: "write", label: "Write" },
];

const LEVEL_TONE: Record<EnergyPermissionLevel, { chip: string; card: string; active: string }> = {
  none: { chip: "bg-surface-subtle text-muted-light", card: "border-border", active: "bg-muted text-white" },
  read: { chip: "bg-primary/10 text-primary", card: "border-primary/30", active: "bg-primary/80 text-white" },
  write: { chip: "bg-step-success/15 text-step-success", card: "border-step-success/50", active: "bg-primary text-white" },
};

/** Starting points, so a new role does not begin as twelve separate decisions. */
const ROLE_PRESETS: Array<{ label: string; note: string; permissions: EnergyRolePermissionsDto }> = [
  { label: "Viewer", note: "Look and ask the advisor", permissions: { reports: "write", facility: "read", hours_rate: "read", notes: "read", live_connection: "none", people: "none" } },
  { label: "Facility editor", note: "Also edits the site's setup", permissions: { reports: "write", facility: "write", hours_rate: "write", notes: "write", live_connection: "none", people: "none" } },
  { label: "Team manager", note: "Also invites and removes viewers", permissions: { reports: "write", facility: "read", hours_rate: "read", notes: "read", live_connection: "none", people: "write" } },
  { label: "Full manager", note: "Runs the whole client", permissions: { reports: "write", facility: "write", hours_rate: "write", notes: "write", live_connection: "write", people: "write" } },
];

function LevelBadge({ level }: { level: EnergyPermissionLevel }) {
  return <span className={["inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide", LEVEL_TONE[level].chip].join(" ")}>{level}</span>;
}

export function RolesView({
  roles,
  onCreate,
  onEdit,
  onDelete,
}: {
  roles: EnergyAdminRoleDto[];
  onCreate: () => void;
  onEdit: (role: EnergyAdminRoleDto) => void;
  onDelete: (role: EnergyAdminRoleDto) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <AccessSectionHeader
        title="Role access"
        description="A role says what its holders can read and change. Give it to people per Organisation when you invite or edit them. Write always includes read."
        actionLabel="Create role"
        onAction={onCreate}
      />
      <div className="grid gap-4 p-5 lg:grid-cols-2">
        {roles.map((role) => (
          <article key={role.id} className="flex flex-col rounded-xl border border-border bg-surface p-4 shadow-sm">
            <header className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><EnergyIcon name="user" className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {role.name}
                  {role.builtin ? <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[10px] font-medium text-muted">Built in</span> : null}
                </h4>
                {role.description ? <p className="mt-0.5 text-xs text-muted">{role.description}</p> : null}
              </div>
              {!role.builtin ? (
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={() => onEdit(role)} className={secondaryButton}>Edit</button>
                  <button type="button" onClick={() => void onDelete(role)} disabled={role.assignedCount > 0} title={role.assignedCount > 0 ? "Change the role of the people who hold it first" : undefined} className={dangerButton}>Delete</button>
                </div>
              ) : null}
            </header>
            <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
              {PERMISSION_AREAS.map((entry) => (
                <li key={entry.area} className="flex items-center gap-3 px-3 py-2" title={entry.effect[role.permissions[entry.area]]}>
                  <EnergyIcon name={entry.icon} className="h-3.5 w-3.5 shrink-0 text-muted-light" />
                  <span className="min-w-0 flex-1 truncate text-xs">{entry.title}</span>
                  <LevelBadge level={role.permissions[entry.area]} />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[11px] text-muted-light">
              {role.assignedCount === 0 ? "Not given to anyone yet" : `Held by ${role.assignedCount} ${role.assignedCount === 1 ? "person" : "people"}`}
            </p>
          </article>
        ))}
      </div>
      <p className="border-t border-border bg-surface-subtle/50 px-5 py-3 text-[11px] text-muted">
        The advisor&apos;s guidelines, automatic reports and alerts, and managing Organisations, users and roles always stay with super admins.
      </p>
    </section>
  );
}

export function RoleDialog({
  role,
  onClose,
  onSaved,
}: {
  role?: EnergyAdminRoleDto;
  onClose: () => void;
  onSaved: (role: EnergyAdminRoleDto) => Promise<void>;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<EnergyRolePermissionsDto>(role?.permissions ?? ROLE_PRESETS[0]!.permissions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = { name, description, permissions };
      await onSaved(role
        ? await configApi.updateEnergyAdminRole(role.id, body)
        : await configApi.createEnergyAdminRole(body));
    } catch (reason) {
      setError(messageFrom(reason, "Failed to save role"));
    } finally {
      setSaving(false);
    }
  };

  const activePreset = ROLE_PRESETS.find((preset) => PERMISSION_AREAS.every(({ area }) => preset.permissions[area] === permissions[area]));
  const can = PERMISSION_AREAS.filter(({ area }) => permissions[area] !== "none");
  const cannot = PERMISSION_AREAS.filter(({ area }) => permissions[area] === "none");

  return (
    <AccessDialog title={role ? "Edit role" : "Create role"} subtitle="Choose what people holding this role can see and change inside a client." onClose={onClose} wide>
      <form onSubmit={(event) => void submit(event)} className="space-y-6">
        <section className="grid gap-4 sm:grid-cols-2">
          <Field label="Role name">
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className={inputClass} maxLength={60} placeholder="e.g. Facility editor" required />
            <span className="mt-1 block text-right text-[10px] text-muted-light">{name.length}/60</span>
          </Field>
          <Field label="What it is for (optional)">
            <input value={description} onChange={(event) => setDescription(event.target.value)} className={inputClass} maxLength={300} placeholder="e.g. Keeps the site's setup up to date" />
            <span className="mt-1 block text-right text-[10px] text-muted-light">{description.length}/300</span>
          </Field>
        </section>

        <section>
          <h3 className="text-xs font-semibold">Start from</h3>
          <p className="mt-0.5 text-[11px] text-muted">Pick the closest match, then adjust any area below.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {ROLE_PRESETS.map((preset) => {
              const selected = activePreset?.label === preset.label;
              return (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setPermissions(preset.permissions)}
                  className={["rounded-lg border px-3 py-2 text-left transition-colors", selected ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border bg-surface hover:bg-surface-subtle"].join(" ")}
                >
                  <span className="block text-xs font-semibold">{preset.label}</span>
                  <span className="mt-0.5 block text-[11px] text-muted">{preset.note}</span>
                </button>
              );
            })}
          </div>
        </section>

        <fieldset>
          <legend className="text-xs font-semibold">What this role can do</legend>
          <p className="mt-0.5 text-[11px] text-muted">Write always includes read. Everything applies only inside the client the role is given for.</p>
          <div className="mt-3 space-y-3">
            {PERMISSION_AREAS.map((entry) => {
              const level = permissions[entry.area];
              return (
                <div key={entry.area} className={["rounded-xl border bg-surface p-4 transition-colors", LEVEL_TONE[level].card].join(" ")}>
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-subtle text-muted"><EnergyIcon name={entry.icon} className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{entry.title}</p>
                      <p className="mt-0.5 text-[11px] text-muted-light">{entry.where}</p>
                    </div>
                    <div role="radiogroup" aria-label={entry.title} className="inline-flex overflow-hidden rounded-lg border border-border">
                      {LEVELS.map((option) => (
                        <button
                          key={option.level}
                          type="button"
                          role="radio"
                          aria-checked={level === option.level}
                          onClick={() => setPermissions((current) => ({ ...current, [entry.area]: option.level }))}
                          className={["h-8 min-w-16 px-3 text-xs font-semibold transition-colors", level === option.level ? LEVEL_TONE[option.level].active : "bg-surface text-muted hover:bg-surface-subtle"].join(" ")}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-subtle/70 px-3 py-2 text-xs leading-5" aria-live="polite">
                    <LevelBadge level={level} />
                    <span className="min-w-0 flex-1">{entry.effect[level]}</span>
                  </p>
                </div>
              );
            })}
          </div>
        </fieldset>

        <section className="rounded-xl border border-border bg-surface-subtle/50 p-4" aria-label="Summary of this role">
          <h3 className="text-xs font-semibold">In short, {name.trim() ? <span className="text-primary">{name.trim()}</span> : "this role"}</h3>
          <div className="mt-2 grid gap-4 text-xs sm:grid-cols-2">
            <div>
              <p className="font-semibold text-step-success">Can</p>
              {can.length === 0 ? <p className="mt-1 text-muted">Nothing yet. People with this role could not open the client.</p> : (
                <ul className="mt-1 space-y-1 text-muted">
                  {can.map((entry) => <li key={entry.area} className="flex gap-2"><span aria-hidden="true">✓</span><span>{entry.title}: {permissions[entry.area] === "write" ? "read and change" : "read only"}</span></li>)}
                </ul>
              )}
            </div>
            <div>
              <p className="font-semibold text-muted">Cannot</p>
              <ul className="mt-1 space-y-1 text-muted">
                {cannot.map((entry) => <li key={entry.area} className="flex gap-2"><span aria-hidden="true">–</span><span>{entry.title}</span></li>)}
                <li className="flex gap-2"><span aria-hidden="true">–</span><span>Advisor guidelines, automatic reports, other clients, other users and roles</span></li>
              </ul>
            </div>
          </div>
        </section>

        {error ? <AccessBanner tone="error">{error}</AccessBanner> : null}
        <DialogActions onClose={onClose} saving={saving} submitLabel={role ? "Save role" : "Create role"} />
      </form>
    </AccessDialog>
  );
}

function InvitationLinkCard({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="rounded-xl border border-step-success/30 bg-step-success/5 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">Invitation ready</h3>
          <p className="mt-1 text-xs text-muted">Email delivery is in test mode. Copy this one-time link and send it to the user; it expires in 7 days.</p>
          <code className="mt-3 block overflow-x-auto rounded-lg bg-surface px-3 py-2 text-[11px] text-muted">{url}</code>
        </div>
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); }} className={primaryButton}>{copied ? "Copied" : "Copy link"}</button>
        <button type="button" onClick={onDismiss} className={secondaryButton}>Dismiss</button>
      </div>
    </section>
  );
}

function AccessSectionHeader({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel: string; onAction: () => void }) {
  return <header className="flex flex-wrap items-center gap-4 border-b border-border px-5 py-4"><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs text-muted">{description}</p></div><button type="button" onClick={onAction} className={primaryButton}>+ {actionLabel}</button></header>;
}

function AccessDialog({ title, subtitle, wide, children, onClose }: { title: string; subtitle?: string; wide?: boolean; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label={title}><div className={["max-h-[92vh] w-full overflow-auto rounded-xl border border-border bg-surface shadow-2xl", wide ? "max-w-3xl" : "max-w-2xl"].join(" ")}><header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4"><div><h2 className="text-base font-semibold">{title}</h2>{subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}</div><button type="button" onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-surface-subtle" aria-label="Close dialog">×</button></header><div className="p-5">{children}</div></div></div>;
}

/** Asks before a change that is hard to take back. Sits above any open dialog; Escape or Cancel backs out. */
export function ConfirmDialog({ title, message, confirmLabel, danger, busy, onCancel, onConfirm }: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title" aria-describedby="confirm-dialog-message">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className={["flex h-9 w-9 shrink-0 items-center justify-center rounded-full", danger ? "bg-rose-50 text-rose-700" : "bg-surface-subtle text-muted"].join(" ")} aria-hidden="true">
            <EnergyIcon name={danger ? "alert" : "info"} />
          </span>
          <div>
            <h2 id="confirm-dialog-title" className="text-base font-semibold">{title}</h2>
            <p id="confirm-dialog-message" className="mt-1.5 text-sm leading-relaxed text-muted">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" autoFocus onClick={onCancel} disabled={busy} className={secondaryButton}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={busy} className={danger ? dangerSolidButton : primaryButton}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function DialogActions({ onClose, saving, submitLabel }: { onClose: () => void; saving: boolean; submitLabel: string }) {
  return <div className="flex justify-end gap-2 border-t border-border pt-4"><button type="button" onClick={onClose} className={secondaryButton}>Cancel</button><button type="submit" disabled={saving} className={primaryButton}>{saving ? "Saving…" : submitLabel}</button></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold">{label}</span>{children}</label>;
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5" /><span><span className="block text-xs font-semibold">{label}</span><span className="mt-1 block text-[11px] text-muted">{hint}</span></span></label>;
}

function AccessState({ icon, title, body }: { icon: "building" | "settings" | "user"; title: string; body?: string }) {
  return <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-subtle text-muted"><EnergyIcon name={icon} className="h-4 w-4" /></span><h3 className="mt-3 text-sm font-semibold">{title}</h3>{body ? <p className="mt-1 max-w-md text-xs text-muted">{body}</p> : null}</div>;
}

function AccessBanner({ tone, children }: { tone: "error" | "success"; children: React.ReactNode }) {
  return <div className={["rounded-lg border px-4 py-3 text-xs", tone === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-step-success/25 bg-step-success/5 text-step-success"].join(" ")}>{children}</div>;
}

function StatusBadge({ status }: { status: "active" | "disabled" | "pending" }) {
  const colors = status === "active" ? "bg-step-success/10 text-step-success" : status === "pending" ? "bg-step-warning/10 text-step-warning" : "bg-rose-50 text-rose-700";
  return <span className={["inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize", colors].join(" ")}>{status}</span>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="min-w-20"><p className="text-[10px] uppercase tracking-wide text-muted-light">{label}</p><p className="mt-0.5 text-sm font-semibold">{value}</p></div>;
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-md bg-surface-subtle px-2 py-1 text-[10px] font-medium text-muted">{children}</span>;
}

const formatLastLogin = (value?: string): string => value
  ? `Last login ${new Intl.DateTimeFormat("en-SG", { dateStyle: "medium" }).format(new Date(value))}`
  : "Never signed in";

// Admin rules from the server ("Remove this Organisation's users first.") read as written; codes and request failures do not.
const messageFrom = (reason: unknown, fallback: string): string => friendlyErrorMessage(reason, { fallback });

const inputClass = "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:bg-surface-subtle disabled:text-muted";
const primaryButton = "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50";
const dangerButton = "inline-flex h-9 items-center justify-center rounded-lg border border-rose-200 bg-surface px-3 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40";
const dangerSolidButton = "inline-flex h-9 items-center justify-center rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs font-semibold transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50";
