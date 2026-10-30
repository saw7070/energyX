import { configApi } from "./client";

/** An Organisation's single sign-on connection and provisioning keys, as the Team page shows them. */
export type OrganisationSignInSettingsDto = {
  organisation: { id: string; name: string };
  sso: {
    configured: boolean;
    enabled: boolean;
    issuer: string;
    clientId: string;
    hasClientSecret: boolean;
    domains: string[];
    requireSso: boolean;
    autoCreateAccounts: boolean;
    lastTest?: { at: string; ok: boolean; message?: string };
    keepPasswordCount: number;
  };
  redirectUri: string;
  scim: {
    baseUrl: string;
    keys: Array<{ id: string; name: string; hint: string; createdAt: string; lastUsedAt?: string }>;
  };
};

export type SaveOrganisationSsoInput = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  domains: string[];
  requireSso: boolean;
  autoCreateAccounts: boolean;
};

export type OrganisationSsoTestDto = {
  ok: boolean;
  message: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
};

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** Calls for the active Organisation (the API reads it from the session, never from the page). */
export const organisationSignInApi = {
  get(): Promise<OrganisationSignInSettingsDto> {
    return configApi.organisationSignInRequest("/api/v1/organisation-sign-in");
  },
  saveSso(input: SaveOrganisationSsoInput): Promise<OrganisationSignInSettingsDto> {
    return configApi.organisationSignInRequest("/api/v1/organisation-sign-in/sso", json("PUT", input));
  },
  removeSso(): Promise<OrganisationSignInSettingsDto> {
    return configApi.organisationSignInRequest("/api/v1/organisation-sign-in/sso", json("DELETE"));
  },
  testSso(issuer: string): Promise<OrganisationSsoTestDto> {
    return configApi.organisationSignInRequest("/api/v1/organisation-sign-in/sso/test", json("POST", { issuer }));
  },
  createProvisioningKey(name: string): Promise<{ key: string; settings: OrganisationSignInSettingsDto }> {
    return configApi.organisationSignInRequest("/api/v1/organisation-sign-in/provisioning-keys", json("POST", { name }));
  },
  revokeProvisioningKey(id: string): Promise<OrganisationSignInSettingsDto> {
    return configApi.organisationSignInRequest(`/api/v1/organisation-sign-in/provisioning-keys/${encodeURIComponent(id)}`, json("DELETE"));
  },
  /** Where to send the browser to sign in with the organisation's own account. */
  startSingleSignOn(input: { email: string; rememberMe: boolean; returnTo?: string }): Promise<{ redirectUrl: string }> {
    return configApi.organisationSignInRequest("/api/v1/auth/sso/start", json("POST", input));
  },
};

/** Why the sign-in page was sent back from single sign-on (`/login?sso_error=`), in plain words. */
export const SSO_ERROR_MESSAGES: Record<string, string> = {
  expired: "That sign-in took too long or was already used. Please try again.",
  browser_mismatch: "That sign-in was started in a different browser. Please start again here.",
  provider: "Your organisation’s sign-in service did not let you in. Try again, or ask your IT team.",
  not_available: "Single sign-on is no longer switched on for your organisation. Sign in with your email and password.",
  wrong_domain: "That account isn’t one your organisation uses for EnergyX. Sign in with your work account.",
  not_member: "Your organisation hasn’t given you access to EnergyX yet. Ask your administrator to add you.",
  disabled: "Your EnergyX account is switched off. Ask your administrator.",
  use_password: "Your account isn’t managed by your organisation’s sign-in. Sign in with your email and password.",
  rate_limited: "Too many sign-in attempts. Wait a minute and try again.",
  failed: "We couldn’t confirm your sign-in with your organisation. Try again, or ask your administrator.",
};

export const ssoErrorMessage = (code: string | null | undefined): string | null =>
  code ? SSO_ERROR_MESSAGES[code] ?? SSO_ERROR_MESSAGES.failed! : null;

/** Plain words for the single sign-on and provisioning events in the audit history. */
export const ORGANISATION_SIGN_IN_AUDIT_LABELS: Record<string, string> = {
  "auth.sso_login_started": "Started signing in with their organisation's account",
  "auth.sso_login_succeeded": "Signed in with their organisation's account",
  "auth.sso_login_failed": "Failed sign-in with an organisation's account",
  "auth.sso_account_created": "Account created at first single sign-on",
  "auth.password_refused_sso_required": "Password refused: their organisation requires single sign-on",
  "energyiq.organisation_sso_changed": "Changed a client's single sign-on",
  "energyiq.organisation_sso_removed": "Removed a client's single sign-on",
  "energyiq.organisation_sso_tested": "Tested a client's single sign-on",
  "energyiq.organisation_provisioning_key_created": "Created a provisioning key",
  "energyiq.organisation_provisioning_key_revoked": "Revoked a provisioning key",
  "energyiq.team_member_provisioned": "Identity provider added a team member",
  "energyiq.team_member_updated_by_provisioning": "Identity provider updated a team member",
  "energyiq.team_member_deactivated_by_provisioning": "Identity provider switched off a team member",
  "energyiq.team_member_reactivated_by_provisioning": "Identity provider switched a team member back on",
  "energyiq.team_member_deprovisioned": "Identity provider removed a team member",
};

export const ORGANISATION_SIGN_IN_AUDIT_WARNINGS = ["auth.sso_login_failed", "auth.password_refused_sso_required"];
