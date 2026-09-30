import type { PromptTokenReport } from "./context-token-report.js";
import type { ContextRetention } from "./context-item.js";

export type ContextDecision = {
  strategyId: string;
  affectedGroupIds: string[];
  affectedItemIds?: string[];
  tokenSavings: number;
  reason: string;
};

export type GlobalContextBudget = {
  capabilitySource: "conservative-fallback" | "explicit-profile" | "verified-model-default";
  contextWindow: number;
  maxOutputTokens: number;
  outputReserve: number;
  safetyMargin: number;
  inputBudget: number;
};

export type ContextGroupTokenCost = {
  groupId: string;
  mandatory: boolean;
  retention: ContextRetention;
  selected: boolean;
  tokenCost: number;
};

export type ContextPlan = {
  planId: string;
  stepNumber: number;
  packageRevision: number;
  selectedGroupIds: string[];
  omittedGroupIds: string[];
  selectedSourceItemIds: string[];
  omittedSourceItemIds: string[];
  groupTokenCosts: ContextGroupTokenCost[];
  decisions: ContextDecision[];
  budget: GlobalContextBudget;
  tokenReport: PromptTokenReport;
};
