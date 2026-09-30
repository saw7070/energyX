"use client";

import { useCallback, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { configApi } from "../../lib/config-api/client";
import { EnergyXMark } from "../brand/energyx-mark";

export type AuthMode = "login" | "invite" | "forgot" | "verify" | "reset";

const AUTH_MODE_META: Record<AuthMode, { title: string; subtitle: string; submit: string }> = {
  login: { title: "Sign in", subtitle: "Welcome back to EnergyX", submit: "Sign in" },
  invite: { title: "Activate account", subtitle: "Complete your EnergyX invitation", submit: "Activate account" },
  forgot: { title: "Forgot password", subtitle: "We'll send you a reset link", submit: "Send reset link" },
  verify: { title: "Verify email", subtitle: "Enter the code we sent you", submit: "Verify email" },
  reset: { title: "Reset password", subtitle: "Choose a new password", submit: "Reset password" },
};

export const AUTH_BUTTON_CLASS =
  "flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#176b59] px-3 text-sm font-semibold text-white shadow-sm transition-[background-color,transform] duration-[140ms] hover:bg-[#115444] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#176b59]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

/**
 * Self-contained invitation-only password auth journey. Account creation is
 * owned by Admin; users can sign in, activate an invitation or recover access.
 */
export function AuthFlow({
  initialMode,
  initialToken = "",
  onAuthenticated,
  error = null,
}: {
  initialMode: AuthMode;
  initialToken?: string;
  onAuthenticated: () => void | Promise<void>;
  error?: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [token, setToken] = useState(initialToken);
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const goToSubMode = useCallback((next: AuthMode) => {
    setMode(next);
    setLocalError(null);
    setMessage(null);
  }, []);

  // Recovery and invitation states live on /login. Reset the local mode as
  // well because pushing the same URL does not remount this component.
  const goToLogin = useCallback(() => {
    goToSubMode("login");
    router.push("/login");
  }, [goToSubMode, router]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    setMessage(null);
    try {
      if ((mode === "invite" || mode === "reset") && password.length < 8) {
        setLocalError("Password must be at least 8 characters.");
        return;
      }
      if (mode === "login") {
        await configApi.login({ email, password, rememberMe });
        await onAuthenticated();
        return;
      }
      if (mode === "invite") {
        await configApi.activateAccount({ token, password, displayName });
        await onAuthenticated();
        return;
      }
      if (mode === "forgot") {
        const result = await configApi.forgotPassword({ email });
        if (result.resetToken) {
          setToken(result.resetToken);
          setMode("reset");
        } else {
          setMessage("If the account exists, a reset link has been sent.");
        }
        return;
      }
      if (mode === "verify") {
        await configApi.verifyEmail({ token });
        router.push("/login");
        return;
      }
      if (mode === "reset") {
        await configApi.resetPassword({ token, password });
        setMessage("Password reset. Sign in to continue.");
        setMode("login");
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  const meta = AUTH_MODE_META[mode];
  const shownError = localError || error;

  return (
    <PasswordAuthShell title={meta.title} subtitle={meta.subtitle}>
      <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
        {mode === "invite" ? (
          <AuthField
            id="auth-display-name"
            label="Display name"
            value={displayName}
            onChange={setDisplayName}
            placeholder="Ada Lovelace"
            autoComplete="name"
          />
        ) : null}
        {(mode === "verify" || mode === "reset") && !initialToken ? (
          <AuthField
            id="auth-token"
            label={mode === "verify" ? "Verification code" : "Reset code"}
            value={token}
            onChange={setToken}
            placeholder={mode === "verify" ? "Paste your verification code" : "Paste your reset code"}
            autoComplete="one-time-code"
          />
        ) : null}
        {mode === "login" || mode === "forgot" ? (
          <AuthField
            id="auth-email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
          />
        ) : null}
        {mode !== "forgot" && mode !== "verify" ? (
          <AuthField
            id="auth-password"
            label={mode === "reset" ? "New password" : "Password"}
            type="password"
            value={password}
            onChange={setPassword}
            placeholder={mode === "login" ? "Enter your password" : "At least 8 characters"}
            hint={mode === "invite" || mode === "reset" ? "At least 8 characters" : undefined}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            {...(mode === "login"
              ? {
                  action: (
                    <button
                      type="button"
                      onClick={() => goToSubMode("forgot")}
                      className="text-xs font-medium text-[#176b59] transition-colors hover:text-[#115444] hover:underline underline-offset-2"
                    >
                      Forgot password?
                    </button>
                  ),
                }
              : {})}
          />
        ) : null}

        {mode === "login" ? (
          <label htmlFor="auth-remember" className="-mt-1 flex w-fit cursor-pointer select-none items-center gap-2.5 text-sm text-foreground">
            <input
              id="auth-remember"
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-border accent-[#176b59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#176b59]/40 focus-visible:ring-offset-2"
            />
            Remember me for 30 days
          </label>
        ) : null}

        {message ? (
          <p role="status" className="rounded-md bg-surface-subtle px-3 py-2 text-xs leading-relaxed text-muted">
            {message}
          </p>
        ) : null}
        {shownError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-700"
          >
            <ErrorDotIcon />
            <span>{shownError}</span>
          </p>
        ) : null}

        <button className={AUTH_BUTTON_CLASS} disabled={submitting} type="submit">
          {submitting ? (
            <>
              <SpinnerIcon />
              <span>Please wait…</span>
            </>
          ) : (
            meta.submit
          )}
        </button>
      </form>

      <AuthModeSwitch mode={mode} onGoLogin={goToLogin} />
    </PasswordAuthShell>
  );
}

function AuthModeSwitch({
  mode,
  onGoLogin,
}: {
  mode: AuthMode;
  onGoLogin: () => void;
}) {
  const link = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="font-medium text-foreground underline-offset-2 transition-colors hover:text-primary-light hover:underline"
    >
      {label}
    </button>
  );

  return (
    <div className="mt-8 border-t border-border pt-5 text-center text-xs text-muted">
      {mode === "login" ? (
        <p>Accounts are created by an EnergyX administrator.</p>
      ) : (
        <p>{link("Back to sign in", onGoLogin)}</p>
      )}
    </div>
  );
}

function AuthField({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
  autoComplete,
  action,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
  autoComplete?: string;
  action?: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-xs font-medium text-foreground">
          {label}
        </label>
        {action}
      </div>
      <div className="relative">
        <input
          id={id}
          type={isPassword && revealed ? "text" : type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={`h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-sm text-foreground outline-none transition-colors duration-[140ms] placeholder:text-muted-light hover:border-muted-light focus:border-[#176b59] focus:ring-[3px] focus:ring-[#176b59]/15 motion-reduce:transition-none ${isPassword ? "pr-11" : ""}`}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setRevealed((current) => !current)}
            aria-label={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            aria-controls={id}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#176b59]/40"
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        ) : null}
      </div>
      {hint ? <p className="text-[11px] leading-relaxed text-muted-light">{hint}</p> : null}
    </div>
  );
}

function BrandLockup({ tone }: { tone: "dark" | "light" }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`flex h-8 w-8 items-center justify-center rounded-md ${tone === "dark" ? "bg-[#36403b]" : "bg-[#262d2b]"}`}>
        <EnergyXMark className="h-[18px] w-[18px] text-[#a4dfc0]" />
      </span>
      <span className={`text-[15px] font-semibold tracking-tight ${tone === "dark" ? "text-[#f0f4ef]" : "text-foreground"}`}>EnergyX</span>
    </div>
  );
}

/** Illustrative weekday profile (kW by hour) for a small office; not customer data. */
const SAMPLE_WEEKDAY_KW = [
  1.2, 1.1, 1.1, 1.1, 1.2, 1.2, 1.3, 1.9, 4.2, 7.4, 11.8, 12.6,
  12.4, 12.9, 12.7, 12.2, 11.6, 9.8, 7.1, 5.2, 3.6, 2.7, 2.0, 1.5,
];
const SAMPLE_OPEN_HOUR = 8;
const SAMPLE_CLOSE_HOUR = 18;

const sampleStats = (() => {
  const daily = SAMPLE_WEEKDAY_KW.reduce((sum, kw) => sum + kw, 0);
  const afterHours = SAMPLE_WEEKDAY_KW
    .filter((_, hour) => hour < SAMPLE_OPEN_HOUR || hour >= SAMPLE_CLOSE_HOUR)
    .reduce((sum, kw) => sum + kw, 0);
  const baseLoad = Math.min(...SAMPLE_WEEKDAY_KW);
  return {
    daily,
    afterHoursShare: afterHours / daily,
    baseLoad,
    peak: Math.max(...SAMPLE_WEEKDAY_KW),
    // An always-on load running through the 14 closed hours of each of ~30 days.
    baseLoadMonthlyKwh: baseLoad * (24 - (SAMPLE_CLOSE_HOUR - SAMPLE_OPEN_HOUR)) * 30,
  };
})();

function PreviewKpi({ label, value, unit, note }: { label: string; value: string; unit: string; note: string }) {
  return (
    <div className="rounded-lg border border-[#dfe5e0] bg-white px-4 py-3">
      <p className="text-[11px] font-medium text-[#58645d]">{label}</p>
      <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight tabular-nums text-[#252c29]">
        {value}<span className="ml-1 text-xs font-medium text-[#58645d]">{unit}</span>
      </p>
      <p className="mt-2 text-[10.5px] text-[#7a867f]">{note}</p>
    </div>
  );
}

function PreviewDemandChart() {
  const width = 640;
  const height = 118;
  const max = 14;
  const slot = width / 24;
  const y = (kw: number) => height - (kw / max) * height;
  const baseY = y(sampleStats.baseLoad);
  return (
    <div className="rounded-lg border border-[#dfe5e0] bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-[#252c29]">Weekday demand by hour</p>
        <div className="flex items-center gap-4 text-[11px] text-[#58645d]">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-[#176b59]" />Operating hours</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-[#d9913f]" />After hours</span>
        </div>
      </div>
      <svg viewBox={`-28 -6 ${width + 28} ${height + 26}`} className="mt-3 w-full" aria-hidden>
        {[0, 10].map((kw) => (
          <g key={kw}>
            <line x1="0" x2={width} y1={y(kw)} y2={y(kw)} stroke={kw === 0 ? "#c9d2cc" : "#edf0ed"} strokeWidth="1" />
            <text x="-8" y={y(kw) + 3.5} textAnchor="end" fill="#8a958f" fontSize="10">{kw}</text>
          </g>
        ))}
        {SAMPLE_WEEKDAY_KW.map((kw, hour) => {
          const open = hour >= SAMPLE_OPEN_HOUR && hour < SAMPLE_CLOSE_HOUR;
          return (
            <rect key={hour} x={hour * slot + 3} y={y(kw)} width={slot - 6} height={height - y(kw)} rx="2.5"
              fill={open ? "#176b59" : "#d9913f"} />
          );
        })}
        <line x1="0" x2={width} y1={baseY} y2={baseY} stroke="#252c29" strokeOpacity="0.55" strokeWidth="1" strokeDasharray="4 3" />
        <text x="4" y={baseY - 7} fill="#58645d" fontSize="10">
          Base load {sampleStats.baseLoad.toFixed(1)} kW
        </text>
        {[0, 6, 12, 18].map((hour) => (
          <text key={hour} x={hour * slot + 3} y={height + 16} fill="#8a958f" fontSize="10">
            {String(hour).padStart(2, "0")}:00
          </text>
        ))}
      </svg>
    </div>
  );
}

/** A light, product-accurate Overview window, cropped by the panel edge like a screenshot. */
function ProductPreview() {
  const share = Math.round(sampleStats.afterHoursShare * 100);
  return (
    <div className="relative w-[780px] max-w-none">
      <div className="overflow-hidden rounded-xl bg-[#eef1ee] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.06)]">
        <div className="flex h-11 items-center justify-between bg-[#1f2523] px-4">
          <div className="flex items-center gap-2.5 text-[12px]">
            <EnergyXMark className="h-3.5 w-3.5 text-[#a4dfc0]" />
            <span className="text-[#b9c5bc]">Sample Office</span>
            <span className="text-[#58645d]">/</span>
            <span className="font-medium text-[#f0f4ef]">Overview</span>
          </div>
          <span className="rounded-full border border-[#3b4540] px-2 py-0.5 text-[10px] font-medium text-[#b9c5bc]">Sample data</span>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-4 gap-3">
            <PreviewKpi label="Weekday average" value={Math.round(sampleStats.daily).toLocaleString("en-SG")} unit="kWh" note="per day" />
            <PreviewKpi label="Used after hours" value={String(share)} unit="%" note="outside 08:00–18:00" />
            <PreviewKpi label="Base load" value={sampleStats.baseLoad.toFixed(1)} unit="kW" note="never switches off" />
            <PreviewKpi label="Peak demand" value={sampleStats.peak.toFixed(1)} unit="kW" note="13:00 – 14:00" />
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-[#f0d9b8] bg-[#fdf6ec] px-4 py-2.5">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#d9913f]" />
            <p className="text-[12.5px] text-[#5c3b0c]">
              <span className="font-semibold">{sampleStats.baseLoad.toFixed(1)} kW keeps running every night</span>
              <span className="text-[#8a6a3a]"> · about {Math.round(sampleStats.baseLoadMonthlyKwh / 10) * 10} kWh a month while the office is closed</span>
            </p>
          </div>
          <PreviewDemandChart />
        </div>
      </div>

    </div>
  );
}

/**
 * Scales its child down (or modestly up) so it is always shown whole inside the available box,
 * like an image with object-fit: contain. Hidden when the box is too small to be legible.
 */
function FitToBox({ children, className }: { children: ReactNode; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ scale: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const measure = () => {
      const width = content.offsetWidth;
      const height = content.offsetHeight;
      if (!width || !height) return;
      const scale = Math.min(box.clientWidth / width, box.clientHeight / height, 1.25);
      setFit({ scale, width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const visible = fit !== null && fit.scale >= 0.5;
  return (
    <div ref={boxRef} className={`relative min-h-0 min-w-0 ${className ?? ""}`}>
      <div
        className="absolute left-0 top-0"
        style={{
          width: fit ? fit.width * fit.scale : undefined,
          height: fit ? fit.height * fit.scale : undefined,
          visibility: visible ? "visible" : "hidden",
        }}
      >
        <div ref={contentRef} className="w-max origin-top-left" style={{ transform: fit ? `scale(${fit.scale})` : undefined }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Neutral screen shown while the session is checked on page load. Deliberately not the sign-in
 * layout, so a signed-in user refreshing a page never sees what looks like a login screen.
 * The label only appears if the check is slow, so fast checks show a calm blank canvas.
 */
export function AuthLoadingScreen({ label }: { label: string }) {
  const [slow, setSlow] = useState(false);
  useLayoutEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 600);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <main role="status" aria-live="polite" aria-label={label} className="flex min-h-screen items-center justify-center bg-[#eef1ee]">
      <div className={`flex flex-col items-center gap-3 transition-opacity duration-300 motion-reduce:transition-none ${slow ? "opacity-100" : "opacity-0"}`}>
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#262d2b]">
          <EnergyXMark className="h-5 w-5 text-[#a4dfc0]" />
        </span>
        <p className="text-xs text-[#58645d]">{label}</p>
      </div>
    </main>
  );
}

export function PasswordAuthShell({
  children,
  title,
  subtitle,
}: {
  children?: ReactNode;
  title: string;
  subtitle?: string;
}) {
  const year = new Date().getFullYear();
  return (
    <main className="grid min-h-screen bg-surface text-foreground lg:grid-cols-[minmax(0,1fr)_minmax(460px,40%)]">
      <aside
        className="relative hidden overflow-hidden text-[#f0f4ef] lg:flex lg:flex-col"
        style={{ background: "radial-gradient(120% 90% at 0% 0%, #313a36 0%, #262d2b 45%, #1f2523 100%)" }}
      >
        <div className="px-14 pt-12 xl:px-16">
          <BrandLockup tone="dark" />
          <div className="mt-12 max-w-[520px] [@media(min-height:820px)]:mt-20 2xl:max-w-[640px]">
            <h2 className="text-[34px] font-semibold leading-[1.15] tracking-[-0.02em] [text-wrap:balance] 2xl:text-[44px]">
              Know what your building uses, and when.
            </h2>
            <p className="mt-4 max-w-[440px] text-[15px] leading-relaxed text-[#b9c5bc] 2xl:max-w-[520px] 2xl:text-[17px]">
              Metered consumption for every board and circuit, with the after-hours use worth acting on.
            </p>
          </div>
        </div>
        <FitToBox className="mx-14 mb-10 mt-10 flex-1 xl:mx-16">
          <ProductPreview />
        </FitToBox>
      </aside>

      <div className="flex min-h-screen flex-col px-6 py-8 sm:px-10 lg:px-14 lg:py-12">
        <div className="lg:hidden">
          <BrandLockup tone="light" />
        </div>
        <section className="auth-card-in mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-12">
          <div className="mb-8">
            <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">{title}</h1>
            {subtitle ? <p className="mt-2 text-[15px] text-muted">{subtitle}</p> : null}
          </div>
          {children}
        </section>
        <p className="text-center text-xs text-muted-light">© {year} EnergyX</p>
      </div>
    </main>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10.6 5.6A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}


function SpinnerIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 animate-spin" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ErrorDotIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="currentColor" aria-hidden>
      <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm.9 10.5a.9.9 0 1 1-1.8 0 .9.9 0 0 1 1.8 0ZM7.1 4.4a.9.9 0 0 1 1.8 0l-.2 3.8a.7.7 0 0 1-1.4 0l-.2-3.8Z" />
    </svg>
  );
}
