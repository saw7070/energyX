import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore, WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hashToken } from "../auth/crypto.js";
import { AuthService } from "../auth/service.js";
import { handleConfigApiRequest } from "../config-api.js";
import { classifyServerRequestError, resolveConfigApiRequestPreflight } from "../server.js";
import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import {
  materializePreschoolGoldenFixture,
  PRESCHOOL_GOLDEN,
} from "./preschool-golden.fixture.js";
import { resolvePinnedOverviewAiArtifactReadIdentity } from "./overview-ai-artifact.js";
import { materializeCurrentProjectOverviewProjection } from "./project-analysis-resolver.js";

const AUTH_ENV = {
  AUTH_EMAIL_DELIVERY: "test",
  AUTH_PUBLIC_BASE_URL: "http://127.0.0.1",
  AUTH_SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
  DATAFOUNDRY_AUTH_MODE: "password",
  ENERGYIQ_TUYA_SYNC_ENABLED: "false",
} as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authenticated current Overview minimum projection", () => {
  it("makes the Preschool title, window, headline and navigation useful within the read-only request budget", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-overview-minimum-preschool-"));
    const databasePath = join(root, "energy.duckdb");
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const dataGateway = new LocalDataGateway(metadataStore);
    let server: ReturnType<typeof createHttpServer> | undefined;
    vi.stubEnv("ENERGYIQ_DUCKDB_PATH", databasePath);
    try {
      ensureEnergyIqBootstrap(metadataStore);
      metadataStore.configResources.upsert({
        id: "overview-minimum-model-profile",
        workspace_id: "default",
        user_id: "dev-user",
        kind: "model-profile",
        name: "Overview minimum identity test profile",
        payload: { provider: "openai-compatible", modelName: "identity-test" },
        default_enabled: true,
        status: "connected",
      });
      metadataStore.workspaceDefaultModelProfiles.set({
        workspace_id: "default",
        profile_id: "overview-minimum-model-profile",
        profile_owner_user_id: "dev-user",
        configured_by_user_id: "dev-user",
      });
      const snapshot = await materializePreschoolGoldenFixture(databasePath, metadataStore);
      const user = metadataStore.users.getById({ user_id: "dev-user" });
      await materializeCurrentProjectOverviewProjection({
        metadataStore,
        dataGateway,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: PRESCHOOL_GOLDEN.projectId,
        databasePath,
      });
      const personalWorkspace = metadataStore.workspaces.findPersonalByUser({ user_id: user.id })
        ?? metadataStore.workspaces.createPersonal({
          id: `personal-${user.id}`,
          owner_user_id: user.id,
          name: "Test personal workspace",
        });
      metadataStore.workspaceMemberships.upsertOwner({
        workspace_id: personalWorkspace.id,
        user_id: user.id,
      });
      const sessionToken = "energy-overview-minimum-session-token";
      const authSession = metadataStore.authSessions.create({
        id: "energy-overview-minimum-session",
        user_id: user.id,
        token_hash: hashToken(sessionToken, AUTH_ENV.AUTH_SESSION_SECRET),
        csrf_token_hash: hashToken("energy-overview-minimum-csrf", AUTH_ENV.AUTH_SESSION_SECRET),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      });
      const providerFetch = vi.spyOn(globalThis, "fetch");
      const fullAnalysisSql = vi.spyOn(dataGateway, "runSqlReadonly")
        .mockRejectedValue(new Error("FULL_ANALYSIS_MUST_REMAIN_LAZY"));
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
          const result = await handleConfigApiRequest(request, pathname, {
            metadataStore,
            dataGateway,
            authService,
            userId: preflight.authContext.user.id,
            workspaceId: preflight.authContext.workspaceId,
            overviewAiWorkflow: {},
            additionalAiInsightsWorkflow: {},
          } as unknown as Required<ConfigApiContext>);
          response.writeHead(result?.status ?? 404, {
            "Content-Type": "application/json",
            ...(result?.headers ?? {}),
          });
          response.end(JSON.stringify(result?.body ?? { success: false }));
        } catch (error) {
          const classified = classifyServerRequestError(error);
          response.writeHead(classified.status, { "Content-Type": "application/json" });
          response.end(JSON.stringify({
            success: false,
            error: { code: classified.code, message: classified.message },
          }));
        }
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as AddressInfo;
      const changesBefore = totalChanges(metadataStore);
      const lastSeenBefore = metadataStore.authSessions.get({ id: authSession.id }).last_seen_at;

      const startedAt = performance.now();
      const response = await httpGet({
        port: address.port,
        path: `/api/v1/energy/projects/${PRESCHOOL_GOLDEN.projectId}/overview-minimum`,
        headers: {
          Cookie: `df_session=${encodeURIComponent(sessionToken)}`,
          "X-Workspace-Id": PRESCHOOL_WORKSPACE_ID,
        },
      });
      const elapsedMs = performance.now() - startedAt;
      const responseBytes = Buffer.byteLength(response.body, "utf8");
      console.info(
        `[overview-minimum-local-http] elapsed_ms=${elapsedMs.toFixed(1)} bytes=${responseBytes}`,
      );
      const body = JSON.parse(response.body);

      expect(response.status).toBe(200);
      expect(response.cacheControl).toBe("private, no-store");
      expect(body).toMatchObject({
        success: true,
        data: {
          status: "ready",
          contract: "energyiq-current-overview-minimum@2",
          binding: {
            workspaceId: PRESCHOOL_WORKSPACE_ID,
            projectId: PRESCHOOL_GOLDEN.projectId,
            scopeId: "preschool-project",
            resource: "electricity",
            currentPin: {
              from: expect.any(String),
              to: expect.any(String),
              dataSnapshotId: snapshot.id,
              projectReleaseId: "legacy-profile:preschool-demo:2",
            },
            primaryReportWindowId: "current-overview",
            reportTimeBasis: {
              contractRevision: "energyiq-report-time-context@1",
              timezone: PRESCHOOL_GOLDEN.timezone,
              acceptedDataEndExclusive: expect.any(String),
              dataThroughLocalDate: expect.any(String),
              policyId: expect.any(String),
              policyRevision: expect.any(String),
              windows: expect.arrayContaining([
                expect.objectContaining({
                  windowId: "current-overview",
                  from: expect.any(String),
                  toExclusive: expect.any(String),
                }),
              ]),
            },
          },
          presentation: {
            projectName: "Preschool Portfolio",
            title: "Energy overview",
            renderer: { key: "preschool-overview", version: "1" },
            reportWindow: {
              label: expect.any(String),
              start: expect.any(String),
              endExclusive: expect.any(String),
              timezone: PRESCHOOL_GOLDEN.timezone,
            },
            navigation: expect.arrayContaining([
              expect.objectContaining({ id: expect.any(String), label: expect.any(String) }),
            ]),
          },
          headline: {
            metrics: expect.arrayContaining([
              expect.objectContaining({
                id: "centres",
                value: PRESCHOOL_GOLDEN.period.centreCount,
                unit: "centres",
                available: true,
              }),
              expect.objectContaining({
                id: "energy",
                value: PRESCHOOL_GOLDEN.period.usageKwh,
                unit: "kWh",
                available: true,
              }),
            ]),
          },
        },
      });
      expect(body.data.binding.currentPin.from).not.toHaveLength(0);
      expect(body.data.binding.currentPin.to).not.toHaveLength(0);
      const primaryReportWindow = body.data.binding.reportTimeBasis.windows.find(
        (window: { windowId: string }) => window.windowId === body.data.binding.primaryReportWindowId,
      );
      expect(primaryReportWindow).toBeDefined();
      expect({
        presentationFrom: body.data.presentation.reportWindow.start,
        presentationTo: body.data.presentation.reportWindow.endExclusive,
      }).toEqual({
        presentationFrom: primaryReportWindow.from,
        presentationTo: primaryReportWindow.toExclusive,
      });
      expect(body.data.binding.currentPin.from).toBe(
        localDateAt(primaryReportWindow.from, body.data.presentation.reportWindow.timezone),
      );
      expect(body.data.binding.currentPin.to).toBe(localDateAt(
        new Date(Date.parse(primaryReportWindow.toExclusive) - 1).toISOString(),
        body.data.presentation.reportWindow.timezone,
      ));
      expect(body.data.presentation.reportWindow.label).toBe("Calendar month to date");
      const aiIdentity = resolvePinnedOverviewAiArtifactReadIdentity({
        metadataStore,
        projectId: PRESCHOOL_GOLDEN.projectId,
        scopeId: "preschool-project",
        user,
        pin: body.data.binding.currentPin,
      });
      expect(aiIdentity).toMatchObject({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: PRESCHOOL_GOLDEN.projectId,
        scopeId: "preschool-project",
        dataSnapshotId: snapshot.id,
        projectReleaseId: "legacy-profile:preschool-demo:2",
        modelProfileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
      });
      expect(body.data).not.toHaveProperty("analysis");
      expect(body.data).not.toHaveProperty("evidence");
      expect(body.data).not.toHaveProperty("history");
      expect(responseBytes).toBeLessThanOrEqual(64 * 1024);
      expect(elapsedMs).toBeLessThan(1_000);
      expect(metadataStore.authSessions.get({ id: authSession.id }).last_seen_at).toBe(lastSeenBefore);
      expect(totalChanges(metadataStore)).toBe(changesBefore);
      expect(providerFetch).not.toHaveBeenCalled();
      expect(fullAnalysisSql).not.toHaveBeenCalled();
      expect(prepareBuiltinResources).not.toHaveBeenCalled();
      expect(authenticateSession).toHaveBeenCalledWith(sessionToken, { accessMode: "read-only" });

      const inaccessible = await httpGet({
        port: address.port,
        path: "/api/v1/energy/projects/ngee-ann-polytechnic/overview-minimum",
        headers: {
          Cookie: `df_session=${encodeURIComponent(sessionToken)}`,
          "X-Workspace-Id": PRESCHOOL_WORKSPACE_ID,
        },
      });
      const nonexistent = await httpGet({
        port: address.port,
        path: "/api/v1/energy/projects/not-a-real-project/overview-minimum",
        headers: {
          Cookie: `df_session=${encodeURIComponent(sessionToken)}`,
          "X-Workspace-Id": PRESCHOOL_WORKSPACE_ID,
        },
      });
      expect({ status: inaccessible.status, body: inaccessible.body }).toEqual({
        status: nonexistent.status,
        body: nonexistent.body,
      });
      expect(JSON.parse(inaccessible.body)).toEqual({
        success: false,
        error: { code: "FORBIDDEN", message: "ENERGYIQ_PROJECT_FORBIDDEN" },
      });
      expect(providerFetch).not.toHaveBeenCalled();
      expect(totalChanges(metadataStore)).toBe(changesBefore);
    } finally {
      if (server?.listening) await new Promise<void>((resolve) => server!.close(() => resolve()));
      metadataStore.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);
});

function totalChanges(metadataStore: ReturnType<typeof createMetadataStore>): number {
  const row = metadataStore.db.prepare("SELECT total_changes() AS value").get();
  return typeof row === "object" && row !== null && typeof row.value === "number" ? row.value : -1;
}

function removeTemporaryFixture(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && (error.code === "EPERM" || error.code === "EBUSY")
    ) {
      return;
    }
    throw error;
  }
}

function localDateAt(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function httpGet(input: {
  port: number;
  path: string;
  headers: Record<string, string>;
}): Promise<{ status: number; cacheControl: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: input.port,
      path: input.path,
      method: "GET",
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
