import type { DatabaseSync } from "node:sqlite";

/** How long a client keeps its sites' meter readings. Absent means for as long as the client is subscribed. */
export type EnergyIqReadingRetentionMonths = 3 | 12;

export const ENERGYIQ_READING_RETENTION_MONTHS: readonly EnergyIqReadingRetentionMonths[] = [3, 12];

export const isEnergyIqReadingRetentionMonths = (value: unknown): value is EnergyIqReadingRetentionMonths =>
  value === 3 || value === 12;

export type EnergyIqReadingRetentionRecord = {
  workspace_id: string;
  months: EnergyIqReadingRetentionMonths;
  updated_by: string;
  updated_at: string;
};

export const initializeEnergyIqReadingRetentionSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_reading_retention (
      workspace_id TEXT PRIMARY KEY,
      months INTEGER NOT NULL CHECK (months IN (3, 12)),
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
};

/**
 * Per-client (Organisation) limit on how long meter readings are kept. Clients without a row keep everything; the
 * nightly clean-up and every publication trim only clients that have one.
 */
export class EnergyIqReadingRetentionStore {
  constructor(private readonly db: DatabaseSync) {}

  get(workspaceId: string): EnergyIqReadingRetentionMonths | undefined {
    const row = this.db.prepare("SELECT months FROM workspace_reading_retention WHERE workspace_id = ?")
      .get(workspaceId) as { months?: number } | undefined;
    const months = Number(row?.months);
    return isEnergyIqReadingRetentionMonths(months) ? months : undefined;
  }

  /** `months: null` means keep readings for as long as the client is subscribed. */
  set(input: { workspace_id: string; months: EnergyIqReadingRetentionMonths | null; updated_by: string; updated_at?: string }): void {
    if (input.months === null) {
      this.db.prepare("DELETE FROM workspace_reading_retention WHERE workspace_id = ?").run(input.workspace_id);
      return;
    }
    if (!isEnergyIqReadingRetentionMonths(input.months)) throw new Error("ENERGYIQ_READING_RETENTION_INVALID");
    this.db.prepare(`
      INSERT INTO workspace_reading_retention (workspace_id, months, updated_by, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        months = excluded.months,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(input.workspace_id, input.months, input.updated_by, input.updated_at ?? new Date().toISOString());
  }

  list(): EnergyIqReadingRetentionRecord[] {
    return this.db.prepare(`
      SELECT workspace_id, months, updated_by, updated_at FROM workspace_reading_retention ORDER BY workspace_id
    `).all().flatMap((row) => {
      const record = row as { workspace_id: string; months: number; updated_by: string; updated_at: string };
      return isEnergyIqReadingRetentionMonths(record.months)
        ? [{ workspace_id: record.workspace_id, months: record.months, updated_by: record.updated_by, updated_at: record.updated_at }]
        : [];
    });
  }
}
