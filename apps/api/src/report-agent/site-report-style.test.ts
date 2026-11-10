import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseSiteReportSnapshot, type AnalysisData, type ScopeData, type TrendSeries } from "@datafoundry/site-report";
import type { ConfigApiContext } from "../routes/types.js";
import { handleReportApi } from "./report-api.js";
import { handleReportLibraryApi } from "./report-library-api.js";
import { ReportService, registerReportService } from "./report-service.js";
import type { ReportSettings } from "./report-store.js";
import { publishSiteReport } from "./site-report-generation.js";
import type { loadSiteReportData } from "./site-report-data.js";
import { reportEmailText, siteReportLinks } from "../energy/energy-report-delivery.js";

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));
vi.mock("./report-access.js", async (original) => ({ ...(await original<typeof import("./report-access.js")>()), authorizeReportConversation: authorize }));

const cleanup: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-08-16T01:00:00Z")); authorize.mockReturnValue({ canManageProject: true, canChat: true }); });
afterEach(() => { vi.useRealTimers(); authorize.mockReset(); for (const close of cleanup.splice(0)) close(); });

// One week of made-up estate lighting: two blocks, lights on 19:00–07:00 every night.
const DATES = Array.from({ length: 7 }, (_, index) => new Date(Date.parse("2026-08-10T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const night = (hour: number) => hour >= 19 || hour < 7;
const METERS: Record<string, { name: string; group: string; kwh: (hour: number) => number }> = {
  "a-corridor": { name: "12A corridor lights", group: "a", kwh: hour => night(hour) ? 0.6 : 0 },
  "a-lobby": { name: "12A lift lobby lights", group: "a", kwh: hour => night(hour) ? 0.3 : 0 },
  "b-corridor": { name: "12B corridor lights", group: "b", kwh: hour => night(hour) ? 0.6 : 0 },
  "b-lobby": { name: "12B lift lobby lights", group: "b", kwh: hour => night(hour) ? 0.36 : 0 },
};
const series = (id: string, kwh: (hour: number) => number): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh(hour), 60, 0] as TrendSeries["cells"][number])) });
const scope = (name: string, ids: string[]): ScopeData => {
  const total = series("__scope__", hour => ids.reduce((sum, id) => sum + METERS[id]!.kwh(hour), 0));
  total.expectedMinutesPerHour = ids.length * 60;
  total.cells = total.cells.map(cell => [cell[0], cell[1], cell[2], ids.length * 60, 0]);
  const usage = total.cells.reduce((sum, cell) => sum + cell[2]!, 0);
  return { id: name, name, dates: DATES, timezone: "Asia/Singapore", total, types: {}, typeTotals: {}, coverage: 100, usageKwh: usage, peakKw: null, peakAt: null,
    meters: ids.map(id => ({ id, name: METERS[id]!.name, location: name, category: "light" as const, official: true, series: series(id, METERS[id]!.kwh) })),
    cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax" } };
};
const analysisData = (): AnalysisData => {
  const ids = Object.keys(METERS);
  return {
    projectId: "project", projectName: "Harbour Estate", timezone: "Asia/Singapore", snapshotId: "snapshot-1",
    current: { project: scope("Harbour Estate", ids), spaces: [scope("Block 12A", ["a-corridor", "a-lobby"]), scope("Block 12B", ["b-corridor", "b-lobby"])] },
    previous: null, history: null, circuits: [], holidays: new Map(), actions: [], hoursMeaning: "lights_on",
    openingHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ from: "19:00", to: "07:00" }]])),
    groups: { list: [{ id: "a", name: "Block 12A", parentId: null }, { id: "b", name: "Block 12B", parentId: null }], meters: ids.map(id => ({ id, name: METERS[id]!.name, groupId: METERS[id]!.group, kwh: 7 * 12 * METERS[id]!.kwh(20) })) },
  };
};
const PERIOD = { from: "2026-08-10", toExclusive: "2026-08-17" };

function setup() {
  const root = mkdtempSync(join(tmpdir(), "site-report-style-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  cleanup.push(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
  for (const id of ["admin", "reader"]) metadata.users.upsertDevUser({ id, email: `${id}@example.test`, display_name: id, dev_token: id });
  metadata.energyIq.upsertUserRole({ user_id: "admin", role: "admin" });
  metadata.workspaces.upsert({ id: "workspace", owner_user_id: "admin", name: "workspace", kind: "customer" });
  metadata.workspaceMemberships.upsert({ workspace_id: "workspace", user_id: "reader", role: "member" });
  metadata.energyIq.upsertProject({ id: "project", workspace_id: "workspace", name: "Harbour Estate", status: "published", timezone: "Asia/Singapore" });
  const context = { metadataStore: metadata, workspaceId: "workspace", userId: "admin", fileAssetService: { getRef: () => ({}) } } as unknown as Required<ConfigApiContext>;
  const load = vi.fn<typeof loadSiteReportData>(async () => ({ data: analysisData(), dataSnapshotId: "snapshot-1" }));
  const service = new ReportService({ metadata, root, files: context.fileAssetService, harness: async () => ({ answer: "unused" }), dataGateway: {} as never, loadSiteReportData: load, authorizeProject: () => undefined });
  registerReportService(metadata, service);
  const settings: ReportSettings = { projectId: "project", workspaceId: "workspace", actorUserId: "admin", timezone: "Asia/Singapore", contextNotes: "", fileRefIds: [], useProjectData: false, skill: "Saved method", revision: 0, frequency: "weekly", localHour: 3, scheduledPrompt: "" };
  const message = (method: string, body?: unknown) => { const request = Readable.from(body ? [JSON.stringify(body)] : []) as IncomingMessage; request.method = method; request.url = "/"; return request; };
  const api = (method: string, parts: string[], body?: unknown, userId = "admin") => handleReportApi(message(method, body), ["project", ...parts], { ...context, userId });
  const library = (parts: string[] = [], userId = "reader") => handleReportLibraryApi(message("GET"), ["project", ...parts], { ...context, userId });
  return { root, metadata, service, settings, api, library, load };
}

it("keeps the full report for automatic reports unless the site chooses the management review, and remembers the choice", async () => {
  const { service, settings, api } = setup();
  const saved = service.store.saveSettings(settings);
  expect(saved.siteReportStyle).toBeUndefined();
  const { revision: _revision, ...rest } = saved;
  const body = { ...rest, revision: saved.revision };
  const chosen = await api("PUT", ["settings"], { ...body, siteReportStyle: "management" });
  expect(chosen.status).toBe(200);
  expect(service.store.settings("project")?.siteReportStyle).toBe("management");
  // An older page that does not know the choice leaves it as it was.
  const latest = service.store.settings("project")!;
  const { siteReportStyle: _style, ...older } = latest;
  expect((await api("PUT", ["settings"], { ...older, scheduledPrompt: "Watch the lift lobbies" })).status).toBe(200);
  expect(service.store.settings("project")).toMatchObject({ siteReportStyle: "management", scheduledPrompt: "Watch the lift lobbies" });
  expect((await api("PUT", ["settings"], { ...service.store.settings("project")!, siteReportStyle: "fancy" })).status).toBe(400);
});

it("writes the scheduled report in the chosen style and marks only the management review", async () => {
  const { service, settings, root } = setup();
  const full = await publishSiteReport({ metadata: {} as never, dataGateway: {} as never, store: service.store, root, settings, cadence: "weekly", period: PERIOD, generatedAt: "2026-08-17T02:00:00Z", loadData: async () => ({ data: analysisData(), dataSnapshotId: null }) });
  expect(full.run.siteReport).toEqual({ cadence: "weekly" });
  expect(readFileSync(join(root, full.run.id, "accepted-output.txt"), "utf8")).toContain("Energy Report");
  const review = await publishSiteReport({ metadata: {} as never, dataGateway: {} as never, store: service.store, root, settings: { ...settings, siteReportStyle: "management" }, cadence: "monthly", period: { from: "2026-07-01", toExclusive: "2026-08-01" }, generatedAt: "2026-08-01T02:00:00Z", loadData: async () => ({ data: analysisData(), dataSnapshotId: null }) });
  expect(review.run.siteReport).toEqual({ cadence: "monthly", style: "management" });
  expect(review.run.prompt).toContain("Monthly site management review");
  const html = readFileSync(join(root, review.run.id, "accepted-output.txt"), "utf8");
  expect(html).toContain("Harbour Estate Energy Review");
  expect(html).toContain("Block 12B against Block 12A");
  const snapshot = parseSiteReportSnapshot(JSON.parse(readFileSync(join(root, review.run.id, "outputs", "site-report-input.json"), "utf8")));
  expect(snapshot.style).toBe("management");
  expect(snapshot.cadence).toBe("monthly");
});

it("creates a custom report on chosen dates in the chosen style, listed as a custom site report for everyone", async () => {
  const { api, library, load, service } = setup();
  const created = await api("POST", ["site-reports"], { period: PERIOD, style: "management" }, "reader");
  expect(created.status).toBe(201);
  const id = (created.body as { data: { id: string } }).data.id;
  // The report reads what the person asking may read, for exactly the dates they chose.
  expect(load).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: "reader", period: PERIOD, projectId: "project" }));
  const listed = ((await library()).body as { data: { reports: Array<Record<string, unknown>> } }).data.reports.find(report => report.id === id)!;
  expect(listed).toMatchObject({ source: "site", category: "custom", style: "management", title: "Custom Management Review — 10 August 2026 to 16 August 2026" });
  expect(listed.cadence).toBeUndefined();
  const page = ((await library(["output", id])).body as { data: { content: string } }).data.content;
  expect(page).toContain("The things worth deciding");
  expect(parseSiteReportSnapshot(((await library(["snapshot", id])).body as { data: { snapshot: unknown } }).data.snapshot).cadence).toBe("custom");
  // Asking without a style gives today's full report; asking twice saves two.
  const plain = await api("POST", ["site-reports"], { period: PERIOD });
  const plainId = (plain.body as { data: { id: string } }).data.id;
  const plainListed = ((await library()).body as { data: { reports: Array<Record<string, unknown>> } }).data.reports.find(report => report.id === plainId)!;
  expect(plainListed).toMatchObject({ category: "custom", title: "Custom Site Report — 10 August 2026 to 16 August 2026" });
  expect(plainListed.style).toBeUndefined();
  expect(service.store.list("project").filter(run => run.siteReport)).toHaveLength(2);
  // A custom report never becomes a scheduled slot or a "report ready" alert.
  expect(service.store.list("project").every(run => !run.scheduleKey)).toBe(true);
});

it("refuses custom reports with bad dates, too long a stretch, or without permission", async () => {
  const { api } = setup();
  expect((await api("POST", ["site-reports"], { period: { from: "2026-08-17", toExclusive: "2026-08-10" } })).status).toBe(400);
  expect((await api("POST", ["site-reports"], { period: { from: "2026-01-01", toExclusive: "2026-06-01" } })).body).toMatchObject({ error: { message: "SITE_REPORT_PERIOD_TOO_LONG" } });
  expect((await api("POST", ["site-reports"], { period: { from: "10 Aug", toExclusive: "2026-08-17" } })).status).toBe(400);
  authorize.mockReturnValue({ canManageProject: false, canChat: false });
  expect((await api("POST", ["site-reports"], { period: PERIOD }, "reader")).status).toBe(403);
});

it("links each site's own report, in its chosen style, from the scheduled email", async () => {
  const { service, settings, root, metadata } = setup();
  await publishSiteReport({ metadata: {} as never, dataGateway: {} as never, store: service.store, root, settings: { ...settings, siteReportStyle: "management" }, cadence: "weekly", period: PERIOD, generatedAt: "2026-08-17T02:00:00Z", loadData: async () => ({ data: analysisData(), dataSnapshotId: null }) });
  const portfolio = { workspaceName: "Harbour Town Council", sites: [{ projectId: "project", name: "Harbour Estate" }, { projectId: "elsewhere", name: "Elsewhere" }], totals: { usageKwh: 100, previousUsageKwh: 0, costByCurrency: {}, carbonKg: 40, sitesOverBudget: 0, sitesAtRisk: 0 } } as never;
  const schedule = { name: "Weekly summary", frequency: "weekly" } as never;
  const period = { from: "2026-08-10", to: "2026-08-16", key: "week:2026-08-10", dueDate: "2026-08-17" };
  const links = siteReportLinks(metadata, portfolio, "weekly", period, "https://energy.example.test/");
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({ name: "Harbour Estate", style: "management" });
  expect(links[0]!.url).toMatch(/^https:\/\/energy\.example\.test\/energyiq\/library\?projectId=project&reportId=[a-f0-9-]{36}$/);
  const text = reportEmailText(portfolio, schedule, period, "https://energy.example.test", links);
  expect(text).toContain("Each site's own report for this week:");
  expect(text).toContain("- Harbour Estate (management review): https://energy.example.test/energyiq/library?projectId=project&reportId=");
  expect(reportEmailText(portfolio, schedule, period, "https://energy.example.test")).not.toContain("Each site's own report");
});
