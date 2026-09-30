import type {
  ApiResult,
  ArtifactExportFormat,
  ArtifactDto,
  ArtifactVersionDto,
  BackendCapabilitiesResponse,
  ContinueEnergySessionResponseDto,
  DatalinkGraphResponseDto,
  DatalinkServersResponseDto,
  DatalinkToolResponseDto,
  DatasourceDto,
  DatasourceSchemaDto,
  DatasourceTablePreviewDto,
  DatasourceTypeDto,
  DevIdentitiesResponseDto,
  DevIdentityUser,
  EnergyAccessContextDto,
  EnergyMeterHealthDto,
  EnergyAdminOrganisationDto,
  EnergyAdminUserDto,
  EnergyAdditionalInsightFeedbackDto,
  EnergyAdditionalInsightCommentDto,
  EnergyAdditionalInsightEvaluationSummaryDto,
  EnergyAdditionalInsightTransitionSummaryDto,
  EnergyImportBatchDto,
  EnergyImportBatchesResponseDto,
  EnergyImportMaterializationResponseDto,
  EnergyInsightMethodProposalDto,
  EnergyOperatingCalendarEntryInputDto,
  EnergyOperatingCalendarRevisionDto,
  EnergyOperationalPolicyConfigurationDto,
  EnergyProjectAnalysisResolutionDto,
  EnergyProjectOverviewLifecycleDto,
  EnergyProjectOverviewMinimumDto,
  EnergyOverviewAiArtifactDto,
  EnergyPreschoolHtmlAiSlotReadModelDto,
  EnergyProjectOverviewAiReadModelDto,
  EnergyProjectOverviewAdminStateDto,
  EnergyProjectHarnessConfigurationDto,
  EnergyProjectAiOperationsDto,
  EnergyProjectMetricConfigResponseDto,
  EnergyProjectDataCoverageDto,
  EnergyProjectRuleConfigResponseDto,
  EnergyProjectTemplateDraftResponseDto,
  EnergyPublishedTemplateResponseDto,
  EnergyTemplateChangeContextDto,
  EnergyTemplateChangeDiffItemDto,
  EnergyTemplateChangePreviewDto,
  EnergyTemplateChangeProposalDto,
  EnergyOverviewDefinitionDto,
  EnergyTemplateDraftDocumentDto,
  EnergyTemplateRevisionDto,
  EnergyProjectHierarchyDto,
  EnergyProjectRecordDto,
  EnergyProjectSetupDocumentDto,
  EnergyProjectSetupDraftDto,
  EnergyProjectSetupDto,
  EnergyProjectSetupValidationDto,
  EnergyQueryContextDto,
  EnergyQueryContextRequestDto,
  EnergyScopeAnalysisDto,
  EnergySavedAnalysisDetailDto,
  EnergySavedAnalysisAiArtifactInputDto,
  EnergySavedOverviewComparisonCandidateDto,
  EnergySavedAnalysisSummaryDto,
  EnergyTariffScheduleEntryInputDto,
  EnergyTariffScheduleRevisionDto,
  FileAssetRefDto,
  JobDto,
  KnowledgeBaseDto,
  KnowledgeDocumentDto,
  MeResponseDto,
  McpServerDto,
  ModelProfileDto,
  QueryHistoryItemDto,
  QueryHistoryListResponseDto,
  RunCancelDto,
  RunDefaultsDto,
  SessionBranchDto,
  SessionConversationDto,
  SessionListResponseDto,
  SessionTitleDto,
  SkillDto,
  TraceDagDto,
  WorkspaceConfigDto,
} from "./types";
import { ConfigApiError as ConfigApiErrorClass } from "./types";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_WORKSPACE_ID = "default";

export type ConfigApiIdentity = {
  userId: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  devToken: string;
};

let currentIdentity: ConfigApiIdentity | null = null;
let currentWorkspaceId: string | null = isPasswordAuthMode() ? null : DEFAULT_WORKSPACE_ID;

export function setConfigApiIdentity(identity: ConfigApiIdentity | null): void {
  currentIdentity = identity;
}

export function clearConfigApiIdentity(): void {
  currentIdentity = null;
}

export function setConfigApiWorkspaceId(workspaceId: string | null): void {
  currentWorkspaceId = workspaceId;
}

export function configApiIdentityHeaders(): Record<string, string> {
  if (isPasswordAuthMode()) {
    return currentWorkspaceId ? { "X-Workspace-Id": currentWorkspaceId } : {};
  }
  if (!currentIdentity?.devToken) {
    return {};
  }
  return {
    Authorization: `Bearer ${currentIdentity.devToken}`,
    "X-Workspace-Id": currentWorkspaceId ?? DEFAULT_WORKSPACE_ID,
  };
}

export function getConfigApiBaseUrl(): string {
  if (isPasswordAuthMode()) {
    const configured = process.env.NEXT_PUBLIC_CONFIG_API_URL;
    if (configured !== undefined) {
      return configured.replace(/\/$/u, "");
    }
    return "";
  }
  return (
    process.env.NEXT_PUBLIC_CONFIG_API_URL ??
    process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL?.replace(/\/api\/copilotkit\/?$/u, "") ??
    DEFAULT_BASE_URL
  ).replace(/\/$/u, "");
}

export function isPasswordAuthMode(): boolean {
  const configured = process.env.NEXT_PUBLIC_DATAFOUNDRY_AUTH_MODE;
  if (configured === "password") return true;
  if (configured === "dev") return false;
  return process.env.NODE_ENV === "production";
}

export function isLocalDevAdminAvailable(hostname?: string): boolean {
  if (isPasswordAuthMode()) return false;
  const resolvedHostname = hostname ?? (typeof window === "undefined" ? "" : window.location.hostname);
  return resolvedHostname === "localhost"
    || resolvedHostname === "127.0.0.1"
    || resolvedHostname === "::1";
}

export function getAgentRuntimeUrl(): string {
  if (isPasswordAuthMode()) {
    return "/api/copilotkit";
  }
  return (
    process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL ??
    `${DEFAULT_BASE_URL}/api/copilotkit`
  );
}

export function configApiCsrfHeaders(method: string | undefined): Record<string, string> {
  if (!isPasswordAuthMode() || !isUnsafeMethod(method)) {
    return {};
  }
  const token = csrfCookie();
  return token ? { "X-CSRF-Token": token } : {};
}

function csrfCookie(): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("df_csrf="))
    ?.slice("df_csrf=".length);
}

function isUnsafeMethod(method: string | undefined): boolean {
  return method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    throw new ConfigApiErrorClass("INTERNAL_ERROR", "Empty response body", response.status);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConfigApiErrorClass(
      "INTERNAL_ERROR",
      `Invalid JSON response (${response.status})`,
      response.status,
    );
  }
  return parsed as T;
}

async function requestEnvelope<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const baseUrl = getConfigApiBaseUrl();
  const identityHeaders = configApiIdentityHeaders();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    ...(isPasswordAuthMode() ? { credentials: "same-origin" as RequestCredentials } : {}),
    headers: {
      Accept: "application/json",
      ...identityHeaders,
      ...configApiCsrfHeaders(init?.method),
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });

  const envelope = await parseJsonResponse<ApiResult<T>>(response);
  if (!envelope.success) {
    throw new ConfigApiErrorClass(
      envelope.error.code,
      envelope.error.message,
      response.status,
    );
  }
  return envelope.data;
}

async function requestRaw(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = getConfigApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    ...(isPasswordAuthMode() ? { credentials: "same-origin" as RequestCredentials } : {}),
    headers: {
      ...configApiIdentityHeaders(),
      ...configApiCsrfHeaders(init?.method),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ConfigApiErrorClass(
      "INTERNAL_ERROR",
      text || `Request failed (${response.status})`,
      response.status,
    );
  }
  return response;
}

function queryString(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `?${query}` : "";
}

function overviewAiArtifactParams(
  scopeId: string,
  pin?: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string },
): URLSearchParams {
  return new URLSearchParams({
    scopeId,
    ...(pin ? {
      from: pin.from,
      to: pin.to,
      dataSnapshotId: pin.dataSnapshotId,
      projectReleaseId: pin.projectReleaseId,
    } : {}),
  });
}

export type ReportModelProtocol = "openai-completions" | "anthropic-messages";
export type ReportModelProfile = { apiProtocol?: ReportModelProtocol; id: string; name: string; modelName: string; baseUrl: string; hasSecret: boolean; revision: number; compatible: boolean; testedAt: string | null };
export type ReportModelsState = { current: { configured: boolean; available?: boolean; modelName?: string; name?: string; sourceProfileId?: string; revision?: number }; profiles: ReportModelProfile[] };
export const configApi = {
  getReportModels(): Promise<ReportModelsState> { return requestEnvelope("/api/v1/report-models"); },
  createReportModel(body: { apiProtocol?: ReportModelProtocol; name: string; modelName: string; baseUrl: string; apiKey: string }): Promise<ReportModelProfile> {
    return requestEnvelope("/api/v1/report-models", { method: "POST", body: JSON.stringify(body) });
  },
  testReportModel(id: string, revision: number): Promise<ReportModelProfile> {
    return requestEnvelope(`/api/v1/report-models/${encodeURIComponent(id)}/test`, { method: "POST", body: JSON.stringify({ revision }) });
  },
  activateReportModel(id: string, revision: number, bindingRevision: number): Promise<ReportModelsState> {
    return requestEnvelope(`/api/v1/report-models/${encodeURIComponent(id)}/activate`, { method: "POST", body: JSON.stringify({ revision, bindingRevision }) });
  },
  reportActionRequest<T>(projectId: string, action = "", init?: RequestInit): Promise<T> {
    return requestEnvelope<T>(`/api/v1/energy/report-actions/${encodeURIComponent(projectId)}${action ? `/${action}` : ""}`, init);
  },
  reportLibraryRequest<T>(projectId: string, action = "", init?: RequestInit): Promise<T> {
    return requestEnvelope<T>(`/api/v1/energy/report-library/${encodeURIComponent(projectId)}${action ? action.startsWith("?") ? action : `/${action}` : ""}`, init);
  },
  reportTaskHistoryRequest<T>(query = "", init?: RequestInit): Promise<T> {
    return requestEnvelope<T>(`/api/v1/energy/admin/task-history${query}`, init);
  },
  reportAgentRequest<T>(projectId: string, action = "", init?: RequestInit): Promise<T> {
    return requestEnvelope<T>(`/api/v1/energy/admin/report-agent/${encodeURIComponent(projectId)}${action ? `/${action}` : ""}`, init);
  },
  register(body: { displayName?: string; email: string; password: string }): Promise<{
    user: { id: string; email?: string; displayName?: string };
    workspace: { id: string; name?: string };
    verificationToken?: string;
  }> {
    return requestEnvelope("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  login(body: { email: string; password: string; rememberMe?: boolean }): Promise<MeResponseDto> {
    return requestEnvelope<MeResponseDto>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  verifyEmail(body: { token: string }): Promise<{ user: { id: string; email?: string; displayName?: string } }> {
    return requestEnvelope("/api/v1/auth/verify-email", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  logout(): Promise<{ ok: boolean }> {
    return requestEnvelope<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" });
  },

  logoutAll(): Promise<{ ok: boolean }> {
    return requestEnvelope<{ ok: boolean }>("/api/v1/auth/logout-all", { method: "POST" });
  },

  forgotPassword(body: { email: string }): Promise<{ ok: boolean; resetToken?: string }> {
    return requestEnvelope("/api/v1/auth/password/forgot", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  resetPassword(body: { password: string; token: string }): Promise<{ ok: boolean }> {
    return requestEnvelope("/api/v1/auth/password/reset", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  changePassword(body: { currentPassword: string; newPassword: string }): Promise<{ ok: boolean }> {
    return requestEnvelope("/api/v1/auth/password/change", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getMe(): Promise<MeResponseDto> {
    return requestEnvelope<MeResponseDto>("/api/v1/me");
  },

  activateAccount(body: { displayName?: string; password: string; token: string }): Promise<MeResponseDto> {
    return requestEnvelope<MeResponseDto>("/api/v1/auth/activate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateMe(body: { displayName: string; avatarUrl?: string | null }): Promise<MeResponseDto> {
    return requestEnvelope<MeResponseDto>("/api/v1/me", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  getEnergyProjectInformation<T>(projectId: string): Promise<T> {
    return requestEnvelope<T>(`/api/v1/energy/projects/${encodeURIComponent(projectId)}/information`);
  },

  getEnergyProjectMeterHealth(projectId: string): Promise<EnergyMeterHealthDto> {
    return requestEnvelope<EnergyMeterHealthDto>(`/api/v1/energy/projects/${encodeURIComponent(projectId)}/meter-health`);
  },

  getEnergyAccessContext(options?: { workspaceId?: string; signal?: AbortSignal }): Promise<EnergyAccessContextDto> {
    return requestEnvelope<EnergyAccessContextDto>("/api/v1/energy/access-context", {
      signal: options?.signal,
      ...(options?.workspaceId ? { headers: { "X-Workspace-Id": options.workspaceId } } : {}),
    });
  },

  listEnergyAdminOrganisations(): Promise<{ organisations: EnergyAdminOrganisationDto[] }> {
    return requestEnvelope("/api/v1/energy/admin/organisations");
  },

  createEnergyAdminOrganisation(body: { name: string }): Promise<EnergyAdminOrganisationDto> {
    return requestEnvelope("/api/v1/energy/admin/organisations", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateEnergyAdminOrganisation(
    id: string,
    body: { disabled: boolean; name: string },
  ): Promise<EnergyAdminOrganisationDto> {
    return requestEnvelope(`/api/v1/energy/admin/organisations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  /** Moves a project, with its readings and history, into another customer Organisation. */
  moveEnergyAdminProject(
    projectId: string,
    body: { organisationId: string },
  ): Promise<{ organisations: EnergyAdminOrganisationDto[] }> {
    return requestEnvelope(`/api/v1/energy/admin/projects/${encodeURIComponent(projectId)}/move`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  /** Archives a project (hidden from customers, data kept) or restores it. */
  setEnergyAdminProjectArchived(projectId: string, archived: boolean): Promise<{ organisations: EnergyAdminOrganisationDto[] }> {
    return requestEnvelope(`/api/v1/energy/admin/projects/${encodeURIComponent(projectId)}/archive`, {
      method: "POST",
      body: JSON.stringify({ archived }),
    });
  },

  /** Permanently deletes a project and all of its data. `confirmName` must equal the project name. */
  deleteEnergyAdminProject(projectId: string, confirmName: string): Promise<{ organisations: EnergyAdminOrganisationDto[] }> {
    return requestEnvelope(`/api/v1/energy/admin/projects/${encodeURIComponent(projectId)}/delete`, {
      method: "POST",
      body: JSON.stringify({ confirmName }),
    });
  },

  /** Permanently deletes an Organisation that has no projects and no users. */
  deleteEnergyAdminOrganisation(id: string): Promise<{ organisations: EnergyAdminOrganisationDto[] }> {
    return requestEnvelope(`/api/v1/energy/admin/organisations/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  listEnergyAdminUsers(): Promise<{ users: EnergyAdminUserDto[] }> {
    return requestEnvelope("/api/v1/energy/admin/users");
  },

  inviteEnergyAdminUser(body: {
    displayName?: string;
    email: string;
    organisationIds: string[];
    role: "user" | "admin";
  }): Promise<{ invitationUrl?: string; user: EnergyAdminUserDto }> {
    return requestEnvelope("/api/v1/energy/admin/users", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  updateEnergyAdminUser(
    id: string,
    body: {
      disabled: boolean;
      displayName: string;
      organisationIds: string[];
      role: "user" | "admin";
    },
  ): Promise<EnergyAdminUserDto> {
    return requestEnvelope(`/api/v1/energy/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  resendEnergyAdminInvitation(id: string): Promise<{ invitationUrl?: string; user: EnergyAdminUserDto }> {
    return requestEnvelope(`/api/v1/energy/admin/users/${encodeURIComponent(id)}/resend-invitation`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  getEnergyProjectHierarchy(projectId: string): Promise<EnergyProjectHierarchyDto> {
    return requestEnvelope<EnergyProjectHierarchyDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/hierarchy`,
    );
  },

  getEnergyProjectOverviewMinimum(projectId: string): Promise<EnergyProjectOverviewMinimumDto> {
    return requestEnvelope<EnergyProjectOverviewMinimumDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-minimum`,
    );
  },

  createEnergyProject(body: {
    name: string;
    timezone?: string;
  }): Promise<{ project: EnergyProjectRecordDto; draft: EnergyProjectSetupDraftDto }> {
    return requestEnvelope("/api/v1/energy/projects", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getEnergyProjectSetup(projectId: string): Promise<EnergyProjectSetupDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/setup`,
    );
  },

  saveEnergyProjectSetupDraft(
    projectId: string,
    body: { expectedRevision: number; document: EnergyProjectSetupDocumentDto },
  ): Promise<{
    draft: EnergyProjectSetupDraftDto;
    validation: EnergyProjectSetupValidationDto;
  }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/setup/draft`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  },

  validateEnergyProjectSetup(projectId: string): Promise<EnergyProjectSetupValidationDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/setup/validate`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  publishEnergyProjectSetup(
    projectId: string,
    body: {
      expectedRevision: number;
      expectedTemplateDraftRevision: number;
      expectedMetricConfigRevision: number;
      expectedRuleConfigRevision: number;
    },
  ): Promise<{
    hierarchy_revision_id: string;
    template_revision_id: string;
    validation: EnergyProjectSetupValidationDto;
    project: EnergyProjectRecordDto;
  }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/setup/publish`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  /** Makes saved Facility changes live straight away (publishes with the project's current settings). */
  applyEnergyProjectChanges(projectId: string): Promise<{ hierarchy_revision_id: string; template_revision_id: string }> {
    return requestEnvelope(`/api/v1/energy/projects/${encodeURIComponent(projectId)}/setup/apply`, { method: "POST", body: JSON.stringify({}) });
  },

  selectEnergyOperationalPolicy(projectId: string, body: { kind: "tariff" | "calendar"; version: string; expectedVersion: string | null }): Promise<EnergyOperationalPolicyConfigurationDto> {
    return requestEnvelope(`/api/v1/energy/projects/${encodeURIComponent(projectId)}/operational-policies/select`, { method: "POST", body: JSON.stringify(body) });
  },

  getEnergyOperationalPolicies(projectId: string): Promise<EnergyOperationalPolicyConfigurationDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/operational-policies`,
    );
  },

  publishEnergyTariffSchedule(
    projectId: string,
    body: { entries: EnergyTariffScheduleEntryInputDto[] },
  ): Promise<{
    revision: EnergyTariffScheduleRevisionDto;
    configuration: EnergyOperationalPolicyConfigurationDto;
  }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/operational-policies/tariff`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  publishEnergyOperatingCalendar(
    projectId: string,
    body: { entries: EnergyOperatingCalendarEntryInputDto[]; academicPeriods?: NonNullable<EnergyOperatingCalendarRevisionDto["academic_periods"]> },
  ): Promise<{
    revision: EnergyOperatingCalendarRevisionDto;
    configuration: EnergyOperationalPolicyConfigurationDto;
  }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/operational-policies/calendar`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  getEnergyProjectMetricConfig(projectId: string): Promise<EnergyProjectMetricConfigResponseDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/metric-config`,
    );
  },

  saveEnergyProjectMetricConfig(
    projectId: string,
    body: { expectedRevision: number; selectedMetricRevisionIds: string[] },
  ): Promise<EnergyProjectMetricConfigResponseDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/metric-config`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  },

  getEnergyProjectRuleConfig(projectId: string): Promise<EnergyProjectRuleConfigResponseDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/rule-config`,
    );
  },

  saveEnergyProjectRuleConfig(
    projectId: string,
    body: { expectedRevision: number; selectedRuleRevisionIds: string[] },
  ): Promise<EnergyProjectRuleConfigResponseDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/rule-config`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  },

  getEnergyProjectTemplateDraft(projectId: string): Promise<EnergyProjectTemplateDraftResponseDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/template-draft`,
    );
  },

  getEnergyPublishedTemplate(projectId: string): Promise<EnergyPublishedTemplateResponseDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/published-template`,
    );
  },

  getEnergyTemplateChangeContext(projectId: string): Promise<EnergyTemplateChangeContextDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/template-change-context`,
    );
  },

  publishEnergyAiSlotPresentation(
    projectId: string,
    mode: "structured" | "html",
  ): Promise<{
    revision: EnergyTemplateRevisionDto;
    overviewDefinition: EnergyOverviewDefinitionDto;
    diff: EnergyTemplateChangeDiffItemDto[];
  }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/ai-slot-presentation`,
      { method: "POST", body: JSON.stringify({ mode }) },
    );
  },

  proposeEnergyTemplateChange(
    projectId: string,
    body: { instruction: string; scopeId?: string },
  ): Promise<{
    proposal: EnergyTemplateChangeProposalDto;
    generation: { runId: string; sessionId: string };
  }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/template-change-proposals`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  previewEnergyTemplateChange(projectId: string, proposalId: string): Promise<EnergyTemplateChangePreviewDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/template-change-proposals/${encodeURIComponent(proposalId)}/preview`,
    );
  },

  rejectEnergyTemplateChange(projectId: string, proposalId: string): Promise<{ proposal: EnergyTemplateChangeProposalDto }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/template-change-proposals/${encodeURIComponent(proposalId)}/reject`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  publishEnergyTemplateChange(projectId: string, proposalId: string): Promise<{
    proposal: EnergyTemplateChangeProposalDto;
    revision: EnergyTemplateRevisionDto;
  }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/template-change-proposals/${encodeURIComponent(proposalId)}/publish`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  listEnergySavedAnalyses(projectId: string): Promise<{ items: EnergySavedAnalysisSummaryDto[] }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/saved-analyses`,
    );
  },

  listEnergySavedOverviewComparisonCandidates(
    projectId: string,
  ): Promise<{ items: EnergySavedOverviewComparisonCandidateDto[] }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/saved-analyses/overview-comparison-candidates`,
    );
  },

  saveEnergyAnalysis(
    projectId: string,
    body: EnergyQueryContextRequestDto & {
      title?: string;
      viewState?: {
        grain: "day" | "hour";
        comparison: "overlay" | "selected" | "average";
        category: "all" | "load" | "light";
      };
      aiArtifact?: EnergySavedAnalysisAiArtifactInputDto;
    },
  ): Promise<EnergySavedAnalysisDetailDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/saved-analyses`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  getEnergySavedAnalysis(
    projectId: string,
    analysisId: string,
  ): Promise<EnergySavedAnalysisDetailDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/saved-analyses/${encodeURIComponent(analysisId)}`,
    );
  },

  rerunEnergySavedAnalysis(
    projectId: string,
    analysisId: string,
  ): Promise<EnergySavedAnalysisDetailDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/saved-analyses/${encodeURIComponent(analysisId)}/rerun`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  getEnergyProjectDataCoverage(projectId: string): Promise<{ coverage: EnergyProjectDataCoverageDto | null }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/data-coverage`,
    );
  },

  saveEnergyProjectTemplateDraft(
    projectId: string,
    body: { expectedRevision: number; document: EnergyTemplateDraftDocumentDto },
  ): Promise<EnergyProjectTemplateDraftResponseDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/template-draft`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  },

  resolveEnergyQueryContext(
    body: EnergyQueryContextRequestDto,
  ): Promise<EnergyQueryContextDto> {
    return requestEnvelope<EnergyQueryContextDto>("/api/v1/energy/query-context/resolve", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  executeEnergyScopeAnalysis(
    body: EnergyQueryContextRequestDto,
  ): Promise<EnergyScopeAnalysisDto> {
    return requestEnvelope<EnergyScopeAnalysisDto>("/api/v1/energy/analysis/execute", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  resolveProjectAnalysis(
    body: EnergyQueryContextRequestDto,
    options?: { bypassCache?: boolean },
  ): Promise<EnergyProjectAnalysisResolutionDto> {
    if (body.analysisWindow === "current-project-overview") {
      if (body.scopeId !== "project" || body.resource !== "electricity") {
        return Promise.reject(
          new Error("ENERGYIQ_CURRENT_PROJECT_OVERVIEW_CONTEXT_INVALID"),
        );
      }
      const params = new URLSearchParams();
      if (body.expectedDataSnapshotId) {
        params.set("expectedDataSnapshotId", body.expectedDataSnapshotId);
      }
      if (body.expectedProjectReleaseId) {
        params.set("expectedProjectReleaseId", body.expectedProjectReleaseId);
      }
      if (body.from) params.set("expectedFrom", body.from);
      if (body.to) params.set("expectedTo", body.to);
      const query = params.size > 0 ? `?${params.toString()}` : "";
      return requestEnvelope<EnergyProjectAnalysisResolutionDto>(
        `/api/v1/energy/projects/${encodeURIComponent(body.projectId)}/overview-projection${query}`,
      );
    }
    return requestEnvelope<EnergyProjectAnalysisResolutionDto>("/api/v1/energy/analysis/resolve", {
      method: "POST",
      body: JSON.stringify(options?.bypassCache ? { ...body, bypassCache: true } : body),
    });
  },

  getCurrentProjectOverviewLifecycle(
    projectId: string,
    expectedProjectionRef: string,
  ): Promise<EnergyProjectOverviewLifecycleDto> {
    const params = new URLSearchParams({ expectedProjectionRef });
    return requestEnvelope<EnergyProjectOverviewLifecycleDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-lifecycle?${params.toString()}`,
    );
  },

  materializeCurrentProjectOverview(
    projectId: string,
  ): Promise<{
    changed: boolean;
    identity: Record<string, unknown>;
    evidenceRefs: string[];
  }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-projection`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  getEnergyOverviewAiArtifact(
    projectId: string,
    scopeId: string,
    pin?: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string },
  ): Promise<EnergyOverviewAiArtifactDto> {
    const params = overviewAiArtifactParams(scopeId, pin);
    return requestEnvelope<EnergyOverviewAiArtifactDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-ai-artifact?${params.toString()}`,
    );
  },

  getEnergyProjectOverviewAiReadModel(
    projectId: string,
    scopeId: string,
    pin?: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string },
  ): Promise<EnergyProjectOverviewAiReadModelDto> {
    const params = overviewAiArtifactParams(scopeId, pin);
    return requestEnvelope<EnergyProjectOverviewAiReadModelDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-ai-artifact?${params.toString()}`,
    );
  },

  getEnergyPreschoolHtmlAiSlots(
    projectId: string,
    scopeId: string,
    pin?: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string },
  ): Promise<EnergyPreschoolHtmlAiSlotReadModelDto> {
    const params = overviewAiArtifactParams(scopeId, pin);
    return requestEnvelope<EnergyPreschoolHtmlAiSlotReadModelDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-ai-artifact/html-slots?${params.toString()}`,
    );
  },

  getEnergyProjectOverviewAdminState(projectId: string): Promise<EnergyProjectOverviewAdminStateDto> {
    return requestEnvelope<EnergyProjectOverviewAdminStateDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-admin-state`,
    );
  },

  getEnergyProjectHarnessConfiguration(projectId: string): Promise<EnergyProjectHarnessConfigurationDto> {
    return requestEnvelope<EnergyProjectHarnessConfigurationDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/harness-configuration`,
    );
  },

  getEnergyProjectAiOperations(
    projectId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<EnergyProjectAiOperationsDto> {
    const query = new URLSearchParams();
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return requestEnvelope<EnergyProjectAiOperationsDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/ai-operations${suffix}`,
    );
  },

  getEnergyProjectAiOperationsRun(
    projectId: string,
    actorId: string,
    runId: string,
  ): Promise<EnergyProjectAiOperationsDto> {
    return requestEnvelope<EnergyProjectAiOperationsDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/ai-operations/runs/${encodeURIComponent(runId)}?actorId=${encodeURIComponent(actorId)}`,
    );
  },

  generateMissingEnergyProjectOverviewAnalysis(projectId: string): Promise<EnergyProjectOverviewAdminStateDto> {
    return requestEnvelope<EnergyProjectOverviewAdminStateDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-admin-state/actions/generate-missing`,
      { method: "POST", body: "{}" },
    );
  },

  ensureEnergyOverviewAiArtifact(
    projectId: string,
    scopeId: string,
    pin?: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string },
  ): Promise<EnergyOverviewAiArtifactDto> {
    const params = overviewAiArtifactParams(scopeId, pin);
    return requestEnvelope<EnergyOverviewAiArtifactDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-ai-artifact/ensure?${params.toString()}`,
      { method: "POST", body: "{}" },
    );
  },

  generateEnergyPreschoolHtmlAiSlots(
    projectId: string,
    scopeId: string,
    pin?: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string },
  ): Promise<EnergyPreschoolHtmlAiSlotReadModelDto> {
    const params = overviewAiArtifactParams(scopeId, pin);
    return requestEnvelope<EnergyPreschoolHtmlAiSlotReadModelDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-ai-artifact/html-slots/ensure?${params.toString()}`,
      { method: "POST", body: "{}" },
    );
  },

  retryEnergyOverviewAiArtifact(
    projectId: string,
    scopeId: string,
    pin?: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string },
    targetId?: "centre-benchmark" | "standby-wastage" | "operating-behaviour" | "planning-outlook" | "executive-synthesis",
  ): Promise<EnergyOverviewAiArtifactDto> {
    const params = overviewAiArtifactParams(scopeId, pin);
    return requestEnvelope<EnergyOverviewAiArtifactDto>(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/overview-ai-artifact/retry?${params.toString()}`,
      { method: "POST", body: JSON.stringify(targetId ? { targetId } : {}) },
    );
  },

  getEnergyAdditionalInsightFeedback(
    projectId: string,
    artifactId: string,
    findingId: string,
  ): Promise<EnergyAdditionalInsightFeedbackDto | null> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/${encodeURIComponent(artifactId)}/findings/${encodeURIComponent(findingId)}/feedback`,
    );
  },

  putEnergyAdditionalInsightFeedback(
    projectId: string,
    artifactId: string,
    findingId: string,
    body: { rating: "useful" | "not-useful"; expectedRevision: number },
  ): Promise<EnergyAdditionalInsightFeedbackDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/${encodeURIComponent(artifactId)}/findings/${encodeURIComponent(findingId)}/feedback`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  },

  listEnergyAdditionalInsightComments(
    projectId: string,
    artifactId: string,
    findingId: string,
  ): Promise<{ comments: EnergyAdditionalInsightCommentDto[] }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/${encodeURIComponent(artifactId)}/findings/${encodeURIComponent(findingId)}/comments`,
    );
  },

  appendEnergyAdditionalInsightComment(
    projectId: string,
    artifactId: string,
    findingId: string,
    body: { idempotencyKey: string; text: string },
  ): Promise<EnergyAdditionalInsightCommentDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/${encodeURIComponent(artifactId)}/findings/${encodeURIComponent(findingId)}/comments`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  createEnergyInsightMethodProposal(
    projectId: string,
    artifactId: string,
    findingId: string,
    body: { idempotencyKey: string; title: string; guidance: string },
  ): Promise<EnergyInsightMethodProposalDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/${encodeURIComponent(artifactId)}/findings/${encodeURIComponent(findingId)}/method-proposals`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  listEnergyInsightMethodProposals(projectId: string): Promise<{ proposals: EnergyInsightMethodProposalDto[] }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/method-proposals`,
    );
  },

  transitionEnergyInsightMethodProposal(
    projectId: string,
    proposalId: string,
    action: "submit" | "approve" | "publish",
    expectedRevision: number,
  ): Promise<EnergyInsightMethodProposalDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/method-proposals/${encodeURIComponent(proposalId)}/${action}`,
      { method: "POST", body: JSON.stringify({ expectedRevision }) },
    );
  },

  listEnergyAdditionalInsightEvaluations(
    projectId: string,
  ): Promise<{ evaluations: EnergyAdditionalInsightEvaluationSummaryDto[] }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/evaluations`,
    );
  },

  publishEnergyAdditionalInsightEvaluation(
    projectId: string,
    evaluationId: string,
    expectedRevision: number,
  ): Promise<EnergyAdditionalInsightEvaluationSummaryDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/evaluations/${encodeURIComponent(evaluationId)}/publish`,
      { method: "POST", body: JSON.stringify({ expectedRevision }) },
    );
  },

  listEnergyAdditionalInsightTransitions(
    projectId: string,
  ): Promise<{ transitions: EnergyAdditionalInsightTransitionSummaryDto[] }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/transitions`,
    );
  },

  createEnergyAdditionalInsightTransition(
    projectId: string,
    body: {
      idempotencyKey: string;
      previousEvaluationId: string;
      previousAttemptId: string;
      scopeId: string;
      dataSnapshotId: string;
      projectReleaseId: string;
      from: string;
      to: string;
    },
  ): Promise<EnergyAdditionalInsightTransitionSummaryDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/transitions`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  getEnergyAdditionalInsightTransition(
    projectId: string,
    transitionId: string,
  ): Promise<EnergyAdditionalInsightTransitionSummaryDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/additional-ai-insights/transitions/${encodeURIComponent(transitionId)}`,
    );
  },

  attachEnergySavedAnalysisAiArtifact(
    projectId: string,
    analysisId: string,
    aiArtifact: EnergySavedAnalysisAiArtifactInputDto,
  ): Promise<EnergySavedAnalysisDetailDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/saved-analyses/${encodeURIComponent(analysisId)}/ai-result`,
      { method: "POST", body: JSON.stringify({ aiArtifact }) },
    );
  },

  listEnergyImportBatches(projectId: string): Promise<EnergyImportBatchesResponseDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/imports`,
    );
  },

  /** Reads a device list (code → equipment) from a photo or screenshot of a table. */
  extractEnergyDeviceListFromImage(file: File): Promise<{ devices: Array<{ code: string; description: string }> }> {
    const form = new FormData();
    form.append("file", file);
    return requestEnvelope("/api/v1/energy/admin/device-list/extract", { method: "POST", body: form });
  },

  uploadEnergyExcelImport(
    projectId: string,
    file: File,
  ): Promise<{ batch: EnergyImportBatchDto; duplicate: boolean }> {
    const form = new FormData();
    form.append("file", file);
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/imports/excel`,
      { method: "POST", body: form },
    );
  },

  syncEnergyTuyaImport(
    projectId: string,
    body: {
      startTime: string | number;
      endTime: string | number;
    },
  ): Promise<{ batch: EnergyImportBatchDto; duplicate: boolean }> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/imports/tuya`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  materializeEnergyImportBatch(
    projectId: string,
    batchId: string,
  ): Promise<EnergyImportMaterializationResponseDto> {
    return requestEnvelope(
      `/api/v1/energy/projects/${encodeURIComponent(projectId)}/imports/${encodeURIComponent(batchId)}/materialize`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  getDevIdentities(): Promise<DevIdentitiesResponseDto> {
    return requestEnvelope<DevIdentitiesResponseDto>("/api/v1/dev/identities");
  },

  createDevUser(body: { id?: string; email?: string; displayName?: string }): Promise<{ user: DevIdentityUser }> {
    return requestEnvelope<{ user: DevIdentityUser }>("/api/v1/dev/users", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getCapabilities(): Promise<BackendCapabilitiesResponse> {
    return requestEnvelope<BackendCapabilitiesResponse>("/api/v1/capabilities");
  },

  getWorkspaceConfig(): Promise<WorkspaceConfigDto> {
    return requestEnvelope<WorkspaceConfigDto>("/api/v1/workspace-config");
  },

  getRunDefaults(): Promise<RunDefaultsDto> {
    return requestEnvelope<RunDefaultsDto>("/api/v1/run-defaults");
  },

  async uploadChatFile(
    file: File,
    sessionId?: string | null,
  ): Promise<{ path: string; mimeType: string; size: number }> {
    const form = new FormData();
    form.append("file", file);
    if (sessionId) {
      form.append("sessionId", sessionId);
      form.append("threadId", sessionId);
    }
    const response = await requestRaw("/api/v1/chat/uploads", {
      method: "POST",
      body: form,
    });
    return parseJsonResponse<{ path: string; mimeType: string; size: number }>(
      response,
    );
  },

  async uploadDatasourceFile(
    file: File,
  ): Promise<{ path: string; originalName: string; size: number; mimeType: string }> {
    const form = new FormData();
    form.append("file", file);
    const response = await requestRaw("/api/v1/datasources/uploads", {
      method: "POST",
      body: form,
    });
    return parseJsonResponse<{
      path: string;
      originalName: string;
      size: number;
      mimeType: string;
    }>(response);
  },

  getSessionConversation(sessionId: string, limit?: number): Promise<SessionConversationDto> {
    const params = new URLSearchParams();
    if (limit !== undefined) {
      params.set("limit", String(limit));
    }
    return requestEnvelope<SessionConversationDto>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/conversation${queryString(params)}`,
    );
  },

  continueEnergySessionOnCurrent(input: {
    sourceSessionId: string;
    target: {
      projectId: string;
      scopeId: string;
      resource: "electricity" | "water";
    };
  }): Promise<ContinueEnergySessionResponseDto> {
    return requestEnvelope<ContinueEnergySessionResponseDto>(
      "/api/v1/energy/analysis/sessions/continue-current",
      { method: "POST", body: JSON.stringify(input) },
    );
  },

  getSessionTraceDag(sessionId: string, limit?: number): Promise<TraceDagDto> {
    const params = new URLSearchParams();
    if (limit !== undefined) {
      params.set("limit", String(limit));
    }
    return requestEnvelope<TraceDagDto>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/trace-dag${queryString(params)}`,
    ).then(normalizeTraceDagDto);
  },

  createSessionBranch(
    sessionId: string,
    input: { checkpointId?: string; runId?: string; title?: string },
  ): Promise<SessionBranchDto> {
    return requestEnvelope<SessionBranchDto>(`/api/v1/sessions/${encodeURIComponent(sessionId)}/branches`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  listSessions(options: { limit?: number; cursor?: string; projectId?: string } = {}): Promise<SessionListResponseDto> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.projectId) params.set("projectId", options.projectId);
    return requestEnvelope<SessionListResponseDto>(`/api/v1/sessions${queryString(params)}`);
  },

  patchSessionTitle(sessionId: string, title: string): Promise<SessionTitleDto> {
    return requestEnvelope<SessionTitleDto>(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  },

  deleteSession(sessionId: string): Promise<{ sessionId: string; deleted: boolean; deletedSessionIds: string[] }> {
    return requestEnvelope<{ sessionId: string; deleted: boolean; deletedSessionIds: string[] }>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE" },
    );
  },

  listDatasourceTypes(): Promise<DatasourceTypeDto[]> {
    return requestEnvelope<DatasourceTypeDto[]>("/api/v1/datasource-types");
  },

  listDatalinkServers(): Promise<DatalinkServersResponseDto> {
    return requestEnvelope<DatalinkServersResponseDto>("/api/v1/datalink/servers");
  },

  getDatalinkGraph(serverId: string): Promise<DatalinkGraphResponseDto> {
    return requestEnvelope<DatalinkGraphResponseDto>(
      `/api/v1/datalink/${encodeURIComponent(serverId)}/graph`,
    );
  },

  exploreDatalink(
    serverId: string,
    body: { focus?: string; maskCredential?: boolean; maxNodes?: number; query: string },
  ): Promise<DatalinkToolResponseDto> {
    return requestEnvelope<DatalinkToolResponseDto>(
      `/api/v1/datalink/${encodeURIComponent(serverId)}/explore`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  addDatalinkTable(
    serverId: string,
    body: { schemaName?: string; source: string; sourceType?: string; table?: string },
  ): Promise<DatalinkToolResponseDto> {
    return requestEnvelope<DatalinkToolResponseDto>(
      `/api/v1/datalink/${encodeURIComponent(serverId)}/tables`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  removeDatalinkTable(
    serverId: string,
    body: { cleanupOrphans?: boolean; tableId: string },
  ): Promise<DatalinkToolResponseDto> {
    return requestEnvelope<DatalinkToolResponseDto>(
      `/api/v1/datalink/${encodeURIComponent(serverId)}/tables`,
      { method: "DELETE", body: JSON.stringify(body) },
    );
  },

  rebuildDatalink(serverId: string): Promise<DatalinkToolResponseDto> {
    return requestEnvelope<DatalinkToolResponseDto>(
      `/api/v1/datalink/${encodeURIComponent(serverId)}/rebuild`,
      { method: "POST", body: JSON.stringify({}) },
    );
  },

  createDatasource(body: Record<string, unknown>): Promise<DatasourceDto> {
    return requestEnvelope<DatasourceDto>("/api/v1/datasources", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  patchDatasource(id: string, body: Record<string, unknown>): Promise<DatasourceDto> {
    return requestEnvelope<DatasourceDto>(`/api/v1/datasources/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteDatasource(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/datasources/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  testDatasource(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/datasources/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  },

  introspectDatasource(id: string, idempotencyKey?: string): Promise<JobDto> {
    return requestEnvelope<JobDto>(`/api/v1/datasources/${encodeURIComponent(id)}/introspect`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    });
  },

  getDatasourceSchema(
    id: string,
    options: { q?: string; includeStats?: boolean } = {},
  ): Promise<DatasourceSchemaDto> {
    const params = new URLSearchParams();
    if (options.q) params.set("q", options.q);
    if (options.includeStats) params.set("includeStats", "true");
    return requestEnvelope<DatasourceSchemaDto>(
      `/api/v1/datasources/${encodeURIComponent(id)}/schema${queryString(params)}`,
    );
  },

  getDatasourceTablePreview(
    id: string,
    table: string,
    options: { schema?: string; limit?: number; offset?: number; orderBy?: string } = {},
  ): Promise<DatasourceTablePreviewDto> {
    const params = new URLSearchParams();
    if (options.schema) params.set("schema", options.schema);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.offset !== undefined) params.set("offset", String(options.offset));
    if (options.orderBy) params.set("orderBy", options.orderBy);
    return requestEnvelope<DatasourceTablePreviewDto>(
      `/api/v1/datasources/${encodeURIComponent(id)}/tables/${encodeURIComponent(table)}/preview${queryString(params)}`,
    );
  },

  createKnowledgeBase(body: Record<string, unknown>): Promise<KnowledgeBaseDto> {
    return requestEnvelope<KnowledgeBaseDto>("/api/v1/knowledge-bases", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  patchKnowledgeBase(id: string, body: Record<string, unknown>): Promise<KnowledgeBaseDto> {
    return requestEnvelope<KnowledgeBaseDto>(
      `/api/v1/knowledge-bases/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },

  deleteKnowledgeBase(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/knowledge-bases/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  testKnowledgeBase(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/knowledge-bases/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  },

  uploadKnowledgeFile(
    id: string,
    file: File,
  ): Promise<KnowledgeDocumentDto> {
    const form = new FormData();
    form.append("file", file);
    return requestEnvelope<KnowledgeDocumentDto>(`/api/v1/knowledge-bases/${encodeURIComponent(id)}/files`, {
      method: "POST",
      body: form,
    });
  },

  listKnowledgeFiles(id: string): Promise<{ documents: KnowledgeDocumentDto[] }> {
    return requestEnvelope<{ documents: KnowledgeDocumentDto[] }>(
      `/api/v1/knowledge-bases/${encodeURIComponent(id)}/files`,
    );
  },

  deleteKnowledgeFile(
    id: string,
    documentId: string,
  ): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope<{ deleted: boolean; id: string }>(
      `/api/v1/knowledge-bases/${encodeURIComponent(id)}/files/${encodeURIComponent(documentId)}`,
      { method: "DELETE" },
    );
  },

  reindexKnowledgeFile(id: string, documentId: string): Promise<KnowledgeDocumentDto> {
    return requestEnvelope<KnowledgeDocumentDto>(
      `/api/v1/knowledge-bases/${encodeURIComponent(id)}/files/${encodeURIComponent(documentId)}/reindex`,
      { method: "POST" },
    );
  },

  reindexKnowledgeBase(id: string, idempotencyKey?: string): Promise<JobDto> {
    return requestEnvelope<JobDto>(
      `/api/v1/knowledge-bases/${encodeURIComponent(id)}/reindex`,
      {
        method: "POST",
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      },
    );
  },

  createMcpServer(body: Record<string, unknown>): Promise<McpServerDto> {
    return requestEnvelope<McpServerDto>("/api/v1/mcp-servers", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  patchMcpServer(id: string, body: Record<string, unknown>): Promise<McpServerDto> {
    return requestEnvelope<McpServerDto>(`/api/v1/mcp-servers/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteMcpServer(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/mcp-servers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  testMcpServer(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/mcp-servers/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  },

  getMcpTools(id: string): Promise<Array<Record<string, unknown>>> {
    return requestEnvelope(`/api/v1/mcp-servers/${encodeURIComponent(id)}/tools`);
  },

  createModelProfile(body: Record<string, unknown>): Promise<ModelProfileDto> {
    return requestEnvelope<ModelProfileDto>("/api/v1/model-profiles", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  patchModelProfile(id: string, body: Record<string, unknown>): Promise<ModelProfileDto> {
    return requestEnvelope<ModelProfileDto>(
      `/api/v1/model-profiles/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  },

  deleteModelProfile(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/model-profiles/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  testModelProfile(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/model-profiles/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  },

  createSkill(form: FormData): Promise<SkillDto> {
    return requestEnvelope<SkillDto>("/api/v1/skills", {
      method: "POST",
      body: form,
    });
  },

  patchSkill(id: string, body: Record<string, unknown>): Promise<SkillDto> {
    return requestEnvelope<SkillDto>(`/api/v1/skills/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  deleteSkill(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/skills/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  testSkill(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/skills/${encodeURIComponent(id)}/test`, {
      method: "POST",
    });
  },

  validateSkill(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/skills/${encodeURIComponent(id)}/validate`, {
      method: "POST",
    });
  },

  replaceSkill(id: string, form: FormData): Promise<SkillDto> {
    return requestEnvelope<SkillDto>(`/api/v1/skills/${encodeURIComponent(id)}/replace`, {
      method: "POST",
      body: form,
    });
  },

  getJob(id: string): Promise<JobDto> {
    return requestEnvelope<JobDto>(`/api/v1/jobs/${encodeURIComponent(id)}`);
  },

  cancelJob(id: string): Promise<JobDto> {
    return requestEnvelope<JobDto>(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    });
  },

  cancelRun(id: string, reason?: string): Promise<RunCancelDto> {
    return requestEnvelope<RunCancelDto>(`/api/v1/runs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    });
  },

  getArtifact(id: string): Promise<ArtifactDto> {
    return requestEnvelope<ArtifactDto>(`/api/v1/artifacts/${encodeURIComponent(id)}`);
  },

  getArtifactPreview(id: string): Promise<Record<string, unknown>> {
    return requestEnvelope(`/api/v1/artifacts/${encodeURIComponent(id)}/preview`);
  },

  listSessionArtifacts(sessionId: string): Promise<{ artifacts: ArtifactDto[] }> {
    const params = new URLSearchParams({ sessionId });
    return requestEnvelope<{ artifacts: ArtifactDto[] }>(`/api/v1/artifacts?${params.toString()}`);
  },

  promoteArtifact(id: string): Promise<FileAssetRefDto> {
    return requestEnvelope<FileAssetRefDto>(`/api/v1/artifacts/${encodeURIComponent(id)}/promote`, {
      method: "POST",
    });
  },

  listArtifactVersions(id: string): Promise<{ versions: ArtifactVersionDto[] }> {
    return requestEnvelope<{ versions: ArtifactVersionDto[] }>(
      `/api/v1/artifacts/${encodeURIComponent(id)}/versions`
    );
  },

  async downloadArtifactVersion(
    id: string,
    versionId: string,
  ): Promise<{ blob: Blob; filename: string }> {
    const response = await requestRaw(
      `/api/v1/artifacts/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/download`
    );
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/u.exec(disposition);
    const filename = match?.[1] ?? `artifact-version-${versionId}`;
    const blob = await response.blob();
    return { blob, filename };
  },

  exportArtifact(
    id: string,
    format: ArtifactExportFormat,
    idempotencyKey?: string,
  ): Promise<JobDto> {
    return requestEnvelope<JobDto>(`/api/v1/artifacts/${encodeURIComponent(id)}/export`, {
      method: "POST",
      body: JSON.stringify({
        format,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      }),
    });
  },

  async downloadArtifact(
    id: string,
    format?: ArtifactExportFormat,
  ): Promise<{ blob: Blob; filename: string }> {
    const params = new URLSearchParams();
    if (format) params.set("format", format);
    const response = await requestRaw(
      `/api/v1/artifacts/${encodeURIComponent(id)}/download${queryString(params)}`,
    );
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/u.exec(disposition);
    const filename = match?.[1] ?? `artifact-${id}`;
    const blob = await response.blob();
    return { blob, filename };
  },

  listWorkspaceFiles(options: {
    scope?: "session" | "workspace";
    origin?: string[];
    source?: string[];
    sessionId?: string;
  } = {}): Promise<{ files: FileAssetRefDto[] }> {
    const params = new URLSearchParams();
    if (options.scope) params.set("scope", options.scope);
    if (options.origin?.length) params.set("origin", options.origin.join(","));
    if (options.source?.length) params.set("source", options.source.join(","));
    if (options.sessionId) params.set("sessionId", options.sessionId);
    return requestEnvelope<{ files: FileAssetRefDto[] }>(`/api/v1/files${queryString(params)}`);
  },

  async uploadWorkspaceFiles(
    files: File[],
    sessionId?: string | null,
  ): Promise<{ files: FileAssetRefDto[] }> {
    const form = new FormData();
    for (const file of files) {
      form.append("file", file);
    }
    if (sessionId) {
      form.append("sessionId", sessionId);
      form.append("threadId", sessionId);
    }
    return requestEnvelope<{ files: FileAssetRefDto[] }>("/api/v1/files", {
      method: "POST",
      body: form,
    });
  },

  promoteWorkspaceFile(id: string): Promise<FileAssetRefDto> {
    return requestEnvelope<FileAssetRefDto>(`/api/v1/files/${encodeURIComponent(id)}/promote`, {
      method: "POST",
    });
  },

  async downloadWorkspaceFile(id: string): Promise<{ blob: Blob; filename: string }> {
    const response = await requestRaw(`/api/v1/files/${encodeURIComponent(id)}/download`);
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/u.exec(disposition);
    const filename = match?.[1] ?? `file-${id}`;
    const blob = await response.blob();
    return { blob, filename };
  },

  deleteWorkspaceFile(id: string): Promise<{ deleted: boolean; id: string }> {
    return requestEnvelope(`/api/v1/files/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  listQueryHistory(options: {
    sessionId?: string;
    datasourceId?: string;
    favorite?: boolean;
    limit?: number;
  } = {}): Promise<QueryHistoryListResponseDto> {
    const params = new URLSearchParams();
    if (options.sessionId) params.set("sessionId", options.sessionId);
    if (options.datasourceId) params.set("datasourceId", options.datasourceId);
    if (options.favorite !== undefined) params.set("favorite", String(options.favorite));
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    return requestEnvelope<QueryHistoryListResponseDto>(
      `/api/v1/query-history${queryString(params)}`,
    );
  },

  favoriteQueryHistory(id: string, favorite: boolean): Promise<QueryHistoryItemDto> {
    return requestEnvelope<QueryHistoryItemDto>(
      `/api/v1/query-history/${encodeURIComponent(id)}/${favorite ? "favorite" : "unfavorite"}`,
      { method: "POST" },
    );
  },
};

/** Keep Trace clients compatible with API responses persisted before semantic sections existed. */
export function normalizeTraceDagDto(
  input: Omit<TraceDagDto, "sections"> & { sections?: TraceDagDto["sections"] },
): TraceDagDto {
  return {
    ...input,
    sections: Array.isArray(input.sections) ? input.sections : [],
  };
}

export { ConfigApiError } from "./types";
