import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { validateWorkerTree } from "./pi-report-harness.js";
import { DatabaseSync } from "node:sqlite";
import { ReportService, assertReportMeterNames } from "./report-service.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MetadataStore } from "@datafoundry/metadata";
import type { FileAssetService } from "@datafoundry/files";
import type { ReportRun } from "./report-store.js";
const mocks = vi.hoisted(() => ({ access: vi.fn(), query: vi.fn(), route: vi.fn(), ensure: vi.fn(), export: vi.fn() }));
vi.mock("@datafoundry/data-gateway", () => ({ ensureEnergyScopedDataSource: mocks.ensure, exportEnergyScopedCsv: mocks.export }));
vi.mock("../energy/energy-query-context.js", () => ({ resolveEnergyAccessContext: mocks.access, resolveEnergyQueryContext: mocks.query, resolveEnergyPublishedMeterRoute: mocks.route, resolveEnergyPublishedHierarchyNodes: () => [{ id: "project", name: "Office" }] }));
// Input packaging uses a controlled authorization seam; real membership/grant checks
// are covered by the capability and report-library API integration tests.
vi.mock("../energy/energy-project-capabilities.js", () => ({ resolveEnergyProjectCapabilities: ({ metadataStore, userId, workspaceId, projectId }: any) => {
  const access = mocks.access();
  const allowed = !metadataStore.users.getById({ user_id: userId }).disabled_at && access.activeWorkspaceId === workspaceId && access.projects.some((project: any) => project.id === projectId && project.workspaceId === workspaceId);
  return { readOwnHistory: allowed, createReport: allowed, manageSkills: allowed, publishConfiguration: allowed && access.role === "admin" };
} }));
import { compressReportDataset, prepareReportInputs } from "./report-inputs.js";
let root: string;
let snapshot: string;
let disabled: boolean;
let snapshotExists: boolean;
const metadata = { users: { getById: () => ({ disabled_at: disabled ? "disabled" : undefined }) }, energyIq: { projectSetup: { listHierarchyRevisions: () => [{id:"h1",snapshot_json:JSON.stringify({meter_mapping:{schema_version:2,confirmed:true,rows:[{id:"meter-1",display_name:"Meter 01",presentation:{device_name:"Showroom display"},resource:"electricity",scope_id:"room",meter_role:"sub",coverage:"partial",category:"lighting"}]}})}] }, findCurrentDataSnapshot: () => snapshotExists ? { id: snapshot } : undefined, templates: { getLatestProjectRevision: () => undefined }, getProject: () => ({ name: "Office", timezone: "Asia/Singapore", data_snapshot_id: snapshot }) } } as unknown as MetadataStore;
const files = { getRef: vi.fn(), materializeRefToPath: vi.fn() } as unknown as FileAssetService;
function run(): ReportRun { return { id: "run", sessionId: "session", projectId: "p", workspaceId: "w", actorUserId: "u", status: "queued", kind: "report", period: { from: "2026-09-10", toExclusive: "2026-09-11" }, prompt: "Analyze", createdAt: "2026-09-11", settings: { projectId: "p", workspaceId: "w", actorUserId: "u", timezone: "Asia/Singapore", contextNotes: "Office", fileRefIds: [], useProjectData: true, skill: "", revision: 1, frequency: "off", localHour: 1, scheduledPrompt: "" } }; }
beforeEach(() => {
  vi.clearAllMocks(); root = mkdtempSync(join(tmpdir(), "report-inputs-")); snapshot = "snapshot-1"; snapshotExists = true; disabled = false;
  mocks.access.mockReturnValue({ role: "admin", activeWorkspaceId: "w", projects: [{ id: "p", workspaceId: "w" }] });
  mocks.query.mockImplementation(({ request }) => ({ workspaceId: "w", projectId: "p", scopeId: "project", timezone: "Asia/Singapore", dataSnapshotId: "snapshot-1", hierarchyRevisionId: "h1", meterMappingRevisionId: "m1", from: `${request.from}T00:00:00+08:00`, to: new Date(Date.parse(`${request.to}T00:00:00+08:00`) + 86400000).toISOString() }));
  mocks.route.mockReturnValue({ attachments: [{ meterPointId: "main", scopeId: "project", officialAggregation: true }, { meterPointId: "missing", scopeId: "project", officialAggregation: false }] });
  mocks.ensure.mockResolvedValue({});
  mocks.export.mockImplementation(async (_source, path) => { writeFileSync(path, "usage_kwh\n1\n"); return { rows: 1, bytes: 12, sha256: "hash", firstIntervalStart: "2026-09-10T00:00:00Z", actualLastIntervalEnd: "2026-09-10T00:15:00Z", meters: [{ meterPointId: "main", observedMinutes: 15, validMinutes: 15, rows: 1 }] }; });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
describe("report input package", () => {
  it("opts new measured full reports into a source-pinned analysis contract", async () => {
    vi.stubEnv("ENERGYIQ_ANALYSIS_PACKAGE_V1", "true");
    try {
      await prepareReportInputs(run(), root, metadata, files);
      const raw = readFileSync(join(root,"inputs/manifest.json"));
      expect(JSON.parse(raw.toString()).dataInstructions).toContain("quality_status in ('ok', 'gap')");
      expect(JSON.parse(raw.toString()).dataInstructions).toContain("elapsed_minutes=15");
      expect(JSON.parse(raw.toString()).dataInstructions).not.toContain("totals include only official_aggregation_eligible and quality_status=ok");
      expect(JSON.parse(readFileSync(join(root,"inputs/analysis-contract.json"),"utf8"))).toMatchObject({
        runId:"run",projectId:"p",workspaceId:"w",schemaVersion:1,
        inputManifestHash:createHash("sha256").update(raw).digest("hex"),
      });
    } finally { vi.unstubAllEnvs(); }
  });
  it("freezes project spatial geometry and offline SVG with digests without another upload", async () => {
    const input = run();
    const ref = {schemaVersion:1,projectId:"p",provenance:{file:"site.html",status:"reference-derived"},layout:{viewBox:[0,0,800,500],zones:[{id:"A",referenceBoard:"DB1",rect:[10,10,300,300]}],rooms:[{name:"Office",zone:"A",rect:[20,60,200,150]}]}};
    input.settings.contextNotes = "```json\n" + JSON.stringify(ref) + "\n```";
    await prepareReportInputs(input, root, metadata, files);
    const manifest = JSON.parse(readFileSync(join(root,"inputs/manifest.json"),"utf8"));
    expect(manifest.spatialReference.dataFile).toBe("project-spatial-reference.json");
    const svg = readFileSync(join(root,"inputs/project-spatial-reference.svg"),"utf8");
    expect(svg).toContain("Office");
    expect(manifest.projectFiles).toContainEqual({filename:"project-spatial-reference.svg",sha256:createHash("sha256").update(svg).digest("hex")});
    expect(JSON.parse(readFileSync(join(root,"inputs/project-spatial-reference.json"),"utf8"))).toEqual(ref);
  });
  it("exports the exact project style and its digest for both scheduled and conversational runs", async () => {
    const input = run();
    input.settings.styleSkill = { id: "office-style", name: "Office style", version: "3", content: "Use navy headings, never school artwork." };
    await prepareReportInputs(input, root, metadata, files);
    expect(readFileSync(join(root, "inputs", "project-style.md"), "utf8")).toBe(input.settings.styleSkill.content);
    const manifest = JSON.parse(readFileSync(join(root, "inputs", "manifest.json"), "utf8"));
    expect(manifest.skills).toContainEqual(expect.objectContaining({ id: "office-style", version: "3", inputPath: "project-style.md", contentHash: createHash("sha256").update(input.settings.styleSkill.content).digest("hex") }));
    expect(manifest.projectFiles).toContainEqual(expect.objectContaining({ filename: "project-style.md" }));
  });
  it("exports distinct current and bounded history windows with absent meters and actual cutoff", async () => {
    await prepareReportInputs(run(), root, metadata, files);
    const manifest = JSON.parse(readFileSync(join(root, "inputs/manifest.json"), "utf8"));
    expect(mocks.query.mock.calls.map(([arg]) => arg.request)).toMatchObject([{ from: "2026-09-10", to: "2026-09-10" }, { from: "2026-08-13", to: "2026-09-09" }]);
    expect(manifest.datasets.map((x: { filename: string }) => x.filename)).toEqual(["meter-intervals.csv", "history.csv"]);
    expect(manifest.datasets[0]).toMatchObject({ actualLastIntervalEnd: "2026-09-10T00:15:00Z", coverage: [{ status: "partial", expectedMinutes: 1440 }, { status: "no_intervals", validMinutes: 0, validCoverageRatio: 0 }] });
    const configuration = JSON.parse(readFileSync(join(root, "inputs/project-configuration.json"), "utf8"));
    expect(mocks.export.mock.calls[0]?.[2]).toEqual({"meter-1":"Showroom display"});
    expect(configuration.meterDisplayNames).toContainEqual({meterId:"meter-1",displayName:"Showroom display",scopeId:"room"});
    expect(configuration).toMatchObject({ basis: "published_configuration", dataSnapshotId: "snapshot-1", hierarchyRevisionId: "h1", tariff: { status: "not_configured" } });
    expect(manifest.projectFiles.map((item: { filename: string }) => item.filename)).toContain("project-configuration.json");
    const presentation = readFileSync(join(root, "inputs/report-presentation.md"), "utf8");
    expect(presentation).toContain("Open with 3–4 important conclusions");
    expect(manifest.projectFiles).toContainEqual({ filename: "report-presentation.md", sha256: createHash("sha256").update(presentation).digest("hex") });
    expect(manifest).toMatchObject({ dataSnapshotId: "snapshot-1", reportLanguage: "en", sessionId: "session" });
  });
  it("uses an explicitly requested comparison window instead of implicit history", async () => {
    const input = run(); input.settings.comparisonPeriod = { from: "2026-09-01", toExclusive: "2026-09-03" };
    await prepareReportInputs(input, root, metadata, files);
    expect(mocks.query.mock.calls[1]![0].request).toMatchObject({ from: "2026-09-01", to: "2026-09-02" });
    expect(existsSync(join(root, "inputs/comparison-meter-intervals.csv"))).toBe(true);
    expect(existsSync(join(root, "inputs/history.csv"))).toBe(false);
  });
  it("rejects project and disabled-user access before creating input files", async () => {
    mocks.access.mockReturnValue({ role: "admin", activeWorkspaceId: "w", projects: [] });
    await expect(prepareReportInputs(run(), root, metadata, files)).rejects.toThrow("REPORT_PROJECT_FORBIDDEN");
    expect(mocks.export).not.toHaveBeenCalled(); expect(existsSync(join(root, "inputs"))).toBe(false);
    disabled = true;
    await expect(prepareReportInputs(run(), root, metadata, files)).rejects.toThrow("REPORT_PROJECT_FORBIDDEN");
  });
  it("fails without a completed manifest if publication changes during export", async () => {
    mocks.export.mockImplementationOnce(async () => { snapshot = "snapshot-2"; return { meters: [] }; });
    await expect(prepareReportInputs(run(), root, metadata, files)).rejects.toThrow("REPORT_DATA_CHANGED_RETRY");
    expect(existsSync(join(root, "inputs/manifest.json"))).toBe(false);
  });
  it("resolves attachments with the current run actor rather than a saved settings owner", async () => {
    const input = run(); input.settings.actorUserId = "other-admin"; input.settings.fileRefIds = ["private-file"];
    vi.mocked(files.getRef).mockImplementation(() => { throw new Error("FILE_NOT_FOUND"); });
    await expect(prepareReportInputs(input, root, metadata, files)).rejects.toThrow("FILE_NOT_FOUND");
    expect(files.getRef).toHaveBeenCalledWith({ user_id: "u", workspace_id: "w", id: "private-file" });
    expect(existsSync(join(root, "inputs/manifest.json"))).toBe(false);
  });
});

describe("conversation without measured inputs", () => {
  it("prepares context and an explicit missing-data manifest and reaches the chat harness", async () => {
    const input = run(); input.kind = "chat"; input.settings.useProjectData = false;
    const db = new DatabaseSync(join(root, "metadata.sqlite"));
    const harness = vi.fn(async ({ directory }: { directory: string }) => {
      const manifest = JSON.parse(readFileSync(join(directory, "inputs/manifest.json"), "utf8"));
      expect(manifest.dataAvailability).toBe("no_measured_data_available");
      expect(manifest.dataInstructions).toMatch(/no measured data available/i);
      expect(manifest.dataInstructions).toMatch(/do not invent/i);
      expect(manifest.attachments).toEqual([]);
      expect(readFileSync(join(directory, "inputs/project-context.md"), "utf8")).toBe("Office");
      return { answer: "I am the configured report assistant", sessionId: "pi-chat" };
    });
    const service = new ReportService({ root, metadata: { ...metadata, db } as MetadataStore, files, harness });
    try {
      const queued = service.store.enqueue({ settings: input.settings, period: input.period, prompt: "What model are you?", actorUserId: "u", kind: "chat" });
      service.start(); await service.tick();
      await vi.waitFor(() => expect(service.store.get("p", queued.id).status).not.toBe("running"));
      expect(service.store.get("p", queued.id).errorCode).toBeUndefined();
      expect(service.store.get("p", queued.id)).toMatchObject({ status: "succeeded", answer: "I am the configured report assistant" });
      expect(harness).toHaveBeenCalledOnce();
      expect(mocks.export).not.toHaveBeenCalled();
    } finally { await service.stop(); db.close(); }
  });
});


describe("missing-data boundaries", () => {
  it.each([false,true])("allows initialization chat before configuration publication with staged data=%s", async (hasSnapshot) => {
    snapshot = "placeholder-before-import"; snapshotExists = hasSnapshot;
    const input = run(); input.kind = "chat";
    await prepareReportInputs(input, root, metadata, files);
    expect(mocks.export).not.toHaveBeenCalled();
    expect(input.settings.useProjectData).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "inputs/manifest.json"), "utf8"))).toMatchObject({ dataAvailability: "project_not_initialized" });
  });
  it("allows conversation-derived Skill inputs without meter data", async () => {
    const input = run(); input.kind = "skill"; input.settings.useProjectData = false;
    await prepareReportInputs(input, root, metadata, files);
    expect(JSON.parse(readFileSync(join(root, "inputs/manifest.json"), "utf8"))).toMatchObject({ dataAvailability: "no_measured_data_available", datasets: [], attachments: [] });
  });
  it("retains the data gate for explicit reports", async () => {
    const input = run(); input.settings.useProjectData = false;
    await expect(prepareReportInputs(input, root, metadata, files)).rejects.toThrow("REPORT_DATA_INPUT_REQUIRED");
    expect(existsSync(join(root, "inputs/manifest.json"))).toBe(false);
  });
  it.each(["chat", "skill"] as const)("still rejects unauthorized %s without data", async (kind) => {
    const input = run(); input.kind = kind; input.settings.useProjectData = false;
    mocks.access.mockReturnValue({ role: "admin", activeWorkspaceId: "w", projects: [] });
    await expect(prepareReportInputs(input, root, metadata, files)).rejects.toThrow("REPORT_PROJECT_FORBIDDEN");
    expect(existsSync(join(root, "inputs"))).toBe(false);
  });
  it.each(["chat", "skill"] as const)("does not silently ignore a selected bad attachment for %s", async (kind) => {
    const input = run(); input.kind = kind; input.settings.useProjectData = false; input.settings.fileRefIds = ["bad-file"];
    vi.mocked(files.getRef).mockImplementation(() => { throw new Error("FILE_NOT_FOUND"); });
    await expect(prepareReportInputs(input, root, metadata, files)).rejects.toThrow("FILE_NOT_FOUND");
    expect(existsSync(join(root, "inputs/manifest.json"))).toBe(false);
  });
});

describe("large historical input transport", () => {
  it("preserves a 115 MiB dataset byte-for-byte while fitting the existing worker limit", async () => {
    const source = Buffer.alloc(115 * 1024 * 1024, "meter,2026-05-01,1.25\n");
    const sha256 = createHash("sha256").update(source).digest("hex");
    writeFileSync(join(root,"meter-intervals.csv"),source);
    expect(() => validateWorkerTree(root)).toThrow("REPORT_WORKER_FILES_TOO_LARGE");
    const result = await compressReportDataset(root,"meter-intervals.csv",{bytes:source.length,sha256});
    expect(result).toMatchObject({filename:"meter-intervals.csv.gz",compression:"gzip",uncompressedBytes:source.length,uncompressedSha256:sha256});
    const compressed = readFileSync(join(root,"meter-intervals.csv.gz"));
    expect(createHash("sha256").update(compressed).digest("hex")).toBe(result.sha256);
    expect(createHash("sha256").update(gunzipSync(compressed)).digest("hex")).toBe(sha256);
    expect(existsSync(join(root,"meter-intervals.csv"))).toBe(false);
    expect(() => validateWorkerTree(root)).not.toThrow();
  });
});

describe("published meter naming gate", () => {
  it("blocks generic identities and accepts the same updated names Explorer renders", async () => {
    const { projectMeterNamingReadiness, projectExplorerMeters } = await import("../energy/energy-explorer-meters.js");
    const document = JSON.parse(metadata.energyIq.projectSetup.listHierarchyRevisions("p")[0]!.snapshot_json);
    document.meter_mapping.rows[0].presentation.device_name = "Meter 03";
    const blocked = projectMeterNamingReadiness(document);
    expect(blocked.ready).toBe(false);
    expect(blocked.missing[0]!.meterId).toBe("meter-1");
    await prepareReportInputs(run(), root, metadata, files);
    const path = join(root, "inputs", "project-configuration.json");
    writeFileSync(path, JSON.stringify({meterNamingReadiness: blocked}));
    expect(() => assertReportMeterNames(root)).toThrow("REPORT_METER_NAMES_REQUIRED");
    for (const label of ["Office lighting", "DB1 total electricity", "Fridge and water dispenser"]) {
      document.meter_mapping.rows[0].presentation.device_name = label;
      const ready = projectMeterNamingReadiness(document);
      expect(ready.ready).toBe(true);
      expect(projectExplorerMeters({document,resource:"electricity",scopeIds:new Set(["room"]),officialMeterIds:new Set()})[0]!.name).toBe(label);
      writeFileSync(path, JSON.stringify({meterNamingReadiness: ready}));
      expect(() => assertReportMeterNames(root)).not.toThrow();
    }
    document.meter_mapping.confirmed = false;
    expect(projectMeterNamingReadiness(document).ready).toBe(false);
  });
});

describe("report execution naming boundary", () => {
  it("does not spend a model call on unnamed published meters and returns a concrete question", async () => {
    const original = metadata.energyIq.projectSetup.listHierarchyRevisions;
    const document = JSON.parse(original("p")[0]!.snapshot_json);
    document.meter_mapping.rows[0].presentation.device_name = "Meter 03";
    const revision = vi.spyOn(metadata.energyIq.projectSetup, "listHierarchyRevisions").mockReturnValue([{...original("p")[0]!, snapshot_json: JSON.stringify(document)}]);
    const db = new DatabaseSync(join(root, "naming.sqlite"));
    const harness = vi.fn(async () => ({answer:"should not execute"}));
    const input = run();
    const service = new ReportService({root, metadata: {...metadata, db} as MetadataStore, files, harness});
    try {
      const queued = service.store.enqueue({settings:input.settings,period:input.period,prompt:"Generate report",actorUserId:"u",kind:"report"});
      service.start(); await service.tick();
      await vi.waitFor(() => expect(service.store.get("p",queued.id).status).toBe("failed"));
      expect(service.store.get("p",queued.id)).toMatchObject({errorCode:"REPORT_METER_NAMES_REQUIRED",answer:expect.stringContaining("Meter 01")});
      expect(harness).not.toHaveBeenCalled();
      expect(existsSync(join(root,queued.id,"accepted-output.txt"))).toBe(false);
    } finally { await service.stop(); revision.mockRestore(); db.close(); }
  });
});

describe("supporting windows for questions about other dates", () => {
  it("covers every available reading before and after the chosen dates, up to about 13 months each way", async () => {
    const periods = await import("./report-periods.js");
    const spy = vi.spyOn(periods, "availableReportPeriod").mockResolvedValue({ from: "2025-01-01", toExclusive: "2026-09-20", actualLastIntervalEnd: null });
    try {
      const { supportingWindows } = await import("./report-inputs.js");
      expect(await supportingWindows(run(), metadata, files)).toEqual([
        ["history", { from: "2025-08-06", toExclusive: "2026-09-10" }],
        ["later", { from: "2026-09-11", toExclusive: "2026-09-20" }],
      ]);
      spy.mockResolvedValue({ from: "2026-08-16", toExclusive: "2026-09-11", actualLastIntervalEnd: null });
      expect(await supportingWindows(run(), metadata, files)).toEqual([["history", { from: "2026-08-16", toExclusive: "2026-09-10" }]]);
    } finally { spy.mockRestore(); }
  });
});
