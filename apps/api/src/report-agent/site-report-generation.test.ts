import { createMetadataStore } from "@datafoundry/metadata";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parseSiteReportSnapshot, type AnalysisData, type ScopeData, type ScopeMeter, type TrendSeries } from "@datafoundry/site-report";
import type { ConfigApiContext } from "../routes/types.js";
import { handleReportLibraryApi } from "./report-library-api.js";
import { ReportService, registerReportService } from "./report-service.js";
import type { ReportSettings } from "./report-store.js";
import { publishSiteReport, siteReportScheduleKey } from "./site-report-generation.js";
import { readSiteAlerts } from "../energy/energy-site-alerts.js";
import type { loadSiteReportData } from "./site-report-data.js";

const cleanup: Array<() => void> = [];
// start() and a bare tick() schedule on the clock. Weekly reports fall due on Mondays after 03:00 Singapore time, so on
// a real Monday morning they queued an extra report. Every test here runs on Sunday 16 August 2026 instead; only the
// date is frozen, so timers still run.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-08-16T01:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const close of cleanup.splice(0)) close(); });

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

// One day of a lit estate: corridor and lobby lights run at night, the emergency lights day and night. Readings stop at
// `until` o'clock, as when the gateway goes quiet part-way through the day.
const LIGHTS_ON = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ from: "19:00", to: "07:00" }]]));
const dayData = (date: string, until = 24): AnalysisData => {
  const night = (hour: number) => hour >= 19 || hour < 7;
  const lights: Record<string, { name: string; kwh: (hour: number) => number }> = {
    corridor: { name: "Corridor lights", kwh: hour => night(hour) ? 2 : 0.1 },
    lobby: { name: "Lobby lights", kwh: hour => night(hour) ? 1.2 : 0.05 },
    emergency: { name: "Emergency lights", kwh: () => 0.3 },
  };
  const daySeries = (id: string, kwh: (hour: number) => number): TrendSeries => ({ id, expectedMinutesPerHour: 60,
    cells: Array.from({ length: 24 }, (_, hour) => (hour < until ? [date, hour, kwh(hour), 60, 0] : [date, hour, null, 0, 0]) as TrendSeries["cells"][number]) });
  const total = daySeries("__scope__", hour => Object.values(lights).reduce((sum, light) => sum + light.kwh(hour), 0));
  const usage = total.cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0);
  const project: ScopeData = { id: "project", name: "Harbour Estate", dates: [date], timezone: "Asia/Singapore", total, types: {},
    meters: Object.entries(lights).map(([id, light]) => ({ id, name: light.name, location: "DB1", category: "light", official: true, series: daySeries(id, light.kwh) })),
    usageKwh: usage, peakKw: null, peakAt: null, cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax" }, typeTotals: {}, coverage: until / 24 * 100 };
  return { projectId: "project", projectName: "Harbour Estate", timezone: "Asia/Singapore", snapshotId: "snapshot-1", current: { project, spaces: [] },
    previous: null, history: null, circuits: [], holidays: new Map(), openingHours: LIGHTS_ON, hoursMeaning: "lights_on", actions: [] };
};
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

it("publishes yesterday's site report every day at the chosen hour, in the site's report style, and rings the bell", async () => {
  const asked: Array<{ from: string; toExclusive: string }> = [];
  const { service, settings, call, metadata } = setup({ loadSiteReportData: async input => { asked.push(input.period); return { data: dayData(input.period.from), dataSnapshotId: "snapshot-1" }; } });
  service.start();
  await service.tick();
  // The clock itself moves, because the service also wakes itself up after each report it runs.
  // Monday 17 August 2026, 05:59 in Singapore: the chosen hour has not come yet.
  vi.setSystemTime(new Date("2026-08-16T21:59:00Z"));
  service.store.saveSettings({ ...settings, frequency: "daily", localHour: 6, siteReportStyle: "management" });
  await service.tick();
  await service.settleSiteReports();
  expect(asked).toEqual([]);
  // 06:00: Sunday the 16th is a full day in the site's time zone. A later tick the same morning adds nothing.
  vi.setSystemTime(new Date("2026-08-16T22:00:00Z"));
  await service.tick();
  vi.setSystemTime(new Date("2026-08-16T23:30:00Z"));
  await service.tick();
  await service.settleSiteReports();
  await service.stop();
  expect(asked).toEqual([{ from: "2026-08-16", toExclusive: "2026-08-17" }]);

  const reports = ((await call()).body as { data: { reports: Array<Record<string, unknown>> } }).data.reports.filter(item => item.source === "site");
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject({ cadence: "daily", category: "scheduled", style: "management", period: { from: "2026-08-16", toExclusive: "2026-08-17" },
    title: "Daily Management Review — 16 August 2026" });
  const id = String(reports[0]!.id);
  const snapshot = parseSiteReportSnapshot(((await call(["project", "snapshot", id])).body as { data: { snapshot: unknown } }).data.snapshot);
  expect(snapshot).toMatchObject({ cadence: "daily", style: "management", period: { from: "2026-08-16", toExclusive: "2026-08-17" } });
  const page = text(((await call(["project", "output", id])).body as { data: { content: string } }).data.content);
  expect(page).toContain("What this day shows");
  expect(page).toContain("1 day, SGT");
  expect(page).not.toContain("1 days");
  // Readers hear about it the same way as the weekly and monthly reports.
  const alerts = readSiteAlerts({ metadataStore: metadata, projectId: "project", userId: "reader", includeReports: true, includeSync: false, reportRuns: service.store.list("project") });
  expect(alerts.reports).toEqual([expect.objectContaining({ reportId: id, cadence: "daily", from: "2026-08-16", toExclusive: "2026-08-17" })]);
});

it("still writes the site's own daily report when AI is switched off for the organisation", async () => {
  const { service, settings, metadata } = setup({ loadSiteReportData: async input => ({ data: dayData(input.period.from), dataSnapshotId: "snapshot-1" }) });
  metadata.energyIq.ai.setSettings("workspace", { enabled: false }, "admin");
  service.store.saveSettings({ ...settings, frequency: "daily" });
  // Sunday 16 August, 09:00 in Singapore: past 03:00, so Saturday the 15th is due.
  service.start();
  await service.tick();
  await service.settleSiteReports();
  await service.stop();
  const runs = service.store.list("project");
  // No advisor report, which needs AI; the site report needs none.
  expect(runs.filter(run => !run.siteReport)).toHaveLength(0);
  expect(runs.map(run => [run.siteReport?.cadence, run.reportingPeriod])).toEqual([["daily", { from: "2026-08-15", toExclusive: "2026-08-16" }]]);
  expect(service.store.settings("project")?.frequency).toBe("daily");
});

it("says plainly when a daily report's day has incomplete readings, and estimates nothing from part of a day", async () => {
  const { publish, root } = setup();
  const day = { from: "2026-08-16", toExclusive: "2026-08-17" };
  const { run } = await publish({ cadence: "daily", period: day, loadData: async () => ({ data: dayData("2026-08-16", 18), dataSnapshotId: "snapshot-1" }) });
  expect(run.siteReport).toEqual({ cadence: "daily" });
  expect(run.prompt).toBe("Daily site energy report for 2026-08-16 to 2026-08-17 (the end date is not included). Written by the server from the site's own meter readings.");
  const page = text(readFileSync(join(root, run.id, "accepted-output.txt"), "utf8"));
  expect(page).toContain("Some readings for this day are missing");
  expect(page).toContain("Only 75% of the expected readings arrived, so the figures below count only the readings received and may be lower than the real use.");
  expect(page).toContain("No meter has a full day of readings on this day, so a 30-day month is not estimated.");
  expect(page).toContain("Some readings for this day are missing, so the hour-by-hour pattern is not drawn.");
  expect(page).not.toContain("1 days");
  expect(page).not.toMatch(/S\$0 a month|0\.0 kWh\b/);
  // A single day has no other day to stand out from.
  expect(page).not.toContain("Days that stood out");
});

it("keeps every weekly, monthly and custom report listed however many daily reports follow them", async () => {
  const { service, settings, call } = setup();
  const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const site = (cadence: "daily" | "weekly" | "monthly" | "custom", from: string, toExclusive: string) => service.store.insertCompleted({
    settings, period: { from, toExclusive }, reportingPeriod: { from, toExclusive }, prompt: "Site energy report", actorUserId: "admin",
    ...(cadence === "custom" ? { custom: true, siteReport: {} } : { scheduleKey: siteReportScheduleKey("project", cadence, { from, toExclusive }), siteReport: { cadence } }),
  }).run;
  // The advisor's own daily report, finished the way the worker finishes one.
  const advisorDaily = (from: string, toExclusive: string) => {
    service.store.enqueue({ settings, period: { from, toExclusive }, reportingPeriod: { from, toExclusive }, prompt: "Daily report", actorUserId: "admin",
      scheduleKey: `project:daily:${from}:${toExclusive}` });
    const claimed = service.store.claim()!;
    service.store.finish({ ...claimed, status: "succeeded" });
    return claimed;
  };
  const monthly = ["2026-04-01", "2026-05-01", "2026-06-01"].map((from, index, all) => site("monthly", from, all[index + 1] ?? "2026-07-01"));
  const weekly = Array.from({ length: 6 }, (_, week) => site("weekly", shift("2026-05-25", week * 7), shift("2026-05-25", week * 7 + 7)));
  const custom = site("custom", "2026-06-10", "2026-06-20");
  // Fifteen weeks of daily reports from the site and the advisor: far more than the newest runs of every kind hold.
  const daily = Array.from({ length: 105 }, (_, day) => [site("daily", shift("2026-07-06", day), shift("2026-07-06", day + 1)), advisorDaily(shift("2026-07-06", day), shift("2026-07-06", day + 1))]).flat();
  const reports = ((await call(["project"], "admin")).body as { data: { reports: Array<{ id: string; cadence?: string }> } }).data.reports;
  const listed = new Set(reports.map(report => report.id));
  for (const run of [...monthly, ...weekly, custom]) expect(listed.has(run.id)).toBe(true);
  // Daily reports keep a window of their own, newest first.
  const dailyListed = daily.filter(run => listed.has(run.id));
  expect(dailyListed).toHaveLength(92);
  expect(dailyListed).toEqual(daily.slice(-92));
});
