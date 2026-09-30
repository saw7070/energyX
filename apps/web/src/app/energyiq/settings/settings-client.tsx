"use client";

import Link from "next/link";
import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";

import {
  DataTaskAvatar,
  useDataTaskIdentity,
} from "../../data-tasks/data-task-identity";
import { useEnergyIqAccess } from "../_components/energyiq-access";
import { EnergyIcon } from "../_components/icons";

const MAX_AVATAR_INPUT_BYTES = 5 * 1024 * 1024;
const AVATAR_SIZE = 256;

export function EnergyIqSettings() {
  const {
    authMode,
    changePassword,
    currentUser,
    updateProfile,
  } = useDataTaskIdentity();
  const { access, activeProject, refresh } = useEnergyIqAccess();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(currentUser.displayName ?? currentUser.userId);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(currentUser.avatarUrl ?? null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const activeWorkspace = access?.workspaces.find(
    (workspace) => workspace.id === access.activeWorkspaceId,
  );
  const projects = access?.projects.filter(
    (project) => project.workspaceId === access.activeWorkspaceId,
  ) ?? [];
  const previewIdentity = {
    userId: currentUser.userId,
    devToken: currentUser.devToken,
    displayName,
    ...(currentUser.email ? { email: currentUser.email } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
  const profileDirty = displayName.trim() !== (currentUser.displayName ?? currentUser.userId)
    || avatarUrl !== (currentUser.avatarUrl ?? null);

  const handleAvatarChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setProfileError(null);
    setProfileMessage(null);
    try {
      setAvatarUrl(await resizeAvatar(file));
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Unable to read this image.");
    }
  };

  const handleProfileSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextName = displayName.replace(/\s+/gu, " ").trim();
    if (!nextName) {
      setProfileError("Display name is required.");
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      await updateProfile({ displayName: nextName, avatarUrl });
      await refresh();
      setDisplayName(nextName);
      setProfileMessage("Profile updated.");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Unable to update profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordMessage(null);
    setPasswordError(null);
    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage("Password updated.");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Unable to update password.");
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="min-h-full bg-surface-subtle px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              href="/energyiq/overview"
              className="mb-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground"
            >
              <EnergyIcon name="chevron" className="h-3 w-3 rotate-180" />
              Back to Overview
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
            <p className="mt-1 text-sm text-muted">
              Manage your profile, account security and EnergyX access.
            </p>
          </div>
          {activeProject ? (
            <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted">
              Active project: <span className="text-foreground">{activeProject.name}</span>
            </span>
          ) : null}
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav className="sticky top-20 hidden rounded-xl border border-border bg-surface p-2 shadow-[var(--shadow-card)] lg:block" aria-label="Settings sections">
            <SettingsNavLink href="#profile" label="Profile" icon="user" />
            <SettingsNavLink href="#access" label="Company & projects" icon="building" />
            <SettingsNavLink href="#security" label="Security" icon="settings" />
          </nav>

          <div className="grid gap-6">
            <SettingsSection
              id="profile"
              title="Profile"
              description="Update how your account appears across EnergyX."
            >
              <form onSubmit={handleProfileSubmit} className="grid gap-6">
                <div className="flex flex-wrap items-center gap-4">
                  <DataTaskAvatar identity={previewIdentity} className="h-20 w-20 text-lg" />
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className={secondaryButtonClass}
                      >
                        Upload photo
                      </button>
                      {avatarUrl ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAvatarUrl(null);
                            setProfileError(null);
                            setProfileMessage(null);
                          }}
                          className={secondaryButtonClass}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-muted-light">
                      JPG, PNG or WebP. Images are cropped to a square automatically.
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleAvatarChange}
                      className="sr-only"
                      aria-label="Upload profile photo"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <SettingsField label="Display name" htmlFor="settings-display-name">
                    <input
                      id="settings-display-name"
                      value={displayName}
                      maxLength={80}
                      onChange={(event) => {
                        setDisplayName(event.target.value);
                        setProfileError(null);
                        setProfileMessage(null);
                      }}
                      className={inputClass}
                      autoComplete="name"
                    />
                  </SettingsField>
                  <SettingsField label="Email" htmlFor="settings-email" hint="Email changes require administrator support for now.">
                    <input
                      id="settings-email"
                      value={currentUser.email ?? ""}
                      readOnly
                      className={`${inputClass} cursor-not-allowed bg-surface-subtle text-muted`}
                    />
                  </SettingsField>
                </div>

                <FormFooter
                  error={profileError}
                  message={profileMessage}
                  action={
                    <button
                      type="submit"
                      disabled={!profileDirty || savingProfile}
                      className={primaryButtonClass}
                    >
                      {savingProfile ? "Saving…" : "Save profile"}
                    </button>
                  }
                />
              </form>
            </SettingsSection>

            <SettingsSection
              id="access"
              title="Company & projects"
              description="Your access is assigned by an EnergyX administrator and is read-only here."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoTile label="Company" value={activeWorkspace?.name ?? "Not assigned"} />
                <InfoTile
                  label="Account role"
                  value={access?.role === "admin" ? "Administrator" : "User"}
                />
              </div>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">Accessible projects</h3>
                  <span className="text-xs text-muted-light">{projects.length} projects</span>
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  {projects.length > 0 ? projects.map((project) => (
                    <div
                      key={project.id}
                      className="flex items-center justify-between gap-4 border-b border-border bg-surface px-4 py-3 last:border-b-0"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{project.name}</p>
                        <p className="mt-0.5 text-xs text-muted-light">{project.timezone}</p>
                      </div>
                      <span className="shrink-0 rounded-full border border-border bg-surface-subtle px-2.5 py-1 text-[11px] font-medium capitalize text-muted">
                        {project.status}
                      </span>
                    </div>
                  )) : (
                    <p className="bg-surface px-4 py-5 text-sm text-muted">No projects assigned.</p>
                  )}
                </div>
              </div>
            </SettingsSection>

            <SettingsSection
              id="security"
              title="Security"
              description="Update your password for this EnergyX account."
            >
              {authMode === "password" ? (
                <form onSubmit={handlePasswordSubmit} className="grid max-w-xl gap-4">
                  <SettingsField label="Current password" htmlFor="settings-current-password">
                    <input
                      id="settings-current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      className={inputClass}
                      autoComplete="current-password"
                      required
                    />
                  </SettingsField>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <SettingsField label="New password" htmlFor="settings-new-password" hint="At least 6 characters.">
                      <input
                        id="settings-new-password"
                        type="password"
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        className={inputClass}
                        autoComplete="new-password"
                        required
                      />
                    </SettingsField>
                    <SettingsField label="Confirm password" htmlFor="settings-confirm-password">
                      <input
                        id="settings-confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        className={inputClass}
                        autoComplete="new-password"
                        required
                      />
                    </SettingsField>
                  </div>
                  <FormFooter
                    error={passwordError}
                    message={passwordMessage}
                    action={
                      <button type="submit" disabled={savingPassword} className={primaryButtonClass}>
                        {savingPassword ? "Updating…" : "Update password"}
                      </button>
                    }
                  />
                </form>
              ) : (
                <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3 text-sm text-muted">
                  Password management is available when production password authentication is enabled.
                </div>
              )}
            </SettingsSection>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsSection({
  children,
  description,
  id,
  title,
}: {
  children: ReactNode;
  description: string;
  id: string;
  title: string;
}) {
  return (
    <section id={id} className="scroll-mt-20 rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="mb-6 border-b border-border pb-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {children}
    </section>
  );
}

function SettingsNavLink({ href, icon, label }: { href: string; icon: "building" | "settings" | "user"; label: string }) {
  return (
    <a href={href} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium text-muted transition-colors hover:bg-surface-subtle hover:text-foreground">
      <EnergyIcon name={icon} className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}

function SettingsField({
  children,
  hint,
  htmlFor,
  label,
}: {
  children: ReactNode;
  hint?: string;
  htmlFor: string;
  label: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint ? <p className="mt-1.5 text-[11px] text-muted-light">{hint}</p> : null}
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-light">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function FormFooter({
  action,
  error,
  message,
}: {
  action: ReactNode;
  error: string | null;
  message: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <div aria-live="polite" className="min-h-5 text-xs">
        {error ? <span className="text-rose-700">{error}</span> : null}
        {!error && message ? <span className="text-step-success">{message}</span> : null}
      </div>
      {action}
    </div>
  );
}

async function resizeAvatar(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPG, PNG or WebP image.");
  }
  if (file.size > MAX_AVATAR_INPUT_BYTES) {
    throw new Error("Image must be smaller than 5 MB.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const sourceSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = (bitmap.width - sourceSize) / 2;
    const sourceY = (bitmap.height - sourceSize) / 2;
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to process this image.");
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      AVATAR_SIZE,
      AVATAR_SIZE,
    );
    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    bitmap.close();
  }
}

const inputClass = "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-light focus:border-primary focus:ring-2 focus:ring-primary/10";
const primaryButtonClass = "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass = "inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-subtle";
