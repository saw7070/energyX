"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  configApi,
  setConfigApiWorkspaceId,
  type EnergyAccessContextDto,
  type EnergyProjectDto,
} from "../../../lib/config-api";
import { useFriendlyError } from "./friendly-error";
import { friendlyErrorMessages } from "./friendly-error-messages";
import { useMessages } from "./energyiq-locale";

type EnergyIqAccessValue = {
  access: EnergyAccessContextDto | null;
  activeProject: EnergyProjectDto | null;
  error: string | null;
  loading: boolean;
  navigationTransitionPending: boolean;
  getNavigationTransitionGeneration: () => number;
  beginNavigationTransition: () => void;
  finishNavigationTransition: () => void;
  refresh: () => Promise<void>;
  selectOrganisation: (workspaceId: string) => Promise<EnergyProjectDto | null>;
  selectProject: (projectId: string) => void;
  selectProjectContext: (workspaceId: string, projectId: string) => Promise<void>;
};

const EnergyIqAccessContext = createContext<EnergyIqAccessValue | null>(null);
const ORGANISATION_STORAGE_KEY = "energyiq:active-organisation:v1";
const projectStorageKey = (workspaceId: string) => `energyiq:active-project:${workspaceId}:v1`;
// Which Organisation each project was last opened in, so a link to it asks that Organisation first.
const PROJECT_ORGANISATION_STORAGE_KEY = "energyiq:project-organisation:v1";

export function EnergyIqAccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<EnergyAccessContextDto | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The failure itself is kept so its wording follows the reader's language; consumers receive a plain sentence.
  const [failure, setFailure] = useState<{ reason: unknown } | null>(null);
  const friendly = useFriendlyError();
  const tf = useMessages(friendlyErrorMessages);
  const error = failure ? friendly(failure.reason, tf("access.loadFailed")) : null;
  const [navigationTransitionPending, setNavigationTransitionPending] = useState(false);
  const navigationTransitionGenerationRef = useRef(0);
  const beginNavigationTransition = useCallback(() => {
    navigationTransitionGenerationRef.current += 1;
    setNavigationTransitionPending(true);
  }, []);
  const getNavigationTransitionGeneration = useCallback(
    () => navigationTransitionGenerationRef.current,
    [],
  );
  const finishNavigationTransition = useCallback(() => {
    navigationTransitionGenerationRef.current += 1;
    setNavigationTransitionPending(false);
  }, []);

  const load = useCallback(async (
    requestedWorkspaceId?: string,
    requestedProjectId: string | null = getRequestedProjectId(),
  ) => {
    setLoading(true);
    setFailure(null);
    try {
      const restoredWorkspaceId = requestedWorkspaceId || rememberedOrganisation(requestedProjectId) || (typeof window === "undefined"
        ? null
        : window.localStorage.getItem(ORGANISATION_STORAGE_KEY));
      if (restoredWorkspaceId) setConfigApiWorkspaceId(restoredWorkspaceId);
      let next: EnergyAccessContextDto;
      try {
        next = await configApi.getEnergyAccessContext();
      } catch (reason) {
        if (!restoredWorkspaceId || !isStaleOrganisationSelection(reason)) throw reason;
        window.localStorage.removeItem(ORGANISATION_STORAGE_KEY);
        setConfigApiWorkspaceId(null);
        next = await configApi.getEnergyAccessContext();
      }
      next = await recoverRequestedProjectContext(next, requestedProjectId);
      if (next.activeWorkspaceId) {
        setConfigApiWorkspaceId(next.activeWorkspaceId);
        try {
          window.localStorage.setItem(ORGANISATION_STORAGE_KEY, next.activeWorkspaceId);
        } catch {
          // The server-selected Organisation remains authoritative.
        }
      }
      setAccess(next);
      const selectable = selectableProjects(next);
      const stored = typeof window === "undefined"
        ? null
        : window.localStorage.getItem(projectStorageKey(next.activeWorkspaceId));
      const selected = selectable.find((project) => project.id === requestedProjectId)
        ?? selectable.find((project) => project.id === stored)
        ?? selectable.find((project) => project.status === "published")
        ?? selectable[0]
        ?? null;
      setActiveProjectId(selected?.id ?? null);
      if (selected) rememberOrganisation(selected.id, next.activeWorkspaceId);
      return selected;
    } catch (reason) {
      setFailure({ reason });
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const availableProjects = useMemo(
    () => access ? selectableProjects(access) : [],
    [access],
  );
  const activeProject = availableProjects.find((project) => project.id === activeProjectId)
    ?? availableProjects.find((project) => project.status === "published")
    ?? availableProjects[0]
    ?? null;

  const selectProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    if (access?.activeWorkspaceId) rememberOrganisation(projectId, access.activeWorkspaceId);
    try {
      if (access?.activeWorkspaceId) {
        window.localStorage.setItem(projectStorageKey(access.activeWorkspaceId), projectId);
      }
    } catch {
      // Selection remains in memory when localStorage is unavailable.
    }
  }, [access?.activeWorkspaceId]);

  const selectOrganisation = useCallback(async (workspaceId: string) => {
    if (!workspaceId) return null;
    if (workspaceId === access?.activeWorkspaceId) return activeProject;
    const previousAccess = access;
    const previousWorkspaceId = access?.activeWorkspaceId ?? null;
    const previousProjectId = activeProject?.id ?? null;
    setConfigApiWorkspaceId(workspaceId);
    try {
      window.localStorage.setItem(ORGANISATION_STORAGE_KEY, workspaceId);
    } catch {
      // Selection remains in memory when localStorage is unavailable.
    }
    const selected = await load(workspaceId, null);
    if (selected || !previousWorkspaceId) return selected;

    setConfigApiWorkspaceId(previousWorkspaceId);
    setAccess(previousAccess);
    setActiveProjectId(previousProjectId);
    try {
      window.localStorage.setItem(ORGANISATION_STORAGE_KEY, previousWorkspaceId);
    } catch {
      // The previous authorised context remains active in memory.
    }
    return null;
  }, [access, activeProject, load]);

  const selectProjectContext = useCallback(async (workspaceId: string, projectId: string) => {
    if (!workspaceId || !projectId) return;
    if (workspaceId === access?.activeWorkspaceId) {
      selectProject(projectId);
      return;
    }
    setConfigApiWorkspaceId(workspaceId);
    try {
      window.localStorage.setItem(ORGANISATION_STORAGE_KEY, workspaceId);
      window.localStorage.setItem(projectStorageKey(workspaceId), projectId);
    } catch {
      // The requested context is still applied in memory when localStorage is unavailable.
    }
    await load(workspaceId, projectId);
  }, [access?.activeWorkspaceId, load, selectProject]);

  const value = useMemo<EnergyIqAccessValue>(
    () => ({
      access,
      activeProject,
      error,
      loading,
      navigationTransitionPending,
      getNavigationTransitionGeneration,
      beginNavigationTransition,
      finishNavigationTransition,
      refresh: async () => {
        await load();
      },
      selectOrganisation,
      selectProject,
      selectProjectContext,
    }),
    [
      access,
      activeProject,
      beginNavigationTransition,
      error,
      finishNavigationTransition,
      getNavigationTransitionGeneration,
      load,
      loading,
      navigationTransitionPending,
      selectOrganisation,
      selectProject,
      selectProjectContext,
    ],
  );

  return (
    <EnergyIqAccessContext.Provider value={value}>
      {children}
    </EnergyIqAccessContext.Provider>
  );
}

export function useEnergyIqAccess(): EnergyIqAccessValue {
  const value = useContext(EnergyIqAccessContext);
  if (!value) {
    throw new Error("useEnergyIqAccess must be used inside EnergyIqAccessProvider");
  }
  return value;
}

function isStaleOrganisationSelection(reason: unknown): boolean {
  if (!(reason instanceof Error)) return false;
  return reason.message.includes("WORKSPACE_NOT_FOUND")
    || reason.message.includes("ENERGYIQ_WORKSPACE_FORBIDDEN");
}

function getRequestedProjectId(): string | null {
  // Any page that names a project can be opened from a link, even when that project belongs to another client.
  if (typeof window === "undefined" || !window.location.pathname.startsWith("/energyiq/")
    || window.location.pathname.startsWith("/energyiq/admin")) return null;
  return new URLSearchParams(window.location.search).get("projectId");
}

async function recoverRequestedProjectContext(
  initial: EnergyAccessContextDto,
  requestedProjectId: string | null,
): Promise<EnergyAccessContextDto> {
  if (!requestedProjectId || hasSelectableProject(initial, requestedProjectId)) return initial;

  // Deep-link recovery only probes Workspaces already authorised by the access response, all at once.
  const candidates = await Promise.all(initial.workspaces
    .filter((workspace) => !workspace.disabled && workspace.id !== initial.activeWorkspaceId)
    .map((workspace) => configApi.getEnergyAccessContext({ workspaceId: workspace.id }).catch(() => null)));
  const found = candidates.find((candidate) => candidate && hasSelectableProject(candidate, requestedProjectId));
  setConfigApiWorkspaceId(found?.activeWorkspaceId ?? initial.activeWorkspaceId);
  return found ?? initial;
}

function rememberedOrganisation(projectId: string | null): string | null {
  if (!projectId || typeof window === "undefined") return null;
  try {
    const remembered = JSON.parse(window.localStorage.getItem(PROJECT_ORGANISATION_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    return typeof remembered[projectId] === "string" ? remembered[projectId] : null;
  } catch {
    return null;
  }
}

function rememberOrganisation(projectId: string, workspaceId: string): void {
  if (typeof window === "undefined" || rememberedOrganisation(projectId) === workspaceId) return;
  try {
    const remembered = JSON.parse(window.localStorage.getItem(PROJECT_ORGANISATION_STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(PROJECT_ORGANISATION_STORAGE_KEY, JSON.stringify({ ...remembered, [projectId]: workspaceId }));
  } catch {
    // Without storage, a link to another Organisation's project still works by asking each Organisation.
  }
}

function hasSelectableProject(access: EnergyAccessContextDto, projectId: string): boolean {
  return selectableProjects(access).some((project) => project.id === projectId);
}

function selectableProjects(access: EnergyAccessContextDto): EnergyProjectDto[] {
  return access.projects.filter((project) => project.workspaceId === access.activeWorkspaceId
    && (project.status === "published" || (access.role === "admin" && project.status === "draft")));
}