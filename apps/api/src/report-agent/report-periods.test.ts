import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { MetadataStore } from "@datafoundry/metadata";
import type { FileAssetService } from "@datafoundry/files";
import type { ReportSettings } from "./report-store.js";
import { availableReportPeriod, latestReportPeriod, csvAvailablePeriod, presetReportPeriod, resolveRequestedReportPeriod } from "./report-periods.js";
const { coverage, route } = vi.hoisted(() => ({ coverage: vi.fn(), route: vi.fn() }));
vi.mock("@datafoundry/data-gateway", () => ({ readEnergyAnalysisEligibleCoverage: coverage }));
vi.mock("../energy/energy-query-context.js", () => ({ resolveEnergyPublishedMeterRoute: route }));
const settings: ReportSettings = { projectId: "p", workspaceId: "w", actorUserId: "u", timezone: "Asia/Singapore", contextNotes: "", fileRefIds: ["csv"], useProjectData: false, skill: "", revision: 1, frequency: "off", localHour: 3, scheduledPrompt: "" };
it("resolves SGT midnight, month/year and Monday boundaries without assuming UTC date", () => {
  const now = new Date("2026-01-31T16:00:00Z");
  expect(presetReportPeriod("recent", now)).toEqual({ from: "2026-01-04", toExclusive: "2026-02-01" });
  expect(presetReportPeriod("previous-month", now)).toEqual({ from: "2026-01-01", toExclusive: "2026-02-01" });
  expect(presetReportPeriod("previous-day", now)).toEqual({ from: "2026-01-31", toExclusive: "2026-02-01" });
  expect(presetReportPeriod("recent", new Date("2026-01-01T00:00:00Z"))).toEqual({ from: "2025-12-04", toExclusive: "2026-01-01" });
  expect(presetReportPeriod("previous-week", new Date("2026-09-13T16:00:00Z"))).toEqual({ from: "2026-09-07", toExclusive: "2026-09-14" });
  expect(presetReportPeriod("previous-week", new Date("2026-09-13T15:59:59Z"))).toEqual({ from: "2026-08-31", toExclusive: "2026-09-07" });
  expect(presetReportPeriod("previous-month", new Date("2024-03-01T00:00:00Z"))).toEqual({ from: "2024-02-01", toExclusive: "2024-03-01" });
});
it("prioritizes explicit dates, otherwise inherits only without a preset, and requires real All/custom dates", () => {
  const period = { from: "2025-01-01", toExclusive: "2025-02-01" };
  expect(resolveRequestedReportPeriod({ period, preset: "all" })).toEqual(period);
  expect(resolveRequestedReportPeriod({ inherited: period })).toEqual(period);
  expect(resolveRequestedReportPeriod({ inherited: period, preset: "previous-day", now: new Date("2026-09-11T16:00:00Z") })).toEqual({ from: "2026-09-11", toExclusive: "2026-09-12" });
  expect(() => resolveRequestedReportPeriod({ preset: "all", available: null })).toThrow("AVAILABLE_PERIOD_UNAVAILABLE");
  expect(() => resolveRequestedReportPeriod({ preset: "custom", inherited: period })).toThrow("PERIOD_REQUIRED");
  const csv = csvAvailablePeriod("interval_start_utc,interval_end_utc\n2023-01-01T00:00:00Z,2023-01-01T00:15:00Z\n2026-09-10T15:30:00Z,2026-09-10T15:45:00Z");
  expect(resolveRequestedReportPeriod({ preset: "all", available: csv })).toEqual({ from: "2023-01-01", toExclusive: "2026-09-11" });
});
it("parses quoted CSV records and preserves the actual interval cutoff separately from day boundaries", () => {
  const text = '\uFEFFnote,interval_start_sgt,interval_end_sgt\r\n"name, with\nnewline",2026-08-16T16:45:00+08:00,2026-08-16T17:00:00+08:00\r\n"quote ""ok""",2026-09-10T23:30:00+08:00,2026-09-10T23:45:00+08:00';
  expect(csvAvailablePeriod(text)).toEqual({ from: "2026-08-16", toExclusive: "2026-09-11", actualLastIntervalEnd: "2026-09-10T15:45:00.000Z" });
  expect(csvAvailablePeriod("interval_start_utc,interval_end_utc\n2026-09-10T15:45:00Z,2026-09-10T16:00:00Z")?.toExclusive).toBe("2026-09-11");
  expect(csvAvailablePeriod("interval_start_utc,interval_end_utc\n2026-09-10 15:30:00,2026-09-10 16:15:00")).toEqual({ from: "2026-09-10", toExclusive: "2026-09-12", actualLastIntervalEnd: "2026-09-10T16:15:00.000Z" });
  expect(csvAvailablePeriod("interval_start_sgt,interval_end_sgt\n2026-09-10 23:30:00,2026-09-11 00:15:00")).toEqual({ from: "2026-09-10", toExclusive: "2026-09-12", actualLastIntervalEnd: "2026-09-10T16:15:00.000Z" });
  expect(csvAvailablePeriod("date,value\n2026-08-01,1\n2026-09-10,2")).toEqual({ from: "2026-08-01", toExclusive: "2026-09-11", actualLastIntervalEnd: null });
  expect(csvAvailablePeriod("meter,value\na,42")).toBeNull();
  expect(csvAvailablePeriod("timestamp,value\nunknown,42")).toBeNull();
});
it("caches authorized CSV reads by asset identity and rechecks authorization before returning cached dates", async () => {
  const metadata = { energyIq: { getProject: () => ({ data_snapshot_id: "s", hierarchy_revision_id: "h" }) } } as unknown as MetadataStore;
  let assetId = "a";
  const getRef = vi.fn(() => ({ ref: { id: "csv", filename: "data.csv" }, asset: { id: assetId, size_bytes: 100 } }));
  const readRef = vi.fn(() => ({ body: Buffer.from("date,kwh\n2024-01-01,42\n2026-09-10,12") }));
  const files = { getRef, readRef } as unknown as FileAssetService;
  expect(await availableReportPeriod(metadata, files, settings, "current-user")).toMatchObject({ from: "2024-01-01", toExclusive: "2026-09-11" });
  await availableReportPeriod(metadata, files, settings, "current-user");
  expect(readRef).toHaveBeenCalledTimes(1); expect(getRef).toHaveBeenLastCalledWith({ user_id: "current-user", workspace_id: "w", id: "csv" });
  assetId = "b"; await availableReportPeriod(metadata, files, settings, "current-user"); expect(readRef).toHaveBeenCalledTimes(2);
  getRef.mockImplementationOnce(() => { throw new Error("FORBIDDEN"); });
  expect(await availableReportPeriod(metadata, files, settings, "current-user")).toBeNull();
});
it("uses validated project snapshot and meter scope for live data boundaries", async () => {
  const metadata = { energyIq: { getProject: () => ({ data_snapshot_id: "snap", hierarchy_revision_id: "hier", root_scope_id: "root" }) } } as unknown as MetadataStore;
  route.mockReturnValue({ attachments: [{ meterPointId: "meter" }] });
  coverage.mockResolvedValue({ from: "2024-01-01T00:00:00Z", to: "2026-09-10T15:45:00Z", intervalCount: 10 });
  expect(await availableReportPeriod(metadata, {} as FileAssetService, { ...settings, useProjectData: true, fileRefIds: [] }, "u")).toMatchObject({ from: "2024-01-01", toExclusive: "2026-09-11" });
  expect(coverage).toHaveBeenCalledWith({ metadataStore: metadata, workspaceId: "w", projectId: "p", dataSnapshotId: "snap", resource: "electricity", meterAttachments: [{ meterPointId: "meter" }] });
});
it.skipIf(!process.env.S1_REPORT_CSV_PATH)("matches the actual authorized Tuya reference CSV boundary evidence", () => {
  expect(csvAvailablePeriod(readFileSync(process.env.S1_REPORT_CSV_PATH!, "utf8"))).toEqual({ from: "2026-08-16", toExclusive: "2026-09-11", actualLastIntervalEnd: "2026-09-10T15:45:00.000Z" });
});

it("anchors the 28-day window to completed SGT days without silently shortening it for missing data", () => {
  const now = new Date("2026-09-13T10:00:00Z");
  expect(latestReportPeriod({from:"2026-09-01",toExclusive:"2026-09-12",actualLastIntervalEnd:"2026-09-11T08:00:00Z"}, now)).toEqual({from:"2026-08-14",toExclusive:"2026-09-11"});
  expect(latestReportPeriod({from:"2026-08-01",toExclusive:"2026-09-12",actualLastIntervalEnd:"2026-09-11T16:00:00Z"}, now)).toEqual({from:"2026-08-15",toExclusive:"2026-09-12"});
  expect(latestReportPeriod(null, now)).toEqual({from:"2026-08-16",toExclusive:"2026-09-13"});
});
