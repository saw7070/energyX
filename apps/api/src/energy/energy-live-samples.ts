/**
 * Each live meter value for a day, as the 15-minute live check read it (energy-live-readings.ts): the running total,
 * the time the meter sent it, and whether Tuya had the meter online at the check. The alerts within the hour
 * (energy-live-hour-alerts.ts) measure each meter's last hours from these. Nothing here is published, and nothing here
 * calls Tuya. The table is created here rather than by a numbered migration, like the other live tables.
 */
import type { DatabaseSync } from "node:sqlite";

/** Live values are kept this long: the hours the live alerts judge, and the values before them. */
export const LIVE_SAMPLE_KEEP_MS = 30 * 3_600_000;

/** One meter at one live check: its running total and when the meter sent it, and whether Tuya had it online. */
export type LiveSample = { polledAt: number; energyKwh: number | null; reportedAt?: number; online?: boolean };

const ensureSamplesTable = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_live_samples (
      project_id TEXT NOT NULL,
      meter_point_id TEXT NOT NULL,
      polled_at TEXT NOT NULL,
      energy_kwh REAL,
      reported_at TEXT,
      online INTEGER,
      PRIMARY KEY (project_id, meter_point_id, polled_at)
    )
  `);
};

/**
 * Keeps one live check's values for a day. A meter that could not be read is kept only when Tuya said it was offline
 * (that alone says use after it cannot be placed in time).
 */
export const recordLiveSamples = (input: {
  db: DatabaseSync;
  projectId: string;
  polledAt: number;
  samples: ReadonlyArray<{ meterPointId: string; energyKwh: number | null; reportedAt?: number; online?: boolean }>;
}): void => {
  ensureSamplesTable(input.db);
  const polledAt = new Date(input.polledAt).toISOString();
  const insert = input.db.prepare(`
    INSERT OR REPLACE INTO energyiq_live_samples (project_id, meter_point_id, polled_at, energy_kwh, reported_at, online)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const sample of input.samples) {
    const energy = sample.energyKwh !== null && Number.isFinite(sample.energyKwh) && sample.energyKwh >= 0 ? sample.energyKwh : null;
    if (energy === null && sample.online !== false) continue;
    const reported = sample.reportedAt !== undefined && Number.isFinite(sample.reportedAt) ? new Date(sample.reportedAt).toISOString() : null;
    insert.run(input.projectId, sample.meterPointId, polledAt, energy, reported, sample.online === undefined ? null : sample.online ? 1 : 0);
  }
  input.db.prepare("DELETE FROM energyiq_live_samples WHERE project_id = ? AND polled_at < ?")
    .run(input.projectId, new Date(input.polledAt - LIVE_SAMPLE_KEEP_MS).toISOString());
};

/** Each meter's live values from `fromMs` on, oldest first. */
export const readLiveSamples = (db: DatabaseSync, projectId: string, fromMs: number): Map<string, LiveSample[]> => {
  ensureSamplesTable(db);
  const rows = db.prepare(`
    SELECT meter_point_id, polled_at, energy_kwh, reported_at, online FROM energyiq_live_samples
    WHERE project_id = ? AND polled_at >= ? ORDER BY meter_point_id, polled_at
  `).all(projectId, new Date(fromMs).toISOString()) as Array<{ meter_point_id: string; polled_at: string; energy_kwh: number | null; reported_at: string | null; online: number | null }>;
  const byMeter = new Map<string, LiveSample[]>();
  for (const row of rows) {
    const reportedAt = row.reported_at ? Date.parse(row.reported_at) : Number.NaN;
    const sample: LiveSample = {
      polledAt: Date.parse(row.polled_at),
      energyKwh: row.energy_kwh === null ? null : Number(row.energy_kwh),
      ...(Number.isFinite(reportedAt) ? { reportedAt } : {}),
      ...(row.online === null ? {} : { online: Number(row.online) === 1 }),
    };
    byMeter.set(row.meter_point_id, [...(byMeter.get(row.meter_point_id) ?? []), sample]);
  }
  return byMeter;
};
