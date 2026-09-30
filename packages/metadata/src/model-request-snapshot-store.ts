import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type ModelRequestSnapshotRecord = {
  id: string;
  user_id: string;
  session_id: string;
  run_id: string;
  step_number: number;
  retry_count: number;
  context_package_id: string;
  context_package_revision: number;
  payload_json: string;
  payload_availability: "not-retained" | "retained";
  content_sha256: string;
  created_at: string;
};

export type CreateModelRequestSnapshotInput = {
  user_id: string;
  session_id: string;
  run_id: string;
  step_number: number;
  retry_count: number;
  context_package_id: string;
  context_package_revision: number;
  payload: unknown;
};

export class ModelRequestSnapshotRepository {
  constructor(private readonly db: DatabaseSync) {}

  create(input: CreateModelRequestSnapshotInput): ModelRequestSnapshotRecord {
    requireNonNegativeInteger(input.step_number, "step_number");
    requireNonNegativeInteger(input.retry_count, "retry_count");
    requireNonNegativeInteger(input.context_package_revision, "context_package_revision");
    requireExactModelRequestIdentity(this.db, input);
    const id = modelRequestSnapshotId(input.run_id, input.step_number, input.retry_count);
    const canonicalPayloadJson = JSON.stringify(canonicalizeJson(input.payload));
    if (typeof canonicalPayloadJson !== "string") throw new Error("MODEL_REQUEST_SNAPSHOT_INVALID:payload");
    const contentSha256 = `sha256:${createHash("sha256").update(canonicalPayloadJson).digest("hex")}`;
    const payloadJson = JSON.stringify({ retention: "hash-only" });
    const existing = this.find({ user_id: input.user_id, id });
    if (existing) {
      if (!sameIdentity(existing, input) || existing.content_sha256 !== contentSha256) {
        throw new Error(`MODEL_REQUEST_SNAPSHOT_IMMUTABLE:${id}`);
      }
      return existing;
    }

    this.db.prepare(`
      INSERT INTO model_request_snapshots (
        id, user_id, session_id, run_id, step_number, retry_count,
        context_package_id, context_package_revision, payload_json, payload_availability,
        content_sha256, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.user_id,
      input.session_id,
      input.run_id,
      input.step_number,
      input.retry_count,
      input.context_package_id,
      input.context_package_revision,
      payloadJson,
      "not-retained",
      contentSha256,
      new Date().toISOString(),
    );
    return this.get({ user_id: input.user_id, id });
  }

  find(input: { user_id: string; id: string }): ModelRequestSnapshotRecord | undefined {
    return mapRow(this.db.prepare(`
      SELECT * FROM model_request_snapshots WHERE user_id = ? AND id = ?
    `).get(input.user_id, input.id));
  }

  get(input: { user_id: string; id: string }): ModelRequestSnapshotRecord {
    const snapshot = this.find(input);
    if (!snapshot) throw new Error(`MODEL_REQUEST_SNAPSHOT_NOT_FOUND:${input.id}`);
    return snapshot;
  }
}

const modelRequestSnapshotId = (runId: string, stepNumber: number, retryCount: number): string =>
  `model-request:${runId}:${stepNumber}:${retryCount}`;

const requireExactModelRequestIdentity = (
  db: DatabaseSync,
  input: CreateModelRequestSnapshotInput,
): void => {
  const run = db.prepare(`
    SELECT session_id FROM runs WHERE user_id = ? AND id = ?
  `).get(input.user_id, input.run_id);
  if (!isRecord(run)) {
    throw new Error("MODEL_REQUEST_SNAPSHOT_IDENTITY_MISMATCH:run_id");
  }
  if (run.session_id !== input.session_id) {
    throw new Error("MODEL_REQUEST_SNAPSHOT_IDENTITY_MISMATCH:session_id");
  }
  const contextPackage = db.prepare(`
    SELECT session_id, run_id FROM context_package_snapshots
    WHERE user_id = ? AND package_id = ? AND revision = ?
  `).get(input.user_id, input.context_package_id, input.context_package_revision);
  if (!isRecord(contextPackage)
    || contextPackage.session_id !== input.session_id
    || contextPackage.run_id !== input.run_id) {
    throw new Error("MODEL_REQUEST_SNAPSHOT_IDENTITY_MISMATCH:context_package");
  }
};

const sameIdentity = (
  record: ModelRequestSnapshotRecord,
  input: CreateModelRequestSnapshotInput,
): boolean => record.session_id === input.session_id
  && record.run_id === input.run_id
  && record.step_number === input.step_number
  && record.retry_count === input.retry_count
  && record.context_package_id === input.context_package_id
  && record.context_package_revision === input.context_package_revision;

const canonicalizeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalizeJson(item)]),
  );
};

const mapRow = (row: unknown): ModelRequestSnapshotRecord | undefined => {
  if (!isRecord(row)) return undefined;
  return {
    id: requiredString(row, "id"),
    user_id: requiredString(row, "user_id"),
    session_id: requiredString(row, "session_id"),
    run_id: requiredString(row, "run_id"),
    step_number: requiredInteger(row, "step_number"),
    retry_count: requiredInteger(row, "retry_count"),
    context_package_id: requiredString(row, "context_package_id"),
    context_package_revision: requiredInteger(row, "context_package_revision"),
    payload_json: requiredString(row, "payload_json"),
    payload_availability: requiredPayloadAvailability(row),
    content_sha256: requiredString(row, "content_sha256"),
    created_at: requiredString(row, "created_at"),
  };
};

const requireNonNegativeInteger = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`MODEL_REQUEST_SNAPSHOT_INVALID:${field}`);
};

const requiredString = (row: Record<string, unknown>, field: string): string => {
  const value = row[field];
  if (typeof value !== "string") throw new Error(`MODEL_REQUEST_SNAPSHOT_INVALID:${field}`);
  return value;
};

const requiredInteger = (row: Record<string, unknown>, field: string): number => {
  const value = row[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`MODEL_REQUEST_SNAPSHOT_INVALID:${field}`);
  }
  return value;
};

const requiredPayloadAvailability = (
  row: Record<string, unknown>,
): ModelRequestSnapshotRecord["payload_availability"] => {
  const value = row.payload_availability;
  if (value !== "not-retained" && value !== "retained") {
    throw new Error("MODEL_REQUEST_SNAPSHOT_INVALID:payload_availability");
  }
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
