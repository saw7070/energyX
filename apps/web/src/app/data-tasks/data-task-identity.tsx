"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  clearConfigApiIdentity,
  configApi,
  isLocalDevAdminAvailable,
  isPasswordAuthMode,
  setConfigApiIdentity,
  type ConfigApiIdentity,
} from "../../lib/config-api/client";
import type { DevIdentityUser } from "../../lib/config-api";
import { AUTH_BUTTON_CLASS, AuthLoadingScreen, PasswordAuthShell } from "../../components/auth/auth-flow";

const IDENTITY_STORAGE_KEY = "data-tasks:identity:v1";
const DEV_SIGNED_OUT_STORAGE_KEY = "data-tasks:identity:signed-out:v1";

const DEFAULT_IDENTITY: ConfigApiIdentity = {
  userId: "dev-user",
  displayName: "EnergyX Admin",
  email: "admin@energyiq.local",
  devToken: "dev-token",
};

type DataTaskIdentityContextValue = {
  authMode: "dev" | "password";
  authHeaders: Record<string, string>;
  changePassword: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
  createUser: (input: { displayName: string; email?: string; id?: string }) => Promise<void>;
  currentUser: ConfigApiIdentity;
  error: string | null;
  loading: boolean;
  scopeKey: string;
  selectUser: (userId: string) => void;
  signOut: () => void;
  signOutAll: () => void;
  updateProfile: (input: { displayName: string; avatarUrl?: string | null }) => Promise<void>;
  users: ConfigApiIdentity[];
};

const DataTaskIdentityContext = createContext<DataTaskIdentityContextValue | null>(null);

function storageIdentity(): ConfigApiIdentity {
  if (typeof window === "undefined") return DEFAULT_IDENTITY;
  try {
    const raw = window.localStorage.getItem(IDENTITY_STORAGE_KEY);
    if (!raw) return DEFAULT_IDENTITY;
    const parsed = JSON.parse(raw) as Partial<ConfigApiIdentity>;
    if (!parsed.userId || !parsed.devToken) return DEFAULT_IDENTITY;
    return {
      userId: parsed.userId,
      displayName: parsed.displayName || parsed.userId,
      ...(parsed.email ? { email: parsed.email } : {}),
      ...(parsed.avatarUrl ? { avatarUrl: parsed.avatarUrl } : {}),
      devToken: parsed.devToken,
    };
  } catch {
    return DEFAULT_IDENTITY;
  }
}

function persistIdentity(identity: ConfigApiIdentity): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Identity stays in memory when localStorage is unavailable.
  }
}

function removeStoredIdentity(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(IDENTITY_STORAGE_KEY);
  } catch {
    // Identity stays in memory when localStorage is unavailable.
  }
}

function storageDevSignedOut(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEV_SIGNED_OUT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistDevSignedOut(signedOut: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (signedOut) {
      window.localStorage.setItem(DEV_SIGNED_OUT_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(DEV_SIGNED_OUT_STORAGE_KEY);
    }
  } catch {
    // Signed-out state stays in memory when localStorage is unavailable.
  }
}

function dtoToIdentity(user: DevIdentityUser): ConfigApiIdentity {
  return {
    userId: user.id,
    displayName: user.displayName || user.id,
    ...(user.email ? { email: user.email } : {}),
    ...(user.avatarUrl ? { avatarUrl: user.avatarUrl } : {}),
    devToken: user.devToken ?? "",
  };
}

function identityInitials(identity: ConfigApiIdentity): string {
  const source = identity.displayName || identity.userId;
  const parts = source.split(/\s+/u).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function slugFromName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || `user-${Date.now()}`;
}

export function DataTaskIdentityProvider({ children }: { children: ReactNode }) {
  if (isPasswordAuthMode()) {
    return <PasswordIdentityProvider>{children}</PasswordIdentityProvider>;
  }
  return <DevIdentityProvider>{children}</DevIdentityProvider>;
}

function DevIdentityProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<ConfigApiIdentity>(() => storageIdentity());
  const [users, setUsers] = useState<ConfigApiIdentity[]>(() => [storageIdentity()]);
  const [signedOut, setSignedOut] = useState(() => storageDevSignedOut());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (signedOut) {
      clearConfigApiIdentity();
      removeStoredIdentity();
      persistDevSignedOut(true);
      return;
    }
    setConfigApiIdentity(currentUser);
    persistIdentity(currentUser);
    persistDevSignedOut(false);
  }, [currentUser, signedOut]);

  useEffect(() => {
    if (signedOut) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void configApi
      .getDevIdentities()
      .then((response) => {
        if (cancelled) return;
        const nextUsers = response.users.map(dtoToIdentity);
        setUsers(nextUsers.length > 0 ? nextUsers : [currentUser]);
        const current = nextUsers.find((user) => user.userId === currentUser.userId);
        if (current) {
          setCurrentUser(current);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load users");
          setUsers((current) => (current.length > 0 ? current : [currentUser]));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.userId, signedOut]);

  const selectUser = useCallback(
    (userId: string) => {
      const next = users.find((user) => user.userId === userId);
      if (next) setCurrentUser(next);
    },
    [users],
  );

  const signOut = useCallback(() => {
    clearConfigApiIdentity();
    removeStoredIdentity();
    persistDevSignedOut(true);
    setSignedOut(true);
  }, []);

  const signOutAll = useCallback(() => {
    signOut();
  }, [signOut]);

  const continueAsDevUser = useCallback(() => {
    setCurrentUser(DEFAULT_IDENTITY);
    setUsers([DEFAULT_IDENTITY]);
    setSignedOut(false);
  }, []);

  const changePassword = useCallback(async () => {
    throw new Error("Password changes are unavailable for local dev identities.");
  }, []);

  const createUser = useCallback(
    async (input: { displayName: string; email?: string; id?: string }) => {
      setLoading(true);
      setError(null);
      try {
        const response = await configApi.createDevUser({
          id: input.id || slugFromName(input.displayName),
          displayName: input.displayName,
          ...(input.email ? { email: input.email } : {}),
        });
        const next = dtoToIdentity(response.user);
        setUsers((current) => {
          const rest = current.filter((user) => user.userId !== next.userId);
          return [next, ...rest];
        });
        setCurrentUser(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create user");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const updateProfile = useCallback(async (input: { displayName: string; avatarUrl?: string | null }) => {
    setError(null);
    try {
      const response = await configApi.updateMe(input);
      const next = dtoToIdentity(response.user);
      setCurrentUser(next);
      setUsers((current) => current.map((user) => user.userId === next.userId ? next : user));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
      throw err;
    }
  }, []);

  const value = useMemo<DataTaskIdentityContextValue>(
    () => ({
      authMode: "dev",
      authHeaders: {
        Authorization: `Bearer ${currentUser.devToken}`,
        "X-Workspace-Id": "default",
      },
      changePassword,
      createUser,
      currentUser,
      error,
      loading,
      scopeKey: currentUser.userId,
      selectUser,
      signOut,
      signOutAll,
      updateProfile,
      users,
    }),
    [changePassword, createUser, currentUser, error, loading, selectUser, signOut, signOutAll, updateProfile, users],
  );

  if (signedOut) {
    return <DevSignedOutScreen onContinue={continueAsDevUser} />;
  }

  return (
    <DataTaskIdentityContext.Provider value={value}>
      {children}
    </DataTaskIdentityContext.Provider>
  );
}

function DevSignedOutScreen({ onContinue }: { onContinue: () => void }) {
  const localAdminAvailable = isLocalDevAdminAvailable();
  return (
    <PasswordAuthShell title="Local administrator" subtitle="Local development only">
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-muted">
          Continue with the built-in EnergyX administrator. No password is required on this device.
        </p>
        {localAdminAvailable ? (
          <button type="button" onClick={onContinue} className={AUTH_BUTTON_CLASS}>
            Continue as Local Administrator
          </button>
        ) : (
          <p role="alert" className="rounded-md border border-border bg-surface-subtle px-3 py-2 text-xs leading-5 text-muted">
            Local administrator access is available only from localhost.
          </p>
        )}
      </div>
    </PasswordAuthShell>
  );
}

function PasswordIdentityProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<ConfigApiIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await configApi.getMe();
      setCurrentUser(dtoToIdentity(response.user));
      clearConfigApiIdentity();
    } catch (err) {
      setCurrentUser(null);
      if (err instanceof Error && !err.message.includes("Authentication required")) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const signOut = useCallback(() => {
    setError(null);
    void (async () => {
      try {
        await configApi.logout();
        setCurrentUser(null);
        window.location.assign("/login");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to sign out");
      }
    })();
  }, []);

  const signOutAll = useCallback(() => {
    setError(null);
    void (async () => {
      try {
        await configApi.logoutAll();
        setCurrentUser(null);
        window.location.assign("/login");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to sign out on all devices");
      }
    })();
  }, []);

  const changePassword = useCallback(async (input: { currentPassword: string; newPassword: string }) => {
    await configApi.changePassword(input);
  }, []);

  const createUser = useCallback(async (input: { displayName: string; email?: string }) => {
    if (!input.email) {
      throw new Error("Email is required.");
    }
    await configApi.register({
      email: input.email,
      displayName: input.displayName,
      password: "replace-this-password",
    });
  }, []);

  const updateProfile = useCallback(async (input: { displayName: string; avatarUrl?: string | null }) => {
    setError(null);
    try {
      const response = await configApi.updateMe(input);
      setCurrentUser(dtoToIdentity(response.user));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update profile");
      throw err;
    }
  }, []);

  const value = useMemo<DataTaskIdentityContextValue | null>(() => {
    if (!currentUser) return null;
    return {
      authMode: "password",
      authHeaders: csrfAuthHeaders(),
      changePassword,
      createUser,
      currentUser,
      error,
      loading,
      scopeKey: currentUser.userId,
      selectUser: () => undefined,
      signOut,
      signOutAll,
      updateProfile,
      users: [currentUser],
    };
  }, [changePassword, createUser, currentUser, error, loading, signOut, signOutAll, updateProfile]);

  // Only a real "not signed in" answer sends someone to the sign-in page. If the server could not be reached,
  // their session may be perfectly good, so ask them to try again instead of signing them out.
  useEffect(() => {
    if (!loading && !error && (!currentUser || !value)) {
      router.replace("/login");
    }
  }, [loading, error, currentUser, value, router]);

  if (loading) {
    return <AuthLoadingScreen label="Loading your workspace…" />;
  }
  if (error && (!currentUser || !value)) {
    return (
      <PasswordAuthShell title="Can't reach the server" subtitle="Your session is still safe">
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-sm leading-6 text-muted">
            EnergyX could not load your account just now. This is usually a short interruption.
          </p>
          <button type="button" onClick={() => void loadMe()} className={AUTH_BUTTON_CLASS}>
            Try again
          </button>
        </div>
      </PasswordAuthShell>
    );
  }
  if (!currentUser || !value) {
    return <AuthLoadingScreen label="Redirecting to sign in…" />;
  }
  return (
    <DataTaskIdentityContext.Provider value={value}>
      {children}
    </DataTaskIdentityContext.Provider>
  );
}

function csrfAuthHeaders(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const token = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("df_csrf="))
    ?.slice("df_csrf=".length);
  return token ? { "X-CSRF-Token": token } : {};
}

export function useDataTaskIdentity(): DataTaskIdentityContextValue {
  const context = useContext(DataTaskIdentityContext);
  if (!context) {
    throw new Error("useDataTaskIdentity must be used within DataTaskIdentityProvider");
  }
  return context;
}

export function DataTaskAccountMenu({
  details = [],
  settingsHref,
}: {
  details?: Array<{ label: string; value: string }>;
  settingsHref?: string;
}) {
  const { currentUser, error, signOut } = useDataTaskIdentity();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold text-muted transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        aria-label="Open account menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <DataTaskAvatar identity={currentUser} className="h-8 w-8 border-0" />
      </button>

      {open ? (
        <div
          role="menu"
          className="account-menu-popover-in absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-popover)]"
        >
          <div className="border-b border-border px-2 py-2">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <DataTaskAvatar identity={currentUser} className="h-9 w-9" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {currentUser.displayName || currentUser.userId}
                </span>
                <span className="block truncate text-xs text-muted-light">
                  {currentUser.email || currentUser.userId}
                </span>
              </span>
            </div>
            {details.length > 0 ? (
              <dl className="mt-1 grid gap-1 px-2 pb-1 text-xs">
                {details.map((detail) => (
                  <div key={detail.label} className="flex items-center justify-between gap-3">
                    <dt className="text-muted-light">{detail.label}</dt>
                    <dd className="truncate font-medium text-foreground">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
          <div className="pt-1.5">
            {settingsHref ? (
              <AccountMenuItem
                label="Settings"
                onClick={() => {
                  router.push(settingsHref);
                  setOpen(false);
                }}
              />
            ) : null}
            <AccountMenuItem
              label="Sign out"
              onClick={() => {
                signOut();
                setOpen(false);
              }}
            />
          </div>
          {error ? <p className="mt-2 px-2 text-xs text-rose-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function DataTaskAvatar({
  identity,
  className = "h-8 w-8",
}: {
  identity: ConfigApiIdentity;
  className?: string;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface-subtle text-xs font-semibold text-foreground ${className}`}
    >
      {identity.avatarUrl ? (
        <img src={identity.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        identityInitials(identity)
      )}
    </span>
  );
}

import { LanguageToggle } from "../../i18n/LanguageToggle";
import { useT } from "../../i18n/locale-context";

export function DataTaskUserBar({
  compact = false,
  onOpenSettings,
  quickStartGuide,
}: {
  compact?: boolean;
  onOpenSettings?: () => void;
  quickStartGuide?: ReactNode;
}) {
  const {
    currentUser,
    error,
    signOut,
  } = useDataTaskIdentity();
  const t = useT();
  const [open, setOpen] = useState(false);

  if (compact) {
    return (
      <div className="mt-auto flex flex-col items-center gap-2 border-t border-border px-2 pt-2">
        {quickStartGuide}
        <button
          type="button"
          onClick={() => onOpenSettings?.()}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle"
          title={currentUser.displayName || currentUser.userId}
          aria-label={t("userBar.currentUser")}
        >
          <DataTaskAvatar identity={currentUser} className="h-8 w-8 border-0" />
        </button>
        <LanguageToggle compact />
      </div>
    );
  }

  return (
    <div className="relative mt-auto border-t border-border bg-surface-subtle px-2 py-2">
      {open ? (
        <div className="account-menu-popover-in absolute bottom-full left-2 right-2 z-50 origin-bottom rounded-xl border border-border bg-surface p-1.5 shadow-[var(--shadow-popover)]">
          <div className="border-b border-border px-2 py-2">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <DataTaskAvatar identity={currentUser} className="h-9 w-9" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-foreground">
                  {currentUser.displayName || currentUser.userId}
                </span>
                <span className="block truncate text-xs text-muted-light">
                  {currentUser.email || currentUser.userId}
                </span>
              </span>
            </div>
          </div>
          <div className="pt-1.5">
            {onOpenSettings ? (
              <AccountMenuItem
                label={t("userBar.settings")}
                onClick={() => {
                  onOpenSettings();
                  setOpen(false);
                }}
              />
            ) : null}
            <AccountMenuItem
              label={t("userBar.signOut")}
              onClick={() => {
                signOut();
                setOpen(false);
              }}
            />
          </div>
          {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
        </div>
      ) : null}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface/60"
        >
          <DataTaskAvatar identity={currentUser} className="h-8 w-8" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-foreground">
              {currentUser.displayName || currentUser.userId}
            </span>
            <span className="block truncate text-[11px] text-muted-light">{currentUser.email || currentUser.userId}</span>
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-light transition-colors hover:bg-surface-subtle hover:text-foreground">
            <AccountMoreIcon />
          </span>
        </button>
        {quickStartGuide}
        <LanguageToggle />
      </div>
    </div>
  );
}

function AccountMoreIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
      <circle cx="4.5" cy="10" r="1.2" />
      <circle cx="10" cy="10" r="1.2" />
      <circle cx="15.5" cy="10" r="1.2" />
    </svg>
  );
}

function AccountMenuItem({
  detail,
  disabled = false,
  label,
  onClick,
  shortcut,
  trailing,
}: {
  detail?: string;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
  shortcut?: string;
  trailing?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-foreground transition-colors enabled:hover:bg-surface-subtle disabled:cursor-not-allowed disabled:text-muted-light"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail ? <span className="block truncate text-[11px] font-normal text-muted-light">{detail}</span> : null}
      </span>
      {shortcut ? <span className="shrink-0 text-muted-light">{shortcut}</span> : null}
      {trailing ? <span className="shrink-0 text-muted-light">{trailing}</span> : null}
    </button>
  );
}
