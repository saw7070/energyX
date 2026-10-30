"use client";

import { useEffect, useState, type FormEvent } from "react";
import { configApi } from "../../lib/config-api/client";
import type { TwoStepPromptDto, TwoStepSetupDto } from "../../lib/config-api/types";
import { AUTH_BUTTON_CLASS, PasswordAuthShell, authErrorMessage } from "./auth-flow";
import { formatSetupKey } from "./two-step-format";

type Step = "code" | "recovery" | "setup" | "codes";

const HEADINGS: Record<Step, { title: string; subtitle: string }> = {
  code: { title: "Two-step verification", subtitle: "Enter the 6-digit code from your authenticator app" },
  recovery: { title: "Use a recovery code", subtitle: "Enter one of the codes you saved when you set this up" },
  setup: { title: "Set up two-step verification", subtitle: "It takes a minute, and keeps your account safe" },
  codes: { title: "Save your recovery codes", subtitle: "Each one signs you in once if your phone isn't to hand" },
};

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-sm text-foreground outline-none transition-colors duration-[140ms] placeholder:text-muted-light hover:border-muted-light focus:border-[#176b59] focus:ring-[3px] focus:ring-[#176b59]/15 motion-reduce:transition-none";
const LINK_CLASS = "text-xs font-medium text-[#176b59] transition-colors hover:text-[#115444] hover:underline underline-offset-2";

/**
 * The second step of password sign-in. "verify": the person enters a code from their authenticator app (or a recovery
 * code). "enroll": two-step verification is required and not set up yet, so they add EnergyX to an app, confirm with
 * a code and see their recovery codes once. No session exists until a code is accepted.
 */
export function TwoStepSignIn({
  prompt,
  onAuthenticated,
  onCancel,
}: {
  prompt: TwoStepPromptDto;
  onAuthenticated: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [step, setStep] = useState<Step>(prompt.mode === "enroll" ? "setup" : "code");
  const [setup, setSetup] = useState<TwoStepSetupDto | null>(null);
  const [value, setValue] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (prompt.mode !== "enroll") return;
    let cancelled = false;
    configApi
      .startTwoStepSignInSetup({ challenge: prompt.challenge })
      .then((result) => {
        if (!cancelled) setSetup(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(authErrorMessage(reason, "login"));
      });
    return () => {
      cancelled = true;
    };
  }, [prompt]);

  const switchTo = (next: Step) => {
    setStep(next);
    setValue("");
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === "codes") {
      await onAuthenticated();
      return;
    }
    if (!value.trim()) {
      setError(step === "recovery" ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await configApi.completeTwoStepSignIn({
        challenge: prompt.challenge,
        ...(step === "recovery" ? { recoveryCode: value.trim() } : { code: value.trim() }),
      });
      if (result.recoveryCodes?.length) {
        setRecoveryCodes(result.recoveryCodes);
        setStep("codes");
        return;
      }
      await onAuthenticated();
    } catch (reason) {
      setError(authErrorMessage(reason, "login"));
    } finally {
      setSubmitting(false);
    }
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard?.writeText(recoveryCodes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const heading = HEADINGS[step];
  const subtitle = step === "setup" && prompt.requiredBy
    ? prompt.requiredBy === "organisation"
      ? "Your organisation asks everyone to use it when signing in"
      : "Platform administrators use it every time they sign in"
    : heading.subtitle;

  return (
    <PasswordAuthShell title={heading.title} subtitle={subtitle}>
      <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)} noValidate>
        {step === "setup" ? (
          <ol className="flex list-decimal flex-col gap-4 pl-4 text-sm leading-6 text-foreground marker:text-muted">
            <li>
              Open an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password,
              and add a new account.
            </li>
            <li>
              Enter this setup key in the app:
              {setup ? (
                <span className="mt-2 block rounded-lg border border-border bg-surface-subtle px-3 py-2 font-mono text-[13px] tracking-wide text-foreground select-all" data-testid="two-step-secret">
                  {formatSetupKey(setup.secret)}
                </span>
              ) : (
                <span className="mt-2 block text-xs text-muted">Preparing your setup key…</span>
              )}
              {setup ? (
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer">Use a setup link instead</summary>
                  <p className="mt-2">
                    On a phone, <a href={setup.otpauthUri} className={LINK_CLASS}>open the setup link</a> to add it in one tap. Or copy it:
                  </p>
                  <span className="mt-1 block break-all rounded-md bg-surface-subtle px-2 py-1.5 font-mono text-[11px] select-all">{setup.otpauthUri}</span>
                </details>
              ) : null}
            </li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
        ) : null}

        {step === "codes" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-6 text-muted">
              Keep these somewhere safe, away from your phone. They are shown only now.
            </p>
            <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface-subtle p-3 font-mono text-[13px] text-foreground" aria-label="Recovery codes">
              {recoveryCodes.map((code) => <li key={code}>{code}</li>)}
            </ul>
            <button type="button" onClick={() => void copyCodes()} className={`${LINK_CLASS} w-fit`}>
              {copied ? "Copied" : "Copy codes"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="two-step-code" className="text-xs font-medium text-foreground">
                {step === "recovery" ? "Recovery code" : "6-digit code"}
              </label>
              {step === "code" ? (
                <button type="button" onClick={() => switchTo("recovery")} className={LINK_CLASS}>Use a recovery code</button>
              ) : step === "recovery" ? (
                <button type="button" onClick={() => switchTo("code")} className={LINK_CLASS}>Use your app instead</button>
              ) : null}
            </div>
            <input
              id="two-step-code"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={step === "recovery" ? "xxxxx-xxxxx" : "123 456"}
              autoComplete="one-time-code"
              inputMode={step === "recovery" ? "text" : "numeric"}
              autoFocus
              aria-required
              className={INPUT_CLASS}
            />
          </div>
        )}

        {error ? (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700">
            {error}
          </p>
        ) : null}

        <button className={AUTH_BUTTON_CLASS} disabled={submitting || (step === "setup" && !setup)} type="submit">
          {submitting ? "Please wait…" : step === "setup" ? "Turn on and sign in" : step === "codes" ? "I've saved them, continue" : "Verify"}
        </button>
      </form>

      {step !== "codes" ? (
        <div className="mt-8 border-t border-border pt-5 text-center text-xs text-muted">
          <p>
            {step === "recovery" || step === "code" ? "Lost your phone and your codes? Ask your administrator to reset two-step verification. " : null}
            <button
              type="button"
              onClick={onCancel}
              className="font-medium text-foreground underline-offset-2 transition-colors hover:text-primary-light hover:underline"
            >
              Back to sign in
            </button>
          </p>
        </div>
      ) : null}
    </PasswordAuthShell>
  );
}
