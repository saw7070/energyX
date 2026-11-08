import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MailDelivery } from "../email/mail-delivery.js";
import { createEnergyAlertEmailer } from "./energy-alert-emails.js";
import { createEnergyLiveReadingsPoller } from "./energy-live-readings.js";
import { createEnergyReportDeliveryWorker } from "./energy-report-delivery.js";
import { createEnergyTargetsMonitor } from "./energy-targets-monitor.js";

// A pass with nothing to do never awaits, so it finishes before runOnce returns. The in-flight guard must still be
// released, or every later call returns the finished pass and the job never runs again. On 2026-11-08 production's
// report-email job ran once after the deploy and then stalled.
describe("background jobs run again after a pass with nothing to do", () => {
  let root: string;
  let metadata: ReturnType<typeof createMetadataStore>;
  const delivery: MailDelivery = { mode: "test", send: vi.fn(async () => undefined) };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "background-job-passes-"));
    metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("checks report schedules on every pass", async () => {
    const worker = createEnergyReportDeliveryWorker({ metadataStore: metadata, env: {}, delivery });
    const listSchedules = vi.spyOn(metadata.energyIq.targets, "listEnabledSchedules");

    await worker.runOnce();
    await worker.runOnce();

    expect(listSchedules).toHaveBeenCalledTimes(2);
  });

  it("checks budgets and overnight use on every pass", async () => {
    const monitor = createEnergyTargetsMonitor({ metadataStore: metadata, env: {}, delivery });
    const listWorkspaces = vi.spyOn(metadata.workspaces, "list");

    await monitor.runOnce();
    await monitor.runOnce();

    expect(listWorkspaces).toHaveBeenCalledTimes(2);
  });

  it("polls live readings on every pass", async () => {
    const poller = createEnergyLiveReadingsPoller({ metadataStore: metadata, readLatestEnergy: vi.fn(), env: {} });
    const listConnections = vi.spyOn(metadata.energyIq.liveConnectors, "listSyncEnabled");

    await poller.pollAll();
    await poller.pollAll();

    expect(listConnections).toHaveBeenCalledTimes(2);
  });

  it("looks for meter alerts to email on every pass", async () => {
    const emailer = createEnergyAlertEmailer({
      metadataStore: metadata,
      env: {},
      send: vi.fn(async () => undefined),
      readMeters: vi.fn(async () => []),
    });
    const listConnections = vi.spyOn(metadata.energyIq.liveConnectors, "listSyncEnabled");

    await emailer.runOnce();
    await emailer.runOnce();

    expect(listConnections).toHaveBeenCalledTimes(2);
  });
});
