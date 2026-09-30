import type {
  AdapterExecutionInput,
  AdapterPreviewInput,
  AdapterSqlInput,
  DataSourceAdapter,
  SchemaSummary,
  TableResult
} from "../types.js";
import { DatabaseSync } from "node:sqlite";
import type * as DuckDbModule from "duckdb";
import { AsyncLocalStorage } from "node:async_hooks";
import { resolve } from "node:path";
import { getDuckDbDatabase, openDuckDbDatabase } from "../duckdb-database-cache.js";
import {
  assertEnergySnapshotReceipt,
  energySnapshotGuardSql,
  type EnergySnapshotGuardScope,
  type EnergySnapshotIdentityScope,
} from "../energy-snapshot-guard.js";

type EnergySnapshotReadSessionState = {
  connection: DuckDbModule.Connection;
  databasePath: string;
  detachCleanup: boolean;
  scope: EnergySnapshotGuardScope;
  tail: Promise<void>;
};

const energySnapshotReadSession = new AsyncLocalStorage<EnergySnapshotReadSessionState>();

export class SQLiteAdapter implements DataSourceAdapter {
  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const database = this.open();

    try {
      const tables = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
        .all()
        .map((row) => requiredRecordString(row, "name"));

      return {
        tables: tables.map((table) => ({
          name: table,
          columns: database
            .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
            .all()
            .map((row) => ({
              name: requiredRecordString(row, "name"),
              type: requiredRecordString(row, "type") || "TEXT",
              nullable: requiredRecordNumber(row, "notnull") === 0
            }))
        }))
      };
    } finally {
      database.close();
    }
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    const database = this.open();

    try {
      const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(input.table)} LIMIT ?`).all(input.limit);
      return rowsToTableResult(rows);
    } finally {
      database.close();
    }
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    // node:sqlite DatabaseSync is synchronous; cancellation is cooperative before
    // statement execution. Hard cancel would require worker-thread isolation.
    const database = this.open();

    try {
      const rows = database.prepare(applyStandardLimit(input.sql, input.limit)).all();
      return rowsToTableResult(rows);
    } finally {
      database.close();
    }
  }

  private open(): DatabaseSync {
    const path = stringConfig(this.config, "path");
    return new DatabaseSync(path);
  }
}

export class DuckDbAdapter implements DataSourceAdapter {
  private memoryDatabase: Promise<DuckDbModule.Database> | undefined;

  constructor(private readonly config: Record<string, unknown>) {}

  async inspectSchema(input: AdapterExecutionInput = {}): Promise<Omit<SchemaSummary, "datasource_id">> {
    throwIfAborted(input.signal);
    const rows = await this.query(`
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'main'
      ORDER BY table_name, ordinal_position
    `, input.signal);
    return schemaRowsToSummary(rows, "table_name", "column_name", "data_type", "is_nullable");
  }

  async previewTable(input: AdapterPreviewInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(
      `SELECT * FROM ${quoteIdentifier(input.table)} LIMIT ${input.limit}`,
      input.signal
    ));
  }

  async runSqlReadonly(input: AdapterSqlInput): Promise<TableResult> {
    throwIfAborted(input.signal);
    return rowsToTableResult(await this.query(applyStandardLimit(input.sql, input.limit), input.signal));
  }

  async withEnergySnapshotReadSession<T>(execute: (scope: EnergySnapshotGuardScope) => Promise<T>): Promise<T> {
    const databasePath = normalizeDuckDbPath(stringConfig(this.config, "path"));
    const expectedScope = energySnapshotIdentityScope(this.config.energyQueryScope);
    if (!expectedScope) throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
    const existing = energySnapshotReadSession.getStore();
    if (existing) {
      assertSameEnergySnapshotSession(existing, databasePath, expectedScope);
      return await execute(existing.scope);
    }
    const database = await this.database(databasePath);
    const connection = database.connect();
    let session: EnergySnapshotReadSessionState | undefined;
    try {
      await duckDbAll(connection, "BEGIN TRANSACTION");
      const scope = await readEnergySnapshotStateReceipt(connection, expectedScope);
      session = {
        connection,
        databasePath,
        detachCleanup: false,
        scope,
        tail: Promise.resolve(),
      };
      return await energySnapshotReadSession.run(session, () => execute(scope));
    } finally {
      const cleanup = async (): Promise<void> => {
        await session?.tail.catch(() => undefined);
        await duckDbAll(connection, "ROLLBACK").catch(() => undefined);
        await duckDbClose(connection).catch(ignoreAlreadyClosed);
      };
      if (session?.detachCleanup) {
        void cleanup().catch(() => undefined);
      } else {
        await cleanup();
      }
    }
  }

  private async query(sql: string, signal?: AbortSignal | undefined): Promise<Record<string, unknown>[]> {
    const databasePath = normalizeDuckDbPath(stringConfig(this.config, "path"));
    const snapshotScope = energySnapshotScope(this.config.energyQueryScope);
    const session = energySnapshotReadSession.getStore();
    if (session) {
      if (!snapshotScope) throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
      assertSameEnergySnapshotSession(session, databasePath, snapshotScope);
      const prior = session.tail;
      let started = false;
      const markDetachedCleanup = (): void => {
        if (isSessionInterruption(signal?.reason)) session.detachCleanup = true;
      };
      signal?.addEventListener("abort", markDetachedCleanup, { once: true });
      if (signal?.aborted) markDetachedCleanup();
      const completion = prior.then(async () => {
        started = true;
        throwIfAborted(signal);
        return await duckDbAll(session.connection, sql, signal);
      });
      void completion.then(
        () => signal?.removeEventListener("abort", markDetachedCleanup),
        () => signal?.removeEventListener("abort", markDetachedCleanup),
      );
      session.tail = completion.then(() => undefined, () => undefined);
      return (await rejectIfAbortedWhileQueued(completion, signal, () => started)).filter(isRecord);
    }
    const database = await this.database(databasePath);
    const connection = database.connect();
    try {
      if (snapshotScope) {
        await duckDbAll(connection, "BEGIN TRANSACTION", signal);
        await assertEnergySnapshotState(connection, snapshotScope, signal);
      }
      const rows = await duckDbAll(connection, sql, signal);
      return rows.filter(isRecord);
    } finally {
      if (snapshotScope) await duckDbAll(connection, "ROLLBACK").catch(() => undefined);
      await duckDbClose(connection).catch(ignoreAlreadyClosed);
    }
  }

  private async database(databasePath: string): Promise<DuckDbModule.Database> {
    if (databasePath !== ":memory:") return await getDuckDbDatabase(databasePath);
    this.memoryDatabase ??= openDuckDbDatabase(databasePath);
    return await this.memoryDatabase;
  }
}

const energySnapshotScope = (value: unknown): EnergySnapshotGuardScope | undefined => {
  if (!isRecord(value)) return undefined;
  const sourceSha256 = value.sourceSha256;
  if (typeof value.workspaceId !== "string"
    || typeof value.projectId !== "string"
    || typeof value.dataSnapshotId !== "string"
    || typeof value.manifestFingerprint !== "string"
    || typeof value.factWriterContractVersion !== "string"
    || typeof value.canonicalIntervalCount !== "number"
    || !Number.isSafeInteger(value.canonicalIntervalCount)
    || value.canonicalIntervalCount < 0
    || typeof value.canonicalIntervalDigest !== "string"
    || !/^[a-f0-9]{64}$/u.test(value.canonicalIntervalDigest)
    || !Array.isArray(sourceSha256)
    || !sourceSha256.every((source) => typeof source === "string")) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  return {
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    dataSnapshotId: value.dataSnapshotId,
    manifestFingerprint: value.manifestFingerprint,
    sourceSha256,
    factWriterContractVersion: value.factWriterContractVersion,
    canonicalIntervalCount: value.canonicalIntervalCount,
    canonicalIntervalDigest: value.canonicalIntervalDigest,
  };
};

const energySnapshotIdentityScope = (value: unknown): EnergySnapshotIdentityScope | undefined => {
  if (!isRecord(value)) return undefined;
  const sourceSha256 = value.sourceSha256;
  if (typeof value.workspaceId !== "string"
    || typeof value.projectId !== "string"
    || typeof value.dataSnapshotId !== "string"
    || typeof value.manifestFingerprint !== "string"
    || typeof value.factWriterContractVersion !== "string"
    || !Array.isArray(sourceSha256)
    || !sourceSha256.every((source) => typeof source === "string")) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  return {
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    dataSnapshotId: value.dataSnapshotId,
    manifestFingerprint: value.manifestFingerprint,
    sourceSha256,
    factWriterContractVersion: value.factWriterContractVersion,
  };
};

const assertSameEnergySnapshotSession = (
  session: EnergySnapshotReadSessionState,
  databasePath: string,
  scope: EnergySnapshotIdentityScope,
): void => {
  if (session.databasePath !== databasePath) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  assertEnergySnapshotReceipt(scope, session.scope);
};

const assertEnergySnapshotState = async (
  connection: DuckDbModule.Connection,
  scope: EnergySnapshotGuardScope,
  signal?: AbortSignal,
): Promise<void> => {
  await duckDbAll(connection, `SELECT ${energySnapshotGuardSql(scope)} AS snapshot_valid`, signal);
};

const readEnergySnapshotStateReceipt = async (
  connection: DuckDbModule.Connection,
  expected: EnergySnapshotIdentityScope,
): Promise<EnergySnapshotGuardScope> => {
  let rows: DuckDbModule.TableData;
  try {
    rows = await duckDbAll(connection, `
      SELECT workspace_id, project_id, data_snapshot_id, manifest_fingerprint,
        source_sha256_json, fact_writer_contract_version,
        canonical_interval_count, canonical_interval_digest
      FROM energy_project_fact_state
      WHERE project_id = ${sqlLiteral(expected.projectId)}
    `);
  } catch {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  if (rows.length !== 1 || !isRecord(rows[0])) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const row = rows[0];
  let sourceSha256: unknown;
  try {
    sourceSha256 = JSON.parse(String(row.source_sha256_json));
  } catch {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const canonicalIntervalCount = Number(row.canonical_interval_count);
  const canonicalIntervalDigest = String(row.canonical_interval_digest);
  if (!Array.isArray(sourceSha256)
    || !sourceSha256.every((value) => typeof value === "string")
    || !Number.isSafeInteger(canonicalIntervalCount)
    || canonicalIntervalCount < 0
    || !/^[a-f0-9]{64}$/u.test(canonicalIntervalDigest)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const actual: EnergySnapshotGuardScope = {
    workspaceId: String(row.workspace_id),
    projectId: String(row.project_id),
    dataSnapshotId: String(row.data_snapshot_id),
    manifestFingerprint: String(row.manifest_fingerprint),
    sourceSha256,
    factWriterContractVersion: String(row.fact_writer_contract_version),
    canonicalIntervalCount,
    canonicalIntervalDigest,
  };
  assertEnergySnapshotReceipt(expected, actual);
  return actual;
};

const normalizeDuckDbPath = (databasePath: string): string =>
  databasePath === ":memory:" ? databasePath : resolve(databasePath);

const rejectIfAbortedWhileQueued = async <T>(
  completion: Promise<T>,
  signal: AbortSignal | undefined,
  hasStarted: () => boolean,
): Promise<T> => {
  if (!signal) return await completion;
  throwIfAborted(signal);
  let abortListener: (() => void) | undefined;
  const aborted = new Promise<T>((_, reject) => {
    abortListener = () => {
      if (!hasStarted()) reject(abortReason(signal));
    };
    signal.addEventListener("abort", abortListener, { once: true });
    if (signal.aborted) abortListener();
  });
  try {
    return await Promise.race([completion, aborted]);
  } finally {
    if (abortListener) signal.removeEventListener("abort", abortListener);
  }
};

const duckDbAll = async (
  connection: DuckDbModule.Connection,
  sql: string,
  signal?: AbortSignal | undefined,
): Promise<DuckDbModule.TableData> =>
  await new Promise((resolve, reject) => {
    throwIfAborted(signal);
    let aborted: Error | undefined;
    const abort = (): void => {
      aborted = abortReason(signal);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      signal.removeEventListener("abort", abort);
      reject(abortReason(signal));
      return;
    }
    connection.all(sql, (error, rows) => {
      signal?.removeEventListener("abort", abort);
      if (aborted) {
        reject(aborted);
      } else if (error) {
        reject(error);
      } else {
        resolve(rows);
      }
    });
  });

const abortReason = (signal?: AbortSignal): Error =>
  signal?.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED");

const isSessionInterruption = (reason: unknown): boolean =>
  reason instanceof Error
  && (reason.message === "SQL_TIMEOUT" || reason.message === "RUN_CANCELLED" || reason.name === "AbortError");

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const duckDbClose = async (connection: DuckDbModule.Connection): Promise<void> =>
  await new Promise((resolve, reject) => {
    connection.close((error) => error ? reject(error) : resolve());
  });

const ignoreAlreadyClosed = (error: unknown): void => {
  if (error instanceof Error && error.message.includes("already closed")) {
    return;
  }
  throw error;
};

const applyStandardLimit = (sql: string, limit: number): string => {
  if (/\bLIMIT\s+\d+\b/iu.test(sql)) {
    return sql;
  }

  return `SELECT * FROM (${sql}) AS readonly_query LIMIT ${limit}`;
};

const rowsToTableResult = (rows: unknown[]): TableResult => {
  const objectRows = rows.filter(isRecord);
  const columns = Array.from(new Set(objectRows.flatMap((row) => Object.keys(row))));

  return objectRowsToTableResult(objectRows, columns);
};

const objectRowsToTableResult = (rows: Record<string, unknown>[], columns: string[]): TableResult => ({
  columns,
  rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
  row_count: rows.length
});

const schemaRowsToSummary = (
  rows: Record<string, unknown>[],
  tableKey: string,
  columnKey: string,
  typeKey: string,
  nullableKey: string
): Omit<SchemaSummary, "datasource_id"> => {
  const tables = new Map<string, SchemaSummary["tables"][number]>();
  rows.forEach((row) => {
    const tableName = requiredRecordStringLoose(row, tableKey);
    const table = tables.get(tableName) ?? { name: tableName, columns: [] };
    table.columns.push({
      name: requiredRecordStringLoose(row, columnKey),
      type: requiredRecordStringLoose(row, typeKey),
      nullable: requiredRecordStringLoose(row, nullableKey).toUpperCase() === "YES"
    });
    tables.set(tableName, table);
  });
  return { tables: [...tables.values()] };
};

const stringConfig = (config: Record<string, unknown>, key: string, defaultValue?: string): string => {
  const value = config[key];

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Missing config value: ${key}`);
};

const quoteIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const requiredRecordString = (row: unknown, key: string): string => {
  if (!isRecord(row) || typeof row[key] !== "string") {
    throw new Error(`Expected string column: ${key}`);
  }

  return row[key];
};

const requiredRecordStringLoose = (row: unknown, key: string): string => {
  if (!isRecord(row)) {
    throw new Error(`Expected string column: ${key}`);
  }
  const value = row[key] ?? row[key.toUpperCase()] ?? row[key.toLowerCase()];
  if (typeof value !== "string") {
    throw new Error(`Expected string column: ${key}`);
  }
  return value;
};

const requiredRecordNumber = (row: unknown, key: string): number => {
  if (!isRecord(row) || typeof row[key] !== "number") {
    throw new Error(`Expected number column: ${key}`);
  }

  return row[key];
};

const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED");
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
