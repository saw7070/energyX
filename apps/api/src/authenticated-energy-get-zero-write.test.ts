import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hashToken } from "./auth/crypto.js";
import { AuthService } from "./auth/service.js";
import { handleConfigApiRequest } from "./config-api.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy/energy-bootstrap.js";
import type { ConfigApiContext } from "./routes/types.js";
import { resolveConfigApiRequestPreflight } from "./server.js";

const AUTH_ENV = {
  AUTH_EMAIL_DELIVERY: "test",
  AUTH_PUBLIC_BASE_URL: "http://127.0.0.1",
  AUTH_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
  DATAFOUNDRY_AUTH_MODE: "password",
  ENERGYIQ_TUYA_SYNC_ENABLED: "false",
} as const;

afterEach(() => vi.restoreAllMocks());

describe("authenticated EnergyIQ GET side effects", () => {
  it("serves an exact Admin AI Operations GET without touching session, owner, ensure, queue, or Provider state", async () => {
    const root = mkdtempSync(join(tmpdir(), "authenticated-energy-get-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    let server: ReturnType<typeof createHttpServer> | undefined;
    try {
      ensureEnergyIqBootstrap(metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });
      const personalWorkspace = metadataStore.workspaces.findPersonalByUser({ user_id: user.id })
        ?? metadataStore.workspaces.createPersonal({
          id: `personal-${user.id}`,
          owner_user_id: user.id,
          name: "Test personal workspace",
        });
      metadataStore.workspaceMemberships.upsertOwner({ workspace_id: personalWorkspace.id, user_id: user.id });
      const sessionToken = "authenticated-energy-get-session-token";
      const authSession = metadataStore.authSessions.create({
        id: "authenticated-energy-get-session",
        user_id: user.id,
        token_hash: hashToken(sessionToken, AUTH_ENV.AUTH_SESSION_SECRET),
        csrf_token_hash: hashToken("authenticated-energy-get-csrf", AUTH_ENV.AUTH_SESSION_SECRET),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      metadataStore.sessions.create({
        id: "authenticated-energy-project-session",
        user_id: user.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      for (let index = 0; index < 496; index += 1) {
        metadataStore.runs.create({
          id: `authenticated-energy-project-run-${String(index).padStart(3, "0")}`,
          user_id: user.id,
          session_id: "authenticated-energy-project-session",
          user_input: "private",
        });
      }
      const providerFetch = vi.spyOn(globalThis, "fetch");
      const authService = new AuthService(metadataStore, {
        mode: "password",
        publicBaseUrl: AUTH_ENV.AUTH_PUBLIC_BASE_URL,
        sessionSecret: AUTH_ENV.AUTH_SESSION_SECRET,
        emailDelivery: "test",
      });
      const authenticateSession = vi.spyOn(authService, "authenticateSession");
      const prepareBuiltinResources = vi.fn();
      server = createHttpServer(async (request, response) => {
        try {
          const preflight = resolveConfigApiRequestPreflight({
            request,
            metadataStore,
            authConfig: {
              mode: "password",
              publicBaseUrl: AUTH_ENV.AUTH_PUBLIC_BASE_URL,
              sessionSecret: AUTH_ENV.AUTH_SESSION_SECRET,
              emailDelivery: "test",
            },
            authService,
          });
          if (preflight.prepareBuiltinResources) prepareBuiltinResources();
          const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
          const result = await handleConfigApiRequest(
            request,
            pathname,
            {
              metadataStore,
              authService,
              userId: preflight.authContext.user.id,
              workspaceId: preflight.authContext.workspaceId,
              overviewAiWorkflow: {},
              additionalAiInsightsWorkflow: {},
            } as unknown as Required<ConfigApiContext>,
          );
          response.writeHead(result?.status ?? 404, {
            "Content-Type": "application/json",
            ...(result?.headers ?? {}),
          });
          response.end(JSON.stringify(result?.body ?? { success: false }));
        } catch (error) {
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ success: false, error: String(error) }));
        }
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const changesBefore = totalChanges(metadataStore);
      const lastSeenBefore = metadataStore.authSessions.get({ id: authSession.id }).last_seen_at;

      const startedAt = performance.now();
      const response = await httpGet({
        port: address.port,
        path: "/api/v1/energy/projects/preschool-demo/ai-operations",
        headers: {
            Cookie: `df_session=${encodeURIComponent(sessionToken)}`,
            "X-Workspace-Id": PRESCHOOL_WORKSPACE_ID,
        },
      });
      const elapsedMs = performance.now() - startedAt;
      const responseBytes = Buffer.byteLength(response.body, "utf8");
      console.info(`[ai-operations-local-http] runs=496 elapsed_ms=${elapsedMs.toFixed(1)} bytes=${responseBytes}`);

      expect(response.status).toBe(200);
      expect(response.cacheControl).toBe("private, no-store");
      const responseBody = JSON.parse(response.body);
      expect(responseBody).toMatchObject({
        success: true,
        data: {
          runs: expect.arrayContaining([expect.objectContaining({ traceAvailability: "detail-required" })]),
          pagination: { limit: 20, returned: 20, hasMore: true, nextCursor: expect.any(String) },
        },
      });
      expect(responseBody.data.runs).toHaveLength(20);
      expect(elapsedMs).toBeLessThan(3_000);

      const exactDetail = await httpGet({
        port: address.port,
        path: "/api/v1/energy/projects/preschool-demo/ai-operations/runs/authenticated-energy-project-run-000?actorId=dev-user",
        headers: {
          Cookie: `df_session=${encodeURIComponent(sessionToken)}`,
          "X-Workspace-Id": PRESCHOOL_WORKSPACE_ID,
        },
      });
      const missingActor = await httpGet({
        port: address.port,
        path: "/api/v1/energy/projects/preschool-demo/ai-operations/runs/authenticated-energy-project-run-000",
        headers: {
          Cookie: `df_session=${encodeURIComponent(sessionToken)}`,
          "X-Workspace-Id": PRESCHOOL_WORKSPACE_ID,
        },
      });
      const wrongActor = await httpGet({
        port: address.port,
        path: "/api/v1/energy/projects/preschool-demo/ai-operations/runs/authenticated-energy-project-run-000?actorId=not-the-run-actor",
        headers: {
          Cookie: `df_session=${encodeURIComponent(sessionToken)}`,
          "X-Workspace-Id": PRESCHOOL_WORKSPACE_ID,
        },
      });
      const crossProject = await httpGet({
        port: address.port,
        path: "/api/v1/energy/projects/ngee-ann-polytechnic/ai-operations/runs/authenticated-energy-project-run-000?actorId=dev-user",
        headers: {
          Cookie: `df_session=${encodeURIComponent(sessionToken)}`,
          "X-Workspace-Id": PRESCHOOL_WORKSPACE_ID,
        },
      });
      const invalidLimit = await httpGet({
        port: address.port,
        path: "/api/v1/energy/projects/preschool-demo/ai-operations?limit=0",
        headers: {
          Cookie: `df_session=${encodeURIComponent(sessionToken)}`,
          "X-Workspace-Id": PRESCHOOL_WORKSPACE_ID,
        },
      });
      const invalidCursor = await httpGet({
        port: address.port,
        path: "/api/v1/energy/projects/preschool-demo/ai-operations?cursor=invalid",
        headers: {
          Cookie: `df_session=${encodeURIComponent(sessionToken)}`,
          "X-Workspace-Id": PRESCHOOL_WORKSPACE_ID,
        },
      });
      expect(exactDetail.status).toBe(200);
      expect(exactDetail.cacheControl).toBe("private, no-store");
      expect(missingActor.status).toBe(400);
      expect(wrongActor.status).toBe(403);
      expect(crossProject.status).toBe(403);
      expect(invalidLimit.status).toBe(400);
      expect(invalidCursor.status).toBe(400);
      expect([missingActor, wrongActor, crossProject, invalidLimit, invalidCursor]
        .every(({ body }) => !body.includes("NOT_ENABLED"))).toBe(true);
      expect(metadataStore.authSessions.get({ id: authSession.id }).last_seen_at).toBe(lastSeenBefore);
      expect(totalChanges(metadataStore)).toBe(changesBefore);
      expect(providerFetch).not.toHaveBeenCalled();
      expect(prepareBuiltinResources).not.toHaveBeenCalled();
      expect(authenticateSession).toHaveBeenCalledWith(sessionToken, { accessMode: "read-only" });

      const changesBeforeUnsafe = totalChanges(metadataStore);
      const unsafe = await httpCall({
        port: address.port,
        path: "/api/v1/energy/projects/preschool-demo/ai-operations",
        method: "POST",
        headers: {
          Cookie: `df_session=${encodeURIComponent(sessionToken)}`,
          "X-CSRF-Token": "authenticated-energy-get-csrf",
          "X-Workspace-Id": PRESCHOOL_WORKSPACE_ID,
        },
      });
      expect(unsafe.status).not.toBe(500);
      expect(authenticateSession).toHaveBeenLastCalledWith(sessionToken, { accessMode: "mutating" });
      expect(prepareBuiltinResources).toHaveBeenCalledTimes(1);
      expect(totalChanges(metadataStore)).toBeGreaterThan(changesBeforeUnsafe);

      metadataStore.db.prepare(`
        DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?
      `).run(personalWorkspace.id, user.id);
      expect(() => authService.authenticateSession(sessionToken, { accessMode: "read-only" }))
        .toThrow("Authentication required");
    } finally {
      if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 30_000);
});

function totalChanges(metadataStore: ReturnType<typeof createMetadataStore>): number {
  const row = metadataStore.db.prepare("SELECT total_changes() AS value").get();
  return typeof row === "object" && row !== null && typeof row.value === "number" ? row.value : -1;
}

function httpGet(input: {
  port: number;
  path: string;
  headers: Record<string, string>;
}): Promise<{ status: number; cacheControl: string | undefined; body: string }> {
  return httpCall({ ...input, method: "GET" });
}

function httpCall(input: {
  port: number;
  path: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
}): Promise<{ status: number; cacheControl: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: input.port,
      path: input.path,
      method: input.method,
      headers: input.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        cacheControl: Array.isArray(response.headers["cache-control"])
          ? response.headers["cache-control"][0]
          : response.headers["cache-control"],
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.end();
  });
}
