import { LocalDataGateway } from "@datafoundry/data-gateway";
import type { FileAssetService } from "@datafoundry/files";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolvePiReportModel } from "../report-agent/pi-report-harness.js";
import { ReportService } from "../report-agent/report-service.js";
import type { ReportSettings } from "../report-agent/report-store.js";
import type { ConfigApiContext } from "../routes/types.js";
import { assertAiAllowed, recordAiRequest } from "./energy-ai-governance.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";

const request = (method: string, url: string, body?: unknown): IncomingMessage => {
  const stream = new PassThrough() as PassThrough & IncomingMessage;
  stream.method = method;
  stream.url = url;
  stream.headers = body === undefined ? {} : { "content-type": "application/json" };
  stream.end(body === undefined ? undefined : JSON.stringify(body));
  return stream;
};

describe("AI governance", () => {
  let root: string;
  let metadata: ReturnType<typeof createMetadataStore>;
  const contextFor = (userId: string, workspaceId = "default") => ({ metadataStore: metadata, dataGateway: new LocalDataGateway(metadata), userId, workspaceId }) as unknown as Required<ConfigApiContext>;
  const call = (userId: string, method: string, segments: string[], query = "", body?: unknown) =>
    handleEnergyApiRequest(request(method, `/api/v1/energy/${segments.join("/")}${query}`, body), segments, contextFor(userId));
  const auditTypes = () => metadata.authAuditEvents.list({ limit: 50 }).events.map((event) => event.event_type);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "energy-ai-gov-"));
    metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    metadata.users.createPasswordUser({ id: "owner", email: "owner@example.test" });
    metadata.workspaceMemberships.upsertOwner({ workspace_id: "default", user_id: "owner" });
  });
  afterEach(() => {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("lets a super admin switch AI off, set a monthly limit, and see every client's use", async () => {
    const view = await call("dev-user", "GET", ["admin", "ai"]);
    expect(view.status).toBe(200);
    const organisations = (view.body as { data: { organisations: Array<{ id: string; settings: { enabled: boolean } }> } }).data.organisations;
    expect(organisations.find((organisation) => organisation.id === "default")?.settings.enabled).toBe(true);

    const saved = await call("dev-user", "PUT", ["admin", "ai", "default"], "", { enabled: false, monthlyRequestLimit: 25 });
    expect(saved.status).toBe(200);
    expect(metadata.energyIq.ai.getSettings("default")).toMatchObject({ enabled: false, monthlyRequestLimit: 25 });
    expect(auditTypes()).toContain("energyiq.ai_settings_changed");
    expect((await call("dev-user", "PUT", ["admin", "ai", "default"], "", { modelProfileId: "not-a-tested-model" })).status).toBe(400);
    expect((await call("owner", "GET", ["admin", "ai"])).status).toBe(403);
  });

  it("refuses AI when it is off or the month's limit is used, and records every request in the audit history", () => {
    const input = { metadataStore: metadata, workspaceId: "default", projectId: "ngee-ann-polytechnic", userId: "owner", feature: "advisor" as const };
    metadata.energyIq.ai.setSettings("default", { enabled: false }, "dev-user");
    expect(() => assertAiAllowed(input)).toThrow("ENERGYIQ_AI_DISABLED");
    metadata.energyIq.ai.setSettings("default", { enabled: true, monthlyRequestLimit: 1 }, "dev-user");
    assertAiAllowed(input);
    recordAiRequest(input);
    expect(() => assertAiAllowed(input)).toThrow("ENERGYIQ_AI_LIMIT_REACHED");
    expect(metadata.energyIq.ai.usageSummary("default", "2000-01-01T00:00:00Z")).toMatchObject({ requests: 1, blocked: 2 });
    expect(auditTypes()).toEqual(expect.arrayContaining(["energyiq.ai_used", "energyiq.ai_blocked"]));
  });

  it("stops an advisor run before the model is called when AI is off, and meters the tokens when it is on", async () => {
    const settings: ReportSettings = { projectId: "ngee-ann-polytechnic", workspaceId: "default", actorUserId: "owner", timezone: "Asia/Singapore", contextNotes: "", fileRefIds: [], useProjectData: true, skill: "Analyse night load", revision: 0, frequency: "off", localHour: 3, scheduledPrompt: "" };
    const period = { from: "2026-08-01", toExclusive: "2026-09-01" };
    const harness = vi.fn(async ({ directory, workspaceId, onUsage }: { directory: string; workspaceId?: string; onUsage?: (usage: { model: string; inputTokens: number; outputTokens: number }) => void }) => {
      expect(workspaceId).toBe("default");
      onUsage?.({ model: "deepseek-chat", inputTokens: 1200, outputTokens: 300 });
      writeFileSync(join(directory, "outputs", "report.html"), "<!doctype html><html><body>Energy report with evidence</body></html>");
      return { answer: "Report created" };
    });
    const service = new ReportService({ root: join(root, "reports"), metadata, files: {} as FileAssetService, harness,
      authorizeProject: () => undefined,
      prepareInputs: async (_run, directory) => { mkdirSync(join(directory, "inputs"), { recursive: true }); writeFileSync(join(directory, "inputs", "sample.csv"), "kwh\n10"); },
    });
    metadata.energyIq.ai.setSettings("default", { enabled: false }, "dev-user");
    const blocked = service.store.enqueue({ settings, period, prompt: "Make report", actorUserId: "owner" });
    service.start();
    await vi.waitFor(() => expect(service.store.get(settings.projectId, blocked.id).status).toBe("failed"));
    expect(service.store.get(settings.projectId, blocked.id).errorCode).toBe("ENERGYIQ_AI_DISABLED");
    expect(harness).not.toHaveBeenCalled();

    metadata.energyIq.ai.setSettings("default", { enabled: true }, "dev-user");
    const allowed = service.store.enqueue({ settings, period, prompt: "Make another", actorUserId: "owner" });
    await service.tick();
    await vi.waitFor(() => expect(service.store.get(settings.projectId, allowed.id).status).toBe("succeeded"));
    const usage = metadata.energyIq.ai.listUsage("default", "2000-01-01T00:00:00Z").find((entry) => entry.status === "allowed");
    expect(usage).toMatchObject({ feature: "report", projectId: "ngee-ann-polytechnic", userId: "owner", model: "deepseek-chat", inputTokens: 1200, outputTokens: 300 });
    await service.stop();
  });

  it("will not send a client's data to another provider when its chosen model is gone", () => {
    metadata.energyIq.ai.setSettings("default", { modelProfileId: "report-model-removed" }, "dev-user");
    expect(() => resolvePiReportModel(metadata, "default")).toThrow("ENERGYIQ_AI_MODEL_UNAVAILABLE");
  });

  it("keeps each person's helpful / not helpful rating, and lets the client's People admins switch AI", async () => {
    const posted = await call("owner", "POST", ["ai", "feedback"], "", { projectId: "ngee-ann-polytechnic", targetKind: "advisor", targetId: "run-1", rating: "down", comment: "Wrong month" });
    expect(posted.status).toBe(200);
    const read = await call("owner", "GET", ["ai", "feedback"], "?targetKind=advisor&targetId=run-1");
    expect((read.body as { data: { rating?: string } }).data.rating).toBe("down");
    expect((await call("owner", "POST", ["ai", "feedback"], "", { targetKind: "advisor", targetId: "run-1", rating: "meh" })).status).toBe(400);

    const own = await call("owner", "GET", ["ai", "settings"]);
    expect((own.body as { data: { enabled: boolean; canToggle: boolean } }).data).toMatchObject({ enabled: true, canToggle: false });
    expect((await call("owner", "PUT", ["ai", "settings"], "", { enabled: false })).status).toBe(403);
    const admin = await call("dev-user", "PUT", ["ai", "settings"], "", { enabled: false });
    expect((admin.body as { data: { enabled: boolean } }).data.enabled).toBe(false);
  });
});
