import { createMetadataStore } from "@datafoundry/metadata";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { parseSiteReportSnapshot, type AnalysisData, type ScopeData, type ScopeMeter, type TrendSeries } from "@datafoundry/site-report";
import type { ConfigApiContext } from "../routes/types.js";
import { handleReportLibraryApi } from "./report-library-api.js";
import { ReportService, registerReportService } from "./report-service.js";
import type { ReportSettings } from "./report-store.js";
import { publishSiteReport, siteReportScheduleKey } from "./site-report-generation.js";
import type { loadSiteReportData } from "./site-report-data.js";

const cleanup: Array<() => void> = [];
afterEach(() => { vi.restoreAllMocks(); for (const close of cleanup.splice(0)) close(); });

// Two weeks from Monday 3 August 2026, open Monday to Friday, mirroring the office fixture the page is checked with.
const DATES = Array.from({ length: 14 }, (_, index) => new Date(Date.parse("2026-08-03T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
const open = (date: string, hour: number) => !weekend(date) && hour >= 9 && hour < 18;
const series = (id: string, kwh: (date: string, hour: number) => number): TrendSeries => ({
  id, expectedMinutesPerHour: 60,
  cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh(date, hour), 60, 0] as TrendSeries["cells"][number])),
});
const PROFILES: Record<string, { name: string; board: string; category: ScopeMeter["category"]; kwh: (date: string, hour: number) => number }> = {
  "db1-light": { name: "DB1 L1 Light", board: "DB1", category: "light", kwh: (date, hour) => open(date, hour) ? 2 : 0.05 },
  "db1-power": { name: "DB1 L1 Power", board: "DB1", category: "load", kwh: (date, hour) => open(date, hour) ? 0.4 : 0.3 },
  "db2-power": { name: "DB2 L2 Power", board: "DB2", category: "load", kwh: (date, hour) => open(date, hour) ? 1.95 : 1.9 },
};
const scope = (name: string, ids: string[]): ScopeData => {
  const total = series("__scope__", (date, hour) => ids.reduce((sum, id) => sum + PROFILES[id]!.kwh(date, hour), 0));
  const usage = total.cells.reduce((sum, cell) => sum + cell[2]!, 0);
  return { id: name, name, dates: DATES, timezone: "Asia/Singapore", total, types: {},
    meters: ids.map(id => ({ id, name: PROFILES[id]!.name, location: PROFILES[id]!.board, category: PROFILES[id]!.category, official: true, series: series(id, PROFILES[id]!.kwh) })),
    usageKwh: usage, peakKw: null, peakAt: null, cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax" }, typeTotals: {}, coverage: 100 };
};
const analysisData = (): AnalysisData => ({
  projectId: "project", projectName: "Tuya Office", timezone: "Asia/Singapore", snapshotId: "snapshot-1",
  current: { project: scope("Tuya Office", Object.keys(PROFILES)), spaces: [scope("Space 1 - Office Area", ["db1-light", "db1-power"])] },
  previous: null, history: null, circuits: [],
  holidays: new Map([["2026-08-09", "National Day"]]),
  openingHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map(day => [day, [{ from: "09:00", to: "18:00" }]])),
  actions: [],
});

const PERIOD = { from: "2026-08-03", toExclusive: "2026-08-17" };

function setup(options: { loadSiteReportData?: typeof loadSiteReportData } = {}) {
  const root = mkdtempSync(join(tmpdir(), "site-report-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  cleanup.push(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
  for (const id of ["admin", "reader"]) metadata.users.upsertDevUser({ id, email: `${id}@example.test`, display_name: id, dev_token: id });
  metadata.energyIq.upsertUserRole({ user_id: "admin", role: "admin" });
  metadata.workspaces.upsert({ id: "workspace", owner_user_id: "admin", name: "workspace", kind: "customer" });
  metadata.workspaceMemberships.upsert({ workspace_id: "workspace", user_id: "reader", role: "member" });
  metadata.energyIq.upsertProject({ id: "project", workspace_id: "workspace", name: "project", status: "published" });
  const context = { metadataStore: metadata, workspaceId: "workspace", userId: "reader", fileAssetService: {} } as Required<ConfigApiContext>;
  const load: typeof loadSiteReportData = options.loadSiteReportData ?? (async () => ({ data: analysisData(), dataSnapshotId: "snapshot-1" }));
  const service = new ReportService({
    metadata, root, files: context.fileAssetService, harness: async () => ({ answer: "unused" }),
    dataGateway: {} as never, loadSiteReportData: load,
    authorizeProject: () => undefined,
    availablePeriod: async () => ({ from: "2026-01-01", toExclusive: "2026-09-01" }) as never,
  });
  registerReportService(metadata, service);
  const settings: ReportSettings = {
    projectId: "project", workspaceId: "workspace", actorUserId: "admin", timezone: "Asia/Singapore",
    contextNotes: "", fileRefIds: [], useProjectData: false, skill: "Saved reusable method", revision: 0,
    frequency: "weekly", localHour: 3, scheduledPrompt: "Write the usual report",
  };
  const request = (method = "GET") => { const message = Readable.from([]) as IncomingMessage; message.method = method; return message; };
  const call = (segments: string[] = ["project"], userId = "reader") => handleReportLibraryApi(request(), segments, { ...context, userId });
  const publish = (overrides: Partial<Parameters<typeof publishSiteReport>[0]> = {}) => publishSiteReport({
    metadata, dataGateway: {} as never, store: service.store, root, settings, cadence: "weekly", period: PERIOD,
    generatedAt: "2026-08-17T02:00:00Z", loadData: load, ...overrides,
  });
  return { root, metadata, service, settings, context, call, publish };
}

it("gives the site report its own scheduled slot, so it never collides with the advisor's report", () => {
  const key = siteReportScheduleKey("project", "weekly", PERIOD);
  expect(key).toBe("project:site-weekly:2026-08-03:2026-08-17");
  expect(key).not.toBe(`project:weekly:${PERIOD.from}:${PERIOD.toExclusive}`);
  expect(siteReportScheduleKey("project", "monthly", PERIOD)).not.toBe(key);
});

it("publishes one report per period however often the schedule wakes up", async () => {
  const { publish, service } = setup();
  const first = await publish();
  expect(first.created).toBe(true);
  const again = await publish();
  expect(again.created).toBe(false);
  expect(again.run.id).toBe(first.run.id);
  const rows = service.store.list("project").filter(run => run.siteReport);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.status).toBe("succeeded");
  expect(rows[0]!.siteReport).toEqual({ cadence: "weekly" });
});

it("refuses a second record for a slot that is already taken, whatever the caller passes", () => {
  const { service, settings } = setup();
  const insert = () => service.store.insertCompleted({
    settings, period: PERIOD, reportingPeriod: PERIOD, prompt: "Weekly site energy report",
    actorUserId: "admin", scheduleKey: "project:site-weekly:2026-08-03:2026-08-17", siteReport: { cadence: "weekly" },
  });
  const first = insert();
  const second = insert();
  expect(first.created).toBe(true);
  expect(second.created).toBe(false);
  expect(second.run.id).toBe(first.run.id);
  expect(service.store.list("project")).toHaveLength(1);
  expect(service.store.findByScheduleKey("project:site-weekly:2026-08-03:2026-08-17")?.id).toBe(first.run.id);
  expect(service.store.latestSiteReport("project", "weekly")?.id).toBe(first.run.id);
  expect(service.store.latestSiteReport("project", "monthly")).toBeUndefined();
});

it("saves the finished page and the readings it was built from, side by side", async () => {
  const { publish, root } = setup();
  const { run } = await publish();
  const html = readFileSync(join(root, run.id, "accepted-output.txt"), "utf8");
  expect(html).toMatch(/<html[\s>]/i);
  expect(html).toMatch(/<\/html\s*>/i);
  expect(html).toContain("Tuya Office");
  const snapshot = parseSiteReportSnapshot(JSON.parse(readFileSync(join(root, run.id, "outputs", "site-report-input.json"), "utf8")));
  expect(snapshot.cadence).toBe("weekly");
  expect(snapshot.language).toBe("en");
  expect(snapshot.period).toEqual(PERIOD);
  expect(snapshot.generatedAt).toBe("2026-08-17T02:00:00Z");
  // The closures survive the trip to disk and back as a lookup, not as a bare list.
  expect(snapshot.data.holidays.get("2026-08-09")).toBe("National Day");
  expect(snapshot.data.current.project.dates).toEqual(DATES);
});

it("leaves nothing behind when the readings cannot be loaded", async () => {
  const { publish, root, service } = setup();
  await expect(publish({ loadData: async () => { throw new Error("ENERGYIQ_PROJECT_FORBIDDEN"); } })).rejects.toThrow("ENERGYIQ_PROJECT_FORBIDDEN");
  expect(service.store.list("project")).toHaveLength(0);
  expect(existsSync(join(root, "outputs"))).toBe(false);
});

it("publishes the due site report and lets any workspace member read the page and the readings", async () => {
  const { service, settings, call } = setup();
  service.store.saveSettings(settings);
  service.start();
  // start() already fired a tick on the real clock; let it settle so the scheduled date below is the one used.
  await service.tick();
  // Monday 17 August 2026, 09:00 in Singapore: the week that ended that morning is due.
  await service.tick(new Date("2026-08-17T01:00:00Z"));
  await service.settleSiteReports();
  await service.stop();

  const library = (await call()).body as { data: { reports: Array<Record<string, unknown>> } };
  const report = library.data.reports.find(item => item.source === "site");
  expect(report).toBeDefined();
  expect(Object.keys(report!).sort()).toEqual(["cadence", "canDiscuss", "category", "createdAt", "finishedAt", "id", "kind", "period", "source", "title", "version"]);
  expect(report!.cadence).toBe("weekly");
  expect(report!.category).toBe("scheduled");
  expect(report!.period).toEqual({ from: "2026-08-10", toExclusive: "2026-08-17" });
  expect(report!.title).toBe("Weekly Site Report — 10 August 2026 to 16 August 2026");

  const page = (await call(["project", "output", String(report!.id)])).body as { data: { content: string } };
  expect(page.data.content).toMatch(/<html[\s>]/i);
  const snapshot = (await call(["project", "snapshot", String(report!.id)])).body as { data: { snapshot: unknown } };
  expect(parseSiteReportSnapshot(snapshot.data.snapshot).cadence).toBe("weekly");
});

it("keeps the advisor's own scheduled report and the project's schedule when the site report cannot be written", async () => {
  const { service, settings, call } = setup({ loadSiteReportData: async () => { throw new Error("ENERGYIQ_PROJECT_FORBIDDEN"); } });
  service.store.saveSettings(settings);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  service.start();
  await service.tick();
  await service.tick(new Date("2026-08-17T01:00:00Z"));
  await service.settleSiteReports();
  await service.stop();

  // A forbidden site report must not be mistaken for the owner losing access to the project.
  expect(service.store.settings("project")?.frequency).toBe("weekly");
  expect(service.store.settings("project")?.schedulePermissionIssue).toBeUndefined();
  const advisor = service.store.list("project").filter(run => !run.siteReport);
  expect(advisor).toHaveLength(1);
  expect(advisor[0]!.prompt).toContain("Write the usual report");
  expect(((await call()).body as { data: { reports: unknown[] } }).data.reports.filter(item => (item as { source: string }).source === "site")).toHaveLength(0);
});

it("does not let the advisor continue from a site report, which is a page rather than a conversation", async () => {
  const { publish, service, settings } = setup();
  const { run } = await publish();
  expect(() => service.store.enqueue({ settings, actorUserId: "admin", period: PERIOD, prompt: "Tell me more", kind: "chat", parentRunId: run.id }))
    .toThrow("REPORT_PARENT_NOT_READY");
});

it("does not offer a snapshot for the advisor's reports, or for a report in another workspace", async () => {
  const { publish, call, service, settings } = setup();
  const { run } = await publish();
  const advisor = service.store.enqueue({ settings, actorUserId: "admin", period: PERIOD, prompt: "Advisor report" });
  service.store.claim();
  service.store.finish({ ...advisor, status: "succeeded" });
  expect((await call(["project", "snapshot", advisor.id])).status).toBe(404);
  expect((await call(["project", "snapshot", "00000000-0000-4000-8000-000000000000"])).status).toBe(404);
  expect((await call(["project", "snapshot", run.id])).status).toBe(200);
});
