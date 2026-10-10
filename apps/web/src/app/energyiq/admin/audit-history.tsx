"use client";

import { useCallback, useEffect, useState } from "react";
import { configApi, type EnergyAuditEventDto, type EnergyAuditFilterDto } from "../../../lib/config-api";
import { EnergyIcon } from "../_components/icons";
import { EnergySelect } from "../_components/energy-select";
import { friendlyErrorMessage } from "../_components/friendly-error";

/** Plain words for each recorded event. Anything new still shows, under its technical name. */
export const AUDIT_EVENT_LABELS: Record<string, string> = {
  "auth.login_succeeded": "Signed in",
  "auth.login_failed": "Failed sign-in attempt",
  "auth.login_unverified": "Sign-in blocked: email not verified",
  "auth.logout": "Signed out",
  "auth.logout_all": "Signed out on every device",
  "auth.session_created": "Started a session",
  "auth.password_changed": "Changed their password",
  "auth.password_reset_requested": "Asked for a password reset",
  "auth.password_reset_requested_unknown": "Password reset asked for an unknown email",
  "auth.password_reset_completed": "Reset their password",
  "auth.invitation_created": "Invitation sent",
  "auth.invitation_resent": "Invitation sent again",
  "auth.invitation_accepted": "Accepted an invitation",
  "auth.email_verified": "Verified their email",
  "energyiq.user_updated": "Changed a user's account or access",
  "energyiq.user_access_assigned": "Gave a user access",
  "energyiq.team_member_invited": "Invited a team member",
  "energyiq.team_member_removed": "Removed a team member",
  "energyiq.team_invitation_resent": "Sent a team invitation again",
  "energyiq.role_created": "Created a role",
  "energyiq.role_updated": "Changed a role",
  "energyiq.role_deleted": "Deleted a role",
  "energyiq.organisation_created": "Created a client",
  "energyiq.organisation_updated": "Changed a client",
  "energyiq.organisation_deleted": "Deleted a client",
  "energyiq.project_created": "Created a project",
  "energyiq.project_archived": "Archived a project",
  "energyiq.project_restored": "Restored a project",
  "energyiq.project_deleted": "Deleted a project",
  "energyiq.project_moved": "Moved a project to another client",
  "energyiq.electricity_rate_published": "Changed the electricity rate",
  "energyiq.hours_holidays_published": "Changed opening hours or holidays",
  "energyiq.policy_version_selected": "Switched the rate or hours version in use",
  "energyiq.setup_published": "Published facility setup",
  "energyiq.changes_made_live": "Made facility changes live",
  "energyiq.setup_draft_saved": "Saved facility changes",
  "energyiq.data_import_changed": "Uploaded or changed meter data",
  "energyiq.live_connection_changed": "Changed the live meter connection",
  "energyiq.locations_changed": "Changed locations",
  "energyiq.analysis_rules_changed": "Changed analysis rules",
  "energyiq.overview_layout_changed": "Changed the Overview layout",
  "energyiq.budget_carbon_changed": "Changed a site's budget, carbon factor or overnight check",
  "energyiq.report_schedule_changed": "Changed a scheduled report email",
  "energyiq.report_email_sent": "Sent a scheduled report email",
};

const WARNINGS = new Set(["auth.login_failed", "auth.login_unverified", "auth.password_reset_requested_unknown"]);
const PERIODS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All time" },
];
const CATEGORIES: Array<{ value: NonNullable<EnergyAuditFilterDto["category"]>; label: string }> = [
  { value: "", label: "All activity" },
  { value: "sign-in", label: "Sign-ins and accounts" },
  { value: "access", label: "People and access" },
  { value: "projects", label: "Projects and settings" },
];

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Who did what and when across the platform, for super admins: filter, page through, and download for auditors. */
export function AuditHistory() {
  const [period, setPeriod] = useState("30");
  const [category, setCategory] = useState<NonNullable<EnergyAuditFilterDto["category"]>>("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<EnergyAuditEventDto[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filter = useCallback((): EnergyAuditFilterDto => ({
    ...(period === "all" ? {} : { from: new Date(Date.now() - Number(period) * 86_400_000).toISOString() }),
    ...(category ? { category } : {}),
    ...(query ? { search: query } : {}),
  }), [period, category, query]);

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await configApi.listEnergyAuditEvents({ ...filter(), ...(before ? { before } : {}), limit: 100 });
      setEvents(current => before ? [...current, ...page.events] : page.events);
      setNext(page.next);
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: "The audit history could not be loaded." }));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      const { blob, filename } = await configApi.downloadEnergyAuditEvents(filter());
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: "The audit history could not be downloaded." }));
    } finally {
      setDownloading(false);
    }
  };

  return <div className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-5 py-4">
      <p className="max-w-2xl text-sm text-muted">Every sign-in, change to people and access, and change to a project&apos;s settings or data: who did it, when, and from where. Newest first.</p>
      <button type="button" onClick={() => void download()} disabled={downloading} className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-border bg-surface px-3 text-xs font-semibold hover:bg-surface-subtle disabled:opacity-50">
        <EnergyIcon name="download" />{downloading ? "Preparing…" : "Download CSV"}
      </button>
    </header>

    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
      <label className="text-xs font-semibold">Period
        <EnergySelect ariaLabel="Period" value={period} options={PERIODS} onValueChange={setPeriod} className="mt-1 w-40" />
      </label>
      <label className="text-xs font-semibold">Activity
        <EnergySelect ariaLabel="Activity" value={category} options={CATEGORIES} onValueChange={value => setCategory(value as NonNullable<EnergyAuditFilterDto["category"]>)} className="mt-1 w-56" />
      </label>
      <form className="flex flex-1 items-end gap-2" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); }}>
        <label className="flex-1 text-xs font-semibold">Search
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Email, project or change" className="mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm font-normal" />
        </label>
        <button type="submit" className="h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-white">Search</button>
      </form>
    </div>

    {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}

    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-border bg-surface-subtle text-xs text-muted">
          <tr><th className="px-4 py-2.5 font-semibold">When</th><th className="px-4 py-2.5 font-semibold">Who</th><th className="px-4 py-2.5 font-semibold">What</th><th className="px-4 py-2.5 font-semibold">Where</th><th className="px-4 py-2.5 font-semibold">From</th></tr>
        </thead>
        <tbody>
          {events.map(event => <tr key={event.id} className="border-b border-border last:border-0 align-top">
            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">{when(event.at)}</td>
            <td className="px-4 py-2.5">{event.email ?? <span className="text-muted">System</span>}</td>
            <td className="px-4 py-2.5">
              <span className={WARNINGS.has(event.type) ? "font-medium text-rose-700" : "font-medium"}>{AUDIT_EVENT_LABELS[event.type] ?? event.type}</span>
              {event.target ? <span className="block text-xs text-muted">{event.target}</span> : null}
            </td>
            <td className="px-4 py-2.5 text-muted">{[event.organisation, event.project].filter(Boolean).join(" · ") || "—"}</td>
            <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">{event.ip ?? "—"}</td>
          </tr>)}
          {!events.length && !loading ? <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted">Nothing recorded for these filters.</td></tr> : null}
        </tbody>
      </table>
    </div>
    <div className="flex items-center justify-between text-xs text-muted">
      <span>{events.length ? `Showing ${events.length} ${events.length === 1 ? "entry" : "entries"}` : ""}</span>
      {next ? <button type="button" disabled={loading} onClick={() => void load(next)} className="h-9 rounded-lg border border-border bg-surface px-3 font-semibold text-foreground hover:bg-surface-subtle disabled:opacity-50">{loading ? "Loading…" : "Show more"}</button>
        : loading ? <span>Loading…</span> : null}
    </div>
  </div>;
}
