"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  configApi,
  type EnergyAdminOrganisationDto,
  type EnergyAdminUserDto,
} from "../../../lib/config-api";
import { EnergyIcon } from "../_components/icons";
import { EnergySelect } from "../_components/energy-select";

type AdminAccessPagesProps = {
  initialView: "organisations" | "users";
};

export function AdminAccessPages({ initialView }: AdminAccessPagesProps) {
  const [organisations, setOrganisations] = useState<EnergyAdminOrganisationDto[]>([]);
  const [users, setUsers] = useState<EnergyAdminUserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: "organisation"; organisation?: EnergyAdminOrganisationDto }
    | { kind: "user"; user?: EnergyAdminUserDto }
    | null
  >(null);
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [organisationResult, userResult] = await Promise.all([
        configApi.listEnergyAdminOrganisations(),
        configApi.listEnergyAdminUsers(),
      ]);
      setOrganisations(organisationResult.organisations);
      setUsers(userResult.users);
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
      {dialog?.kind === "user" ? (
        <UserDialog
          user={dialog.user}
          organisations={organisations}
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

function OrganisationsView({
  organisations,
  onCreate,
  onEdit,
}: {
  organisations: EnergyAdminOrganisationDto[];
  onCreate: () => void;
  onEdit: (organisation: EnergyAdminOrganisationDto) => void;
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
            <article key={organisation.id} className="grid gap-4 px-5 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center">
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
              <span className="text-xs font-medium capitalize">{user.role}</span>
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

function UserDialog({
  user,
  organisations,
  onClose,
  onSaved,
}: {
  user?: EnergyAdminUserDto;
  organisations: EnergyAdminOrganisationDto[];
  onClose: () => void;
  onSaved: (result: { invitationUrl?: string; user: EnergyAdminUserDto }) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<"user" | "admin">(user?.role ?? "user");
  const [organisationIds, setOrganisationIds] = useState<string[]>(user?.organisationIds ?? []);
  const [disabled, setDisabled] = useState(user?.status === "disabled");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (role === "user" && organisationIds.length === 0) {
      setError("Select at least one Organisation for a customer user.");
      return;
    }
    if ((role === "admin" || disabled) && !window.confirm("This changes platform access. Continue?")) return;
    setSaving(true);
    setError(null);
    try {
      if (user) {
        const updated = await configApi.updateEnergyAdminUser(user.id, {
          displayName,
          role,
          organisationIds,
          disabled,
        });
        await onSaved({ user: updated });
      } else {
        await onSaved(await configApi.inviteEnergyAdminUser({
          displayName,
          email,
          role,
          organisationIds,
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
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
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
              { value: "admin", label: "Admin — platform-wide access" },
            ]}
            onValueChange={(nextRole) => setRole(nextRole === "admin" ? "admin" : "user")}
            className="w-full"
          />
        </Field>
        <fieldset>
          <legend className="text-xs font-semibold">Organisations</legend>
          <p className="mt-1 text-[11px] text-muted">Membership grants all published Projects in the Organisation.</p>
          <div className="mt-2 max-h-44 space-y-2 overflow-auto rounded-lg border border-border p-3">
            {organisations.filter((organisation) => organisation.status === "active").map((organisation) => (
              <label key={organisation.id} className="flex cursor-pointer items-center gap-3 text-xs">
                <input type="checkbox" checked={organisationIds.includes(organisation.id)} onChange={(event) => toggleOrganisation(organisation.id, event.target.checked)} />
                <span className="flex-1">{organisation.name}</span>
                <span className="text-[10px] text-muted-light">{organisation.projectCount} Projects</span>
              </label>
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

function AccessDialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label={title}><div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-xl border border-border bg-surface shadow-2xl"><header className="flex items-center justify-between border-b border-border px-5 py-4"><h2 className="text-base font-semibold">{title}</h2><button type="button" onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-surface-subtle" aria-label="Close dialog">×</button></header><div className="p-5">{children}</div></div></div>;
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

const messageFrom = (reason: unknown, fallback: string): string => reason instanceof Error ? reason.message : fallback;

const inputClass = "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/10 disabled:bg-surface-subtle disabled:text-muted";
const primaryButton = "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs font-semibold transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50";
