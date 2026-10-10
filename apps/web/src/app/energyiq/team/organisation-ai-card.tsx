"use client";

import { useEffect, useState } from "react";

import { configApi, type EnergyAiOrganisationDto } from "../../../lib/config-api";
import { friendlyErrorMessage } from "../_components/friendly-error";
import { EnergyIcon } from "../_components/icons";
import styles from "../admin/admin-ai.module.css";

/** The client's own view of AI: on or off (its People admins can switch it), the model, and this month's use. */
export function OrganisationAiCard({ workspaceId }: { workspaceId: string }) {
  const [ai, setAi] = useState<EnergyAiOrganisationDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setAi(null);
    configApi.getEnergyAiSettings().then(setAi).catch(() => setAi(null));
  }, [workspaceId]);
  if (!ai) return null;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      setAi(await configApi.setEnergyAiEnabled(!ai.enabled));
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: "AI could not be switched." }));
    } finally {
      setBusy(false);
    }
  };
  const share = ai.monthlyRequestLimit ? Math.min(1, ai.usedThisMonth / ai.monthlyRequestLimit) : 0;
  return (
    <section className={styles.intro} aria-label="AI for your organisation">
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg" style={{ background: "color-mix(in srgb, #6e56cf 14%, transparent)", color: "#6e56cf" }}><EnergyIcon name="spark" className="h-4 w-4" /></span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">AI for your organisation</h2>
          <p className="!text-[13px]">
            {ai.enabled ? "On" : "Off"} · {ai.model} · {ai.usedThisMonth} AI request{ai.usedThisMonth === 1 ? "" : "s"} this month
            {ai.monthlyRequestLimit !== undefined ? ` of ${ai.monthlyRequestLimit}` : ""}
            {ai.blockedThisMonth ? ` · ${ai.blockedThisMonth} refused` : ""}
          </p>
          {ai.monthlyRequestLimit !== undefined && <span className={`${styles.meter} mt-2 w-56 ${share >= 1 ? styles.full : share >= 0.8 ? styles.near : ""}`}><i style={{ width: `${share * 100}%` }} /></span>}
          {error && <p role="alert" className={styles.error}>{error}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <a href="/legal/ai-use" target="_blank" rel="noreferrer" className={styles.link}>AI use policy</a>
        {ai.canToggle && (
          <button type="button" role="switch" aria-checked={ai.enabled} aria-label="Use AI in this organisation" className={styles.switch} disabled={busy} onClick={() => void toggle()}>
            <span />
          </button>
        )}
      </div>
    </section>
  );
}
