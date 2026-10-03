import type { DatabaseSync } from "node:sqlite";
import type { EnergyIqProjectSetupDocument, MetadataStore } from "@datafoundry/metadata";

import { resolveEnergyTuyaProjectConnector, type EnergyTuyaProjectConnector } from "./energy-tuya-connector.js";
import type { TuyaDeviceBinding, TuyaLatestEnergyReading } from "./tuya-openapi-client.js";

/**
 * Live readings: every 15 minutes each connected site's meters are read for their current cumulative energy. Two
 * readings give the average power in between; the first reading of the local day gives energy used today so far.
 * Nothing here is published: the daily update stays the official record, and these readings only show what is
 * happening now. Each meter keeps only its latest two readings and the first reading of the day.
 */
export const LIVE_READING_INTERVAL_MS = 15 * 60_000;
/** A meter whose last reading is older than this is not "live"; Overview says so instead of showing old power. */
const LIVE_STALE_MS = 45 * 60_000;
/** Power is only worked out across a gap that is neither a duplicate read nor a long outage. */
const POWER_MIN_GAP_MS = 5 * 60_000;
const POWER_MAX_GAP_MS = 60 * 60_000;

export type LiveMeterReading = {
  meterPointId: string;
  name: string;
  /** When the meter's latest energy value was read. */
  readAt: string;
  energyKwh: number;
  /** Average power since the previous reading; absent until there are two readings close enough together. */
  powerKw?: number;
  /** Energy since the first reading of today (site's local day). */
  todayKwh?: number;
  stale: boolean;
};

export type LiveSiteReadings = {
  /** False when the site has no live connection, so there is nothing to poll. */
  connected: boolean;
  /** Latest reading time across the site's meters. */
  readAt?: string;
  /** Sum over the site's main (official) meters, when every one of them has a current value. */
  powerKw?: number;
  todayKwh?: number;
  officialMeterCount: number;
  /** Official meters with a current (not stale) power value. */
  reportingMeterCount: number;
  meters: LiveMeterReading[];
  intervalMinutes: number;
};

type StoredRow = {
  meter_point_id: string;
  local_date: string;
  day_first_energy_kwh: number;
  prev_energy_kwh: number | null;
  prev_at: string | null;
  last_energy_kwh: number;
  last_at: string;
};

export const recordLiveReadings = (input: {
  db: DatabaseSync;
  projectId: string;
  timezone: string;
  readAt: number;
  readings: Array<{ meterPointId: string; energyKwh: number }>;
}): void => {
  ensureTable(input.db);
  const localDate = localDateOf(input.readAt, input.timezone);
  const readAtIso = new Date(input.readAt).toISOString();
  const select = input.db.prepare(`SELECT * FROM energyiq_live_readings WHERE project_id = ? AND meter_point_id = ?`);
  const upsert = input.db.prepare(`
    INSERT INTO energyiq_live_readings
      (project_id, meter_point_id, local_date, day_first_energy_kwh, prev_energy_kwh, prev_at, last_energy_kwh, last_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (project_id, meter_point_id) DO UPDATE SET
      local_date = excluded.local_date,
      day_first_energy_kwh = excluded.day_first_energy_kwh,
      prev_energy_kwh = excluded.prev_energy_kwh,
      prev_at = excluded.prev_at,
      last_energy_kwh = excluded.last_energy_kwh,
      last_at = excluded.last_at
  `);
  for (const reading of input.readings) {
    if (!Number.isFinite(reading.energyKwh) || reading.energyKwh < 0) continue;
    const previous = select.get(input.projectId, reading.meterPointId) as StoredRow | undefined;
    if (previous && Date.parse(previous.last_at) >= input.readAt) continue;
    // A meter that was replaced or reset counts from zero again; start its day and its power afresh.
    const reset = previous !== undefined && reading.energyKwh < previous.last_energy_kwh;
    const sameDay = previous?.local_date === localDate && !reset;
    // On a new day, the last reading before midnight is the better start when it is recent: today then includes
    // the first minutes after midnight instead of losing them.
    const dayFirst = sameDay
      ? previous!.day_first_energy_kwh
      : previous && !reset && input.readAt - Date.parse(previous.last_at) <= LIVE_READING_INTERVAL_MS * 2
        ? previous.last_energy_kwh
        : reading.energyKwh;
    upsert.run(
      input.projectId,
      reading.meterPointId,
      localDate,
      dayFirst,
      previous && !reset ? previous.last_energy_kwh : null,
      previous && !reset ? previous.last_at : null,
      reading.energyKwh,
      readAtIso,
    );
  }
};

export const readLiveSiteReadings = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  now?: number;
}): LiveSiteReadings => {
  const now = input.now ?? Date.now();
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const document = publishedDocument(input.metadataStore, input.projectId, project.hierarchy_revision_id);
  const timezone = document?.project.timezone ?? "Asia/Singapore";
  const rows = document?.meter_mapping?.rows.filter((row) => row.resource === "electricity") ?? [];
  const names = new Map(rows.map((row) => [row.id, row.display_name]));
  const official = officialProjectMeterIds(document);
  ensureTable(input.metadataStore.db);
  const stored = input.metadataStore.db
    .prepare(`SELECT * FROM energyiq_live_readings WHERE project_id = ? ORDER BY meter_point_id`)
    .all(input.projectId) as StoredRow[];
  const today = localDateOf(now, timezone);
  const meters = stored.filter((row) => names.has(row.meter_point_id)).map((row): LiveMeterReading => {
    const lastAt = Date.parse(row.last_at);
    const gap = row.prev_at ? lastAt - Date.parse(row.prev_at) : 0;
    const stale = now - lastAt > LIVE_STALE_MS;
    const powerKw = row.prev_energy_kwh !== null && gap >= POWER_MIN_GAP_MS && gap <= POWER_MAX_GAP_MS
      ? round((row.last_energy_kwh - row.prev_energy_kwh) / (gap / 3_600_000))
      : undefined;
    return {
      meterPointId: row.meter_point_id,
      name: names.get(row.meter_point_id)!,
      readAt: row.last_at,
      energyKwh: row.last_energy_kwh,
      ...(powerKw !== undefined ? { powerKw } : {}),
      ...(row.local_date === today ? { todayKwh: round(row.last_energy_kwh - row.day_first_energy_kwh) } : {}),
      stale,
    };
  });
  const officialMeters = meters.filter((meter) => official.has(meter.meterPointId));
  const reporting = officialMeters.filter((meter) => !meter.stale && meter.powerKw !== undefined);
  const complete = official.size > 0 && reporting.length === official.size;
  const todayComplete = official.size > 0
    && officialMeters.filter((meter) => !meter.stale && meter.todayKwh !== undefined).length === official.size;
  const readAt = meters.map((meter) => meter.readAt).sort().at(-1);
  return {
    connected: hasLiveSource(input.metadataStore, input.projectId),
    ...(readAt ? { readAt } : {}),
    ...(complete ? { powerKw: round(reporting.reduce((sum, meter) => sum + meter.powerKw!, 0)) } : {}),
    ...(todayComplete ? { todayKwh: round(officialMeters.reduce((sum, meter) => sum + meter.todayKwh!, 0)) } : {}),
    officialMeterCount: official.size,
    reportingMeterCount: reporting.length,
    meters,
    intervalMinutes: LIVE_READING_INTERVAL_MS / 60_000,
  };
};

/** Read one connected site's meters now and store the values. Meters that fail are skipped, not zeroed. */
export const pollLiveReadings = async (input: {
  metadataStore: MetadataStore;
  connector: EnergyTuyaProjectConnector;
  readLatestEnergy: (input: { devices: TuyaDeviceBinding[]; credentials?: EnergyTuyaProjectConnector["credentials"]; signal?: AbortSignal }) => Promise<TuyaLatestEnergyReading[]>;
  now?: () => number;
  signal?: AbortSignal;
}): Promise<{ read: number; failed: number }> => {
  const now = input.now ?? Date.now;
  const latest = await input.readLatestEnergy({
    devices: [...input.connector.devices],
    ...(input.connector.credentials ? { credentials: input.connector.credentials } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const meterByLabel = new Map(input.connector.meterPoints.map((meter) => [meter.sourceLabel, meter.meterPointId]));
  const readings = latest.flatMap((reading) => {
    const meterPointId = meterByLabel.get(reading.sourceLabel);
    return meterPointId && reading.energyKwh !== undefined ? [{ meterPointId, energyKwh: reading.energyKwh }] : [];
  });
  recordLiveReadings({
    db: input.metadataStore.db,
    projectId: input.connector.projectId,
    timezone: input.connector.publishedDocument.project.timezone,
    readAt: now(),
    readings,
  });
  return { read: readings.length, failed: latest.length - readings.length };
};

export type EnergyLiveReadingsPoller = {
  start(): void;
  stop(): Promise<void>;
  /** Read every connected site once; the timer calls it every 15 minutes. */
  pollAll(): Promise<void>;
};

/**
 * Every 15 minutes, read each site that has a live connection: the sites connected in the app, and the one the
 * server's own Tuya settings name. Sites are read one after another so a large site never competes with a small one.
 */
export const createEnergyLiveReadingsPoller = (input: {
  metadataStore: MetadataStore;
  readLatestEnergy: Parameters<typeof pollLiveReadings>[0]["readLatestEnergy"];
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  intervalMs?: number;
}): EnergyLiveReadingsPoller => {
  const env = input.env ?? process.env;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let controller: AbortController | undefined;
  const pollAll = (): Promise<void> => {
    running ??= (async () => {
      controller = new AbortController();
      try {
        for (const projectId of liveProjectIds(input.metadataStore, env)) {
          if (controller.signal.aborted) return;
          try {
            const connector = resolveEnergyTuyaProjectConnector({ metadataStore: input.metadataStore, projectId, env });
            const result = await pollLiveReadings({
              metadataStore: input.metadataStore,
              connector,
              readLatestEnergy: input.readLatestEnergy,
              ...(input.now ? { now: input.now } : {}),
              signal: controller.signal,
            });
            if (result.failed > 0) console.warn(`[live-readings] partial project=${projectId} read=${result.read} failed=${result.failed}`);
          } catch (error) {
            console.error(`[live-readings] failed project=${projectId} code=${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`);
          }
        }
      } finally {
        running = undefined;
        controller = undefined;
      }
    })();
    return running;
  };
  return {
    start() {
      if (timer) return;
      void pollAll();
      timer = setInterval(() => void pollAll(), input.intervalMs ?? LIVE_READING_INTERVAL_MS);
      timer.unref();
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      controller?.abort();
      if (running) await running;
    },
    pollAll,
  };
};

const liveProjectIds = (metadataStore: MetadataStore, env: NodeJS.ProcessEnv): string[] => {
  const ids = new Set(metadataStore.energyIq.liveConnectors.listSyncEnabled().map((connection) => connection.project_id));
  const configured = env.ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim();
  if (configured && env.ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON?.trim()) ids.add(configured);
  return [...ids].sort();
};

const hasLiveSource = (metadataStore: MetadataStore, projectId: string): boolean =>
  Boolean(metadataStore.energyIq.liveConnectors.find(projectId))
  || (process.env.ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim() === projectId && Boolean(process.env.ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON?.trim()));

const publishedDocument = (
  metadataStore: MetadataStore,
  projectId: string,
  hierarchyRevisionId: string | null | undefined,
): EnergyIqProjectSetupDocument | undefined => {
  if (!hierarchyRevisionId) return undefined;
  const revision = metadataStore.energyIq.projectSetup.listHierarchyRevisions(projectId)
    .find((candidate) => candidate.id === hierarchyRevisionId);
  return revision ? JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument : undefined;
};

/** The meters whose sum is the site total: the published project-level official routes for electricity. */
const officialProjectMeterIds = (document: EnergyIqProjectSetupDocument | undefined): Set<string> =>
  new Set((document?.meter_mapping?.official_aggregation_routes ?? [])
    .filter((route) => route.scope_id === "project" && route.resource === "electricity")
    .flatMap((route) => route.meter_point_ids));

const localDateOf = (epochMs: number, timezone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(epochMs));

const round = (value: number): number => Math.round(value * 1_000) / 1_000;

const ensureTable = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_live_readings (
      project_id TEXT NOT NULL,
      meter_point_id TEXT NOT NULL,
      local_date TEXT NOT NULL,
      day_first_energy_kwh REAL NOT NULL,
      prev_energy_kwh REAL,
      prev_at TEXT,
      last_energy_kwh REAL NOT NULL,
      last_at TEXT NOT NULL,
      PRIMARY KEY (project_id, meter_point_id)
    )
  `);
};
