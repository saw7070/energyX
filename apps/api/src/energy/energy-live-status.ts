import type { DatabaseSync } from "node:sqlite";

/**
 * Which live meters Tuya says are offline right now, and since when. The live readings poll asks every 15 minutes;
 * a meter counts as offline once it has been seen offline for half an hour (two polls in a row), so a single missed
 * check is not an alert. A meter that comes back is cleared at the next poll. Nothing here is published data.
 */
export const OFFLINE_ALERT_AFTER_MS = 30 * 60_000;
/** Statuses older than this mean the poll itself stopped; say nothing rather than repeat an old answer. */
const STATUS_STALE_MS = 45 * 60_000;

export type MeterOnlineStatus = { meterPointId: string; online: boolean };
export type OfflineMeter = { meterPointId: string; offlineSince: string };

type StoredStatus = { meter_point_id: string; online: number; offline_since: string | null; checked_at: string };

export const recordDeviceStatus = (input: {
  db: DatabaseSync;
  projectId: string;
  checkedAt: number;
  statuses: MeterOnlineStatus[];
}): void => {
  ensureTable(input.db);
  const checkedAt = new Date(input.checkedAt).toISOString();
  const select = input.db.prepare(`SELECT * FROM energyiq_live_device_status WHERE project_id = ? AND meter_point_id = ?`);
  const upsert = input.db.prepare(`
    INSERT INTO energyiq_live_device_status (project_id, meter_point_id, online, offline_since, checked_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (project_id, meter_point_id) DO UPDATE SET
      online = excluded.online,
      offline_since = excluded.offline_since,
      checked_at = excluded.checked_at
  `);
  for (const status of input.statuses) {
    const previous = select.get(input.projectId, status.meterPointId) as StoredStatus | undefined;
    if (previous && Date.parse(previous.checked_at) >= input.checkedAt) continue;
    // An outage keeps the time it was first seen; it ends the moment the meter is back.
    const offlineSince = status.online ? null : previous?.offline_since ?? checkedAt;
    upsert.run(input.projectId, status.meterPointId, status.online ? 1 : 0, offlineSince, checkedAt);
  }
};

/** Meters offline for at least half an hour as of the latest poll, the longest-offline first. */
export const readOfflineMeters = (input: { db: DatabaseSync; projectId: string; now?: number }): OfflineMeter[] => {
  ensureTable(input.db);
  const now = input.now ?? Date.now();
  const rows = input.db.prepare(`SELECT * FROM energyiq_live_device_status WHERE project_id = ? AND online = 0`)
    .all(input.projectId) as StoredStatus[];
  return rows
    .filter((row) => row.offline_since
      && now - Date.parse(row.checked_at) <= STATUS_STALE_MS
      && now - Date.parse(row.offline_since) >= OFFLINE_ALERT_AFTER_MS)
    .map((row) => ({ meterPointId: row.meter_point_id, offlineSince: row.offline_since! }))
    .sort((left, right) => left.offlineSince.localeCompare(right.offlineSince) || left.meterPointId.localeCompare(right.meterPointId));
};

const ensureTable = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_live_device_status (
      project_id TEXT NOT NULL,
      meter_point_id TEXT NOT NULL,
      online INTEGER NOT NULL,
      offline_since TEXT,
      checked_at TEXT NOT NULL,
      PRIMARY KEY (project_id, meter_point_id)
    )
  `);
};
