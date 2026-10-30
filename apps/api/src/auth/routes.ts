import { createErrorResult, createSuccessResult, type AppErrorCode } from "@datafoundry/contracts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthIdentity, AuthService, AuthSignedIn, AuthTwoStepPending } from "./service.js";
import { AuthError, userDto, workspaceDto } from "./service.js";
import { appendAuthCookies, appendClearAuthCookies, CSRF_COOKIE, parseCookies, SESSION_COOKIE } from "./cookies.js";

export type AuthRouteContext = {
  authService: AuthService;
  identity?: AuthIdentity;
};

export async function handleAuthApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  context: AuthRouteContext
): Promise<boolean> {
  if (!pathname.startsWith("/api/v1/auth/")) {
    return false;
  }
  try {
    const segments = pathname.slice("/api/v1/auth/".length).split("/").filter(Boolean);
    const root = segments[0] ?? "";
    const body = request.method === "GET" || request.method === "DELETE"
      ? {}
      : await readJsonBody(request);

    if (root === "register" && request.method === "POST") {
      const result = await context.authService.register({
        email: requiredString(body.email, "email"),
        password: requiredString(body.password, "password"),
        ...(optionalString(body.displayName) ? { displayName: optionalString(body.displayName) } : {}),
        ...requestMeta(request)
      });
      sendJson(response, 201, createSuccessResult(result));
      return true;
    }
    if (root === "login" && request.method === "POST") {
      sendSignInResult(response, await context.authService.login({
        email: requiredString(body.email, "email"),
        password: requiredString(body.password, "password"),
        rememberMe: body.rememberMe === true,
        ...requestMeta(request)
      }));
      return true;
    }
    if (root === "activate" && request.method === "POST") {
      sendSignInResult(response, await context.authService.acceptInvitation({
        token: requiredString(body.token, "token"),
        password: requiredString(body.password, "password"),
        ...(optionalString(body.displayName) ? { displayName: optionalString(body.displayName) } : {}),
        ...requestMeta(request)
      }));
      return true;
    }
    // Two-step verification while signing in: the challenge from the password step stands in for a session.
    if (root === "mfa" && segments[1] === "setup" && segments.length === 2 && request.method === "POST") {
      sendJson(response, 200, createSuccessResult(context.authService.beginTwoStepSignInSetup({
        challenge: requiredString(body.challenge, "challenge"),
        ...requestMeta(request)
      })));
      return true;
    }
    if (root === "mfa" && segments[1] === "verify" && segments.length === 2 && request.method === "POST") {
      sendSignInResult(response, context.authService.completeTwoStepSignIn({
        challenge: requiredString(body.challenge, "challenge"),
        code: optionalString(body.code),
        recoveryCode: optionalString(body.recoveryCode),
        ...requestMeta(request)
      }));
      return true;
    }
    if (root === "verify-email" && request.method === "POST") {
      sendJson(response, 200, createSuccessResult(await context.authService.verifyEmail({
        token: requiredString(body.token, "token"),
        ...requestMeta(request)
      })));
      return true;
    }
    if (root === "password" && segments[1] === "forgot" && request.method === "POST") {
      sendJson(response, 200, createSuccessResult(await context.authService.forgotPassword({
        email: requiredString(body.email, "email"),
        ...requestMeta(request)
      })));
      return true;
    }
    if (root === "password" && segments[1] === "reset" && request.method === "POST") {
      sendJson(response, 200, createSuccessResult(await context.authService.resetPassword({
        token: requiredString(body.token, "token"),
        password: requiredString(body.password, "password"),
        ...requestMeta(request)
      })));
      return true;
    }

    const identity = requireIdentity(context);
    if (isUnsafeMethod(request.method)) {
      context.authService.validateCsrf(identity, headerString(request.headers["x-csrf-token"]));
    }
    if (root === "csrf" && request.method === "GET") {
      const token = parseCookies(request)[CSRF_COOKIE] ?? "";
      sendJson(response, 200, createSuccessResult({ csrfToken: token }));
      return true;
    }
    if (root === "logout" && request.method === "POST") {
      const result = context.authService.logout(identity);
      appendClearAuthCookies(response);
      sendJson(response, 200, createSuccessResult(result));
      return true;
    }
    if (root === "logout-all" && request.method === "POST") {
      const result = context.authService.logoutAll(identity);
      appendClearAuthCookies(response);
      sendJson(response, 200, createSuccessResult(result));
      return true;
    }
    if (root === "sessions" && request.method === "GET") {
      sendJson(response, 200, createSuccessResult(context.authService.listSessions(identity)));
      return true;
    }
    if (root === "sessions" && segments[1] && request.method === "DELETE") {
      sendJson(response, 200, createSuccessResult(context.authService.revokeSession(identity, segments[1])));
      return true;
    }
    // Two-step verification settings for the signed-in person.
    if (root === "mfa" && segments.length === 1 && request.method === "GET") {
      sendJson(response, 200, createSuccessResult(context.authService.twoStep.status(identity.user)));
      return true;
    }
    if (root === "mfa" && segments[1] === "enable" && segments.length === 2 && request.method === "POST") {
      sendJson(response, 200, createSuccessResult(context.authService.twoStep.beginSetup(identity.user)));
      return true;
    }
    if (root === "mfa" && segments[1] === "enable" && segments[2] === "confirm" && segments.length === 3 && request.method === "POST") {
      sendJson(response, 200, createSuccessResult(context.authService.twoStep.confirmSetup(
        identity.user,
        requiredString(body.code, "code"),
        requestMeta(request)
      )));
      return true;
    }
    if (root === "mfa" && segments[1] === "recovery-codes" && segments.length === 2 && request.method === "POST") {
      sendJson(response, 200, createSuccessResult(context.authService.twoStep.regenerateRecoveryCodes(
        identity.user,
        requiredString(body.code, "code"),
        requestMeta(request)
      )));
      return true;
    }
    if (root === "mfa" && segments[1] === "disable" && segments.length === 2 && request.method === "POST") {
      sendJson(response, 200, createSuccessResult(context.authService.twoStep.disable(
        identity.user,
        requiredString(body.code, "code"),
        requestMeta(request)
      )));
      return true;
    }
    if (root === "password" && segments[1] === "change" && request.method === "POST") {
      sendJson(response, 200, createSuccessResult(await context.authService.changePassword({
        identity,
        currentPassword: requiredString(body.currentPassword, "currentPassword"),
        newPassword: requiredString(body.newPassword ?? body.password, "newPassword"),
        ...requestMeta(request)
      })));
      return true;
    }
    sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "Unknown auth resource."));
    return true;
  } catch (error) {
    sendAuthError(response, error);
    return true;
  }
}

export function resolvePasswordSessionIdentity(
  authService: AuthService,
  request: IncomingMessage
): AuthIdentity {
  return authService.authenticateSession(parseCookies(request)[SESSION_COOKIE], {
    accessMode: isUnsafeMethod(request.method) ? "mutating" : "read-only",
  });
}

export function authMeDto(identity: AuthIdentity): Record<string, unknown> {
  return {
    user: userDto(identity.user),
    workspace: workspaceDto(identity.workspace)
  };
}

export function isUnsafeMethod(method: string | undefined): boolean {
  return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
}

export function sendAuthError(response: ServerResponse, error: unknown): void {
  if (error instanceof AuthError) {
    sendJson(response, error.status, createErrorResult(error.code as AppErrorCode, error.message));
    return;
  }
  const message = error instanceof Error ? error.message : "Unknown auth error";
  sendJson(response, 500, createErrorResult("INTERNAL_ERROR", message));
}

/**
 * Answers a sign-in step: either the session cookies and who signed in, or what two-step verification still needs
 * (no cookies yet). Recovery codes from setting it up during sign-in are passed on to be shown once.
 */
function sendSignInResult(response: ServerResponse, result: (AuthSignedIn & { recoveryCodes?: string[] }) | AuthTwoStepPending): void {
  if ("twoStep" in result) {
    sendJson(response, 200, createSuccessResult({ twoStep: result.twoStep }));
    return;
  }
  appendAuthCookies(response, {
    csrfToken: result.csrfToken,
    maxAgeSeconds: result.maxAgeSeconds,
    persistent: result.persistent,
    sessionToken: result.sessionToken
  });
  sendJson(response, 200, createSuccessResult({
    user: result.user,
    workspace: result.workspace,
    ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {})
  }));
}

function requireIdentity(context: AuthRouteContext): AuthIdentity {
  if (!context.identity) {
    throw new AuthError(401, "UNAUTHORIZED", "Authentication required.");
  }
  return context.identity;
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new AuthError(400, "BAD_REQUEST", `${name} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requestMeta(request: IncomingMessage): { ipAddress?: string | undefined; userAgent?: string | undefined } {
  return {
    ...(headerString(request.headers["x-forwarded-for"]) ?? request.socket.remoteAddress
      ? { ipAddress: (headerString(request.headers["x-forwarded-for"]) ?? request.socket.remoteAddress)?.split(",")[0]?.trim() }
      : {}),
    ...(headerString(request.headers["user-agent"]) ? { userAgent: headerString(request.headers["user-agent"]) } : {})
  };
}

function headerString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  // Cross-origin headers, when the caller is allowed, are set once per request in http-security.ts.
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}
