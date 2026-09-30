import type {
  EnergyQueryContextDto,
  SessionEnergyContextDto,
} from "../../../lib/config-api";

export type EnergySessionContextStatus =
  | { status: "current" }
  | { status: "outdated"; reason: string };

export type EnergySessionInitialRestoreKey = string | null | false;

export function decideEnergySessionContextRestore(input: {
  pathname: string;
  currentSearchParams: Pick<URLSearchParams, "entries" | "get">;
  context: SessionEnergyContextDto;
  initialRestoredContextKey: EnergySessionInitialRestoreKey;
}): { href: string | null; initialRestoredContextKey: EnergySessionInitialRestoreKey } {
  const contextKey = restoredContextKey(input.context);
  if (input.initialRestoredContextKey === null) {
    if (hasExplicitExactWindow(input.currentSearchParams)) {
      return { href: null, initialRestoredContextKey: contextKey };
    }
    return {
      href: null,
      initialRestoredContextKey: false,
    };
  }
  if (input.initialRestoredContextKey === contextKey) {
    return { href: null, initialRestoredContextKey: contextKey };
  }
  return {
    href: restoredEnergySessionHref(
      input.pathname,
      input.currentSearchParams,
      input.context,
    ),
    initialRestoredContextKey: false,
  };
}

export function restoredEnergySessionHref(
  pathname: string,
  currentSearchParams: Pick<URLSearchParams, "entries">,
  context: SessionEnergyContextDto,
): string | null {
  const next = new URLSearchParams([...currentSearchParams.entries()]);
  next.set("projectId", context.projectId);
  next.set("scopeId", context.scopeId);
  next.set("resource", context.resource);
  next.set("period", "Custom");
  next.set("from", context.from);
  next.set("to", context.to);
  next.set("dataSnapshotId", context.dataSnapshotId);
  if (context.projectReleaseId) {
    next.set("projectReleaseId", context.projectReleaseId);
  } else {
    next.delete("projectReleaseId");
  }
  for (const staleKey of [
    "currentFrom",
    "currentTo",
    "currentDataSnapshotId",
    "currentProjectReleaseId",
    "finding",
    "evidence",
  ]) {
    next.delete(staleKey);
  }

  const current = new URLSearchParams([...currentSearchParams.entries()]);
  return next.toString() === current.toString()
    ? null
    : `${pathname}?${next.toString()}`;
}

function hasExplicitExactWindow(
  searchParams: Pick<URLSearchParams, "get">,
): boolean {
  return searchParams.get("period") === "Custom"
    && Boolean(searchParams.get("projectId"))
    && Boolean(searchParams.get("from"))
    && Boolean(searchParams.get("to"));
}

export function freshEnergyAnalysisTaskHref(
  pathname: string,
  currentSearchParams: Pick<URLSearchParams, "entries">,
): string | null {
  const current = new URLSearchParams([...currentSearchParams.entries()]);
  const next = new URLSearchParams([...currentSearchParams.entries()]);
  for (const historicalKey of [
    "period",
    "from",
    "to",
    "dataSnapshotId",
    "projectReleaseId",
    "currentFrom",
    "currentTo",
    "currentDataSnapshotId",
    "currentProjectReleaseId",
    "finding",
    "evidence",
  ]) {
    next.delete(historicalKey);
  }
  return next.toString() === current.toString()
    ? null
    : `${pathname}?${next.toString()}`;
}

export function energySessionContextStatus(
  historical: SessionEnergyContextDto,
  current: EnergyQueryContextDto,
): EnergySessionContextStatus {
  const sameAuthorizedWindow = historical.workspaceId === current.workspaceId
    && historical.projectId === current.projectId
    && historical.scopeId === current.scopeId
    && historical.resource === current.resource
    && historical.timezone === current.timezone
    && historical.from === current.from
    && historical.to === current.to;
  if (!sameAuthorizedWindow) {
    return {
      status: "outdated",
      reason: "This answer belongs to a different authorized Project, Scope, or reporting window.",
    };
  }
  if (historical.dataSnapshotId !== current.dataSnapshotId) {
    return {
      status: "outdated",
      reason: "This answer used an older data Snapshot. Its figures are preserved, but current data has changed.",
    };
  }
  const samePublishedConfiguration =
    historical.hierarchyRevisionId === current.hierarchyRevisionId
    && historical.meterMappingRevisionId === current.meterMappingRevisionId
    && historical.meterFormulaRevisionId === current.meterFormulaRevisionId
    && (historical.projectReleaseId ?? null) === (current.projectReleaseId ?? null);
  if (!samePublishedConfiguration) {
    return {
      status: "outdated",
      reason: "This answer used an older version of the facility details. Its figures remain read-only.",
    };
  }
  return { status: "current" };
}

function restoredContextKey(context: SessionEnergyContextDto): string {
  return JSON.stringify([
    context.workspaceId,
    context.projectId,
    context.scopeId,
    context.resource,
    context.from,
    context.to,
    context.dataSnapshotId,
    context.hierarchyRevisionId,
    context.meterMappingRevisionId,
    context.meterFormulaRevisionId,
    context.projectReleaseId ?? null,
  ]);
}
