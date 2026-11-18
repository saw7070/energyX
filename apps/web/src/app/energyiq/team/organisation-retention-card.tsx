"use client";

import { useEffect, useState } from "react";

import { configApi, type EnergyTeamReadingRetentionDto } from "../../../lib/config-api";
import { friendlyErrorMessage } from "../_components/friendly-error";
import styles from "../admin/admin-ai.module.css";

type Months = EnergyTeamReadingRetentionDto["months"];

const CHOICES: Array<{ value: Months; label: string }> = [
  { value: null, label: "For good" },
  { value: 12, label: "12 months" },
  { value: 3, label: "3 months" },
];

const describe = (months: Months): string => months === null
  ? "For good · readings stay for as long as this client uses EnergyX"
  : `${months} months · readings older than ${months} months are deleted each night`;

/** A shorter limit than now deletes readings; a longer one (or For good) only stops deleting. */
const deletesReadings = (from: Months, to: Months): boolean => to !== null && (from === null || to < from);

/**
 * The client's "Keep meter readings for" setting. Everyone who may see the Team page sees it; only EnergyX platform
 * administrators can change it, because a shorter limit deletes older readings for every site of the client.
 */
export function OrganisationRetentionCard({ workspaceId }: { workspaceId: string }) {
  const [retention, setRetention] = useState<EnergyTeamReadingRetentionDto | null>(null);
  const [pending, setPending] = useState<Months | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRetention(null);
    setPending(undefined);
    configApi.getEnergyTeamReadingRetention().then(setRetention).catch(() => setRetention(null));
  }, [workspaceId]);
  if (!retention) return null;

  const save = async (months: Months) => {
    setBusy(true);
    setError(null);
    try {
      setRetention(await configApi.setEnergyTeamReadingRetention({ months }));
      setPending(undefined);
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: "The setting could not be changed." }));
    } finally {
      setBusy(false);
    }
  };
  const choose = (months: Months) => {
    if (months === retention.months) return setPending(undefined);
    if (deletesReadings(retention.months, months)) return setPending(months);
    void save(months);
  };

  return (
    <section className={styles.intro} aria-label="Keep meter readings for">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: "color-mix(in srgb, #176b59 14%, transparent)", color: "#176b59" }}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 8v4l2.5 2.5" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Keep meter readings for</h2>
          <p className="!text-[13px]">{describe(retention.months)}</p>
          {!retention.canChange && <p className={`${styles.hint} mt-1`}>Only EnergyX platform administrators can change this.</p>}
          {pending !== undefined && pending !== null && (
            <div role="alertdialog" aria-label="Delete older readings?" className="mt-2 grid gap-2">
              <p className={styles.warnText}>
                Readings older than {pending} months, for every site of this client, will be deleted permanently in tonight&apos;s
                clean-up. Year-on-year and 12-month reports won&apos;t be able to go back further. This can&apos;t be undone.
              </p>
              <div className="flex gap-2">
                <button type="button" className={styles.ghost} disabled={busy} onClick={() => void save(pending)}>Delete older readings</button>
                <button type="button" className={styles.ghost} disabled={busy} onClick={() => setPending(undefined)}>Cancel</button>
              </div>
            </div>
          )}
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </div>
      </div>
      {retention.canChange && (
        <select
          aria-label="Keep meter readings for"
          className={styles.select}
          disabled={busy}
          value={String(pending !== undefined ? pending : retention.months)}
          onChange={(event) => choose(event.target.value === "null" ? null : (Number(event.target.value) as 3 | 12))}
        >
          {CHOICES.map((choice) => <option key={String(choice.value)} value={String(choice.value)}>{choice.label}</option>)}
        </select>
      )}
    </section>
  );
}
