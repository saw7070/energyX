"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

import { ConfigApiError } from "../../../lib/config-api";
import { isPasswordAuthMode } from "../../../lib/config-api/client";
import {
  organisationSignInApi,
  type OrganisationSignInSettingsDto,
  type OrganisationSsoTestDto,
} from "../../../lib/config-api/organisation-sign-in";
import { friendlyErrorMessage } from "../_components/friendly-error";
import { EnergyIcon } from "../_components/icons";

const inputClass = "h-10 w-full rounded-xl border border-border bg-surface px-3.5 text-[14px] outline-none transition-colors placeholder:text-muted-light focus:border-primary focus:ring-4 focus:ring-primary/10";
const primaryButton = "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-white shadow-sm transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-border bg-surface px-3.5 text-[13px] font-semibold transition-colors hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50";
const dangerButton = "inline-flex h-9 items-center justify-center whitespace-nowrap rounded-lg border border-rose-200 bg-surface px-3.5 text-[13px] font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40";

/** The server writes these answers for people; anything else (network, server faults) gets friendly wording. */
const messageFrom = (reason: unknown, fallback: string): string =>
  reason instanceof ConfigApiError && reason.status >= 400 && reason.status < 500 && reason.status !== 401 && reason.message.trim()
    ? reason.message
    : friendlyErrorMessage(reason, { fallback });

type SsoForm = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret: string;
  domains: string;
  requireSso: boolean;
  autoCreateAccounts: boolean;
};

const formFrom = (settings: OrganisationSignInSettingsDto): SsoForm => ({
  enabled: settings.sso.enabled,
  issuer: settings.sso.issuer,
  clientId: settings.sso.clientId,
  clientSecret: "",
  domains: settings.sso.domains.join(", "),
  requireSso: settings.sso.requireSso,
  autoCreateAccounts: settings.sso.autoCreateAccounts,
});

/**
 * Sign-in and provisioning for the active Organisation: single sign-on through the organisation's own identity
 * provider, and keys that let that provider add and remove people automatically (SCIM). Shown to people who manage
 * the Organisation's people, and to EnergyX super admins.
 */
export function OrganisationSignInSettings({ workspaceId }: { workspaceId: string }) {
  const [settings, setSettings] = useState<OrganisationSignInSettingsDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setSettings(await organisationSignInApi.get());
    } catch (reason) {
      setSettings(null);
      setLoadError(messageFrom(reason, "Sign-in settings could not be loaded."));
    }
  }, []);

  useEffect(() => {
    setSettings(null);
    void load();
  }, [workspaceId, load]);

  if (loadError) {
    return <Section><p role="alert" className="text-[14px] text-rose-700">{loadError}</p></Section>;
  }
  if (!settings) {
    return <Section><div className="h-24 animate-pulse rounded-xl bg-surface-subtle" aria-busy="true" /></Section>;
  }
  return (
    <Section>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <SingleSignOnCard settings={settings} onChange={setSettings} />
        <ProvisioningCard settings={settings} onChange={setSettings} />
      </div>
    </Section>
  );
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="sign-in-settings-title" className="space-y-4 pb-10">
      <header>
        <h2 id="sign-in-settings-title" className="text-xl font-semibold tracking-tight">Sign-in and provisioning</h2>
        <p className="mt-0.5 text-sm text-muted">Let people sign in with their organisation’s own account, and keep this list in step with it automatically.</p>
      </header>
      {children}
    </section>
  );
}

export function SingleSignOnCard({
  settings,
  onChange,
}: {
  settings: OrganisationSignInSettingsDto;
  onChange: (settings: OrganisationSignInSettingsDto) => void;
}) {
  const [form, setForm] = useState<SsoForm>(() => formFrom(settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<OrganisationSsoTestDto | null>(null);
  useEffect(() => setForm(formFrom(settings)), [settings]);
  const set = <K extends keyof SsoForm>(key: K, value: SsoForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (reason) {
      setError(messageFrom(reason, "That did not work. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const saved = await organisationSignInApi.saveSso({
        enabled: form.enabled,
        issuer: form.issuer,
        clientId: form.clientId,
        ...(form.clientSecret.trim() ? { clientSecret: form.clientSecret } : {}),
        domains: form.domains.split(/[\s,;]+/u).map((domain) => domain.trim()).filter(Boolean),
        requireSso: form.enabled && form.requireSso,
        autoCreateAccounts: form.autoCreateAccounts,
      });
      onChange(saved);
      setNotice(saved.sso.enabled ? "Saved. Single sign-on is on." : "Saved. Single sign-on is off.");
    });
  };

  const status = !settings.sso.enabled ? { label: "Off", tone: "bg-surface-subtle text-muted" }
    : settings.sso.requireSso ? { label: "Required", tone: "bg-step-success/15 text-step-success" }
      : { label: "On", tone: "bg-primary/10 text-primary" };

  return (
    <form onSubmit={save} className="rounded-2xl border border-border bg-surface p-6 shadow-sm" aria-label="Single sign-on">
      <div className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><EnergyIcon name="settings" className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight">Single sign-on</h3>
            <span className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold uppercase tracking-wide ${status.tone}`}>{status.label}</span>
          </div>
          <p className="mt-1 text-[13.5px] leading-6 text-muted">People sign in with their Microsoft, Google, Okta or other work account instead of an EnergyX password.</p>
        </div>
      </div>

      <CopyRow label="Redirect address to give your identity provider" value={settings.redirectUri} />

      <div className="mt-5 space-y-4">
        <Field label="Issuer URL" hint="Microsoft Entra ID: https://login.microsoftonline.com/<tenant ID>/v2.0 · Google: https://accounts.google.com · Okta: https://<your company>.okta.com">
          <input value={form.issuer} onChange={(event) => set("issuer", event.target.value)} className={inputClass} placeholder="https://login.microsoftonline.com/…/v2.0" autoComplete="off" spellCheck={false} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client ID" hint="Also called application ID.">
            <input value={form.clientId} onChange={(event) => set("clientId", event.target.value)} className={inputClass} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Client secret" hint={settings.sso.hasClientSecret ? "Saved. Leave blank to keep it." : "Stored encrypted. Never shown again."}>
            <input type="password" value={form.clientSecret} onChange={(event) => set("clientSecret", event.target.value)} className={inputClass} placeholder={settings.sso.hasClientSecret ? "••••••••" : ""} autoComplete="new-password" />
          </Field>
        </div>
        <Field label="Email domains" hint="People whose email ends with one of these sign in through this connection. Separate several with commas.">
          <input value={form.domains} onChange={(event) => set("domains", event.target.value)} className={inputClass} placeholder="company.com, company.co.uk" autoComplete="off" spellCheck={false} />
        </Field>
      </div>

      <div className="mt-5 space-y-3">
        <Toggle checked={form.enabled} onChange={(value) => set("enabled", value)} label="Turn on single sign-on" />
        <Toggle
          checked={form.enabled && form.requireSso}
          disabled={!form.enabled}
          onChange={(value) => set("requireSso", value)}
          label="Require single sign-on for members"
          hint="Members on these domains can no longer use a password. EnergyX super admins always can, so nobody is locked out."
        />
        <Toggle
          checked={form.autoCreateAccounts}
          onChange={(value) => set("autoCreateAccounts", value)}
          label="Create an account the first time someone signs in"
          hint="New people join this organisation as a Viewer. When this is off, add people here first."
        />
      </div>

      {settings.sso.keepPasswordCount > 0 ? (
        <p className="mt-4 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] leading-5 text-amber-800">
          {settings.sso.keepPasswordCount === 1 ? "1 person" : `${settings.sso.keepPasswordCount} people`} on these domains also
          {settings.sso.keepPasswordCount === 1 ? " belongs" : " belong"} to another organisation in EnergyX, so they keep signing in with a password.
        </p>
      ) : null}

      {test ? (
        <p role="status" className={`mt-4 rounded-xl px-3.5 py-2.5 text-[13px] leading-5 ${test.ok ? "bg-step-success/10 text-step-success" : "bg-rose-50 text-rose-700"}`}>
          {test.message}
        </p>
      ) : settings.sso.lastTest ? (
        <p className="mt-4 text-[12.5px] text-muted">
          Last tested {new Date(settings.sso.lastTest.at).toLocaleString()}: {settings.sso.lastTest.ok ? "reached your identity provider." : settings.sso.lastTest.message ?? "failed."}
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700">{error}</p> : null}
      {notice ? <p role="status" className="mt-4 rounded-xl bg-step-success/10 px-3.5 py-2.5 text-[13px] text-step-success">{notice}</p> : null}
      {!isPasswordAuthMode() ? (
        <p className="mt-4 text-[12.5px] text-muted">This server runs without password sign-in, so single sign-on can be set up here but not used yet.</p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className={primaryButton}>{busy ? "Working…" : "Save"}</button>
        <button
          type="button"
          disabled={busy || !form.issuer.trim()}
          className={secondaryButton}
          onClick={() => void run(async () => setTest(await organisationSignInApi.testSso(form.issuer)))}
        >
          Test connection
        </button>
        {settings.sso.configured ? (
          <button
            type="button"
            disabled={busy}
            className={`${dangerButton} ml-auto`}
            onClick={() => {
              if (!window.confirm("Remove single sign-on? People will sign in with a password again.")) return;
              void run(async () => {
                onChange(await organisationSignInApi.removeSso());
                setTest(null);
                setNotice("Single sign-on removed.");
              });
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function ProvisioningCard({
  settings,
  onChange,
}: {
  settings: OrganisationSignInSettingsDto;
  onChange: (settings: OrganisationSignInSettingsDto) => void;
}) {
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await organisationSignInApi.createProvisioningKey(name);
      onChange(created.settings);
      setNewKey(created.key);
      setName("");
    } catch (reason) {
      setError(messageFrom(reason, "The key could not be created."));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string, label: string) => {
    if (!window.confirm(`Revoke “${label}”? Your identity provider will stop updating this list until you give it a new key.`)) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await organisationSignInApi.revokeProvisioningKey(id));
    } catch (reason) {
      setError(messageFrom(reason, "The key could not be revoked."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm" aria-label="Automatic provisioning">
      <div className="flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><EnergyIcon name="user" className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold tracking-tight">Automatic provisioning (SCIM)</h3>
          <p className="mt-1 text-[13.5px] leading-6 text-muted">
            Your identity provider adds people here, updates their names and removes them when they leave. New people join as a <strong className="font-semibold text-foreground">Viewer</strong>.
          </p>
        </div>
      </div>

      <CopyRow label="Address to give your identity provider (tenant URL)" value={settings.scim.baseUrl} />

      {newKey ? (
        <div className="mt-5 rounded-xl border border-step-success/30 bg-step-success/5 p-4" role="status">
          <p className="text-[13.5px] font-semibold">Copy this key now. You won’t see it again.</p>
          <p className="mt-1 text-[12.5px] text-muted">Paste it into your identity provider as the secret token (Microsoft Entra ID) or API token (Okta).</p>
          <CopyRow label="Provisioning key" value={newKey} compact />
          <button type="button" className={`${secondaryButton} mt-3`} onClick={() => setNewKey(null)}>Done</button>
        </div>
      ) : null}

      <ul className="mt-5 divide-y divide-border rounded-xl border border-border">
        {settings.scim.keys.length === 0 ? (
          <li className="px-4 py-3.5 text-[13.5px] text-muted">No keys yet. Create one to connect your identity provider.</li>
        ) : settings.scim.keys.map((key) => (
          <li key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">{key.name} <span className="font-normal text-muted">· ends in {key.hint}</span></p>
              <p className="text-[12px] text-muted">
                Created {new Date(key.createdAt).toLocaleDateString()} · {key.lastUsedAt ? `last used ${new Date(key.lastUsedAt).toLocaleString()}` : "not used yet"}
              </p>
            </div>
            <button type="button" disabled={busy} className={dangerButton} onClick={() => void revoke(key.id, key.name)}>Revoke</button>
          </li>
        ))}
      </ul>

      <form onSubmit={(event) => void create(event)} className="mt-4 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="provisioning-key-name">Key name</label>
        <input
          id="provisioning-key-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={`${inputClass} min-w-0 flex-1`}
          placeholder="Name, e.g. Microsoft Entra ID"
          autoComplete="off"
        />
        <button type="submit" disabled={busy || !name.trim()} className={primaryButton}>Create key</button>
      </form>
      {error ? <p role="alert" className="mt-3 text-[13px] text-rose-700">{error}</p> : null}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-[13px] font-semibold">
      {label}
      <span className="mt-1.5 block">{children}</span>
      {hint ? <span className="mt-1 block text-[12px] font-normal leading-5 text-muted">{hint}</span> : null}
    </label>
  );
}

function Toggle({ checked, onChange, label, hint, disabled = false }: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#176b59]" />
      <span>
        <span className="block text-[14px] font-semibold">{label}</span>
        {hint ? <span className="block text-[12.5px] leading-5 text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

function CopyRow({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={compact ? "mt-3" : "mt-5"}>
      <p className="text-[12.5px] font-semibold text-muted">{label}</p>
      <div className="mt-1.5 flex gap-2">
        <code className="block min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-xl border border-border bg-surface-subtle px-3.5 py-2 text-xs">{value}</code>
        <button
          type="button"
          className={secondaryButton}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    </div>
  );
}
