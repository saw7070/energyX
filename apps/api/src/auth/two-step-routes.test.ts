import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "../energy/energy-bootstrap.js";
import { EnergyAdminAccessService } from "../energy/energy-admin-access.js";
import { handleEnergyApiRequest } from "../energy/energy-api.js";
import type { ConfigApiContext } from "../routes/types.js";
import { handleAuthApiRequest, resolvePasswordSessionIdentity } from "./routes.js";
import { AuthService } from "./service.js";
import { totpCode, totpStep } from "./totp.js";

const PASSWORD = "plant-room-meter-42";
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const setup = async () => {
  const root = mkdtempSync(join(tmpdir(), "auth-two-step-routes-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite"), secret_master_key: "routes-test-master-key" });
  cleanups.push(() => {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  ensureEnergyIqBootstrap(metadata);
  const auth = new AuthService(metadata, {
    mode: "password",
    publicBaseUrl: "http://127.0.0.1:3001",
    sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
    emailDelivery: "test"
  });
  const admin = new EnergyAdminAccessService(metadata, auth);
  const organisation = admin.createOrganisation({ actorUserId: "dev-user", name: "Elite IOT" });
  const invite = async (email: string) => {
    const invited = await admin.inviteUser({ actorUserId: "dev-user", email, organisationIds: [organisation.id], role: "user" });
    await auth.acceptInvitation({ token: new URL(invited.invitationUrl ?? "").searchParams.get("invite") ?? "", password: PASSWORD });
    return metadata.users.getById({ user_id: invited.user.id });
  };
  // The same order as the API server: resolve a session if there is one, then let the auth routes answer.
  const server: Server = createServer(async (request, response) => {
    let identity;
    try {
      identity = resolvePasswordSessionIdentity(auth, request);
    } catch {
      identity = undefined;
    }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    await handleAuthApiRequest(request, response, pathname, { authService: auth, ...(identity ? { identity } : {}) });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as AddressInfo).port;
  const call = async (path: string, init: { method?: string; body?: unknown; cookies?: string[]; csrf?: string } = {}) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: init.method ?? "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init.cookies ? { Cookie: init.cookies.map((cookie) => cookie.split(";")[0]).join("; ") } : {}),
        ...(init.csrf ? { "X-CSRF-Token": init.csrf } : {})
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
    });
    return { status: response.status, cookies: response.headers.getSetCookie(), body: await response.json() as { data?: Record<string, unknown>; error?: { message: string } } };
  };
  return { metadata, auth, organisation, invite, call };
};

describe("Two-step verification over HTTP", () => {
  it("sets no cookies until the code is entered, then signs in with Remember me kept", async () => {
    const { auth, invite, call } = await setup();
    const user = await invite("member@elite.test");
    const { secret } = auth.twoStep.beginSetup(user);
    auth.twoStep.confirmSetup(user, totpCode(secret, totpStep() - 1));

    const login = await call("/api/v1/auth/login", { body: { email: "member@elite.test", password: PASSWORD, rememberMe: true } });
    expect(login.status).toBe(200);
    expect(login.cookies).toEqual([]);
    const twoStep = login.body.data?.twoStep as { mode: string; challenge: string };
    expect(twoStep.mode).toBe("verify");
    expect(login.body.data?.user).toBeUndefined();

    const wrong = await call("/api/v1/auth/mfa/verify", { body: { challenge: twoStep.challenge, code: "000000" } });
    expect(wrong).toMatchObject({ status: 401, cookies: [], body: { error: { message: expect.stringContaining("That code didn't work") } } });

    const verified = await call("/api/v1/auth/mfa/verify", { body: { challenge: twoStep.challenge, code: totpCode(secret, totpStep()) } });
    expect(verified.status).toBe(200);
    expect(verified.body.data?.user).toMatchObject({ email: "member@elite.test" });
    expect(verified.cookies.find((cookie) => cookie.startsWith("df_session="))).toContain("Max-Age=2592000");

    const csrf = decodeURIComponent(verified.cookies.find((cookie) => cookie.startsWith("df_csrf="))!.split(";")[0]!.slice("df_csrf=".length));
    const status = await call("/api/v1/auth/mfa", { method: "GET", cookies: verified.cookies });
    expect(status.body.data).toMatchObject({ enabled: true, required: false, recoveryCodesLeft: 10 });
    // Changing two-step settings needs the page's CSRF token like any other change.
    expect((await call("/api/v1/auth/mfa/disable", { body: { code: "000000" }, cookies: verified.cookies })).status).toBe(403);
    const disable = await call("/api/v1/auth/mfa/disable", { body: { code: "000000" }, cookies: verified.cookies, csrf });
    expect(disable).toMatchObject({ status: 400, body: { error: { message: expect.stringContaining("That code didn't work") } } });
  });

  it("leaves Remember me off unless the box was ticked", async () => {
    const { invite, call } = await setup();
    await invite("member@elite.test");
    const login = await call("/api/v1/auth/login", { body: { email: "member@elite.test", password: PASSWORD } });
    expect(login.status).toBe(200);
    expect(login.cookies).toHaveLength(2);
    expect(login.cookies.some((cookie) => cookie.includes("Max-Age"))).toBe(false);
  });

  it("serves the Organisation setting on the Team API and the reset on the Admin API", async () => {
    const { metadata, auth, organisation, invite } = await setup();
    const user = await invite("member@elite.test");
    const { secret } = auth.twoStep.beginSetup(user);
    auth.twoStep.confirmSetup(user, totpCode(secret, totpStep()));
    const context = { metadataStore: metadata, authService: auth, userId: "dev-user", workspaceId: organisation.id } as Required<ConfigApiContext>;
    const request = (method: string, url: string, body?: unknown): IncomingMessage => {
      const stream = new PassThrough();
      Object.assign(stream, { method, url, headers: { "content-type": "application/json" } });
      stream.end(body === undefined ? undefined : JSON.stringify(body));
      return stream as unknown as IncomingMessage;
    };

    const before = await handleEnergyApiRequest(request("GET", "/api/v1/energy/team/security"), ["team", "security"], context);
    expect(before).toMatchObject({ status: 200, body: { data: { required: false, canChange: true, membersWithoutTwoStep: 0 } } });
    const changed = await handleEnergyApiRequest(request("PUT", "/api/v1/energy/team/security", { requireTwoStep: true }), ["team", "security"], context);
    expect(changed).toMatchObject({ status: 200, body: { data: { required: true } } });
    const viewer = await handleEnergyApiRequest(request("GET", "/api/v1/energy/team/security"), ["team", "security"], { ...context, userId: user.id });
    expect(viewer.status).toBe(403);

    const refused = await handleEnergyApiRequest(
      request("POST", `/api/v1/energy/admin/users/${user.id}/reset-two-step`), ["admin", "users", user.id, "reset-two-step"], { ...context, userId: user.id }
    );
    expect(refused.status).toBe(403);
    const reset = await handleEnergyApiRequest(
      request("POST", `/api/v1/energy/admin/users/${user.id}/reset-two-step`), ["admin", "users", user.id, "reset-two-step"], context
    );
    expect(reset.status).toBe(200);
    const users = (reset.body as { data: { users: Array<{ id: string; twoStepEnabled: boolean }> } }).data.users;
    expect(users.find((entry) => entry.id === user.id)?.twoStepEnabled).toBe(false);
  });
});
