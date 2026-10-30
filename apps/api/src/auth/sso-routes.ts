import { createErrorResult, createSuccessResult } from "@datafoundry/contracts";
import type { MetadataStore, UserRecord } from "@datafoundry/metadata";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { PasswordAuthConfig } from "./config.js";
import { appendAuthCookies, parseCookies } from "./cookies.js";
import { OrganisationSsoService, SsoSignInError, type SaveSsoInput } from "./organisation-sso.js";
import { sendAuthError } from "./routes.js";
import type { OutboundHttpClient } from "./safe-http.js";
import { AuthError, type AuthService } from "./service.js";

/**
 * HTTP routes for Organisation single sign-on.
 *
 * - `handleBeforeSessionAuth` runs before the server looks at the session cookie: the two sign-in steps
 *   (`POST /api/v1/auth/sso/start`, `GET /api/v1/auth/sso/callback`), which happen before anyone is signed in.
 * - `handleSettings` runs after session authentication and the CSRF check: the Team page's sign-in settings under
 *   `/api/v1/organisation-sign-in`.
 *
 * The browser reaches the API through the web app's same-origin proxy, which passes redirects and cookies through,
 * so the identity provider's redirect to `${AUTH_PUBLIC_BASE_URL}/api/v1/auth/sso/callback` ends with the session
 * cookies set on the web app's own origin.
 */
export const SSO_BROWSER_COOKIE = "df_sso";
const SSO_COOKIE_PATH = "/api/v1/auth/sso";
const SSO_COOKIE_MAX_AGE_SECONDS = 10 * 60;
const SETTINGS_PREFIX = "/api/v1/organisation-sign-in";
const MAX_BODY_BYTES = 64 * 1024;

export type OrganisationIdentityRoutes = {
  sso: OrganisationSsoService;
  handleBeforeSessionAuth: (request: IncomingMessage, response: ServerResponse, url: URL) => Promise<boolean>;
  handleSettings: (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    caller: { user: UserRecord; workspaceId: string }
  ) => Promise<boolean>;
};

export const createOrganisationIdentityRoutes = (dependencies: {
  metadataStore: MetadataStore;
  authService: AuthService;
  authConfig: Pick<PasswordAuthConfig, "mode" | "publicBaseUrl" | "sessionSecret">;
  http?: OutboundHttpClient;
  env?: Record<string, string | undefined>;
  now?: () => number;
}): OrganisationIdentityRoutes => {
  const sso = new OrganisationSsoService(dependencies);
  const publicBaseUrl = dependencies.authConfig.publicBaseUrl.replace(/\/+$/u, "");
  const passwordMode = dependencies.authConfig.mode === "password";

  return {
    sso,
    handleBeforeSessionAuth: async (request, response, url) => {
      if (!url.pathname.startsWith(`${SSO_COOKIE_PATH}/`)) return false;
      if (!passwordMode) {
        sendJson(response, 404, createErrorResult("NOT_ENABLED", "Single sign-on works only when password sign-in is switched on."));
        return true;
      }
      await handleSsoSignIn(request, response, url, sso);
      return true;
    },
    handleSettings: async (request, response, url, caller) => {
      if (url.pathname !== SETTINGS_PREFIX && !url.pathname.startsWith(`${SETTINGS_PREFIX}/`)) return false;
      await handleSettingsRequest(request, response, url, sso, caller, publicBaseUrl ? undefined : requestOrigin(request));
      return true;
    }
  };
};

const handleSsoSignIn = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  sso: OrganisationSsoService
): Promise<void> => {
  const step = url.pathname.slice(SSO_COOKIE_PATH.length + 1);
  if (step === "start" && request.method === "POST") {
    try {
      const body = await readJsonBody(request);
      const result = await sso.start({
        email: typeof body.email === "string" ? body.email : "",
        returnTo: typeof body.returnTo === "string" ? body.returnTo : undefined,
        rememberMe: body.rememberMe !== false,
        ...requestMeta(request)
      });
      response.setHeader("Set-Cookie", browserCookie(result.browserBinding, SSO_COOKIE_MAX_AGE_SECONDS));
      sendJson(response, 200, createSuccessResult({ redirectUrl: result.redirectUrl }));
    } catch (error) {
      sendAuthError(response, error);
    }
    return;
  }
  if (step === "callback" && request.method === "GET") {
    const query = url.searchParams;
    try {
      const result = await sso.complete({
        code: query.get("code") ?? undefined,
        state: query.get("state") ?? undefined,
        error: query.get("error") ?? undefined,
        browserBinding: parseCookies(request)[SSO_BROWSER_COOKIE],
        ...requestMeta(request)
      });
      response.setHeader("Set-Cookie", browserCookie("", 0));
      appendAuthCookies(response, {
        csrfToken: result.session.csrfToken,
        maxAgeSeconds: result.session.maxAgeSeconds,
        persistent: result.session.persistent,
        sessionToken: result.session.sessionToken
      });
      redirect(response, result.returnTo ?? "/energyiq/overview");
    } catch (error) {
      response.setHeader("Set-Cookie", browserCookie("", 0));
      const code = error instanceof SsoSignInError ? error.code : "failed";
      if (!(error instanceof SsoSignInError)) console.warn("[auth] single sign-on failed unexpectedly", error);
      redirect(response, `/login?sso_error=${encodeURIComponent(code)}`);
    }
    return;
  }
  sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "Unknown sign-in step."));
};

const handleSettingsRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  sso: OrganisationSsoService,
  caller: { user: UserRecord; workspaceId: string },
  origin: string | undefined
): Promise<void> => {
  const segments = url.pathname.slice(SETTINGS_PREFIX.length).split("/").filter(Boolean).map(decodeURIComponent);
  const { user, workspaceId } = caller;
  try {
    if (segments.length === 0 && request.method === "GET") {
      sendJson(response, 200, createSuccessResult(sso.getSettings(user, workspaceId, origin)));
      return;
    }
    if (segments[0] === "sso" && segments.length === 1 && request.method === "PUT") {
      const body = await readJsonBody(request);
      sendJson(response, 200, createSuccessResult(await sso.saveSso(user, workspaceId, parseSaveSso(body), origin)));
      return;
    }
    if (segments[0] === "sso" && segments.length === 1 && request.method === "DELETE") {
      sendJson(response, 200, createSuccessResult(sso.removeSso(user, workspaceId, origin)));
      return;
    }
    if (segments[0] === "sso" && segments[1] === "test" && segments.length === 2 && request.method === "POST") {
      const body = await readJsonBody(request);
      sendJson(response, 200, createSuccessResult(await sso.testSso(user, workspaceId, {
        ...(typeof body.issuer === "string" ? { issuer: body.issuer } : {})
      })));
      return;
    }
    if (segments[0] === "provisioning-keys" && segments.length === 1 && request.method === "POST") {
      const body = await readJsonBody(request);
      const created = sso.createProvisioningKey(user, workspaceId, typeof body.name === "string" ? body.name : "", origin);
      sendJson(response, 201, createSuccessResult(created));
      return;
    }
    if (segments[0] === "provisioning-keys" && segments[1] && segments.length === 2 && request.method === "DELETE") {
      sendJson(response, 200, createSuccessResult(sso.revokeProvisioningKey(user, workspaceId, segments[1], origin)));
      return;
    }
    sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "Unknown sign-in setting."));
  } catch (error) {
    sendAuthError(response, error);
  }
};

const parseSaveSso = (body: Record<string, unknown>): SaveSsoInput => ({
  enabled: body.enabled === true,
  issuer: typeof body.issuer === "string" ? body.issuer : "",
  clientId: typeof body.clientId === "string" ? body.clientId : "",
  ...(typeof body.clientSecret === "string" && body.clientSecret.trim() ? { clientSecret: body.clientSecret } : {}),
  removeClientSecret: body.removeClientSecret === true,
  domains: Array.isArray(body.domains) ? body.domains.filter((value): value is string => typeof value === "string") : [],
  requireSso: body.requireSso === true,
  autoCreateAccounts: body.autoCreateAccounts === true
});

const browserCookie = (value: string, maxAgeSeconds: number): string => [
  `${SSO_BROWSER_COOKIE}=${encodeURIComponent(value)}`,
  `Path=${SSO_COOKIE_PATH}`,
  `Max-Age=${maxAgeSeconds}`,
  "SameSite=Lax",
  ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  "HttpOnly"
].join("; ");

const redirect = (response: ServerResponse, location: string): void => {
  response.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  response.end();
};

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new AuthError(413, "BAD_REQUEST", "The request is too large.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AuthError(400, "BAD_REQUEST", "The request could not be read.");
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
};

const requestMeta = (request: IncomingMessage): { ipAddress?: string; userAgent?: string } => {
  const forwarded = request.headers["x-forwarded-for"];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim() || request.socket.remoteAddress;
  const userAgent = request.headers["user-agent"];
  return {
    ...(ip ? { ipAddress: ip } : {}),
    ...(typeof userAgent === "string" ? { userAgent } : {})
  };
};

/** Local development only (no AUTH_PUBLIC_BASE_URL): the address the request came in on. */
const requestOrigin = (request: IncomingMessage): string => `http://${request.headers.host ?? "127.0.0.1"}`;

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};
