import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("Reading retention store", () => {
  it("keeps everything by default, and stores 3 or 12 months per client", () => {
    const root = mkdtempSync(join(tmpdir(), "metadata-reading-retention-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite"), secret_master_key: "reading-retention-master-key" });
    try {
      const migration = metadata.db.prepare("SELECT id FROM schema_migrations WHERE id = '0059_energyiq_reading_retention'").get();
      expect(migration).toBeDefined();
      const store = metadata.energyIq.readingRetention;
      expect(store.get("client-a")).toBeUndefined();
      expect(store.list()).toEqual([]);

      store.set({ workspace_id: "client-a", months: 3, updated_by: "admin", updated_at: "2026-11-18T00:00:00.000Z" });
      store.set({ workspace_id: "client-b", months: 12, updated_by: "admin", updated_at: "2026-11-18T00:00:00.000Z" });
      store.set({ workspace_id: "client-a", months: 12, updated_by: "admin2", updated_at: "2026-11-18T01:00:00.000Z" });
      expect(store.get("client-a")).toBe(12);
      expect(store.list()).toEqual([
        { workspace_id: "client-a", months: 12, updated_by: "admin2", updated_at: "2026-11-18T01:00:00.000Z" },
        { workspace_id: "client-b", months: 12, updated_by: "admin", updated_at: "2026-11-18T00:00:00.000Z" },
      ]);

      store.set({ workspace_id: "client-a", months: null, updated_by: "admin" });
      expect(store.get("client-a")).toBeUndefined();
      expect(() => store.set({ workspace_id: "client-c", months: 6 as never, updated_by: "admin" })).toThrow("ENERGYIQ_READING_RETENTION_INVALID");
      expect(() => metadata.db.prepare("INSERT INTO workspace_reading_retention VALUES ('client-d', 6, 'x', 'y')").run()).toThrow();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
