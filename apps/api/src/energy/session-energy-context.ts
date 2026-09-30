import type { ContextPackageSnapshotRecord } from "@datafoundry/metadata";

export type EnergySessionForkLineage = {
  sourceSessionId: string;
  sourceRunId: string;
  sourceFrom: string;
  sourceTo: string;
};

export type EnergySessionForkUnavailableLineage = {
  status: "unavailable";
  sourceSessionId: string;
  reason: "source-run-unavailable" | "source-context-unavailable";
};

export type EnergySessionForkProvenance =
  | EnergySessionForkLineage
  | EnergySessionForkUnavailableLineage;

export const validateEnergySessionForkLineage = (input: {
  currentSessionId: string;
  currentWorkspaceId: string;
  currentProjectId: string;
  lineage: EnergySessionForkLineage;
  readSourceSession: (sessionId: string) => {
    workspaceId: string | null | undefined;
    projectId: string | null | undefined;
  };
  readSourceRunContext: (runId: string) => {
    sessionId: string | null | undefined;
    workspaceId: string | null | undefined;
    projectId: string | null | undefined;
    from: string | null | undefined;
    to: string | null | undefined;
  };
}): EnergySessionForkLineage => {
  if (input.lineage.sourceSessionId === input.currentSessionId) {
    throw new Error("ENERGYIQ_SESSION_FORK_SELF_REFERENCE");
  }
  const source = input.readSourceSession(input.lineage.sourceSessionId);
  if (source.workspaceId !== input.currentWorkspaceId) {
    throw new Error("ENERGYIQ_SESSION_FORK_WORKSPACE_MISMATCH");
  }
  if (source.projectId !== input.currentProjectId) {
    throw new Error("ENERGYIQ_SESSION_FORK_PROJECT_MISMATCH");
  }
  const sourceRun = input.readSourceRunContext(input.lineage.sourceRunId);
  if (sourceRun.sessionId !== input.lineage.sourceSessionId) {
    throw new Error("ENERGYIQ_SESSION_FORK_RUN_MISMATCH");
  }
  if (
    sourceRun.workspaceId !== input.currentWorkspaceId
    || sourceRun.projectId !== input.currentProjectId
  ) {
    throw new Error("ENERGYIQ_SESSION_FORK_SOURCE_CONTEXT_MISMATCH");
  }
  if (!validWindow(sourceRun.from ?? undefined, sourceRun.to ?? undefined)) {
    throw new Error("ENERGYIQ_SESSION_FORK_SOURCE_CONTEXT_UNAVAILABLE");
  }
  return {
    ...input.lineage,
    sourceFrom: sourceRun.from!,
    sourceTo: sourceRun.to!,
  };
};

export type SessionEnergyContextDto = {
  sourceRunId?: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  scopeType: string;
  resource: "electricity" | "water";
  timezone: string;
  from: string;
  to: string;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  projectReleaseId?: string;
  dataSnapshotId: string;
  forkedFromSessionId?: string;
  forkedFromContextStatus?: "available" | "unavailable";
  forkedFromUnavailableReason?:
    | "source-run-unavailable"
    | "source-context-unavailable";
  forkedFromRunId?: string;
  forkedFromFrom?: string;
  forkedFromTo?: string;
};

export type SessionEnergyContextSnapshotInspection =
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "available"; context: SessionEnergyContextDto };

/** Recover server-authored source disclosure without treating it as current Evidence. */
export const energySessionForkProvenanceFromContext = (
  context: SessionEnergyContextDto | undefined,
): EnergySessionForkProvenance | undefined => {
  if (!context?.forkedFromSessionId) return undefined;
  if (context.forkedFromContextStatus === "unavailable") {
    return context.forkedFromUnavailableReason
      ? {
          status: "unavailable",
          sourceSessionId: context.forkedFromSessionId,
          reason: context.forkedFromUnavailableReason,
        }
      : undefined;
  }
  return context.forkedFromRunId && context.forkedFromFrom && context.forkedFromTo
    ? {
        sourceSessionId: context.forkedFromSessionId,
        sourceRunId: context.forkedFromRunId,
        sourceFrom: context.forkedFromFrom,
        sourceTo: context.forkedFromTo,
      }
    : undefined;
};

export const sessionEnergyContextFromSnapshot = (
  snapshot: ContextPackageSnapshotRecord,
): SessionEnergyContextDto | undefined => {
  const inspection = inspectSessionEnergyContextSnapshot(snapshot);
  return inspection.status === "available" ? inspection.context : undefined;
};

/** Distinguish a non-Energy package from a malformed server-owned Energy binding. */
export const inspectSessionEnergyContextSnapshot = (
  snapshot: ContextPackageSnapshotRecord,
): SessionEnergyContextSnapshotInspection => {
  const payload = parseRecord(snapshot.payload_json);
  if (!payload) return { status: "invalid" };
  const payloadItems = ownValue(payload, "items");
  const items = Array.isArray(payloadItems) ? payloadItems : [];
  const item = items.find(isPotentialEnergyContextItem);
  if (!item) return { status: "absent" };
  if (!isAuthoritativeEnergyContextItem(item)) return { status: "invalid" };

  const metadata = recordValue(ownValue(item, "metadata"));
  const structured = recordValue(ownValue(metadata, "energyQueryContext"));
  const values = structured ?? keyValueLines(ownValue(item, "content"));
  if (!values) return { status: "invalid" };

  const context = sessionEnergyContextFromValues(values, snapshot.run_id);
  return context ? { status: "available", context } : { status: "invalid" };
};

/**
 * Resolve one exact Energy binding from snapshots ordered newest-first.
 * Generic packages are unrelated siblings and cannot mask an older
 * authoritative Energy package; a malformed Energy candidate fails closed.
 */
export const inspectLatestAuthoritativeEnergyContextSnapshots = (
  snapshots: Iterable<ContextPackageSnapshotRecord>,
): SessionEnergyContextSnapshotInspection => {
  for (const snapshot of snapshots) {
    const inspection = inspectSessionEnergyContextSnapshot(snapshot);
    if (inspection.status === "absent") continue;
    return inspection;
  }
  return { status: "absent" };
};

/** Restore a server-authored context persisted when a Session is created pre-Run. */
export const sessionEnergyContextFromPersistedJson = (
  value: string | undefined,
): SessionEnergyContextDto | undefined => {
  if (!value) return undefined;
  const parsed = parseRecord(value);
  return parsed ? sessionEnergyContextFromValues(parsed) : undefined;
};

const sessionEnergyContextFromValues = (
  values: Record<string, unknown>,
  sourceRunId?: string,
): SessionEnergyContextDto | undefined => {
  const workspaceId = boundedString(values, "workspaceId", "workspace_id");
  const projectId = boundedString(values, "projectId", "project_id");
  const projectName = boundedString(values, "projectName", "project_name");
  const scopeId = boundedString(values, "scopeId", "scope_id");
  const scopeName = boundedString(values, "scopeName", "scope_name");
  const scopeType = boundedString(values, "scopeType", "scope_type");
  const resource = boundedString(values, "resource");
  const timezone = boundedString(values, "timezone");
  const from = boundedString(values, "from");
  const to = boundedString(values, "to", "to_exclusive");
  const hierarchyRevisionId = boundedString(
    values,
    "hierarchyRevisionId",
    "hierarchy_revision_id",
  );
  const meterMappingRevisionId = boundedString(
    values,
    "meterMappingRevisionId",
    "meter_mapping_revision_id",
  );
  const meterFormulaRevisionId = boundedString(
    values,
    "meterFormulaRevisionId",
    "meter_formula_revision_id",
  );
  const projectReleaseIdentity = optionalBoundedString(
    values,
    "projectReleaseId",
    "project_release_id",
  );
  if (!projectReleaseIdentity.valid) return undefined;
  const projectReleaseId = projectReleaseIdentity.value;
  const dataSnapshotId = boundedString(values, "dataSnapshotId", "data_snapshot_id");
  const forkedFromSessionIdentity = optionalBoundedString(
    values,
    "forkedFromSessionId",
    "forked_from_session_id",
  );
  const forkedFromContextStatusIdentity = optionalBoundedString(
    values,
    "forkedFromContextStatus",
    "forked_from_context_status",
  );
  const forkedFromUnavailableReasonIdentity = optionalBoundedString(
    values,
    "forkedFromUnavailableReason",
    "forked_from_unavailable_reason",
  );
  const forkedFromRunIdentity = optionalBoundedString(
    values,
    "forkedFromRunId",
    "forked_from_run_id",
  );
  const forkedFromFromIdentity = optionalBoundedString(
    values,
    "forkedFromFrom",
    "forked_from_from",
  );
  const forkedFromToIdentity = optionalBoundedString(
    values,
    "forkedFromTo",
    "forked_from_to",
  );
  if (
    !forkedFromSessionIdentity.valid
    || !forkedFromContextStatusIdentity.valid
    || !forkedFromUnavailableReasonIdentity.valid
    || !forkedFromRunIdentity.valid
    || !forkedFromFromIdentity.valid
    || !forkedFromToIdentity.valid
  ) return undefined;
  const forkedFromSessionId = forkedFromSessionIdentity.value;
  const forkedFromContextStatus = forkedFromContextStatusIdentity.value;
  const forkedFromUnavailableReason = forkedFromUnavailableReasonIdentity.value;
  const forkedFromRunId = forkedFromRunIdentity.value;
  const forkedFromFrom = forkedFromFromIdentity.value;
  const forkedFromTo = forkedFromToIdentity.value;
  const hasForkIdentity = Boolean(
    forkedFromSessionId
    || forkedFromContextStatus
    || forkedFromUnavailableReason
    || forkedFromRunId
    || forkedFromFrom
    || forkedFromTo
  );
  const normalizedForkStatus: "available" | "unavailable" | undefined =
    forkedFromContextStatus === "available" || forkedFromContextStatus === "unavailable"
      ? forkedFromContextStatus
      : forkedFromSessionId
        ? "available"
        : undefined;
  const availableForkValid = normalizedForkStatus === "available"
    && Boolean(
      forkedFromSessionId
      && forkedFromRunId
      && validWindow(forkedFromFrom, forkedFromTo)
      && !forkedFromUnavailableReason
    );
  const unavailableForkValid = normalizedForkStatus === "unavailable"
    && Boolean(
      forkedFromSessionId
      && !forkedFromRunId
      && !forkedFromFrom
      && !forkedFromTo
      && (
        forkedFromUnavailableReason === "source-run-unavailable"
        || forkedFromUnavailableReason === "source-context-unavailable"
      )
    );

  if (
    !workspaceId
    || !projectId
    || !projectName
    || !scopeId
    || !scopeName
    || !scopeType
    || (resource !== "electricity" && resource !== "water")
    || !timezone
    || !validWindow(from, to)
    || !hierarchyRevisionId
    || !meterMappingRevisionId
    || !meterFormulaRevisionId
    || !dataSnapshotId
    || (hasForkIdentity && !availableForkValid && !unavailableForkValid)
  ) {
    return undefined;
  }

  return {
    ...(sourceRunId ? { sourceRunId } : {}),
    workspaceId,
    projectId,
    projectName,
    scopeId,
    scopeName,
    scopeType,
    resource,
    timezone,
    from: from!,
    to: to!,
    hierarchyRevisionId,
    meterMappingRevisionId,
    meterFormulaRevisionId,
    ...(projectReleaseId ? { projectReleaseId } : {}),
    dataSnapshotId,
    ...(forkedFromSessionId
      ? {
          forkedFromSessionId,
          forkedFromContextStatus: normalizedForkStatus!,
          ...(normalizedForkStatus === "available"
            ? {
                forkedFromRunId: forkedFromRunId!,
                forkedFromFrom: forkedFromFrom!,
                forkedFromTo: forkedFromTo!,
              }
            : {
                forkedFromUnavailableReason: forkedFromUnavailableReason as
                  | "source-run-unavailable"
                  | "source-context-unavailable",
              }),
        }
      : {}),
  };
};

const isAuthoritativeEnergyContextItem = (
  value: unknown,
): value is Record<string, unknown> => {
  const item = recordValue(value);
  const metadata = recordValue(ownValue(item, "metadata"));
  const sourceType = ownValue(item, "sourceType");
  const supportedProjection = sourceType === "energy-query-context"
    || (
      sourceType === "evidence-focus"
      && ownValue(metadata, "originalSourceType") === "energy-query-context"
    );
  return supportedProjection
    && ownValue(item, "trust") === "tool"
    && ownValue(metadata, "sourceKind") === "energy-query-context"
    && ownValue(metadata, "sourceOwner") === "server";
};

const isPotentialEnergyContextItem = (value: unknown): boolean => {
  const item = recordValue(value);
  const metadata = recordValue(ownValue(item, "metadata"));
  const sourceType = ownValue(item, "sourceType");
  return sourceType === "energy-query-context"
    || (
      sourceType === "evidence-focus"
      && ownValue(metadata, "originalSourceType") === "energy-query-context"
    );
};

const keyValueLines = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== "string") return undefined;
  const entries: Array<[string, string]> = [];
  for (const line of value.split(/\r?\n/u)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    entries.push([line.slice(0, separator).trim(), line.slice(separator + 1).trim()]);
  }
  return Object.fromEntries(entries);
};

const boundedString = (
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const candidate = ownValue(value, key);
    if (typeof candidate === "string" && candidate.length > 0 && candidate.length <= 500) {
      return candidate;
    }
  }
  return undefined;
};

const optionalBoundedString = (
  value: Record<string, unknown>,
  ...keys: string[]
): { valid: boolean; value?: string } => {
  const present = keys.filter((key) => Object.prototype.hasOwnProperty.call(value, key));
  if (present.length === 0) return { valid: true };
  if (present.length !== 1) return { valid: false };
  const candidate = value[present[0]!];
  return typeof candidate === "string" && candidate.length > 0 && candidate.length <= 500
    ? { valid: true, value: candidate }
    : { valid: false };
};

const validWindow = (from: string | undefined, to: string | undefined): boolean => {
  const fromTime = from ? Date.parse(from) : Number.NaN;
  const toTime = to ? Date.parse(to) : Number.NaN;
  return Number.isFinite(fromTime) && Number.isFinite(toTime) && toTime > fromTime;
};

const parseRecord = (value: string): Record<string, unknown> | undefined => {
  try {
    return recordValue(JSON.parse(value));
  } catch {
    return undefined;
  }
};

const recordValue = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const ownValue = (
  value: Record<string, unknown> | undefined,
  key: string,
): unknown => value && Object.prototype.hasOwnProperty.call(value, key)
  ? value[key]
  : undefined;
