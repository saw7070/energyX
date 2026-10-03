import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { collectSiteAlertEmails, sendPendingAlertEmails, type MeterHealthRow } from "./energy-alert-emails.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { TUYA_OFFICE_PROJECT_ID, TUYA_OFFICE_WORKSPACE_ID } from "./tuya-office-project.js";

const meters: MeterHealthRow[] = [
  { meterPointId: "a", name: "AHU 8B", status: "usable", lastReadingAt: "2026-10-02T06:00:00.000Z" },
  { meterPointId: "b", name: "Canteen lighting", status: "usable", lastReadingAt: "2026-10-01T10:00:00.000Z" },
  { meterPointId: "c", name: "Spare", status: "no_readings" },
];

describe("Alert emails", () => {
  it("emails stopped meters and a failed update once each, and again only when something new happens", async () => {
    await withMetadata(async (metadata) => {
      const claim = metadata.energyIq.sourceSync.claim({
        id: "energy-source-sync-test",
        workspace_id: TUYA_OFFICE_WORKSPACE_ID,
        project_id: TUYA_OFFICE_PROJECT_ID,
        source_kind: "tuya",
        connector_fingerprint: "a".repeat(64),
        trigger: "scheduled",
        window_start_ms: Date.parse("2026-09-30T16:00:00.000Z"),
        window_end_ms: Date.parse("2026-10-01T18:00:00.000Z"),
        actor_user_id: "dev-user",
        started_at: "2026-10-01T18:00:00.000Z",
        stale_before: "2026-10-01T12:00:00.000Z",
      });
      metadata.energyIq.sourceSync.completeFailure({
        run_id: claim.run.id,
        error_code: "ENERGYIQ_TUYA_API_ERROR:1114:YOUR_IP",
        completed_at: "2026-10-01T18:00:05.000Z",
      });
      const outbox: Array<{ to: string[]; subject: string; text: string }> = [];
      const run = (rows: MeterHealthRow[]) => sendPendingAlertEmails({
        metadataStore: metadata,
        projectId: TUYA_OFFICE_PROJECT_ID,
        emails: collectSiteAlertEmails({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, meters: rows, publicBaseUrl: "https://energyiq.example" }),
        recipients: ["facilities@example.com"],
        send: async (message) => { outbox.push(message); },
      });

      expect(await run(meters)).toHaveLength(2);
      expect(outbox[0]).toMatchObject({ to: ["facilities@example.com"], subject: expect.stringContaining("1 meter has stopped sending readings") });
      expect(outbox[0]!.text).toContain("Canteen lighting");
      expect(outbox[0]!.text).not.toContain("AHU 8B");
      expect(outbox[0]!.text).toContain("https://energyiq.example/energyiq/project-configuration?projectId=");
      expect(outbox[1]!.text).toContain("IP allowlist");

      expect(await run(meters)).toEqual([]);
      const another = [...meters, { meterPointId: "d", name: "Hot desk L1", status: "usable", lastReadingAt: "2026-10-01T11:00:00.000Z" }];
      expect(await run(another)).toHaveLength(1);
      expect(outbox).toHaveLength(3);
    });
  });

  it("sends nothing when the site has no one to send to", async () => {
    await withMetadata(async (metadata) => {
      let sent = 0;
      expect(await sendPendingAlertEmails({
        metadataStore: metadata,
        projectId: TUYA_OFFICE_PROJECT_ID,
        emails: [{ key: "meters:x", subject: "s", text: "t" }],
        recipients: [],
        send: async () => { sent += 1; },
      })).toEqual([]);
      expect(sent).toBe(0);
    });
  });
});

const withMetadata = async (run: (metadata: ReturnType<typeof createMetadataStore>) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "energy-alert-emails-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    await run(metadata);
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
