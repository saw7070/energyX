import type { ContextPackage } from "../../inventory/context-package.js";
import type { ContextDecision, ContextPlan } from "../../inventory/context-plan.js";
import {
  contextItemExclusivityKey,
  contextItemSourceKind,
  contextItemSourceOwner,
  isShadowContextItem
} from "../../inventory/context-source-metadata.js";
import type { ContextSourcePolicyDecision } from "../../policy/context-source-policy.js";

export type MastraContextCompiledEventPayload = {
  checkpoint_schema_version: 1;
  budget: ContextPlan["budget"];
  decisions: ContextDecision[];
  omitted_group_ids: string[];
  omitted_sources: ReturnType<typeof createSourceEventEntries>;
  group_token_costs: ContextPlan["groupTokenCosts"];
  package_id: string;
  package_revision: number;
  plan_id: string;
  selected_group_ids: string[];
  selected_sources: ReturnType<typeof createSourceEventEntries>;
  step_number: number;
  token_report: ContextPlan["tokenReport"];
  source_snapshot_hashes: Array<{ source_type: string; content_hash: string; item_ids: string[] }>;
  artifact_refs: string[];
  audit_refs: string[];
  budget_utilization: number;
  high_water_mark: "normal" | "diagnostic" | "review";
  // R-017: stable top-level budget fields so the frontend overview can render model /
  // total_tokens / budget_tokens / prompt_tokens / remaining_tokens without reaching
  // into the nested `budget`/`token_report` objects.
  model?: string;
  total_tokens: number;
  budget_tokens: number;
  prompt_tokens: number;
  remaining_tokens: number;
};

export const createMastraContextCompiledEventPayload = (
  contextPackage: ContextPackage,
  plan: ContextPlan,
  modelName?: string
): MastraContextCompiledEventPayload => ({
  checkpoint_schema_version: 1,
  package_id: contextPackage.packageId,
  package_revision: plan.packageRevision,
  plan_id: plan.planId,
  step_number: plan.stepNumber,
  selected_group_ids: plan.selectedGroupIds,
  omitted_group_ids: plan.omittedGroupIds,
  group_token_costs: plan.groupTokenCosts,
  selected_sources: createSourceEventEntries(contextPackage, new Set(sourceItemIdsForGroups(
    contextPackage,
    new Set(plan.selectedGroupIds),
    new Set(plan.selectedSourceItemIds)
  ))),
  omitted_sources: createSourceEventEntries(contextPackage, new Set([
    ...sourceItemIdsForGroups(contextPackage, new Set(plan.omittedGroupIds), new Set(plan.selectedSourceItemIds)),
    ...plan.omittedSourceItemIds
  ])),
  decisions: plan.decisions,
  token_report: plan.tokenReport,
  source_snapshot_hashes: contextPackage.sourceSnapshots
    .map((snapshot) => ({
      source_type: snapshot.sourceType,
      content_hash: snapshot.contentHash,
      item_ids: [...snapshot.itemIds].sort()
    }))
    .sort((left, right) => left.source_type.localeCompare(right.source_type)),
  artifact_refs: contextPackage.artifactRefs.map((ref) => ref.artifact_id).sort(),
  audit_refs: contextPackage.auditRefs.map((ref) => ref.audit_log_id).sort(),
  budget: plan.budget,
  budget_utilization: budgetUtilization(plan),
  high_water_mark: highWaterMark(plan),
  ...(modelName ? { model: modelName } : {}),
  total_tokens: plan.tokenReport.totalInputTokens,
  budget_tokens: plan.budget.inputBudget,
  prompt_tokens: plan.tokenReport.totalInputTokens,
  remaining_tokens: plan.tokenReport.remainingTokens
});

const budgetUtilization = (plan: ContextPlan): number =>
  plan.budget.inputBudget > 0 ? plan.tokenReport.totalInputTokens / plan.budget.inputBudget : 1;

const highWaterMark = (plan: ContextPlan): "normal" | "diagnostic" | "review" => {
  const utilization = budgetUtilization(plan);
  if (utilization >= 0.75) return "review";
  if (utilization >= 0.5) return "diagnostic";
  return "normal";
};

export const sourcePolicyDecisionsToContextDecisions = (
  decisions: ContextSourcePolicyDecision[]
): ContextDecision[] =>
  decisions.map((decision) => ({
    affectedGroupIds: decision.affectedGroupIds,
    affectedItemIds: decision.affectedItemIds,
    reason: decision.reason,
    strategyId: decision.strategyId,
    tokenSavings: 0
  }));

const createSourceEventEntries = (contextPackage: ContextPackage, itemIds: ReadonlySet<string>) =>
  contextPackage.groups
    .filter((group) => group.kind === "source" && group.itemIds.some((itemId) => itemIds.has(itemId)))
    .map((group) => {
      const items = contextPackage.items.filter((item) =>
        group.itemIds.includes(item.id) && itemIds.has(item.id)
      );
      return {
        group_id: group.id,
        item_ids: items.map((item) => item.id).sort(),
        item_count: items.length,
        source_types: unique(items.map((item) => item.sourceType)),
        source_kinds: unique(items.map(contextItemSourceKind).filter(isString)),
        source_owners: unique(items.map(contextItemSourceOwner).filter(isString)),
        exclusivity_keys: unique(items.map(contextItemExclusivityKey).filter(isString)),
        shadow: items.length > 0 && items.every(isShadowContextItem)
      };
    });

const sourceItemIdsForGroups = (
  contextPackage: ContextPackage,
  groupIds: ReadonlySet<string>,
  visibleSourceItemIds: ReadonlySet<string>
): string[] =>
  contextPackage.groups
    .filter((group) => group.kind === "source" && groupIds.has(group.id))
    .flatMap((group) => group.itemIds.filter((itemId) => visibleSourceItemIds.has(itemId)));

const unique = (values: string[]): string[] => [...new Set(values)].sort((left, right) => left.localeCompare(right));

const isString = (value: unknown): value is string => typeof value === "string";
