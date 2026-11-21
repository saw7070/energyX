import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { laterCutoff } from "./energy-analysis.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";

describe("laterCutoff", () => {
  const ends = (cutoffLocalDate: string) => ({ cutoffLocalDate });

  it("keeps the last day every meter reported in full unless a later day has most of its readings", () => {
    const full = ends("2026-11-20"), mostly = ends("2026-11-20");
    expect(laterCutoff(ends("2026-11-04"), mostly)).toBe(mostly);
    expect(laterCutoff(full, mostly)).toBe(full);
    expect(laterCutoff(full, ends("2026-11-19"))).toBe(full);
    expect(laterCutoff(full, null)).toBe(full);
    expect(laterCutoff(null, mostly)).toBe(mostly);
    expect(laterCutoff(null, null)).toBeNull();
  });
});

/**
 * The sample office (Ngee Ann, Singapore): four official meters with 0.25 kWh every 15 minutes from 1 Sep to 9 Oct
 * 2026. One of them goes offline on 1 October and sends nothing after that.
 */
const PROJECT = "ngee-ann-polytechnic";
const OFFICIAL = [
  ["mapping-lvl-6-total-office-light-8", "l6-total-light"],
  ["mapping-lvl-7-total-office-light-17", "l7-total-light"],
  ["mapping-lvl-6-total-office-load-9", "l6-total-load"],
  ["mapping-lvl-7-total-office-load-18", "l7-total-load"],
] as const;
const OFFLINE = { meterPointId: "mapping-lvl-7-total-office-load-18", from: Date.parse("2026-09-30T16:00:00.000Z") };
const SHA = "c".repeat(64);

const facts = () => {
  const rows = [];
  let row = 0;
  for (let at = Date.parse("2026-08-31T16:00:00.000Z"); at < Date.parse("2026-10-09T16:00:00.000Z"); at += 15 * 60_000) {
    for (const [meterPointId, scopeId] of OFFICIAL) {
      if (meterPointId === OFFLINE.meterPointId && at >= OFFLINE.from) continue;
      row += 1;
      const local = new Date(at + 8 * 3_600_000);
      rows.push({
        workspaceId: "default", projectId: PROJECT, importBatchId: "explorer-window-fixture", resource: "electricity" as const,
        meterPointId, scopeId, sourceLabel: meterPointId, category: "load", meterRole: "total",
        intervalStart: new Date(at).toISOString(), intervalEnd: new Date(at + 15 * 60_000).toISOString(), elapsedMinutes: 15,
        activeEnergyKwh: row, previousActiveEnergyKwh: row - 1, rawDeltaKwh: 0.25, usageKwh: 0.25, averageKw: 1,
        qualityStatus: "ok", localDate: local.toISOString().slice(0, 10), localHour: local.getUTCHours(),
        dayType: "weekday", sourceFile: "fixture.xlsx", sourceSha256: SHA, sourceReadingKind: "interval_usage" as const,
      });
    }
  }
  return rows;
};

const request = (body: unknown): IncomingMessage => {
  const stream = new PassThrough() as PassThrough & IncomingMessage;
  stream.method = "POST";
  stream.url = "/api/v1/energy/analysis/execute";
  stream.headers = { "content-type": "application/json" };
  stream.end(JSON.stringify(body));
  return stream;
};

describe("the latest window on the Overview, Devices and Analysis", () => {
  const previousDuckDb = process.env.ENERGYIQ_DUCKDB_PATH;
  let root: string;
  let metadata: ReturnType<typeof createMetadataStore>;
  let context: Required<ConfigApiContext>;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "energy-explorer-window-"));
    process.env.ENERGYIQ_DUCKDB_PATH = join(root, "energy.duckdb");
    metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    await materializeTestProjectSnapshot({
      metadataStore: metadata, databasePath: join(root, "energy.duckdb"), workspaceId: "default", projectId: PROJECT, timezone: "Asia/Singapore",
      batches: [{ importBatchId: "explorer-window-fixture", sourceSha256: SHA, rawReadings: [], normalizedReadings: [], intervalFacts: facts(), qualityEvents: [] }],
    });
    context = { metadataStore: metadata, dataGateway: new LocalDataGateway(metadata), userId: "dev-user", workspaceId: "default" } as unknown as Required<ConfigApiContext>;
  }, 120_000);

  afterEach(() => {
    metadata.close();
    if (previousDuckDb === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
    else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDb;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("runs to the latest day with most of its readings, not the last day before one meter went offline", async () => {
    const response = await handleEnergyApiRequest(request({
      projectId: PROJECT, scopeId: "project", resource: "electricity", surface: "project-explorer",
      period: "Custom", analysisWindow: "current-overview-28d",
    }), ["analysis", "execute"], context);
    expect(response.status).toBe(200);
    const analysis = (response.body as { data: { context: { from: string; to: string } } }).data;
    // Three of four meters (75%) kept reporting to 9 October; every meter reported in full only up to 30 September.
    // 28 days ending 9 October (Singapore time) start on 12 September.
    expect(analysis.context.to).toBe("2026-10-09T16:00:00.000Z");
    expect(analysis.context.from).toBe("2026-09-11T16:00:00.000Z");
  }, 120_000);
});
