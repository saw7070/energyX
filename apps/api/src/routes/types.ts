import type { ApiResult } from "@datafoundry/contracts";
import type { LocalDataGateway } from "@datafoundry/data-gateway";
import type { FileAssetService } from "@datafoundry/files";
import type { LocalKnowledgeService } from "@datafoundry/knowledge";
import type { MetadataStore } from "@datafoundry/metadata";
import type { RunCancelRegistry } from "../run-cancel-registry.js";
import type { AuthService } from "../auth/service.js";
import type { PreschoolOverviewAiPageWorkflow } from "../energy/preschool-overview-ai-page-workflow.js";
import type { PreschoolAdditionalAiInsightsWorkflow } from "../energy/preschool-additional-ai-insights-workflow.js";
import type { PreschoolAdditionalAiInsightsEvaluationWorkflow } from "../energy/preschool-additional-ai-insights-evaluation.js";
import type { EnergyIqTemplateChangeWorkflow } from "../energy/energy-template-change-workflow.js";
import type { ProjectOverviewAiAdapter } from "../energy/project-overview-ai-adapter.js";
import type { PreschoolHtmlAiSlotWorkflow } from "../energy/preschool-html-ai-slot-workflow.js";

export type ConfigApiContext = {
  authService: AuthService;
  dataGateway: LocalDataGateway;
  fileAssetService: FileAssetService;
  knowledgeService: LocalKnowledgeService;
  metadataStore: MetadataStore;
  overviewAiWorkflow: PreschoolOverviewAiPageWorkflow;
  preschoolHtmlAiSlotWorkflow: PreschoolHtmlAiSlotWorkflow;
  projectOverviewAiAdapters: readonly ProjectOverviewAiAdapter[];
  additionalAiInsightsWorkflow: PreschoolAdditionalAiInsightsWorkflow | undefined;
  additionalAiInsightsEvaluationWorkflow: PreschoolAdditionalAiInsightsEvaluationWorkflow | undefined;
  templateChangeWorkflow: EnergyIqTemplateChangeWorkflow | undefined;
  runCancelRegistry: RunCancelRegistry;
  userId: string;
  workspaceId?: string;
};

export type ConfigApiResponse = {
  body: ApiResult<unknown> | Buffer | Record<string, unknown>;
  headers?: Record<string, string>;
  status: number;
};
