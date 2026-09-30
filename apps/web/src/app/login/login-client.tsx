"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AUTH_BUTTON_CLASS, AuthFlow, PasswordAuthShell, type AuthMode } from "../../components/auth/auth-flow";
import { configApi, isLocalDevAdminAvailable, isPasswordAuthMode } from "../../lib/config-api/client";

export function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checking, setChecking] = useState(true);
  const [localAdminAvailable, setLocalAdminAvailable] = useState(false);
  const returnTo = useMemo(() => safeEnergyIqReturnTo(searchParams.get("returnTo")), [searchParams]);
  const authEntry = useMemo<{ mode: AuthMode; token: string }>(() => {
    const invite = searchParams.get("invite");
    if (invite) return { mode: "invite", token: invite };
    const reset = searchParams.get("reset");
    if (reset) return { mode: "reset", token: reset };
    const verify = searchParams.get("verify");
    if (verify) return { mode: "verify", token: verify };
    return { mode: "login", token: "" };
  }, [searchParams]);

  const redirectAfterAuthentication = useCallback(async () => {
    if (returnTo) {
      router.replace(returnTo);
      return;
    }
    try {
      const access = await configApi.getEnergyAccessContext();
      router.replace(access.role === "admin" ? "/energyiq/admin" : "/energyiq/overview");
    } catch {
      router.replace("/energyiq/overview");
    }
  }, [returnTo, router]);

  useEffect(() => {
    if (!isPasswordAuthMode()) {
      setLocalAdminAvailable(isLocalDevAdminAvailable());
      setChecking(false);
      return;
    }
    let cancelled = false;
    configApi
      .getMe()
      .then(async () => {
        if (!cancelled) await redirectAfterAuthentication();
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [redirectAfterAuthentication, router]);

  if (checking) {
    return <PasswordAuthShell title="Loading account..." />;
  }

  if (!isPasswordAuthMode()) {
    return (
      <PasswordAuthShell title="Local administrator" subtitle="Local development only">
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-6 text-muted">
            Continue with the built-in EnergyX administrator. No password is required on this device.
          </p>
          {localAdminAvailable ? (
            <button
              type="button"
              className={AUTH_BUTTON_CLASS}
              onClick={() => router.replace(returnTo ?? "/energyiq/admin")}
            >
              Continue as Local Administrator
            </button>
          ) : (
            <p role="alert" className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs leading-5 text-muted">
              Local administrator access is available only from localhost.
            </p>
          )}
          <p className="text-xs leading-5 text-muted-light">
            Server deployments use password authentication and do not expose this option.
          </p>
        </div>
      </PasswordAuthShell>
    );
  }

  return (
    <AuthFlow
      key={`${authEntry.mode}:${authEntry.token}`}
      initialMode={authEntry.mode}
      initialToken={authEntry.token}
      onAuthenticated={redirectAfterAuthentication}
    />
  );
}

function safeEnergyIqReturnTo(value: string | null): string | null {
  if (!value || !value.startsWith("/energyiq/") || value.startsWith("//")) return null;
  return value;
}
