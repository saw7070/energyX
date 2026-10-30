"use client";

import { useEffect, useState, type FormEvent } from "react";

import { configApi } from "../../../lib/config-api";
import type { TwoStepSetupDto, TwoStepStatusDto } from "../../../lib/config-api";
import { friendlyErrorMessage } from "../_components/friendly-error";
import { formatSetupKey } from "../../../components/auth/two-step-format";

type Mode = "idle" | "setup" | "regenerate" | "disable";

const inputClass = "h-10 w-full max-w-[220px] rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-light focus:border-primary focus:ring-2 focus:ring-primary/10";
const primaryButtonClass = "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass = "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50";

const REQUIRED_REASON: Record<NonNullable<TwoStepStatusDto["requiredBy"]>, string> = {
  organisation: "Your organisation requires two-step verification, so it can't be turned off.",
  platform: "Platform administrators must use two-step verification, so it can't be turned off.",
};

/**
 * Two-step verification for the signed-in person: turn it on with an authenticator app, see recovery codes once, make
 * new ones, or turn it off. Turning off and new codes both need a current code from the app.
 */
export function TwoStepSettings() {
  const [status, setStatus] = useState<TwoStepStatusDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [setup, setSetup] = useState<TwoStepSetupDto | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    configApi.getTwoStepStatus()
      .then((result) => { if (!cancelled) setStatus(result); })
      .catch((reason: unknown) => {
        if (!cancelled) setLoadError(friendlyErrorMessage(reason, { fallback: "Two-step verification settings could not be loaded." }));
      });
    return () => { cancelled = true; };
  }, []);

  const begin = (next: Mode) => {
    setMode(next);
    setCode("");
    setError(null);
    setMessage(null);
    setRecoveryCodes(null);
  };

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback }));
    } finally {
      setBusy(false);
    }
  };

  const startSetup = () => run(async () => {
    begin("setup");
    setSetup(await configApi.startTwoStepSetup());
  }, "Two-step verification could not be started.");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!code.trim()) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    void run(async () => {
      if (mode === "setup") {
        const result = await configApi.confirmTwoStepSetup(code.trim());
        setStatus(result.status);
        setRecoveryCodes(result.recoveryCodes);
        setMessage("Two-step verification is on.");
      } else if (mode === "regenerate") {
        const result = await configApi.regenerateTwoStepRecoveryCodes(code.trim());
        setStatus(result.status);
        setRecoveryCodes(result.recoveryCodes);
        setMessage("New recovery codes are ready. The old ones no longer work.");
      } else if (mode === "disable") {
        setStatus(await configApi.disableTwoStep(code.trim()));
        setMessage("Two-step verification is off.");
      }
      setMode("idle");
      setSetup(null);
      setCode("");
    }, "That didn't work. Please try again.");
  };

  if (loadError) return <p className="text-sm text-rose-700">{loadError}</p>;
  if (!status) return <p role="status" className="text-sm text-muted">Loading two-step verification…</p>;

  return (
    <div className="grid max-w-xl gap-4" aria-label="Two-step verification" role="group">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Two-step verification</h3>
          <p className="mt-1 text-sm text-muted">
            When you sign in, enter a code from an authenticator app on your phone as well as your password.
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.enabled ? "border-step-success/30 text-step-success" : "border-border text-muted"}`}>
          {status.enabled ? "On" : "Off"}
        </span>
      </div>

      {recoveryCodes ? (
        <div className="rounded-lg border border-border bg-surface-subtle p-4">
          <p className="text-sm font-semibold text-foreground">Your recovery codes</p>
          <p className="mt-1 text-xs text-muted">
            Each one signs you in once if your phone isn't to hand. Keep them somewhere safe; they are shown only now.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-2 font-mono text-[13px] text-foreground sm:grid-cols-5" aria-label="Recovery codes">
            {recoveryCodes.map((value) => <li key={value}>{value}</li>)}
          </ul>
          <div className="mt-3 flex gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => void navigator.clipboard?.writeText(recoveryCodes.join("\n")).catch(() => undefined)}>
              Copy codes
            </button>
            <button type="button" className={primaryButtonClass} onClick={() => setRecoveryCodes(null)}>I've saved them</button>
          </div>
        </div>
      ) : null}

      {mode === "setup" ? (
        <form onSubmit={submit} className="grid gap-3 rounded-lg border border-border p-4">
          <p className="text-sm text-foreground">
            1. Open an authenticator app on your phone (such as Google Authenticator, Microsoft Authenticator or 1Password)
            and add a new account with this setup key:
          </p>
          {setup ? (
            <>
              <span className="w-fit rounded-lg border border-border bg-surface-subtle px-3 py-2 font-mono text-[13px] tracking-wide select-all" data-testid="two-step-secret">
                {formatSetupKey(setup.secret)}
              </span>
              <p className="text-xs text-muted">
                On a phone, you can <a href={setup.otpauthUri} className="font-medium text-primary hover:underline">open the setup link</a> instead:
                <span className="mt-1 block break-all font-mono text-[11px] select-all">{setup.otpauthUri}</span>
              </p>
            </>
          ) : <p className="text-xs text-muted">Preparing your setup key…</p>}
          <label htmlFor="two-step-setup-code" className="text-sm text-foreground">2. Enter the 6-digit code the app shows:</label>
          <CodeField id="two-step-setup-code" value={code} onChange={setCode} />
          <FormActions busy={busy || !setup} submitLabel="Turn on" onCancel={() => begin("idle")} error={error} />
        </form>
      ) : null}

      {mode === "regenerate" || mode === "disable" ? (
        <form onSubmit={submit} className="grid gap-3 rounded-lg border border-border p-4">
          <label htmlFor="two-step-confirm-code" className="text-sm text-foreground">
            {mode === "disable"
              ? "To turn off two-step verification, enter a code from your authenticator app (or a recovery code)."
              : "To make new recovery codes, enter a code from your authenticator app. Your current codes will stop working."}
          </label>
          <CodeField id="two-step-confirm-code" value={code} onChange={setCode} />
          <FormActions busy={busy} submitLabel={mode === "disable" ? "Turn off" : "Make new codes"} onCancel={() => begin("idle")} error={error} />
        </form>
      ) : null}

      {mode === "idle" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div aria-live="polite" className="min-h-5 text-xs">
            {error ? <span className="text-rose-700">{error}</span> : null}
            {!error && message ? <span className="text-step-success">{message}</span> : null}
            {!error && !message && status.enabled ? (
              <span className="text-muted">{status.recoveryCodesLeft} of 10 recovery codes left.</span>
            ) : null}
            {!error && !message && !status.enabled && !status.available ? (
              <span className="text-muted">Two-step verification can't be set up on this server yet. Ask your EnergyX administrator.</span>
            ) : null}
          </div>
          {status.enabled ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={secondaryButtonClass} onClick={() => begin("regenerate")}>New recovery codes</button>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={status.required}
                title={status.requiredBy ? REQUIRED_REASON[status.requiredBy] : undefined}
                onClick={() => begin("disable")}
              >
                Turn off
              </button>
            </div>
          ) : (
            <button type="button" className={primaryButtonClass} disabled={!status.available || busy} onClick={() => void startSetup()}>
              Turn on
            </button>
          )}
        </div>
      ) : null}
      {mode === "idle" && status.enabled && status.requiredBy ? (
        <p className="-mt-2 text-xs text-muted">{REQUIRED_REASON[status.requiredBy]}</p>
      ) : null}
    </div>
  );
}

function CodeField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <input
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="123 456"
      autoComplete="one-time-code"
      inputMode="numeric"
      className={inputClass}
    />
  );
}

function FormActions({ busy, submitLabel, onCancel, error }: { busy: boolean; submitLabel: string; onCancel: () => void; error: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span aria-live="polite" className="min-h-5 text-xs text-rose-700">{error}</span>
      <div className="flex gap-2">
        <button type="button" className={secondaryButtonClass} onClick={onCancel}>Cancel</button>
        <button type="submit" className={primaryButtonClass} disabled={busy}>{submitLabel}</button>
      </div>
    </div>
  );
}
