import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { AGENT_RUNTIME_LIMITS } from "../config/agent-runtime-limits.js";
import { toolErrorObservation } from "../errors/tool-execution-error.js";
import type { AnalysisVerifiedValue } from "./analysis-contract.js";
import type { AnalysisRequirement } from "./analysis-requirements.js";
import {
  contextEvidenceVerifiedValues,
  resolveContextEvidenceFacts,
  type AnalysisContextEvidenceCatalog,
} from "./analysis-context-evidence.js";
import {
  adaptTrustedEnergyRequirementsCommit,
  type TrustedEnergyRequirementsCommitInput
} from "./trusted-energy-requirements-commit-adapter.js";

type RequirementsCommitActionInput = {
  runId: string;
  segmentId: string;
  actionId: string;
  actionName: "analysis.requirements.commit";
  input: TrustedEnergyRequirementsCommitInput;
  idempotencyKey: string;
};

type ContextEvidenceBindActionInput = {
  runId: string;
  segmentId: string;
  actionId: string;
  actionName: "analysis.context.evidence.bind";
  input: Record<string, unknown>;
  idempotencyKey: string;
};

export type CreateAnalysisRequirementsCommitToolInput = {
  analysisRequirements: AnalysisRequirement[];
  contextEvidenceCatalog?: AnalysisContextEvidenceCatalog;
  executeAction(input: RequirementsCommitActionInput | ContextEvidenceBindActionInput): Promise<{ observation: unknown }>;
  getAnalysisRequirements?(): AnalysisRequirement[];
  getVerifiedRequirementValues?(requirementId: string): AnalysisVerifiedValue[];
  runId: string;
  segmentId: string;
  trustedEnergy: boolean;
};

export const analysisRequirementsCommitInputSchema = z.object({
  claims: z.array(z.object({
    requirement_id: z.string().min(1),
    claim: z.string().min(1),
    values: z.array(z.object({
      name: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      unit: z.string().optional()
    })).max(AGENT_RUNTIME_LIMITS.requirementCommitMaxOutputFields).optional(),
    evidence_refs: z.array(z.string().min(1)).optional(),
    evidence_requirement_ids: z.array(z.string().min(1)).optional(),
  })).min(1).max(AGENT_RUNTIME_LIMITS.requirementCommitMaxClaims)
});

const stringEnum = (values: string[]) =>
  z.enum(values as [string, ...string[]]);

/**
 * Build the smallest flat model-facing commit contract for this Run.
 *
 * Provider schemas stay free of per-requirement unions. The trusted adapter
 * remains the final per-requirement guard, while the schema stops advertising
 * ids and value names that the server can never accept.
 */
export const buildAnalysisRequirementsCommitInputSchema = (
  requirements: AnalysisRequirement[],
  _contextEvidenceCatalog?: AnalysisContextEvidenceCatalog,
) => {
  const requirementIds = requirements.map((requirement) => requirement.id);
  if (requirementIds.length === 0) {
    throw new Error("ANALYSIS_REQUIREMENTS_COMMIT_SCHEMA_EMPTY");
  }
  const declaredValueNames = [...new Set(requirements.flatMap((requirement) =>
    requirement.assertions.flatMap((assertion) =>
      assertion.claimValues.map((value) => value.name))))];
  const valueSchema = declaredValueNames.length > 0
    ? z.array(z.object({
        name: stringEnum(declaredValueNames),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        unit: z.string().optional()
      }).strict()).max(AGENT_RUNTIME_LIMITS.requirementCommitMaxOutputFields).optional()
    : undefined;
  const claimShape = {
    requirement_id: stringEnum(requirementIds),
    claim: z.string().min(1),
    ...(valueSchema ? { values: valueSchema } : {}),
    evidence_refs: z.array(z.string().min(1)).optional(),
    evidence_requirement_ids: z.array(stringEnum(requirementIds)).optional(),
  };
  return z.object({
    claims: z.array(z.object(claimShape).strict())
      .min(1)
      .max(AGENT_RUNTIME_LIMITS.requirementCommitMaxClaims)
  }).strict() as z.ZodType<TrustedEnergyRequirementsCommitInput>;
};

/** The adapter is deliberately inside execute's catch boundary so bad model input is one observation. */
export const createAnalysisRequirementsCommitTool = (
  input: CreateAnalysisRequirementsCommitToolInput
) => {
  const inputSchema = buildAnalysisRequirementsCommitInputSchema(
    input.analysisRequirements,
    input.contextEvidenceCatalog,
  );
  return createTool({
    id: "analysis_requirements_commit",
    description: input.contextEvidenceCatalog
      ? "Commit final claims using audited SQL Evidence and/or authorized current-Snapshot Context Evidence. The server automatically binds Context Evidence declared for each requirement. Scoped SQL may add investigation evidence, but it must not silently replace released facts."
      : "Commit final claims for analysis requirements using artifact evidence from successful SQL results.",
    inputSchema,
    execute: async (toolInput, options) => {
      const toolCallId = typeof options?.agent?.toolCallId === "string" && options.agent.toolCallId.length > 0
        ? options.agent.toolCallId
        : undefined;
      try {
        const parsedToolInput = inputSchema.parse(toolInput);
        const currentRequirements = input.getAnalysisRequirements?.() ?? input.analysisRequirements;
        const adaptedInput = input.trustedEnergy
          ? adaptTrustedEnergyRequirementsCommit(parsedToolInput, currentRequirements)
          : parsedToolInput;
        const commitInput = await bindContextEvidence({
          ...input,
          analysisRequirements: currentRequirements,
          claims: adaptedInput.claims,
          ...(toolCallId ? { toolCallId } : {}),
        });
        const result = await input.executeAction({
          runId: input.runId,
          segmentId: input.segmentId,
          actionId: toolCallId ?? `analysis-requirements-commit:${Date.now()}`,
          actionName: "analysis.requirements.commit",
          input: commitInput,
          idempotencyKey: toolCallId ?? JSON.stringify(commitInput)
        });
        return result.observation;
      } catch (error) {
        return toolErrorObservation(error, { toolName: "analysis_requirements_commit" });
      }
    }
  });
};

const bindContextEvidence = async (input: CreateAnalysisRequirementsCommitToolInput & {
  claims: TrustedEnergyRequirementsCommitInput["claims"];
  toolCallId?: string;
}): Promise<TrustedEnergyRequirementsCommitInput> => {
  const catalog = input.contextEvidenceCatalog;
  const requirementsById = new Map(input.analysisRequirements.map((requirement) => [requirement.id, requirement]));
  const claims: TrustedEnergyRequirementsCommitInput["claims"] = [];
  for (const [index, claim] of input.claims.entries()) {
    const requirement = requirementsById.get(claim.requirement_id);
    const factIds = claim.context_fact_ids?.length
      ? claim.context_fact_ids
      : requirement?.contextEvidence?.factIds ?? [];
    if (factIds.length === 0) {
      const verifiedValues = input.getVerifiedRequirementValues?.(claim.requirement_id) ?? [];
      const canonicalValues = verifiedValues.map((value) => ({
        name: value.name,
        value: value.value,
        ...(value.unit ? { unit: value.unit } : {}),
      }));
      claims.push(canonicalValues.length > 0
        ? { ...claim, values: mergeClaimValues(claim.values ?? [], canonicalValues) }
        : claim);
      continue;
    }
    if (!catalog) throw new Error("ANALYSIS_CONTEXT_EVIDENCE_CATALOG_UNAVAILABLE");
    if (!requirement?.contextEvidence) {
      throw new Error(`ANALYSIS_CONTEXT_EVIDENCE_NOT_AUTHORIZED:${claim.requirement_id}`);
    }
    if (requirement.contextEvidence.mode === "supporting" && requirement.status !== "evidenced") {
      throw new Error(`ANALYSIS_CONTEXT_EVIDENCE_SUPPORTING_REQUIRES_QUERY:${claim.requirement_id}`);
    }
    const unauthorizedFactIds = factIds.filter((factId) => !requirement.contextEvidence?.factIds.includes(factId));
    if (unauthorizedFactIds.length > 0) {
      throw new Error([
        `ANALYSIS_CONTEXT_EVIDENCE_NOT_AUTHORIZED:${claim.requirement_id}`,
        `UNAUTHORIZED_FACT_IDS:${unauthorizedFactIds.join(",")}`,
        `ALLOWED_FACT_IDS:${requirement.contextEvidence.factIds.join(",")}`,
      ].join(":"));
    }
    const facts = resolveContextEvidenceFacts(catalog, factIds);
    const verifiedValues = contextEvidenceVerifiedValues(facts);
    const evidenceRefs = [...new Set(facts.flatMap((fact) => fact.evidenceRefs))];
    const bindingInput = {
      requirement_id: claim.requirement_id,
      context_source_id: catalog.sourceId,
      fact_ids: facts.map((fact) => fact.id),
      evidence_refs: evidenceRefs,
      verified_values: verifiedValues,
      pins: structuredClone(catalog.pins),
      completion_mode: requirement.contextEvidence.mode,
    };
    await input.executeAction({
      runId: input.runId,
      segmentId: input.segmentId,
      actionId: input.toolCallId
        ? `${input.toolCallId}:context:${index + 1}`
        : `analysis-context-evidence-bind:${Date.now()}:${index + 1}`,
      actionName: "analysis.context.evidence.bind",
      input: bindingInput,
      idempotencyKey: JSON.stringify(bindingInput),
    });
    const canonicalValues = verifiedValues.map((value) => ({
      name: value.name,
      value: value.value,
      ...(value.unit ? { unit: value.unit } : {}),
    }));
    const supportingContextEvidence = requirement.contextEvidence.mode === "supporting";
    claims.push({
      ...claim,
      values: mergeClaimValues(claim.values ?? [], canonicalValues),
      ...(supportingContextEvidence
        ? {
            // Let the protocol select every verified binding for this requirement.
            // An explicit Context-only reference would otherwise filter out the
            // already-verified query evidence that supporting mode requires.
            evidence_refs: undefined,
            evidence_requirement_ids: [...new Set([
              ...(claim.evidence_requirement_ids ?? []),
              claim.requirement_id,
            ])],
          }
        : {
            evidence_refs: [...new Set([...(claim.evidence_refs ?? []), ...evidenceRefs])],
          }),
    });
  }
  return { claims };
};

const mergeClaimValues = (
  left: NonNullable<TrustedEnergyRequirementsCommitInput["claims"][number]["values"]>,
  right: NonNullable<TrustedEnergyRequirementsCommitInput["claims"][number]["values"]>,
) => [...new Map([...left, ...right].map((value) => [value.name, value])).values()];
