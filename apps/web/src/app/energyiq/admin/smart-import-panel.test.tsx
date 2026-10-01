/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  getEnergyProjectSetup: vi.fn(),
  listEnergyImportBatches: vi.fn(),
  uploadEnergyExcelImport: vi.fn(),
  saveEnergyProjectSetupDraft: vi.fn(),
  materializeEnergyImportBatch: vi.fn(),
  applyEnergyProjectChanges: vi.fn(),
  extractEnergyDeviceListFromImage: vi.fn(),
}));
vi.mock("../../../lib/config-api", () => ({ configApi: api }));
import { describeFileCoverage, friendlyImportError, SmartImportPanel } from "./smart-import-panel";

let container: HTMLDivElement;
let root: Root;
const emptySetup = { draft: { revision: 3, document: { project: { name: "Site", timezone: "Asia/Singapore" }, tier_structure_locked: false, tiers: [], nodes: [] } } };
const batch = (id: string, sourceKind: "excel" | "tuya", status: "inspected" | "materialized", labels = ["Incoming 3Phase", "A18P"]) => ({
  id, projectId: "p", sourceKind, sourceSha256: id.padEnd(64, "0"), filename: `${id}.csv`, status,
  inspection: { columns: [], sourceLabels: labels.map((label) => ({ label, rowCount: 10 })), rowCount: 20, validRowCount: 20, invalidRowCount: 0, duplicateReadingCount: 0, negativeReadingCount: 0, coverageFrom: "2026-09-01T00:00:00Z", coverageTo: "2026-09-30T00:00:00Z", readingKind: "cumulative", qualityStatus: "ready", issues: [] },
});

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  for (const fn of Object.values(api)) fn.mockReset();
  api.getEnergyProjectSetup.mockResolvedValue(emptySetup);
  window.sessionStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const render = async () => { await act(async () => root.render(<SmartImportPanel projectId="p" />)); };

describe("SmartImportPanel", () => {
  it("leaves projects fed by the live connection alone", async () => {
    api.listEnergyImportBatches.mockResolvedValue({ batches: [batch("t1", "tuya", "inspected"), batch("t2", "tuya", "materialized")] });
    await render();
    expect(container.textContent).toContain("This project updates automatically");
    expect(container.querySelector("input[type=file]")).toBeNull();
    expect(container.textContent).not.toContain("Publish");
  });

  it("shows an empty project how to start", async () => {
    api.listEnergyImportBatches.mockResolvedValue({ batches: [] });
    await render();
    expect(container.textContent).toContain("No data yet");
    expect(container.textContent).toContain("Drag files here");
    expect(container.textContent).not.toContain("Check device names");
  });

  it("sets up and publishes only uploaded files, in three visible steps", async () => {
    api.listEnergyImportBatches.mockResolvedValue({ batches: [batch("f1", "excel", "inspected")] });
    api.saveEnergyProjectSetupDraft.mockImplementation(async (_id: string, body: { document: unknown }) => ({ draft: { revision: 4, document: body.document } }));
    api.materializeEnergyImportBatch.mockResolvedValue({});
    api.applyEnergyProjectChanges.mockResolvedValue({});
    await render();
    expect(container.textContent).toContain("Sets up 2 devices");
    const button = [...container.querySelectorAll("button")].find((element) => element.textContent === "Set up & publish")!;
    await act(async () => button.click());

    expect(api.saveEnergyProjectSetupDraft).toHaveBeenCalledWith("p", expect.objectContaining({ expectedRevision: 3 }));
    expect(api.materializeEnergyImportBatch).toHaveBeenCalledWith("p", "f1");
    expect(api.applyEnergyProjectChanges).toHaveBeenCalledWith("p");
    expect(container.textContent).toContain("Published");
  });
});

describe("friendly errors", () => {
  it("turns server codes into plain English", () => {
    expect(friendlyImportError("FILE_ASSET_REF_NOT_FOUND:68cd")).toMatch(/can no longer be found/);
    expect(friendlyImportError("ENERGYIQ_EXCEL_COLUMN_REQUIRED:Active Energy")).toBe('A file is missing the "Active Energy" column. Each file needs Device Name, Time and Active Energy columns.');
    expect(friendlyImportError("ENERGYIQ_EXCEL_FILE_INVALID")).toBe("Only .csv and .xlsx files can be uploaded.");
  });
});

describe("what a new file adds", () => {
  const file = (from: string, to: string, labels = ["A18P"]) => {
    const value = batch("x", "excel", "inspected", labels);
    return { ...value, inspection: { ...value.inspection, coverageFrom: from, coverageTo: to } } as never;
  };
  it("separates new dates from dates already loaded", () => {
    const result = describeFileCoverage(file("2026-09-01T10:30:00Z", "2026-10-01T02:15:00Z"), "2026-09-11T23:45:00Z", ["A18P"]);
    expect(result.text).toBe("New data: 12 Sept 2026 – 1 Oct 2026");
    expect(result.detail).toContain("already loaded");
  });
  it("warns when a file adds nothing", () => {
    expect(describeFileCoverage(file("2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z"), "2026-09-11T00:00:00Z", ["A18P"]).tone).toBe("warning");
  });
  it("treats a first upload as all new", () => {
    expect(describeFileCoverage(file("2026-09-01T00:00:00Z", "2026-09-05T00:00:00Z"), undefined, []).text).toBe("New data: 1 Sept 2026 – 5 Sept 2026");
  });
});


describe("reader's language", () => {
  it("writes file summaries and errors in Chinese and Malay", async () => {
    const { translatorFor } = await import("../_components/energyiq-messages");
    const { smartImportMessages, importDateLocale } = await import("./smart-import-messages");
    const zh = translatorFor(smartImportMessages, "zh-Hans");
    const ms = translatorFor(smartImportMessages, "ms");
    const value = batch("x", "excel", "inspected", ["A18P"]);
    const file = { ...value, inspection: { ...value.inspection, coverageFrom: "2026-09-01T00:00:00Z", coverageTo: "2026-09-05T00:00:00Z" } } as never;
    expect(describeFileCoverage(file, "2026-09-11T00:00:00Z", ["A18P"], zh, importDateLocale("zh-Hans")).text).toBe("没有新内容：此文件中的所有日期都已载入");
    expect(describeFileCoverage(file, undefined, [], ms, importDateLocale("ms")).text).toMatch(/^Data baharu: /);
    expect(friendlyImportError("ENERGYIQ_EXCEL_FILE_INVALID", zh)).toBe("只能上传 .csv 和 .xlsx 文件。");
    expect(friendlyImportError("ENERGYIQ_EXCEL_COLUMN_REQUIRED:Time", ms)).toContain("\"Time\"");
  });
});
