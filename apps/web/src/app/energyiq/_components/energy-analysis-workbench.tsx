"use client";

import nextDynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type {
  DataTasksExternalContext,
  DataTasksServerSessionRequest,
  DataTasksSessionIdentity,
} from "../../data-tasks/data-tasks-app";
import {
  configApi,
  type EnergyQueryContextDto,
  type EnergyQueryContextRequestDto,
  type SessionEnergyContextDto,
} from "../../../lib/config-api";
import {
  decideEnergySessionContextRestore,
  energySessionContextStatus,
  freshEnergyAnalysisTaskHref,
  restoredEnergySessionHref,
} from "./energy-session-context";
import { useEnergyIqAccess } from "./energyiq-access";

const HISTORICAL_CONTEXT_UNAVAILABLE_REASON =
  "This Session's historical exact analysis context is unavailable. Its messages remain read-only.";

type CurrentDataForkState = {
  phase: "resolving" | "ready";
  sourceSessionId: string;
  sourceRunId?: string;
  sourceFrom?: string;
  sourceTo?: string;
  requestKey: number;
  currentFrom?: string;
  currentTo?: string;
  energyContext?: SessionEnergyContextDto;
  serverSessionRequest?: DataTasksServerSessionRequest;
  href?: string;
};

const DataTasksApp = nextDynamic(
  () => import("../../data-tasks/data-tasks-app"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[560px] items-center justify-center bg-surface-subtle text-sm text-muted">
        Loading Energy Analysis…
      </div>
    ),
  },
);

export function EnergyAnalysisWorkbench() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const {
    access,
    activeProject,
    error: accessError,
    loading: accessLoading,
    navigationTransitionPending,
    getNavigationTransitionGeneration,
  } = useEnergyIqAccess();
  const initialDraftPrompt = useMemo(
    () => buildEnergyAiHandoffInitialDraftPrompt(searchParams),
    [searchParams],
  );
  const requestedContext = useMemo<EnergyQueryContextRequestDto>(
    () => energyQueryContextRequestFromSearchParams(searchParams, activeProject?.id),
    [activeProject?.id, searchParams],
  );
  const requestedContextKey = useMemo(
    () => JSON.stringify(requestedContext),
    [requestedContext],
  );
  const authoritativeIdentityKey = JSON.stringify([
    access?.activeWorkspaceId ?? null,
    activeProject?.id ?? null,
  ]);
  const [resolvedState, setResolvedState] = useState<{
    requestKey: string;
    context: EnergyQueryContextDto;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<{
    identityKey: string | null;
    context: SessionEnergyContextDto | null;
    interactionDisabledReason: string | null;
  }>({ identityKey: null, context: null, interactionDisabledReason: null });
  const [urlTransitionPending, setUrlTransitionPending] = useState(false);
  const [contextResolutionGeneration, setContextResolutionGeneration] = useState(0);
  const [currentDataFork, setCurrentDataFork] = useState<CurrentDataForkState | null>(null);
  const [sessionTransitionIdentityKey, setSessionTransitionIdentityKey] = useState<string | null>(null);
  const initialSessionRestoreRef = useRef<{
    identityKey: string;
    value: string | null | false;
  } | null>(null);
  const activeSessionRestoreRef = useRef<{
    identityKey: string;
    sessionId: string;
  } | null>(null);
  const persistedSessionRestoreRef = useRef<{
    identityKey: string;
    sessionId: string;
  } | null>(null);
  const freshSessionRestoreRef = useRef<{
    identityKey: string;
    sessionId: string;
  } | null>(null);
  const currentDataForkIdentityRef = useRef(authoritativeIdentityKey);
  const currentDataForkRequestKeyRef = useRef(0);
  const exactRouteIdentity = `${pathname}?${searchParams.toString()}`;
  const exactRouteIdentityRef = useRef(exactRouteIdentity);
  const sessionContext = sessionState.identityKey === authoritativeIdentityKey
    ? sessionState.context
    : null;
  const sessionInteractionDisabledReason = sessionState.identityKey === authoritativeIdentityKey
    ? sessionState.interactionDisabledReason
    : null;
  const sessionTransitionPending = sessionTransitionIdentityKey === authoritativeIdentityKey;
  const resolved = resolvedState?.context ?? null;
  const explicitHistoricalFallbackContext = useMemo(
    () => exactHistoricalExternalContextFromSearchParams({
      searchParams,
      activeWorkspaceId: access?.activeWorkspaceId,
      activeProject,
    }),
    [access?.activeWorkspaceId, activeProject, searchParams],
  );
  const sessionContextStatus = useMemo(() => {
    if (!sessionContext || !resolved) return null;
    if (restoredEnergySessionHref(pathname, searchParams, sessionContext)) return null;
    return energySessionContextStatus(sessionContext, resolved);
  }, [pathname, resolved, searchParams, sessionContext]);
  const sessionIdentityDriftReason = sessionContextStatus?.status === "outdated"
    ? sessionContextStatus.reason
    : null;
  const requestedRouteProjectId = searchParams.get("projectId");
  const routeProjectTransitionPending = Boolean(
    requestedRouteProjectId
    && activeProject?.id
    && requestedRouteProjectId !== activeProject.id,
  );
  const contextTransitionPending = accessLoading
    || navigationTransitionPending
    || routeProjectTransitionPending
    || urlTransitionPending
    || sessionTransitionPending
    || currentDataFork !== null
    || (error === null
      && resolvedState !== null
      && resolvedState.requestKey !== requestedContextKey);
  const dataTaskInteractionDisabledReason = contextTransitionPending
    ? "Resolving exact analysis context before interaction is available."
    : error && explicitHistoricalFallbackContext
      ? HISTORICAL_CONTEXT_UNAVAILABLE_REASON
      : sessionIdentityDriftReason
        ?? sessionInteractionDisabledReason;

  const beginContextTransition = useCallback(() => {
    currentDataForkRequestKeyRef.current += 1;
    setUrlTransitionPending(true);
    setError(null);
  }, []);

  useEffect(() => () => {
    currentDataForkRequestKeyRef.current += 1;
  }, []);

  useLayoutEffect(() => {
    if (exactRouteIdentityRef.current === exactRouteIdentity) return;
    exactRouteIdentityRef.current = exactRouteIdentity;
    currentDataForkRequestKeyRef.current += 1;
    setCurrentDataFork((current) => current?.phase === "resolving" ? null : current);
  }, [exactRouteIdentity]);

  useEffect(() => {
    if (!accessLoading && !navigationTransitionPending) return;
    currentDataForkRequestKeyRef.current += 1;
    setCurrentDataFork(null);
  }, [accessLoading, navigationTransitionPending]);

  useEffect(() => {
    if (currentDataForkIdentityRef.current === authoritativeIdentityKey) return;
    currentDataForkIdentityRef.current = authoritativeIdentityKey;
    currentDataForkRequestKeyRef.current += 1;
    setCurrentDataFork(null);
  }, [authoritativeIdentityKey]);

  const finishUnavailableSessionRestore = useCallback((
    context: SessionEnergyContextDto | null = null,
  ) => {
    setSessionState({
      identityKey: authoritativeIdentityKey,
      context,
      interactionDisabledReason:
        "This Session's exact analysis context is unavailable. Its messages remain read-only.",
    });
    setSessionTransitionIdentityKey(null);
  }, [authoritativeIdentityKey]);

  const handleSessionEnergyContextRestored = useCallback((
    context: SessionEnergyContextDto | null,
    sessionId: string,
    origin: DataTasksSessionIdentity,
  ) => {
    if (accessLoading || accessError) {
      return;
    }
    if (
      origin.workspaceId !== access?.activeWorkspaceId
      || origin.projectId !== activeProject?.id
    ) {
      return;
    }
    const activeSessionRestore = activeSessionRestoreRef.current;
    if (!activeSessionRestore || activeSessionRestore.identityKey !== authoritativeIdentityKey) {
      activeSessionRestoreRef.current = { identityKey: authoritativeIdentityKey, sessionId };
      const freshSessionRestore = freshSessionRestoreRef.current;
      if (freshSessionRestore?.identityKey !== authoritativeIdentityKey
        || freshSessionRestore.sessionId !== sessionId) {
        persistedSessionRestoreRef.current = {
          identityKey: authoritativeIdentityKey,
          sessionId,
        };
      }
    } else if (activeSessionRestore.sessionId !== sessionId) {
      return;
    }
    if (!context) {
      const freshSessionRestore = freshSessionRestoreRef.current;
      if (freshSessionRestore?.identityKey === authoritativeIdentityKey
        && freshSessionRestore.sessionId === sessionId) {
        // Conversation restore can report the same missing client-created Session
        // more than once while effects settle. Keep its fresh provenance until a
        // concrete payload, Session selection, or identity transition supersedes it.
        setSessionState({
          identityKey: authoritativeIdentityKey,
          context: null,
          interactionDisabledReason: null,
        });
        setSessionTransitionIdentityKey(null);
        return;
      }
      finishUnavailableSessionRestore();
      return;
    }
    const freshSessionRestore = freshSessionRestoreRef.current;
    const restoringFreshSession = freshSessionRestore?.identityKey === authoritativeIdentityKey
      && freshSessionRestore.sessionId === sessionId;
    freshSessionRestoreRef.current = null;
    if (!hasExactEnergySessionContext(context)) {
      finishUnavailableSessionRestore();
      return;
    }
    if (
      context.workspaceId !== access?.activeWorkspaceId
      || context.projectId !== activeProject?.id
    ) {
      finishUnavailableSessionRestore();
      return;
    }
    setSessionState({
      identityKey: authoritativeIdentityKey,
      context,
      interactionDisabledReason: null,
    });
    const restoredHref = restoredEnergySessionHref(pathname, searchParams, context);
    const decision = decideEnergySessionContextRestore({
      pathname,
      currentSearchParams: searchParams,
      context,
      initialRestoredContextKey:
        initialSessionRestoreRef.current?.identityKey === authoritativeIdentityKey
          ? initialSessionRestoreRef.current.value
          : null,
    });
    initialSessionRestoreRef.current = {
      identityKey: authoritativeIdentityKey,
      value: decision.initialRestoredContextKey,
    };
    if (decision.href) {
      if (!restoringFreshSession) {
        persistedSessionRestoreRef.current = {
          identityKey: authoritativeIdentityKey,
          sessionId,
        };
      }
      beginContextTransition();
      setSessionTransitionIdentityKey(null);
      router.replace(decision.href, { scroll: false });
      return;
    }
    if (restoredHref) {
      finishUnavailableSessionRestore(context);
      return;
    }
    setSessionTransitionIdentityKey(null);
  }, [
    access?.activeWorkspaceId,
    accessError,
    accessLoading,
    activeProject?.id,
    authoritativeIdentityKey,
    beginContextTransition,
    finishUnavailableSessionRestore,
    pathname,
    router,
    searchParams,
  ]);

  const handleFreshSessionCreated = useCallback((
    sessionId: string,
    origin: "user" | "request" = "user",
  ) => {
    if (origin === "user") {
      setCurrentDataFork(null);
    }
    activeSessionRestoreRef.current = { identityKey: authoritativeIdentityKey, sessionId };
    const serverCreatedFork = origin === "request" && currentDataFork?.phase === "ready"
      ? currentDataFork
      : null;
    freshSessionRestoreRef.current = serverCreatedFork
      ? null
      : { identityKey: authoritativeIdentityKey, sessionId };
    persistedSessionRestoreRef.current = serverCreatedFork
      ? { identityKey: authoritativeIdentityKey, sessionId }
      : null;
    setSessionState({
      identityKey: authoritativeIdentityKey,
      context: serverCreatedFork?.energyContext ?? null,
      interactionDisabledReason: null,
    });
    setSessionTransitionIdentityKey(serverCreatedFork?.href ? authoritativeIdentityKey : null);
    initialSessionRestoreRef.current = { identityKey: authoritativeIdentityKey, value: false };
    if (serverCreatedFork) {
      setCurrentDataFork(null);
      return;
    }
    const href = freshEnergyAnalysisTaskHref(pathname, searchParams);
    beginContextTransition();
    if (href) {
      router.replace(href, { scroll: false });
      return;
    }
    setContextResolutionGeneration((current) => current + 1);
  }, [
    authoritativeIdentityKey,
    beginContextTransition,
    currentDataFork,
    pathname,
    router,
    searchParams,
  ]);

  const handleInitialFreshSessionCreated = useCallback((sessionId: string) => {
    activeSessionRestoreRef.current = { identityKey: authoritativeIdentityKey, sessionId };
    freshSessionRestoreRef.current = { identityKey: authoritativeIdentityKey, sessionId };
    persistedSessionRestoreRef.current = null;
    setSessionState({
      identityKey: authoritativeIdentityKey,
      context: null,
      interactionDisabledReason: null,
    });
    setSessionTransitionIdentityKey(null);
    initialSessionRestoreRef.current = { identityKey: authoritativeIdentityKey, value: false };
  }, [authoritativeIdentityKey]);

  const handleSessionSelectionStarted = useCallback((sessionId: string) => {
    currentDataForkRequestKeyRef.current += 1;
    setCurrentDataFork(null);
    activeSessionRestoreRef.current = { identityKey: authoritativeIdentityKey, sessionId };
    freshSessionRestoreRef.current = null;
    persistedSessionRestoreRef.current = {
      identityKey: authoritativeIdentityKey,
      sessionId,
    };
    setSessionState({
      identityKey: authoritativeIdentityKey,
      context: null,
      interactionDisabledReason: null,
    });
    initialSessionRestoreRef.current = { identityKey: authoritativeIdentityKey, value: false };
    setSessionTransitionIdentityKey(authoritativeIdentityKey);
    setError(null);
  }, [authoritativeIdentityKey]);

  const handleContinueOnCurrentData = useCallback(() => {
    const sourceSession = persistedSessionRestoreRef.current ?? activeSessionRestoreRef.current;
    if (!sourceSession || sourceSession.identityKey !== authoritativeIdentityKey) return;
    setCurrentDataFork({
      phase: "resolving",
      sourceSessionId: sourceSession.sessionId,
      requestKey: 0,
    });
    setSessionTransitionIdentityKey(authoritativeIdentityKey);
    setError(null);
    const requestKey = currentDataForkRequestKeyRef.current + 1;
    currentDataForkRequestKeyRef.current = requestKey;
    const navigationGeneration = getNavigationTransitionGeneration();
    const requestRouteIdentity = exactRouteIdentityRef.current;
    const requestIsCurrent = () => (
      currentDataForkRequestKeyRef.current === requestKey
      && getNavigationTransitionGeneration() === navigationGeneration
      && exactRouteIdentityRef.current === requestRouteIdentity
    );
    void configApi.continueEnergySessionOnCurrent({
      sourceSessionId: sourceSession.sessionId,
      target: {
        projectId: requestedContext.projectId,
        scopeId: requestedContext.scopeId ?? "project",
        resource: requestedContext.resource ?? "electricity",
      },
    }).then(({ session, energyContext }) => {
      if (!requestIsCurrent()) return;
      const href = restoredEnergySessionHref(pathname, searchParams, energyContext);
      const serverSessionRequest = { key: requestKey, session };
      setSessionState({
        identityKey: authoritativeIdentityKey,
        context: energyContext,
        interactionDisabledReason: null,
      });
      setCurrentDataFork({
        phase: "ready",
        sourceSessionId: sourceSession.sessionId,
        ...(energyContext.forkedFromRunId
          ? { sourceRunId: energyContext.forkedFromRunId }
          : {}),
        ...(energyContext.forkedFromFrom
          ? { sourceFrom: energyContext.forkedFromFrom }
          : {}),
        ...(energyContext.forkedFromTo
          ? { sourceTo: energyContext.forkedFromTo }
          : {}),
        requestKey,
        currentFrom: energyContext.from,
        currentTo: energyContext.to,
        energyContext,
        serverSessionRequest,
        ...(href ? { href } : {}),
      });
      if (href) {
        beginContextTransition();
        router.replace(href, { scroll: false });
      }
    }).catch((reason) => {
      if (!requestIsCurrent()) return;
      setCurrentDataFork(null);
      setSessionTransitionIdentityKey(null);
      setError(reason instanceof Error
        ? reason.message
        : "Unable to continue on current data");
    });
  }, [
    authoritativeIdentityKey,
    beginContextTransition,
    getNavigationTransitionGeneration,
    pathname,
    requestedContext.projectId,
    requestedContext.resource,
    requestedContext.scopeId,
    router,
    searchParams,
  ]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void configApi.resolveEnergyQueryContext(requestedContext)
      .then((context) => {
        if (!cancelled) {
          setResolvedState({ requestKey: requestedContextKey, context });
          setUrlTransitionPending(false);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setUrlTransitionPending(false);
          const message = reason instanceof Error
            ? reason.message
            : "Unable to resolve analysis context";
          const persistedSessionRestore = persistedSessionRestoreRef.current;
          if (persistedSessionRestore?.identityKey === authoritativeIdentityKey) {
            setSessionState((current) => ({
              ...current,
              identityKey: authoritativeIdentityKey,
              interactionDisabledReason: HISTORICAL_CONTEXT_UNAVAILABLE_REASON,
            }));
          }
          setError(message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    authoritativeIdentityKey,
    contextResolutionGeneration,
    requestedContext,
    requestedContextKey,
  ]);

  const baseExternalContext = useMemo<DataTasksExternalContext | null>(
    () => {
      const base = resolved
        ? toEnergyAnalysisExternalContext(resolved)
        : error
          ? explicitHistoricalFallbackContext
          : null;
      if (!base) return null;
      if (!sessionContext) return base;
      if (error && (explicitHistoricalFallbackContext
        || persistedSessionRestoreRef.current?.identityKey === authoritativeIdentityKey)) {
        return {
          ...base,
          workspaceId: sessionContext.workspaceId,
          projectId: sessionContext.projectId,
          projectName: sessionContext.projectName,
          scopeId: sessionContext.scopeId,
          scopeName: sessionContext.scopeName,
          resource: sessionContext.resource,
          period: "Custom",
          from: sessionContext.from,
          to: sessionContext.to,
          timezone: sessionContext.timezone,
          dataCutoff: localDateFromInstant(
            new Date(Date.parse(sessionContext.to) - 1).toISOString(),
            sessionContext.timezone,
          ),
          dataSnapshotId: sessionContext.dataSnapshotId,
          historyStatus: "outdated",
          historyStatusReason:
            sessionInteractionDisabledReason ?? HISTORICAL_CONTEXT_UNAVAILABLE_REASON,
        };
      }
      if (restoredEnergySessionHref(pathname, searchParams, sessionContext)) return base;
      return sessionContextStatus?.status === "outdated"
        ? {
            ...base,
            historyStatus: "outdated",
            historyStatusReason: sessionContextStatus.reason,
          }
        : sessionContext.sourceRunId
          ? {
              ...base,
              historyStatus: "historical",
              historicalDataThrough: localDateFromInstant(
                new Date(Date.parse(sessionContext.to) - 1).toISOString(),
                sessionContext.timezone,
              ),
            }
          : base;
    },
    [
      error,
      explicitHistoricalFallbackContext,
      authoritativeIdentityKey,
      pathname,
      resolved,
      searchParams,
      sessionContext,
      sessionContextStatus,
      sessionInteractionDisabledReason,
    ],
  );

  const externalContext = useMemo<DataTasksExternalContext | null>(() => {
    if (!baseExternalContext) return null;
    if (currentDataFork?.phase === "ready") {
      const current = currentDataFork.energyContext;
      if (!current) return null;
      const timezone = current.timezone;
      return {
        ...baseExternalContext,
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        projectName: current.projectName,
        scopeId: current.scopeId,
        scopeName: current.scopeName,
        resource: current.resource,
        period: "Custom",
        from: current.from,
        to: current.to,
        timezone: current.timezone,
        dataCutoff: localDateFromInstant(
          new Date(Date.parse(current.to) - 1).toISOString(),
          current.timezone,
        ),
        dataSnapshotId: current.dataSnapshotId,
        expectedDataSnapshotId: current.dataSnapshotId,
        expectedProjectReleaseId: current.projectReleaseId ?? null,
        expectedHierarchyRevisionId: current.hierarchyRevisionId,
        expectedMeterMappingRevisionId: current.meterMappingRevisionId,
        expectedMeterFormulaRevisionId: current.meterFormulaRevisionId,
        forkedFromSessionId: currentDataFork.sourceSessionId,
        ...(currentDataFork.sourceRunId
          ? { forkedFromRunId: currentDataFork.sourceRunId }
          : {}),
        ...(currentDataFork.sourceFrom
          ? { forkedFromFrom: currentDataFork.sourceFrom }
          : {}),
        ...(currentDataFork.sourceTo
          ? { forkedFromTo: currentDataFork.sourceTo }
          : {}),
        forkedFromContextStatus: current.forkedFromContextStatus,
        forkedFromUnavailableReason: current.forkedFromUnavailableReason,
        rangeChangeDisclosure: currentDataFork.sourceFrom && currentDataFork.sourceTo
          ? `Started a new Session on ${analysisRangeLabel(
              current.from,
              current.to,
              timezone,
            )}; the original Session remains on ${analysisRangeLabel(
              currentDataFork.sourceFrom,
              currentDataFork.sourceTo,
              timezone,
            )}.`
          : `Started a new Session on ${analysisRangeLabel(
              current.from,
              current.to,
              timezone,
            )}. The original Session's exact source context is unavailable and remains unchanged.`,
      };
    }
    if (sessionContext?.forkedFromSessionId) {
      const sourceFrom = sessionContext.forkedFromFrom;
      const sourceTo = sessionContext.forkedFromTo;
      const timezone = baseExternalContext.timezone ?? sessionContext.timezone;
      return {
        ...baseExternalContext,
        forkedFromSessionId: sessionContext.forkedFromSessionId,
        forkedFromContextStatus: sessionContext.forkedFromContextStatus,
        forkedFromUnavailableReason: sessionContext.forkedFromUnavailableReason,
        ...(sessionContext.forkedFromRunId
          ? { forkedFromRunId: sessionContext.forkedFromRunId }
          : {}),
        ...(sourceFrom ? { forkedFromFrom: sourceFrom } : {}),
        ...(sourceTo ? { forkedFromTo: sourceTo } : {}),
        ...(sourceFrom && sourceTo
          ? { rangeChangeDisclosure: `This Session uses ${analysisRangeLabel(
              baseExternalContext.from,
              baseExternalContext.to,
              timezone,
            )}; it was continued from a Session on ${analysisRangeLabel(
              sourceFrom,
              sourceTo,
              timezone,
            )}.` }
          : sessionContext.forkedFromContextStatus === "unavailable"
            ? { rangeChangeDisclosure: `This Session uses ${analysisRangeLabel(
                baseExternalContext.from,
                baseExternalContext.to,
                timezone,
              )}. The original Session's exact source context is unavailable and remains unchanged.` }
          : {}),
      };
    }
    return baseExternalContext;
  }, [baseExternalContext, currentDataFork, sessionContext]);

  const keepHistoricalSessionVisible = Boolean(
    error
    && externalContext
    && (explicitHistoricalFallbackContext
      || persistedSessionRestoreRef.current?.identityKey === authoritativeIdentityKey),
  );
  if ((error && !keepHistoricalSessionVisible) || accessError) {
    return (
      <div className="flex h-full min-h-[560px] items-center justify-center bg-surface-subtle px-6 text-center">
        <div>
          <p className="text-sm font-semibold">Analysis context is unavailable</p>
          <p className="mt-2 text-xs text-muted">{error ?? accessError}</p>
        </div>
      </div>
    );
  }
  if (!externalContext) {
    return (
      <div className="flex h-full min-h-[560px] items-center justify-center bg-surface-subtle text-sm text-muted">
        Resolving project, scope and reporting period…
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0" aria-busy={contextTransitionPending}>
      <div className="h-full min-h-0" inert={contextTransitionPending ? true : undefined}>
        <DataTasksApp
          viewport="embedded"
          accessMode="user"
          externalContext={externalContext}
          interactionDisabledReason={dataTaskInteractionDisabledReason ?? undefined}
          onSessionEnergyContextRestored={handleSessionEnergyContextRestored}
          onSessionSelectionStarted={handleSessionSelectionStarted}
          onFreshSessionCreated={handleFreshSessionCreated}
          onInitialFreshSessionCreated={handleInitialFreshSessionCreated}
          startWithFreshSession={requestedContext.analysisWindow === "all-available"}
          freshSessionRequestKey={0}
          {...(currentDataFork?.phase === "ready" && currentDataFork.serverSessionRequest
            ? { serverSessionRequest: currentDataFork.serverSessionRequest }
            : {})}
          {...(initialDraftPrompt ? { initialDraftPrompt } : {})}
          inheritIdentity
        />
      </div>
      {contextTransitionPending ? (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-surface-subtle/95 text-sm text-muted"
          role="status"
        >
          Resolving project, scope and reporting period…
        </div>
      ) : null}
      {!contextTransitionPending && dataTaskInteractionDisabledReason
      && (
        persistedSessionRestoreRef.current?.identityKey === authoritativeIdentityKey
        || activeSessionRestoreRef.current?.identityKey === authoritativeIdentityKey
      ) ? (
        <div className="absolute inset-x-4 bottom-4 z-30 flex items-center justify-between gap-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950 shadow-[var(--shadow-card)]">
          <span>The original messages stay unchanged. Start a new Session on the current authorized data range.</span>
          <button
            type="button"
            data-testid="continue-on-current-data"
            className="shrink-0 rounded-md bg-foreground px-3 py-2 font-semibold text-background"
            onClick={handleContinueOnCurrentData}
          >
            Continue on current data
          </button>
        </div>
      ) : null}
    </div>
  );
}

function hasExactEnergySessionContext(
  context: SessionEnergyContextDto,
): boolean {
  const required = [
    context.workspaceId,
    context.projectId,
    context.scopeId,
    context.resource,
    context.timezone,
    context.from,
    context.to,
    context.hierarchyRevisionId,
    context.meterMappingRevisionId,
    context.meterFormulaRevisionId,
    context.dataSnapshotId,
  ];
  return required.every((value) => typeof value === "string" && value.trim().length > 0)
    && isIncreasingPeriod(context.from, context.to);
}

export function toEnergyAnalysisExternalContext(
  resolved: EnergyQueryContextDto,
): DataTasksExternalContext {
  return {
    source: "energyiq",
    workspaceId: resolved.workspaceId,
    projectId: resolved.projectId,
    projectName: resolved.projectName,
    scopeId: resolved.scopeId,
    scopeName: resolved.scopeName,
    resource: resolved.resource,
    period: resolved.period,
    from: resolved.from,
    to: resolved.to,
    timezone: resolved.timezone,
    dataCutoff: localDateFromInstant(
      new Date(Date.parse(resolved.to) - 1).toISOString(),
      resolved.timezone,
    ),
    dataSnapshotId: resolved.dataSnapshotId,
    expectedDataSnapshotId: resolved.dataSnapshotId,
    expectedProjectReleaseId: resolved.projectReleaseId ?? null,
    expectedHierarchyRevisionId: resolved.hierarchyRevisionId,
    expectedMeterMappingRevisionId: resolved.meterMappingRevisionId,
    expectedMeterFormulaRevisionId: resolved.meterFormulaRevisionId,
  };
}

function exactHistoricalExternalContextFromSearchParams(input: {
  searchParams: Pick<URLSearchParams, "get">;
  activeWorkspaceId?: string;
  activeProject: { id: string; name: string; timezone: string } | null;
}): DataTasksExternalContext | null {
  const projectId = input.searchParams.get("projectId");
  const scopeId = input.searchParams.get("scopeId");
  const from = input.searchParams.get("from");
  const to = input.searchParams.get("to");
  const dataSnapshotId = input.searchParams.get("dataSnapshotId");
  if (
    !input.activeWorkspaceId
    || !input.activeProject
    || projectId !== input.activeProject.id
    || input.searchParams.get("period") !== "Custom"
    || !scopeId
    || !from
    || !to
    || !dataSnapshotId
  ) {
    return null;
  }
  return {
    source: "energyiq",
    workspaceId: input.activeWorkspaceId,
    projectId,
    projectName: input.activeProject.name,
    scopeId,
    scopeName: scopeId,
    resource: input.searchParams.get("resource") === "water" ? "water" : "electricity",
    period: "Custom",
    from,
    to,
    timezone: input.activeProject.timezone,
    dataCutoff: to,
    dataSnapshotId,
    historyStatus: "outdated",
    historyStatusReason: HISTORICAL_CONTEXT_UNAVAILABLE_REASON,
  };
}

function localDateFromInstant(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(value));
}

function analysisRangeLabel(
  from: string | undefined,
  toExclusive: string | undefined,
  timeZone: string,
): string {
  if (!from || !toExclusive) return "the current authorized data range";
  return `${localDateFromInstant(from, timeZone)} to ${localDateFromInstant(
    new Date(Date.parse(toExclusive) - 1).toISOString(),
    timeZone,
  )}`;
}

const normalizePeriod = (
  value: string | null,
): "Yesterday" | "Last 7 days" | "Last 30 days" | "Previous week" | "Previous month" | "Custom" => {
  if (value === "Yesterday" || value === "Last 7 days" || value === "Previous week" || value === "Previous month" || value === "Custom") {
    return value;
  }
  return "Last 30 days";
};

export function energyQueryContextRequestFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
  activeProjectId?: string,
): EnergyQueryContextRequestDto {
  const projectId = searchParams.get("projectId") ?? activeProjectId ?? "ngee-ann-polytechnic";
  const explicitPeriod = searchParams.get("period");
  const dataSnapshotId = searchParams.get("dataSnapshotId");
  const projectReleaseId = searchParams.get("projectReleaseId");
  const identityPin = {
    ...(dataSnapshotId ? { expectedDataSnapshotId: dataSnapshotId } : {}),
    ...(projectReleaseId ? { expectedProjectReleaseId: projectReleaseId } : {}),
  };
  const base = {
    projectId,
    scopeId: searchParams.get("scopeId") ?? "project",
    resource: searchParams.get("resource") === "water" ? "water" as const : "electricity" as const,
    ...identityPin,
  };
  if (explicitPeriod === null) {
    return { ...base, analysisWindow: "all-available" };
  }
  return {
    ...base,
    period: normalizePeriod(explicitPeriod),
    ...(searchParams.get("from") ? { from: searchParams.get("from")! } : {}),
    ...(searchParams.get("to") ? { to: searchParams.get("to")! } : {}),
  };
}

type EnergyAiHandoffSearchParams = Pick<URLSearchParams, "get">;

const MAX_HANDOFF_PARAMETER_LENGTH = 8_000;
const MAX_HANDOFF_TEXT_LENGTH = 800;
const MAX_HANDOFF_ID_LENGTH = 200;
const MAX_HANDOFF_REFERENCE_COUNT = 8;

export function buildEnergyAiHandoffInitialDraftPrompt(
  searchParams: EnergyAiHandoffSearchParams,
): string | null {
  const finding = parseBoundedJsonRecord(searchParams.get("finding"));
  const evidence = parseBoundedJsonRecord(searchParams.get("evidence"));
  if (!finding || !evidence) return null;
  if (finding.kind === "section-insight") {
    return buildSectionInsightHandoffDraft(finding, evidence);
  }
  if (finding.kind === "tuya-overview-finding") {
    return buildTuyaOverviewFindingHandoffDraft(finding, evidence, searchParams);
  }

  const title = boundedText(finding.title, MAX_HANDOFF_TEXT_LENGTH);
  const takeaway = boundedText(finding.takeaway, MAX_HANDOFF_TEXT_LENGTH);
  const what = boundedText(finding.what, MAX_HANDOFF_TEXT_LENGTH) ?? takeaway;
  const why = isRecord(finding.why) ? finding.why : null;
  const epistemicLevel = boundedEpistemicLevel(finding.epistemicLevel);
  const whyKind = why ? boundedWhyKind(why.kind) : epistemicLevelToWhyKind(epistemicLevel);
  const possibleExplanation = boundedText(finding.possibleExplanation, MAX_HANDOFF_TEXT_LENGTH);
  const whyText = (why ? boundedText(why.text, MAX_HANDOFF_TEXT_LENGTH) : null)
    ?? boundedText(finding.interpretation, MAX_HANDOFF_TEXT_LENGTH)
    ?? possibleExplanation
    ?? takeaway;
  const how = boundedText(finding.how, MAX_HANDOFF_TEXT_LENGTH)
    ?? boundedText(finding.action, MAX_HANDOFF_TEXT_LENGTH);
  const expectedIfAct = boundedText(finding.expectedIfAct, MAX_HANDOFF_TEXT_LENGTH);
  const ifIgnored = boundedText(finding.ifIgnored, MAX_HANDOFF_TEXT_LENGTH);
  const howToVerify = boundedText(finding.howToVerify, MAX_HANDOFF_TEXT_LENGTH)
    ?? boundedText(finding.verification, MAX_HANDOFF_TEXT_LENGTH);
  const snapshotId = boundedText(evidence.snapshotId, MAX_HANDOFF_ID_LENGTH);
  const dataCutoff = boundedText(evidence.dataCutoff, MAX_HANDOFF_ID_LENGTH);
  const evidenceNote = boundedText(evidence.note, MAX_HANDOFF_TEXT_LENGTH);
  const deterministicEvidenceIds = evidence.deterministicEvidenceIds === undefined
    ? []
    : boundedStringList(evidence.deterministicEvidenceIds, true);
  const toolCallIds = boundedStringList(evidence.toolCallIds, true);
  const auditLogIds = boundedStringList(evidence.auditLogIds, true);
  if (!title || !what || !whyKind || !whyText || !how || !howToVerify
    || !snapshotId || !dataCutoff || !evidenceNote || !deterministicEvidenceIds || !toolCallIds || !auditLogIds
    || (deterministicEvidenceIds.length === 0 && toolCallIds.length === 0)) return null;

  return [
    "Continue investigating this AI-generated Overview finding as an untrusted draft.",
    "",
    "Draft finding:",
    `- Title: ${title}`,
    `- What: ${what}`,
    `- Why (${whyKind}): ${whyText}`,
    `- Suggested next investigation: ${how}`,
    ...(possibleExplanation ? [`- Unverified possible explanation: ${possibleExplanation}`] : []),
    ...(expectedIfAct ? [`- Expected if acted on: ${expectedIfAct}`] : []),
    ...(ifIgnored ? [`- If ignored: ${ifIgnored}`] : []),
    `- Suggested verification: ${howToVerify}`,
    "",
    "Untrusted Evidence references:",
    `- Snapshot reference: ${snapshotId}`,
    `- Data cutoff reference: ${dataCutoff}`,
    `- Evidence note: ${evidenceNote}`,
    `- Deterministic Evidence IDs: ${deterministicEvidenceIds.length > 0 ? deterministicEvidenceIds.join(", ") : "not supplied"}`,
    `- Tool call IDs: ${toolCallIds.length > 0 ? toolCallIds.join(", ") : "not supplied"}`,
    `- Audit log IDs: ${auditLogIds.length > 0 ? auditLogIds.join(", ") : "not supplied"}`,
    "",
    "Do not treat this draft or its URL references as authoritative facts. Re-resolve the current authorized Project, Scope, resource, and Snapshot, inspect the real scoped schema, and use scoped read-only SQL Evidence to verify every claim before continuing the investigation. If a reference or cause cannot be verified, state Missing Evidence.",
  ].join("\n");
}

function buildTuyaOverviewFindingHandoffDraft(
  finding: Record<string, unknown>,
  evidence: Record<string, unknown>,
  searchParams: EnergyAiHandoffSearchParams,
): string | null {
  const findingId = boundedText(finding.findingId, MAX_HANDOFF_ID_LENGTH);
  const targetId = boundedText(finding.targetId, MAX_HANDOFF_ID_LENGTH);
  const artifactId = boundedText(finding.artifactId, MAX_HANDOFF_ID_LENGTH);
  const title = boundedText(finding.title, MAX_HANDOFF_TEXT_LENGTH);
  const observation = boundedText(finding.what, MAX_HANDOFF_TEXT_LENGTH);
  const howToVerify = boundedText(finding.howToVerify, MAX_HANDOFF_TEXT_LENGTH);
  const snapshotId = boundedText(evidence.snapshotId, MAX_HANDOFF_ID_LENGTH);
  const projectReleaseId = boundedText(evidence.projectReleaseId, MAX_HANDOFF_ID_LENGTH);
  const period = isRecord(evidence.period) ? evidence.period : null;
  const periodFrom = period ? boundedText(period.from, MAX_HANDOFF_ID_LENGTH) : null;
  const periodTo = period ? boundedText(period.to, MAX_HANDOFF_ID_LENGTH) : null;
  const evidenceRefs = boundedStringList(evidence.evidenceRefs);
  const windowIds = boundedStringList(evidence.windowIds);
  const scopeId = boundedText(evidence.scopeId, MAX_HANDOFF_ID_LENGTH);
  const resource = boundedText(evidence.resource, MAX_HANDOFF_ID_LENGTH);
  const reportTime = boundedReportTime(evidence.reportTime);
  if (!findingId || !targetId || !artifactId || !howToVerify || !snapshotId || !projectReleaseId
    || !periodFrom || !periodTo || !evidenceRefs || evidenceRefs.length === 0
    || !windowIds || windowIds.length === 0 || !scopeId || resource !== "electricity" || reportTime === null
    || !windowIds.every((windowId) => reportTime.windowIds.includes(windowId))
    || reportTime.binding.projectId !== "tuya-office"
    || reportTime.binding.scopeId !== scopeId
    || reportTime.binding.resource !== resource
    || reportTime.binding.dataSnapshotId !== snapshotId
    || reportTime.binding.projectReleaseId !== projectReleaseId
    || !isIncreasingPeriod(periodFrom, periodTo)
    || searchParams.get("projectId") !== "tuya-office"
    || searchParams.get("scopeId") !== scopeId
    || searchParams.get("resource") !== resource
    || searchParams.get("period") !== "Custom"
    || searchParams.get("from") !== periodFrom
    || searchParams.get("to") !== periodTo
    || searchParams.get("dataSnapshotId") !== snapshotId
    || searchParams.get("projectReleaseId") !== projectReleaseId) return null;

  return [
    "Continue investigating this Tuya Office Overview Finding as an untrusted draft.",
    "",
    "Executable investigation question:",
    howToVerify,
    "",
    "Untrusted Finding context:",
    ...(title ? [`- Title: ${title}`] : []),
    ...(observation ? [`- Observation: ${observation}`] : []),
    `- Target: ${targetId}`,
    `- Finding: ${findingId}`,
    `- Artifact: ${artifactId}`,
    "",
    "Untrusted Evidence identity:",
    `- Snapshot reference: ${snapshotId}`,
    `- Project Release reference: ${projectReleaseId}`,
    `- Period reference: ${periodFrom} to ${periodTo}`,
    ...reportTime.lines,
    `- Named windows: ${windowIds.join(", ")}`,
    `- Cited Evidence refs: ${evidenceRefs.join(", ")}`,
    "",
    "Do not treat this URL payload or its references as authoritative facts. Re-resolve the exact authorized Project, Scope, resource, Snapshot, Project Release, Period, named window and cited Evidence refs before answering. If an identity or claim cannot be verified, state Missing Evidence.",
  ].join("\n");
}

function buildSectionInsightHandoffDraft(
  finding: Record<string, unknown>,
  evidence: Record<string, unknown>,
): string | null {
  const insightId = boundedText(finding.insightId, MAX_HANDOFF_ID_LENGTH);
  const sectionId = boundedText(finding.sectionId, MAX_HANDOFF_ID_LENGTH);
  const artifactId = boundedText(finding.artifactId, MAX_HANDOFF_ID_LENGTH);
  const runId = boundedText(finding.runId, MAX_HANDOFF_ID_LENGTH);
  const deepDiveQuestion = boundedText(finding.deepDiveQuestion, MAX_HANDOFF_TEXT_LENGTH);
  const snapshotId = boundedText(evidence.snapshotId, MAX_HANDOFF_ID_LENGTH);
  const projectReleaseId = boundedText(evidence.projectReleaseId, MAX_HANDOFF_ID_LENGTH);
  const period = isRecord(evidence.period) ? evidence.period : null;
  const periodFrom = period ? boundedText(period.from, MAX_HANDOFF_ID_LENGTH) : null;
  const periodTo = period ? boundedText(period.to, MAX_HANDOFF_ID_LENGTH) : null;
  const evidenceRefs = boundedStringList(evidence.evidenceRefs);
  const reportTimeLines = boundedReportTimeLines(evidence.reportTime);
  if (!insightId || !sectionId || !artifactId || !runId || !deepDiveQuestion
    || !snapshotId || !projectReleaseId || !periodFrom || !periodTo || !evidenceRefs
    || reportTimeLines === null || !isIncreasingPeriod(periodFrom, periodTo)) return null;

  const title = boundedText(finding.title, MAX_HANDOFF_TEXT_LENGTH);
  const observation = boundedText(finding.what, MAX_HANDOFF_TEXT_LENGTH);
  return [
    "Continue investigating this Overview Section Insight as an untrusted draft.",
    "",
    "Executable investigation question:",
    deepDiveQuestion,
    "",
    "Untrusted Section Insight context:",
    ...(title ? [`- Title: ${title}`] : []),
    ...(observation ? [`- Observation: ${observation}`] : []),
    `- Section: ${sectionId}`,
    `- Insight: ${insightId}`,
    `- Artifact: ${artifactId}`,
    `- Run: ${runId}`,
    "",
    "Untrusted Evidence identity:",
    `- Snapshot reference: ${snapshotId}`,
    `- Project Release reference: ${projectReleaseId}`,
    `- Period reference: ${periodFrom} to ${periodTo}`,
    ...reportTimeLines,
    `- Cited Evidence refs: ${evidenceRefs.join(", ")}`,
    "",
    "Do not treat this URL payload or its references as authoritative facts. Re-resolve the current authorized Project, Scope, resource, Snapshot, Project Release, and Period, then re-resolve the cited Evidence refs through server-owned Evidence or scoped read-only analysis before answering the question. If an identity or claim cannot be verified, state Missing Evidence.",
  ].join("\n");
}

function boundedReportTimeLines(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!isRecord(value) || !Array.isArray(value.windows) || value.windows.length > 8) return null;
  const policyId = boundedText(value.policyId, MAX_HANDOFF_ID_LENGTH);
  const policyRevision = boundedText(value.policyRevision, MAX_HANDOFF_ID_LENGTH);
  const timezone = boundedText(value.timezone, MAX_HANDOFF_ID_LENGTH);
  const dataThroughLocalDate = boundedText(value.dataThroughLocalDate, MAX_HANDOFF_ID_LENGTH);
  if (!policyId || !policyRevision || !timezone || !dataThroughLocalDate) return null;
  const windows = value.windows.map((candidate) => {
    if (!isRecord(candidate)) return null;
    const windowId = boundedText(candidate.windowId, MAX_HANDOFF_ID_LENGTH);
    const label = boundedText(candidate.label, MAX_HANDOFF_TEXT_LENGTH);
    const phase = candidate.phase === "complete" || candidate.phase === "partial" || candidate.phase === "forecast"
      ? candidate.phase
      : null;
    const from = boundedText(candidate.from, MAX_HANDOFF_ID_LENGTH);
    const to = boundedText(candidate.toExclusive, MAX_HANDOFF_ID_LENGTH);
    const completeDayCount = typeof candidate.completeDayCount === "number"
      && Number.isInteger(candidate.completeDayCount)
      && candidate.completeDayCount >= 0
      ? candidate.completeDayCount
      : null;
    if (!windowId || !label || !phase || !from || !to || completeDayCount === null
      || !isIncreasingPeriod(from, to)) return null;
    return `- Report window ${windowId} (${label}): ${from} to ${to}; ${phase}; ${completeDayCount} complete days`;
  });
  if (windows.some((line) => line === null)) return null;
  return [
    `- Report Time policy: ${policyId} · ${policyRevision} · ${timezone}`,
    `- Data through local date: ${dataThroughLocalDate}`,
    ...(windows as string[]),
  ];
}

function boundedReportTime(value: unknown): {
  lines: string[];
  windowIds: string[];
  binding: {
    projectId: string;
    scopeId: string;
    resource: string;
    dataSnapshotId: string;
    projectReleaseId: string;
  };
} | null {
  if (!isRecord(value) || !Array.isArray(value.windows) || value.windows.length > 8) return null;
  const contractRevision = boundedText(value.contractRevision, MAX_HANDOFF_ID_LENGTH);
  const policyId = boundedText(value.policyId, MAX_HANDOFF_ID_LENGTH);
  const policyRevision = boundedText(value.policyRevision, MAX_HANDOFF_ID_LENGTH);
  const timezone = boundedText(value.timezone, MAX_HANDOFF_ID_LENGTH);
  const acceptedDataEndExclusive = boundedText(value.acceptedDataEndExclusive, MAX_HANDOFF_ID_LENGTH);
  const dataThroughLocalDate = boundedText(value.dataThroughLocalDate, MAX_HANDOFF_ID_LENGTH);
  const binding = isRecord(value.binding) ? value.binding : null;
  const projectId = binding ? boundedText(binding.projectId, MAX_HANDOFF_ID_LENGTH) : null;
  const scopeId = binding ? boundedText(binding.scopeId, MAX_HANDOFF_ID_LENGTH) : null;
  const resource = binding ? boundedText(binding.resource, MAX_HANDOFF_ID_LENGTH) : null;
  const dataSnapshotId = binding ? boundedText(binding.dataSnapshotId, MAX_HANDOFF_ID_LENGTH) : null;
  const projectReleaseId = binding ? boundedText(binding.projectReleaseId, MAX_HANDOFF_ID_LENGTH) : null;
  if (!contractRevision || !policyId || !policyRevision || !timezone || !acceptedDataEndExclusive
    || !dataThroughLocalDate || !projectId || !scopeId || !resource || !dataSnapshotId || !projectReleaseId) return null;
  const windows = value.windows.map((candidate) => {
    if (!isRecord(candidate)) return null;
    const windowId = boundedText(candidate.windowId, MAX_HANDOFF_ID_LENGTH);
    const label = boundedText(candidate.label, MAX_HANDOFF_TEXT_LENGTH);
    const phase = candidate.phase === "complete" || candidate.phase === "partial" || candidate.phase === "forecast"
      ? candidate.phase
      : null;
    const from = boundedText(candidate.from, MAX_HANDOFF_ID_LENGTH);
    const to = boundedText(candidate.toExclusive, MAX_HANDOFF_ID_LENGTH);
    const completeDayCount = typeof candidate.completeDayCount === "number"
      && Number.isInteger(candidate.completeDayCount)
      && candidate.completeDayCount >= 0
      ? candidate.completeDayCount
      : null;
    if (!windowId || !label || !phase || !from || !to || completeDayCount === null
      || !isIncreasingPeriod(from, to)) return null;
    return { windowId, line: `- Report window ${windowId} (${label}): ${from} to ${to}; ${phase}; ${completeDayCount} complete days` };
  });
  if (windows.some((window) => window === null)) return null;
  const validWindows = windows as Array<{ windowId: string; line: string }>;
  return {
    lines: [
      `- Report Time policy: ${policyId} · ${policyRevision} · ${timezone}`,
      `- Data through local date: ${dataThroughLocalDate}`,
      ...validWindows.map(({ line }) => line),
    ],
    windowIds: validWindows.map(({ windowId }) => windowId),
    binding: { projectId, scopeId, resource, dataSnapshotId, projectReleaseId },
  };
}

function isIncreasingPeriod(from: string, to: string): boolean {
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  return Number.isFinite(fromTime) && Number.isFinite(toTime) && fromTime < toTime;
}

function parseBoundedJsonRecord(value: string | null): Record<string, unknown> | null {
  if (!value || value.length > MAX_HANDOFF_PARAMETER_LENGTH) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001F\u007F]+/gu, " ").replace(/\s+/gu, " ").trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function boundedWhyKind(value: unknown): "Evidence" | "Hypothesis" | "Missing Evidence" | null {
  return value === "Evidence" || value === "Hypothesis" || value === "Missing Evidence"
    ? value
    : null;
}

function boundedEpistemicLevel(value: unknown): "verified" | "hypothesis" | "exploration-idea" | null {
  return value === "verified" || value === "hypothesis" || value === "exploration-idea" ? value : null;
}

function epistemicLevelToWhyKind(
  value: "verified" | "hypothesis" | "exploration-idea" | null,
): "Evidence" | "Hypothesis" | "Missing Evidence" | null {
  if (value === "verified") return "Evidence";
  if (value === "hypothesis") return "Hypothesis";
  if (value === "exploration-idea") return "Missing Evidence";
  return null;
}

function boundedStringList(value: unknown, allowEmpty = false): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_HANDOFF_REFERENCE_COUNT) return null;
  const items = value.map((candidate) => boundedText(candidate, MAX_HANDOFF_ID_LENGTH));
  if (items.some((candidate) => candidate === null)) return null;
  if (!allowEmpty && items.length === 0) return null;
  return [...new Set(items as string[])];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
