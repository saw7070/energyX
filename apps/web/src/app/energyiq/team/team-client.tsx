"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import {
  configApi,
  type EnergyPermissionArea,
  type EnergyPermissionLevel,
  type EnergyTeamDto,
  type EnergyTeamMemberDto,
  type EnergyTeamRoleDto,
} from "../../../lib/config-api";
import { useEnergyIqAccess } from "../_components/energyiq-access";
import { friendlyErrorMessage } from "../_components/friendly-error";
import { EnergyIcon, type EnergyIconName } from "../_components/icons";
import styles from "../_components/project-configuration-view.module.css";

const inputClass = "h-11 w-full rounded-xl border border-border bg-surface px-3.5 text-[15px] outline-none transition-colors placeholder:text-muted-light focus:border-primary focus:ring-4 focus:ring-primary/10";
const primaryButton = "inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-border bg-surface px-3.5 text-[13px] font-semibold transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50";
const dangerButton = "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-rose-200 bg-surface px-3.5 text-[13px] font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40";
const COLUMNS = "md:grid-cols-[minmax(0,1fr)_minmax(150px,190px)_minmax(120px,140px)_208px]";

const STATUS: Record<EnergyTeamMemberDto["status"], { label: string; dot: string; text: string }> = {
  active: { label: "Active", dot: "bg-step-success", text: "text-step-success" },
  pending: { label: "Invited", dot: "bg-amber-500", text: "text-amber-700" },
  disabled: { label: "Disabled", dot: "bg-muted-light", text: "text-muted" },
};

const AREA_TITLES: Record<EnergyPermissionArea, { title: string; icon: EnergyIconName }> = {
  reports: { title: "Overview, analysis and reports", icon: "analysis" },
  facility: { title: "Facility structure", icon: "building" },
  hours_rate: { title: "Hours, holidays and rate", icon: "clock" },
  notes: { title: "Project notes", icon: "info" },
  live_connection: { title: "Live connection", icon: "bolt" },
  people: { title: "People", icon: "user" },
};

const messageFrom = (reason: unknown, fallback: string) => friendlyErrorMessage(reason, { fallback });

export function EnergyIqTeam() {
  const { access, error: accessError } = useEnergyIqAccess();
  const workspaceId = access?.activeWorkspaceId ?? "";
  // "People: read" may look at the list; "People: write" may also invite and remove.
  const allowed = (access?.permissions?.people ?? "none") !== "none" || access?.team?.canManagePeople === true;
  const canWrite = access?.team?.canManagePeople === true;
  const [team, setTeam] = useState<EnergyTeamDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invitationUrl, setInvitationUrl] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setTeam(await configApi.getEnergyTeam());
    } catch (reason) {
      setTeam(null);
      setError(messageFrom(reason, "Could not load the team"));
    }
  }, []);

  // The Organisation can change from the top bar; reload so the list never shows another client's people.
  useEffect(() => {
    setTeam(null);
    setInvitationUrl(null);
    setNotice(null);
    if (allowed) void load();
  }, [allowed, workspaceId, load]);

  const run = async (action: () => Promise<{ invitationUrl?: string; team?: EnergyTeamDto }>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (result.team) setTeam(result.team);
      setInvitationUrl(result.invitationUrl ?? null);
      setNotice(success);
      return true;
    } catch (reason) {
      setError(messageFrom(reason, "That did not work"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(
      () => configApi.inviteEnergyTeamUser({ email, ...(displayName.trim() ? { displayName } : {}) }),
      `Invitation created for ${email.trim().toLowerCase()}.`,
    );
    if (ok) {
      setEmail("");
      setDisplayName("");
    }
  };

  // Until the person's access is known, show a placeholder. Deciding sooner would flash "not available" on every refresh.
  if (!access) {
    return accessError
      ? <div className="p-4 sm:p-6"><Banner tone="error">{accessError}</Banner></div>
      : <TeamLoading />;
  }

  if (!allowed) {
    return (
      <section className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center px-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-subtle text-muted"><EnergyIcon name="user" className="h-6 w-6" /></span>
        <h1 className="mt-4 text-xl font-semibold">Team management is not available</h1>
        <p className="mt-2 text-[15px] text-muted">Ask your administrator if you need to add or remove people.</p>
      </section>
    );
  }

  // Same page padding the Facility page gets from the project gate.
  return (
    <div className="min-w-0 p-4 sm:p-6">
      <TeamView
        organisationName={team?.organisation.name}
        members={team?.members ?? null}
        roles={team?.roles ?? []}
        canWrite={canWrite}
        busy={busy}
        error={error}
        notice={notice}
        invitationUrl={invitationUrl}
        email={email}
        displayName={displayName}
        onEmailChange={setEmail}
        onDisplayNameChange={setDisplayName}
        onInvite={(event) => void invite(event)}
        onDismissInvitation={() => setInvitationUrl(null)}
        onRefresh={() => void load()}
        onResend={(member) => void run(() => configApi.resendEnergyTeamInvitation(member.id), `A new invitation was created for ${member.email ?? "this person"}.`)}
        onRemove={(member) => {
          const name = member.displayName ?? member.email ?? "this person";
          if (window.confirm(`Remove ${name} from ${team?.organisation.name ?? "this client"}? They will lose access straight away.`)) {
            void run(() => configApi.removeEnergyTeamUser(member.id), `${name} no longer has access.`);
          }
        }}
      />
    </div>
  );
}

export type TeamViewProps = {
  organisationName: string | undefined;
  /** Null while loading. */
  members: EnergyTeamMemberDto[] | null;
  roles: EnergyTeamRoleDto[];
  canWrite: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  invitationUrl: string | null;
  email: string;
  displayName: string;
  onEmailChange: (value: string) => void;
  onDisplayNameChange: (value: string) => void;
  onInvite: (event: FormEvent) => void;
  onDismissInvitation: () => void;
  onResend: (member: EnergyTeamMemberDto) => void;
  onRemove: (member: EnergyTeamMemberDto) => void;
  onRefresh: () => void;
};

type Filter = "all" | EnergyTeamMemberDto["status"];

export function TeamView(props: TeamViewProps) {
  const { organisationName, members, roles, canWrite, busy, error, notice, invitationUrl } = props;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [copied, setCopied] = useState(false);
  const counts = useMemo(() => ({
    all: members?.length ?? 0,
    active: members?.filter((member) => member.status === "active").length ?? 0,
    pending: members?.filter((member) => member.status === "pending").length ?? 0,
    disabled: members?.filter((member) => member.status === "disabled").length ?? 0,
  }), [members]);
  const visible = useMemo(() => {
    if (!members) return null;
    const needle = query.trim().toLowerCase();
    return members.filter((member) =>
      (filter === "all" || member.status === filter)
      && (!needle || `${member.displayName ?? ""} ${member.email ?? ""} ${member.roleName}`.toLowerCase().includes(needle)));
  }, [members, query, filter]);

  return (
    <section className={`${styles.view} space-y-6 pb-10`}>
      <header className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1>Team</h1>
          <p>Everyone who can open {organisationName ? `${organisationName}’s` : "this client’s"} projects, and what each person is allowed to do.</p>
        </div>
        <div className={styles.toolbar}>
          <button type="button" onClick={props.onRefresh} disabled={busy}>Refresh</button>
        </div>
      </header>

      <section className={styles.overview} aria-label="Client summary">
        <div className={styles.projectMark} aria-hidden="true"><EnergyIcon name="user" className="h-7 w-7" /></div>
        <div className={styles.projectIdentity}>
          <h2>{organisationName ?? "Your client"}</h2>
          <p><EnergyIcon name="info" aria-hidden="true" />Team access</p>
        </div>
        {members ? (
          <dl className={styles.projectStats}>
            <div><dt>People</dt><dd>{counts.all}</dd></div>
            <div><dt>Active</dt><dd>{counts.active}</dd></div>
            <div><dt>Waiting to join</dt><dd>{counts.pending}</dd></div>
          </dl>
        ) : null}
        <div className={styles.projectState}>
          <div className={styles.stateRow}><span className={counts.pending === 0 ? styles.live : undefined}>{counts.pending === 0 ? "Everyone has joined" : `${counts.pending} waiting to join`}</span></div>
        </div>
      </section>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice && !invitationUrl ? <Banner tone="success">{notice}</Banner> : null}

      <div className="grid items-start gap-8 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm" aria-label="People with access">
          <header className="space-y-4 border-b border-border px-6 pb-4 pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">People with access</h2>
                <p className="mt-0.5 text-sm text-muted">{members ? `${counts.all} ${counts.all === 1 ? "person" : "people"} in ${organisationName ?? "this client"}` : "Loading…"}</p>
              </div>
              <div className="relative w-full sm:w-72">
                <EnergyIcon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-light" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} className={`${inputClass} !h-10 pl-10`} placeholder="Search name, email or role" aria-label="Search people" />
              </div>
            </div>
            <div role="tablist" aria-label="Filter people" className="flex flex-wrap gap-2">
              {([["all", "All"], ["active", "Active"], ["pending", "Invited"], ["disabled", "Disabled"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={filter === value}
                  onClick={() => setFilter(value)}
                  className={["inline-flex h-8 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold transition-colors", filter === value ? "bg-primary text-white" : "bg-surface-subtle text-muted hover:bg-border/60"].join(" ")}
                >
                  {label}<span className={["rounded-full px-1.5 text-[11px] tabular-nums", filter === value ? "bg-white/20" : "bg-surface"].join(" ")}>{counts[value]}</span>
                </button>
              ))}
            </div>
          </header>

          <div className={`hidden gap-4 border-b border-border bg-surface-subtle/60 px-6 py-3 text-xs font-semibold uppercase tracking-wider text-muted-light md:grid ${COLUMNS}`} aria-hidden="true">
            <span>Person</span><span>Role</span><span>Status</span><span />
          </div>

          {members === null && !error ? (
            <ul className="divide-y divide-border" aria-busy="true">
              {[0, 1, 2, 3].map((row) => (
                <li key={row} className="flex items-center gap-4 px-6 py-5">
                  <span className="h-11 w-11 animate-pulse rounded-full bg-surface-subtle" />
                  <span className="space-y-2"><span className="block h-3.5 w-44 animate-pulse rounded bg-surface-subtle" /><span className="block h-3 w-32 animate-pulse rounded bg-surface-subtle" /></span>
                </li>
              ))}
            </ul>
          ) : null}
          {members && visible?.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-subtle text-muted"><EnergyIcon name="user" className="h-6 w-6" /></span>
              <p className="mt-4 text-base font-semibold">{query || filter !== "all" ? "No one matches that" : "No one has been added yet"}</p>
              <p className="mt-1 max-w-sm text-sm leading-6 text-muted">{query || filter !== "all" ? "Try a different search or filter." : canWrite ? "Invite the first person using the form and they will appear here." : "People added to this client will appear here."}</p>
            </div>
          ) : null}

          <ul className="divide-y divide-border">
            {visible?.map((member) => {
              const status = STATUS[member.status];
              return (
                <li key={member.id} className={`grid items-center gap-x-4 gap-y-3 px-6 py-4 transition-colors hover:bg-surface-subtle/50 ${COLUMNS}`}>
                  <div className="flex min-w-0 items-center gap-3.5">
                    <Avatar member={member} />
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold">{member.displayName ?? member.email}</p>
                      {member.displayName && member.email ? <p className="truncate text-[13px] text-muted">{member.email}</p> : null}
                    </div>
                  </div>
                  <div><RoleBadge name={member.roleName} /></div>
                  <div>
                    <p className={`inline-flex items-center gap-2 text-[13px] font-semibold ${status.text}`}><span className={`h-2 w-2 rounded-full ${status.dot}`} />{status.label}</p>
                    <p className="mt-0.5 text-xs text-muted">{lastActive(member)}</p>
                  </div>
                  <div className="flex min-h-9 flex-wrap justify-start gap-2 md:flex-nowrap md:justify-end">
                    {member.canChange && member.status === "pending" ? <button type="button" disabled={busy} className={secondaryButton} onClick={() => props.onResend(member)}>Resend invite</button> : null}
                    {member.canChange ? <button type="button" disabled={busy} className={dangerButton} onClick={() => props.onRemove(member)}>Remove</button> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="grid items-start gap-6 lg:grid-cols-2 2xl:sticky 2xl:top-6 2xl:grid-cols-1">
          {invitationUrl ? (
            <section aria-label="Invitation link" className="overflow-hidden lg:col-span-2 2xl:col-span-1 rounded-2xl border border-step-success/30 bg-step-success/5">
              <div className="flex items-start gap-3 px-6 pt-5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-step-success/15 text-step-success"><EnergyIcon name="check" className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-semibold">Invitation ready</h2>
                  <p className="mt-1 text-[13px] leading-6 text-muted">Email may be switched off, so send this one-time link to them yourself. It stops working after 7 days.</p>
                </div>
              </div>
              <div className="space-y-3 px-6 pb-5 pt-4">
                <code className="block overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-surface px-3.5 py-2.5 text-xs text-muted">{invitationUrl}</code>
                <div className="flex gap-2">
                  <button type="button" className={`${secondaryButton} flex-1`} onClick={async () => { await navigator.clipboard.writeText(invitationUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>{copied ? "Copied ✓" : "Copy link"}</button>
                  <button type="button" className={secondaryButton} onClick={props.onDismissInvitation}>Dismiss</button>
                </div>
              </div>
            </section>
          ) : null}

          {canWrite ? (
            <form onSubmit={props.onInvite} className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
              <div className="flex items-start gap-3.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><EnergyIcon name="plus" className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight">Invite someone</h2>
                  <p className="mt-1 text-[13.5px] leading-6 text-muted">They get a one-time link to choose a password and join as a <strong className="font-semibold text-foreground">Viewer</strong>.</p>
                </div>
              </div>
              <div className="mt-6 space-y-4">
                <label className="block text-[13px] font-semibold">Full name
                  <input value={props.displayName} onChange={(event) => props.onDisplayNameChange(event.target.value)} className={`${inputClass} mt-1.5`} placeholder="e.g. Alex Tan" autoComplete="off" />
                </label>
                <label className="block text-[13px] font-semibold">Email address
                  <input type="email" required value={props.email} onChange={(event) => props.onEmailChange(event.target.value)} className={`${inputClass} mt-1.5`} placeholder="name@company.com" autoComplete="off" />
                </label>
              </div>
              <button type="submit" disabled={busy || !props.email.trim()} className={`${primaryButton} mt-6 w-full`}>{busy ? "Working…" : "Create invitation"}</button>
              <p className="mt-3 text-center text-xs text-muted-light">You can remove their access at any time.</p>
            </form>
          ) : null}

          <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm" aria-label="What each role can do">
            <h2 className="text-lg font-semibold tracking-tight">What each role can do</h2>
            <p className="mt-1 text-[13.5px] leading-6 text-muted">The roles in use at this client. Only a super admin can change them.</p>
            <div className="mt-5 space-y-5">
              {roles.map((role) => (
                <div key={role.id} className="rounded-2xl border border-border bg-surface-subtle/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <RoleBadge name={role.name} />
                    <span className="text-xs text-muted">{role.memberCount} {role.memberCount === 1 ? "person" : "people"}</span>
                  </div>
                  {role.description ? <p className="mt-2.5 text-[13px] leading-5 text-muted">{role.description}</p> : null}
                  <ul className="mt-3 space-y-1.5">
                    {(Object.keys(AREA_TITLES) as EnergyPermissionArea[]).map((area) => (
                      <li key={area} className="flex items-center gap-2.5 text-[13px]">
                        <EnergyIcon name={AREA_TITLES[area].icon} className="h-3.5 w-3.5 shrink-0 text-muted-light" />
                        <span className={["min-w-0 flex-1 truncate", role.permissions[area] === "none" ? "text-muted-light" : ""].join(" ")}>{AREA_TITLES[area].title}</span>
                        <LevelPill level={role.permissions[area]} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}

/** The page's shape while access loads, so nothing jumps when the real content arrives. */
export function TeamLoading() {
  return (
    <div className="min-w-0 p-4 sm:p-6" aria-busy="true" role="status" aria-label="Loading team">
      <section className={`${styles.view} space-y-6 pb-10`}>
        <header className={styles.pageHeader}>
          <div className={styles.pageHeading}><h1>Team</h1><p>Loading who has access…</p></div>
        </header>
        <div className="h-[92px] animate-pulse rounded-2xl border border-border bg-surface" />
        <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="h-[320px] animate-pulse rounded-2xl border border-border bg-surface" />
          <div className="h-[320px] animate-pulse rounded-2xl border border-border bg-surface" />
        </div>
      </section>
    </div>
  );
}

function Banner({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={["rounded-2xl border px-5 py-3.5 text-[15px]", tone === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-step-success/25 bg-step-success/5 text-step-success"].join(" ")}>
      {children}
    </div>
  );
}

const AVATAR_TINTS = ["bg-emerald-100 text-emerald-800", "bg-sky-100 text-sky-800", "bg-amber-100 text-amber-800", "bg-violet-100 text-violet-800", "bg-rose-100 text-rose-800", "bg-teal-100 text-teal-800"];

function Avatar({ member }: { member: EnergyTeamMemberDto }) {
  const label = (member.displayName ?? member.email ?? "?").trim();
  const initials = label.split(/[\s@.]+/u).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("") || "?";
  const tint = AVATAR_TINTS[[...(member.id)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % AVATAR_TINTS.length]!;
  return <span aria-hidden="true" className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${tint}`}>{initials}</span>;
}

/** Built-in and manager roles read as a clear step up from a plain Viewer. */
function RoleBadge({ name }: { name: string }) {
  const viewer = name === "Viewer";
  return (
    <span className={["inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-[12.5px] font-semibold", viewer ? "border-border bg-surface-subtle text-muted" : "border-primary/25 bg-primary/10 text-primary"].join(" ")}>
      {name}
    </span>
  );
}

function LevelPill({ level }: { level: EnergyPermissionLevel }) {
  const tone = level === "write" ? "bg-step-success/15 text-step-success" : level === "read" ? "bg-primary/10 text-primary" : "bg-surface-subtle text-muted-light";
  return <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-semibold uppercase tracking-wide ${tone}`}>{level}</span>;
}

function lastActive(member: EnergyTeamMemberDto): string {
  if (member.status === "pending") return "Hasn’t joined yet";
  if (!member.lastLoginAt) return "Never signed in";
  const seconds = Math.round((new Date(member.lastLoginAt).getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return "Just now";
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  if (abs < 30 * 86_400) return format.format(Math.round(seconds / 86_400), "day");
  return new Date(member.lastLoginAt).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}
