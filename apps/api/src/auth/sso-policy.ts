import type { MetadataStore, OrganisationSsoConfigRecord, UserRecord, WorkspaceRecord } from "@datafoundry/metadata";

import { resolveEnergyIqUserRole } from "../energy/energy-user-role.js";

/**
 * Who may, and who must, sign in through an Organisation's own identity provider.
 *
 * An email domain belongs to at most one Organisation. Its identity provider can sign in only people who
 * - are members of that Organisation and of no other (a session reaches every Organisation a person belongs to, so
 *   one client's identity provider must never open another client's data), and
 * - are not EnergyX super admins (they always keep their password, as the break-glass way in).
 * "Require single sign-on" applies to exactly those people: anyone it would lock out of every sign-in method keeps
 * their password.
 */
export type SsoEligibility =
  | { ok: true; organisation: WorkspaceRecord; config: OrganisationSsoConfigRecord }
  | { ok: false; reason: "no_connection" | "disabled_organisation" | "super_admin" | "disabled_account" | "not_member" | "other_organisations" };

export const emailDomain = (email: string): string => email.trim().toLowerCase().split("@").at(-1) ?? "";

/** The enabled connection for this email address, with its Organisation, if one exists and the Organisation is active. */
export const findSsoConnectionForEmail = (
  metadataStore: MetadataStore,
  email: string
): { config: OrganisationSsoConfigRecord; organisation: WorkspaceRecord } | undefined => {
  const config = metadataStore.organisationIdentity.findSsoConfigByDomain(emailDomain(email));
  if (!config?.enabled) return undefined;
  const organisation = activeCustomerOrganisation(metadataStore, config.workspace_id);
  return organisation ? { config, organisation } : undefined;
};

export const isPlatformSuperAdmin = (
  metadataStore: MetadataStore,
  user: UserRecord,
  env: Record<string, string | undefined> = process.env
): boolean => resolveEnergyIqUserRole(metadataStore, user, env) === "admin";

/** Customer Organisations the person belongs to (their personal workspace is not one). */
export const customerOrganisationIds = (metadataStore: MetadataStore, userId: string): string[] =>
  metadataStore.workspaces.listByUser({ user_id: userId })
    .filter((workspace) => workspace.kind === "customer")
    .map((workspace) => workspace.id);

/** Whether this existing account may be signed in by the given Organisation's identity provider. */
export const ssoEligibility = (
  metadataStore: MetadataStore,
  user: UserRecord,
  workspaceId: string,
  env: Record<string, string | undefined> = process.env
): SsoEligibility => {
  const config = metadataStore.organisationIdentity.findSsoConfig(workspaceId);
  if (!config?.enabled || !user.email || !config.domains.includes(emailDomain(user.email))) {
    return { ok: false, reason: "no_connection" };
  }
  const organisation = activeCustomerOrganisation(metadataStore, workspaceId);
  if (!organisation) return { ok: false, reason: "disabled_organisation" };
  if (isPlatformSuperAdmin(metadataStore, user, env)) return { ok: false, reason: "super_admin" };
  if (user.disabled_at) return { ok: false, reason: "disabled_account" };
  const organisations = customerOrganisationIds(metadataStore, user.id);
  if (!organisations.includes(workspaceId)) return { ok: false, reason: "not_member" };
  if (organisations.length > 1) return { ok: false, reason: "other_organisations" };
  return { ok: true, organisation, config };
};

/**
 * The Organisation whose "Require single sign-on" setting stops this person using a password, if any. Only people
 * who can actually use that Organisation's single sign-on are held to it (see ssoEligibility).
 */
export const passwordSignInBlockedBy = (
  metadataStore: MetadataStore,
  user: UserRecord,
  env: Record<string, string | undefined> = process.env
): WorkspaceRecord | undefined => {
  if (!user.email) return undefined;
  const connection = findSsoConnectionForEmail(metadataStore, user.email);
  if (!connection?.config.require_sso) return undefined;
  const eligibility = ssoEligibility(metadataStore, user, connection.organisation.id, env);
  return eligibility.ok ? eligibility.organisation : undefined;
};

export const SSO_REQUIRED_MESSAGE =
  "Your organisation signs in with its own account. Choose “Sign in with your organisation’s account (SSO)” instead.";

const activeCustomerOrganisation = (metadataStore: MetadataStore, workspaceId: string): WorkspaceRecord | undefined => {
  try {
    const workspace = metadataStore.workspaces.get({ id: workspaceId });
    return workspace.kind === "customer" && !workspace.disabled_at ? workspace : undefined;
  } catch {
    return undefined;
  }
};
