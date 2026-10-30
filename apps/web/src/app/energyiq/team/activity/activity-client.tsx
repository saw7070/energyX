"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  configApi,
  type EnergyOrganisationActivityDto,
  type EnergyOrganisationActivityFilterDto,
} from "../../../../lib/config-api";
import { useEnergyIqAccess } from "../../_components/energyiq-access";
import { EnergySelect } from "../../_components/energy-select";
import { friendlyErrorMessage } from "../../_components/friendly-error";
import { EnergyIcon } from "../../_components/icons";
import styles from "../../_components/project-configuration-view.module.css";

type Client = Pick<typeof configApi, "listEnergyOrganisationActivity" | "downloadEnergyOrganisationActivity" | "getEnergyTeam">;
type ActivityType = NonNullable<EnergyOrganisationActivityFilterDto["type"]>;

const TYPES: Array<{ value: ActivityType; label: string }> = [
  { value: "", label: "All activity" },
  { value: "sign-in", label: "Sign-ins" },
  { value: "people", label: "People and access" },
  { value: "projects", label: "Projects and settings" },
  { value: "ai", label: "AI use" },
  { value: "support", label: "EnergyX support access" },
];

const WARNINGS = new Set(["auth.login_failed", "auth.login_unverified", "energyiq.ai_blocked"]);
const inputClass = "mt-1 h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm font-normal";

/** A date from the picker as the start of that day, in the viewer's own time zone. */
const dayStart = (date: string, addDays = 0): string | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return undefined;
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day + addDays).toISOString();
};
const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Team → Activity: who signed in, what changed and when EnergyX support looked, for the people who run the client. */
export function EnergyIqTeamActivity() {
  const { access, error: accessError } = useEnergyIqAccess();
  if (!access) {
    return accessError
      ? <div className="p-4 sm:p-6"><p role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-3.5 text-[15px] text-rose-700">{accessError}</p></div>
      : <div className="p-4 sm:p-6" aria-busy="true" role="status" aria-label="Loading activity"><div className="h-[320px] animate-pulse rounded-2xl border border-border bg-surface" /></div>;
  }
  if (access.team?.canManagePeople !== true) {
    return (
      <section className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center px-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-subtle text-muted"><EnergyIcon name="clock" className="h-6 w-6" /></span>
        <h1 className="mt-4 text-xl font-semibold">Activity is not available</h1>
        <p className="mt-2 text-[15px] text-muted">Only the people who manage this organisation&apos;s members can see its activity.</p>
      </section>
    );
  }
  // A new key when the Organisation changes in the top bar, so nothing from the previous client stays on screen.
  return <div className="mx-auto min-w-0 max-w-[1440px] p-4 sm:p-6"><OrganisationActivity key={access.activeWorkspaceId} /></div>;
}

export function OrganisationActivity({ client = configApi, today = new Date() }: { client?: Client; today?: Date }) {
  const [from, setFrom] = useState(() => isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)));
  const [to, setTo] = useState("");
  const [person, setPerson] = useState("");
  const [type, setType] = useState<ActivityType>("");
  const [people, setPeople] = useState<Array<{ value: string; label: string }>>([]);
  const [organisation, setOrganisation] = useState<string | undefined>();
  const [events, setEvents] = useState<EnergyOrganisationActivityDto[]>([]);
  const [next, setNext] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filter = useMemo((): EnergyOrganisationActivityFilterDto => {
    const start = dayStart(from);
    const end = dayStart(to, 1);
    return { ...(start ? { from: start } : {}), ...(end ? { to: end } : {}), ...(person ? { person } : {}), ...(type ? { type } : {}) };
  }, [from, to, person, type]);

  const load = useCallback(async (before?: string) => {
    setLoading(true);
    setError(null);
    try {
      const page = await client.listEnergyOrganisationActivity({ ...filter, ...(before ? { before } : {}), limit: 100 });
      setOrganisation(page.organisation?.name);
      setEvents((current) => (before ? [...current, ...page.events] : page.events));
      setNext(page.next);
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: "The activity could not be loaded." }));
    } finally {
      setLoading(false);
    }
  }, [client, filter]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let current = true;
    client.getEnergyTeam().then((team) => {
      if (!current) return;
      setPeople(team.members.map((member) => ({ value: member.id, label: member.displayName ?? member.email ?? "Unnamed person" })));
    }).catch(() => undefined);
    return () => { current = false; };
  }, [client]);

  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      const { blob, filename } = await client.downloadEnergyOrganisationActivity(filter);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: "The activity could not be downloaded." }));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className={`${styles.view} space-y-4 pb-10`} aria-label="Activity">
      <header className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1>Activity</h1>
          <p>Who signed in, what changed and when EnergyX support looked at {organisation ? `${organisation}’s` : "this client’s"} data. Newest first.</p>
        </div>
        <div className={styles.toolbar}>
          <Link href="/energyiq/team">Back to Team</Link>
          <button type="button" onClick={() => void download()} disabled={downloading}><EnergyIcon name="download" />{downloading ? "Preparing…" : "Download CSV"}</button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-4">
        <label className="text-xs font-semibold">From
          <input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} className={`${inputClass} w-40`} aria-label="From" />
        </label>
        <label className="text-xs font-semibold">To
          <input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} className={`${inputClass} w-40`} aria-label="To" />
        </label>
        <label className="text-xs font-semibold">Person
          <EnergySelect ariaLabel="Person" value={person} options={[{ value: "", label: "Everyone" }, ...people]} onValueChange={setPerson} className="mt-1 w-56" />
        </label>
        <label className="text-xs font-semibold">Activity
          <EnergySelect ariaLabel="Activity" value={type} options={TYPES} onValueChange={(value) => setType(value as ActivityType)} className="mt-1 w-56" />
        </label>
      </div>

      {error ? <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border bg-surface-subtle text-xs text-muted">
            <tr><Th>When</Th><Th>Who</Th><Th>What</Th><Th>Project</Th><Th>From</Th></tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-border align-top last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">{when(event.at)}</td>
                <td className="px-4 py-2.5">
                  {event.who ?? event.email ?? <span className="text-muted">System</span>}
                  {event.support ? <span className="ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">EnergyX support</span> : null}
                  {event.who && event.email && event.who !== event.email ? <span className="block text-xs text-muted">{event.email}</span> : null}
                </td>
                <td className="px-4 py-2.5">
                  <span className={WARNINGS.has(event.type) ? "font-medium text-rose-700" : "font-medium"}>{event.label}</span>
                  {event.target ? <span className="block text-xs text-muted">{event.target}</span> : null}
                </td>
                <td className="px-4 py-2.5 text-muted">{event.project ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-muted">{event.ip ?? "—"}</td>
              </tr>
            ))}
            {!events.length && !loading ? <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted">Nothing recorded for these filters.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{events.length ? `Showing ${events.length} ${events.length === 1 ? "entry" : "entries"}` : ""}</span>
        {next ? <button type="button" disabled={loading} onClick={() => void load(next)} className="h-9 rounded-lg border border-border bg-surface px-3 font-semibold text-foreground hover:bg-surface-subtle disabled:opacity-50">{loading ? "Loading…" : "Show more"}</button>
          : loading ? <span>Loading…</span> : null}
      </div>
    </section>
  );
}

function Th({ children }: { children: ReactNode }) {
  return <th className="px-4 py-2.5 font-semibold">{children}</th>;
}
