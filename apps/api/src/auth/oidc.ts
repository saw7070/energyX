import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createLocalJWKSet, errors as joseErrors, jwtVerify, type JSONWebKeySet, type JWTPayload } from "jose";

import { assertSafeHttpsUrl, OutboundRequestError, type OutboundHttpClient } from "./safe-http.js";

/**
 * The OpenID Connect relying-party side of Organisation single sign-on: discovery, the authorization code flow with
 * PKCE, the token request and ID-token validation. Works with any standards-following provider, including Microsoft
 * Entra ID, Google Workspace and Okta. All network calls go through the SSRF-guarded client in safe-http.ts.
 */
export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
};

export type OidcFailureReason =
  | "invalid_issuer"
  | "discovery_failed"
  | "token_exchange_failed"
  | "bad_signature"
  | "wrong_issuer"
  | "wrong_audience"
  | "expired"
  | "nonce_mismatch"
  | "email_missing"
  | "email_unverified"
  | "invalid_token";

export class OidcError extends Error {
  constructor(readonly reason: OidcFailureReason, message: string) {
    super(message);
    this.name = "OidcError";
  }
}

export type VerifiedOidcIdentity = {
  subject: string;
  email: string;
  name?: string;
  /** Google's `hd` claim: the Workspace domain that manages the account (absent for personal Google accounts). */
  hostedDomain?: string;
};

/** Google signs in any Google account, including personal ones registered with a company address. */
export const GOOGLE_ISSUER = "https://accounts.google.com";

/** Asymmetric algorithms only: "none" and shared-secret HMAC are never accepted for an ID token. */
const ALLOWED_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];
const DISCOVERY_TTL_MS = 10 * 60 * 1000;
const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_FORCED_REFRESH_GAP_MS = 60 * 1000;
const CLOCK_TOLERANCE_SECONDS = 60;
const MAX_ID_TOKEN_AGE_SECONDS = 10 * 60;

/** The issuer as people paste it: https only, no query or fragment, and without a trailing slash. */
export const normaliseIssuer = (value: string): string => {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = assertSafeHttpsUrl(trimmed);
  } catch (error) {
    throw new OidcError("invalid_issuer", error instanceof Error ? error.message : "The issuer URL is not valid.");
  }
  if (url.search || url.hash) {
    throw new OidcError("invalid_issuer", "The issuer URL must not contain ? or #.");
  }
  return trimmed.replace(/\/+$/u, "");
};

export const randomUrlSafe = (bytes = 32): string => randomBytes(bytes).toString("base64url");

export const createPkcePair = (): { verifier: string; challenge: string } => {
  const verifier = randomUrlSafe(48);
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

export class OidcClient {
  private readonly discoveryCache = new Map<string, { value: OidcDiscovery; expiresAt: number }>();
  private readonly jwksCache = new Map<string, { value: JSONWebKeySet; fetchedAt: number }>();

  constructor(
    private readonly http: OutboundHttpClient,
    private readonly now: () => number = Date.now
  ) {}

  /** Fetch and check the provider's discovery document. `fresh` skips the cache (used by "Test"). */
  async discover(issuerInput: string, options: { fresh?: boolean } = {}): Promise<OidcDiscovery> {
    const issuer = normaliseIssuer(issuerInput);
    const cached = this.discoveryCache.get(issuer);
    if (!options.fresh && cached && cached.expiresAt > this.now()) return cached.value;
    const document = await this.getJson(`${issuer}/.well-known/openid-configuration`, "discovery_failed",
      "The identity provider's settings could not be read. Check the issuer URL.");
    const reportedIssuer = typeof document.issuer === "string" ? document.issuer : "";
    if (reportedIssuer.replace(/\/+$/u, "") !== issuer) {
      throw new OidcError("discovery_failed",
        `The identity provider calls itself "${reportedIssuer.slice(0, 200) || "(nothing)"}", which does not match the issuer URL.`);
    }
    const endpoint = (name: string): string => {
      const value = document[name];
      if (typeof value !== "string") {
        throw new OidcError("discovery_failed", `The identity provider's settings have no ${name}.`);
      }
      try {
        return assertSafeHttpsUrl(value).toString();
      } catch {
        throw new OidcError("discovery_failed", `The identity provider's ${name} is not a public https address.`);
      }
    };
    const discovery: OidcDiscovery = {
      issuer: reportedIssuer,
      authorization_endpoint: endpoint("authorization_endpoint"),
      token_endpoint: endpoint("token_endpoint"),
      jwks_uri: endpoint("jwks_uri"),
      ...(Array.isArray(document.token_endpoint_auth_methods_supported)
        ? { token_endpoint_auth_methods_supported: document.token_endpoint_auth_methods_supported.filter((item): item is string => typeof item === "string") }
        : {})
    };
    this.discoveryCache.set(issuer, { value: discovery, expiresAt: this.now() + DISCOVERY_TTL_MS });
    return discovery;
  }

  authorizationUrl(discovery: OidcDiscovery, input: {
    clientId: string;
    redirectUri: string;
    state: string;
    nonce: string;
    codeChallenge: string;
    loginHint?: string;
  }): string {
    const url = new URL(discovery.authorization_endpoint);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", input.state);
    url.searchParams.set("nonce", input.nonce);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
    return url.toString();
  }

  /** Swap the authorization code for tokens and return the ID token. */
  async exchangeCode(discovery: OidcDiscovery, input: {
    clientId: string;
    clientSecret?: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<string> {
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      code_verifier: input.codeVerifier
    });
    const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
    const methods = discovery.token_endpoint_auth_methods_supported;
    if (input.clientSecret && (!methods || methods.includes("client_secret_basic") || !methods.includes("client_secret_post"))) {
      // RFC 6749 2.3.1: both parts are form-encoded before they are joined and base64-encoded.
      const user = encodeURIComponent(input.clientId).replace(/%20/gu, "+");
      const password = encodeURIComponent(input.clientSecret).replace(/%20/gu, "+");
      headers.Authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
    } else {
      form.set("client_id", input.clientId);
      if (input.clientSecret) form.set("client_secret", input.clientSecret);
    }
    let response;
    try {
      response = await this.http({ url: discovery.token_endpoint, method: "POST", headers, body: form.toString() });
    } catch (error) {
      throw new OidcError("token_exchange_failed", outboundMessage(error, "The identity provider could not be reached."));
    }
    const body = parseJsonObject(response.body);
    if (response.status < 200 || response.status >= 300 || !body || typeof body.id_token !== "string") {
      const reason = body && typeof body.error === "string" ? ` (${body.error.slice(0, 80)})` : "";
      throw new OidcError("token_exchange_failed", `The identity provider did not complete the sign-in${reason}.`);
    }
    return body.id_token;
  }

  /**
   * Check the ID token: signature against the provider's published keys, issuer, audience (and azp when there are
   * several audiences), expiry and issue time, the nonce we sent, and a verified email address.
   */
  async verifyIdToken(discovery: OidcDiscovery, idToken: string, input: {
    clientId: string;
    expectedNonceHash: string;
    hashNonce: (nonce: string) => string;
  }): Promise<VerifiedOidcIdentity> {
    const verifyWith = async (jwks: JSONWebKeySet) => jwtVerify(idToken, createLocalJWKSet(jwks), {
      issuer: discovery.issuer,
      audience: input.clientId,
      algorithms: ALLOWED_ALGORITHMS,
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      maxTokenAge: MAX_ID_TOKEN_AGE_SECONDS,
      requiredClaims: ["iss", "sub", "aud", "exp", "iat"],
      currentDate: new Date(this.now())
    });
    let payload: JWTPayload;
    try {
      try {
        payload = (await verifyWith(await this.jwks(discovery.jwks_uri))).payload;
      } catch (error) {
        // The provider may have rotated its keys since we cached them: fetch them once more and retry.
        if (!(error instanceof joseErrors.JWKSNoMatchingKey)) throw error;
        payload = (await verifyWith(await this.jwks(discovery.jwks_uri, { refresh: true }))).payload;
      }
    } catch (error) {
      throw toOidcError(error);
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (audiences.length > 1 && payload.azp !== input.clientId) {
      throw new OidcError("wrong_audience", "The sign-in was issued for a different application.");
    }
    if (typeof payload.nonce !== "string" || !sameHash(input.hashNonce(payload.nonce), input.expectedNonceHash)) {
      throw new OidcError("nonce_mismatch", "The sign-in does not belong to this browser session.");
    }
    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) {
      throw new OidcError("email_missing", "The identity provider did not share an email address.");
    }
    // Standard claim, or Microsoft Entra ID's "email domain owner verified" optional claim.
    if (!isTrue(payload.email_verified) && !isTrue(payload.xms_edov)) {
      throw new OidcError("email_unverified", "The identity provider has not verified this email address.");
    }
    return {
      subject: String(payload.sub),
      email,
      ...(typeof payload.name === "string" && payload.name.trim() ? { name: payload.name.trim().slice(0, 80) } : {}),
      ...(typeof payload.hd === "string" && payload.hd.trim() ? { hostedDomain: payload.hd.trim().toLowerCase() } : {})
    };
  }

  private async jwks(uri: string, options: { refresh?: boolean } = {}): Promise<JSONWebKeySet> {
    const cached = this.jwksCache.get(uri);
    const now = this.now();
    if (cached) {
      const fresh = now - cached.fetchedAt < JWKS_TTL_MS;
      const refreshedRecently = now - cached.fetchedAt < JWKS_FORCED_REFRESH_GAP_MS;
      if ((!options.refresh && fresh) || (options.refresh && refreshedRecently)) return cached.value;
    }
    const document = await this.getJson(uri, "bad_signature", "The identity provider's signing keys could not be read.");
    if (!Array.isArray(document.keys)) {
      throw new OidcError("bad_signature", "The identity provider's signing keys could not be read.");
    }
    const value = { keys: document.keys.filter((key): key is JSONWebKeySet["keys"][number] => typeof key === "object" && key !== null) };
    this.jwksCache.set(uri, { value, fetchedAt: now });
    return value;
  }

  private async getJson(url: string, reason: OidcFailureReason, message: string): Promise<Record<string, unknown>> {
    let response;
    try {
      response = await this.http({ url, method: "GET" });
    } catch (error) {
      throw new OidcError(reason, outboundMessage(error, message));
    }
    const body = parseJsonObject(response.body);
    if (response.status !== 200 || !body) throw new OidcError(reason, message);
    return body;
  }
}

const isTrue = (value: unknown): boolean => value === true || value === "true";

const sameHash = (left: string, right: string): boolean => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

const parseJsonObject = (text: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
};

const outboundMessage = (error: unknown, fallback: string): string =>
  error instanceof OutboundRequestError ? error.message : fallback;

const toOidcError = (error: unknown): OidcError => {
  if (error instanceof OidcError) return error;
  if (error instanceof joseErrors.JWTExpired) {
    return new OidcError("expired", "The sign-in has expired. Please try again.");
  }
  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    if (error.claim === "iss") return new OidcError("wrong_issuer", "The sign-in came from a different identity provider.");
    if (error.claim === "aud") return new OidcError("wrong_audience", "The sign-in was issued for a different application.");
    if (error.claim === "iat") return new OidcError("expired", "The sign-in is too old or not yet valid.");
    return new OidcError("invalid_token", "The identity provider's answer was not valid.");
  }
  if (error instanceof joseErrors.JWSSignatureVerificationFailed || error instanceof joseErrors.JWKSNoMatchingKey
    || error instanceof joseErrors.JOSEAlgNotAllowed) {
    return new OidcError("bad_signature", "The identity provider's answer was not signed with its published keys.");
  }
  return new OidcError("invalid_token", "The identity provider's answer was not valid.");
};
