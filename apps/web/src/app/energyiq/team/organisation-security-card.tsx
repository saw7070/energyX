"use client";

import { useEffect, useState } from "react";

import { configApi, type EnergyTeamSecurityDto } from "../../../lib/config-api";
import { friendlyErrorMessage } from "../_components/friendly-error";
import styles from "../admin/admin-ai.module.css";

/**
 * The Organisation's "Require two-step verification" setting. Its People admins (and super admins) can switch it;
 * people who have not set it up are taken through setup at their next sign-in, so nobody is locked out.
 */
export function OrganisationSecurityCard({ workspaceId }: { workspaceId: string }) {
  const [security, setSecurity] = useState<EnergyTeamSecurityDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSecurity(null);
    configApi.getEnergyTeamSecurity().then(setSecurity).catch(() => setSecurity(null));
  }, [workspaceId]);
  if (!security) return null;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setSecurity(await configApi.setEnergyTeamSecurity({ requireTwoStep: !security.required }));
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: "The setting could not be changed." }));
    } finally {
      setBusy(false);
    }
  };
  const waiting = security.membersWithoutTwoStep;
  return (
    <section className={styles.intro} aria-label="Sign-in security">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: "color-mix(in srgb, #176b59 14%, transparent)", color: "#176b59" }}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Require two-step verification</h2>
          <p className="!text-[13px]">
            {security.required
              ? "On · everyone here enters a code from an authenticator app when they sign in with a password"
              : "Off · each person chooses whether to use two-step verification"}
          </p>
          {security.required && waiting > 0 ? (
            <p className={`${styles.hint} mt-1`}>
              {waiting} {waiting === 1 ? "person hasn't" : "people haven't"} set it up yet. They will be asked to at their next sign-in.
            </p>
          ) : null}
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </div>
      </div>
      {security.canChange && (
        <button type="button" role="switch" aria-checked={security.required} aria-label="Require two-step verification" className={styles.switch} disabled={busy} onClick={() => void toggle()}>
          <span />
        </button>
      )}
    </section>
  );
}
