"use client";

import { useState, type FormEvent } from "react";

import { friendlyErrorMessage } from "../../app/energyiq/_components/friendly-error";
import { organisationSignInApi } from "../../lib/config-api/organisation-sign-in";
import { AUTH_BUTTON_CLASS } from "./auth-flow";

/** The link under the password form that switches to signing in with the organisation's own account. */
export function SsoSignInLink({ onClick }: { onClick: () => void }) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-light" aria-hidden>
        <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
      </div>
      <button
        type="button"
        onClick={onClick}
        className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold text-foreground transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#176b59]/40"
      >
        <KeyIcon />
        Sign in with your organisation’s account (SSO)
      </button>
    </div>
  );
}

/**
 * Email first: the address tells EnergyX which organisation's sign-in service to send the person to (Microsoft,
 * Google, Okta and others). The service sends them back signed in, or back here with `error` explaining why not.
 */
export function SsoSignInForm({
  returnTo,
  error = null,
  onBack,
  redirect = (url) => window.location.assign(url),
}: {
  returnTo?: string | null;
  error?: string | null;
  onBack: () => void;
  /** Swapped out in tests. */
  redirect?: (url: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) {
      setLocalError("Enter your work email address.");
      return;
    }
    setSubmitting(true);
    setLocalError(null);
    try {
      const { redirectUrl } = await organisationSignInApi.startSingleSignOn({
        email: email.trim(),
        rememberMe,
        ...(returnTo ? { returnTo } : {}),
      });
      redirect(redirectUrl);
    } catch (reason) {
      setLocalError(friendlyErrorMessage(reason, { fallback: "We couldn’t start single sign-on. Please try again." }));
      setSubmitting(false);
    }
  };

  const shownError = localError ?? error;
  return (
    <>
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        <p className="text-sm leading-6 text-muted">
          Enter your work email and we’ll take you to your organisation’s sign-in page, such as Microsoft, Google or Okta.
        </p>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sso-email" className="text-xs font-medium text-foreground">Work email</label>
          <input
            id="sso-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            aria-required
            className="h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-sm text-foreground outline-none transition-colors duration-[140ms] placeholder:text-muted-light hover:border-muted-light focus:border-[#176b59] focus:ring-[3px] focus:ring-[#176b59]/15 motion-reduce:transition-none"
          />
        </div>
        <label htmlFor="sso-remember" className="-mt-1 flex w-fit cursor-pointer select-none items-center gap-2.5 text-sm text-foreground">
          <input
            id="sso-remember"
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-border accent-[#176b59]"
          />
          Remember me for 30 days
        </label>
        {shownError ? (
          <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700">
            {shownError}
          </p>
        ) : null}
        <button className={AUTH_BUTTON_CLASS} disabled={submitting} type="submit">
          {submitting ? "Taking you to your organisation…" : "Continue"}
        </button>
      </form>
      <div className="mt-8 border-t border-border pt-5 text-center text-xs text-muted">
        <button
          type="button"
          onClick={onBack}
          className="font-medium text-foreground underline-offset-2 transition-colors hover:text-primary-light hover:underline"
        >
          Sign in with email and password instead
        </button>
      </div>
    </>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="8" cy="15" r="4" />
      <path d="m10.8 12.2 8.7-8.7M17 6l2.5 2.5M14.5 8.5 16 10" />
    </svg>
  );
}
