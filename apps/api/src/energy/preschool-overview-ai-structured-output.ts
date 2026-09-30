import type { PublicStructuredOutputOptions } from "@mastra/core/agent";
import {
  AI_SLOT_HTML_LIMITS,
  ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1,
} from "@datafoundry/contracts";

import { PRESCHOOL_SECTION_IDS } from "./preschool-overview-ai-contracts.js";
import type { PreschoolOverviewAiStage } from "./preschool-overview-ai-workflow.js";

type StructuredEnvelope = Record<string, unknown>;
type JsonSchema = {
  type: "object" | "array" | "string" | "integer" | "number" | "boolean";
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: Array<string | number | boolean>;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
  maximum?: number;
  oneOf?: JsonSchema[];
};

const nonEmptyString: JsonSchema = { type: "string", minLength: 1 };
const boundedString = (maxLength: number): JsonSchema => ({ type: "string", minLength: 1, maxLength });

export const PRESCHOOL_SECTION_SUMMARY_MAX_CHARS = ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionSummaryChars;
export const PRESCHOOL_SECTION_SUMMARY_TARGET_CHARS = 220;
export const PRESCHOOL_SECTION_INSIGHT_TITLE_MAX_CHARS = ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionInsightTitleChars;
export const PRESCHOOL_SECTION_INSIGHT_LABEL_MAX_CHARS = ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionInsightLabelChars;
export const PRESCHOOL_SECTION_INSIGHT_TEXT_MAX_CHARS = ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionInsightTextChars;
export const PRESCHOOL_SECTION_DEEP_DIVE_MAX_CHARS = ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionDeepDiveQuestionChars;
export const PRESCHOOL_SECTION_LIMITATION_MAX_CHARS = ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.sectionLimitationChars;
export const PRESCHOOL_EXECUTIVE_SUMMARY_MAX_CHARS = ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.executiveSummaryChars;
export const PRESCHOOL_EXECUTIVE_SUMMARY_TARGET_CHARS = 240;
export const PRESCHOOL_EXECUTIVE_FINDING_TITLE_MAX_CHARS = ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.executiveFindingTitleChars;
export const PRESCHOOL_EXECUTIVE_FINDING_TEXT_MAX_CHARS = ENERGYIQ_DECISION_BRIEF_SAFETY_LIMITS_V1.executiveFindingTextChars;
export const PRESCHOOL_ADDITIONAL_INSIGHT_TITLE_MAX_CHARS = 100;
const uniqueEvidenceRefs: JsonSchema = {
  type: "array",
  minItems: 1,
  uniqueItems: true,
  items: nonEmptyString,
};

/** Native envelope for one server-owned static HTML Slot response. */
export const PRESCHOOL_HTML_AI_SLOT_STRUCTURED_OUTPUT_V1 = {
  errorStrategy: "warn",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["evidenceRefs", "html"],
    properties: {
      evidenceRefs: {
        type: "array",
        minItems: 1,
        items: nonEmptyString,
      },
      preferredHeightPx: {
        type: "integer",
        minimum: AI_SLOT_HTML_LIMITS.minHeightPx,
        maximum: AI_SLOT_HTML_LIMITS.maxHeightPx,
      },
      html: {
        type: "string",
        minLength: 1,
        maxLength: AI_SLOT_HTML_LIMITS.maxBytes,
      },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

// Compatible Providers occasionally repeat a valid reference. The server parser
// canonicalizes these arrays before acceptance, so duplicates must not make the
// native structured-output layer discard an otherwise recoverable result.
const modelEvidenceRefsV4: JsonSchema = {
  type: "array",
  minItems: 1,
  items: nonEmptyString,
};

const sectionKeyPoint: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "text", "evidenceRefs"],
  properties: {
    kind: { type: "string", enum: ["priority", "finding", "meaning", "next-check"] },
    label: nonEmptyString,
    text: nonEmptyString,
    evidenceRefs: uniqueEvidenceRefs,
  },
};

/** Native value-output contract for one bounded, independently executed Section. */
export const PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3 = {
  errorStrategy: "strict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sectionId", "status"],
    properties: {
      sectionId: { type: "string", enum: [...PRESCHOOL_SECTION_IDS] },
      status: { type: "string", enum: ["available", "empty"] },
      summary: nonEmptyString,
      keyPoints: {
        type: "array",
        minItems: 0,
        maxItems: 4,
        items: sectionKeyPoint,
      },
      limitation: nonEmptyString,
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

const sectionSummaryV4: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "evidenceRefs"],
  properties: {
    text: boundedString(PRESCHOOL_SECTION_SUMMARY_MAX_CHARS),
    evidenceRefs: modelEvidenceRefsV4,
  },
};

// Candidate defects are isolated by the server parser and acceptance layer.
// Keep the Provider envelope broad so one overlong sibling cannot discard the
// whole Section before the server can preserve useful candidates.
const sectionInsightCandidateV4: JsonSchema = { type: "object" };

/**
 * Current model proposal contract for one independently executed Section.
 * Candidate identity, acceptance and the three-insight publication budget remain server-owned.
 */
export const PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4 = {
  errorStrategy: "warn",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sectionId", "status", "candidates"],
    properties: {
      sectionId: { type: "string", enum: [...PRESCHOOL_SECTION_IDS] },
      status: { type: "string", enum: ["available", "empty"] },
      summary: sectionSummaryV4,
      candidates: {
        type: "array",
        minItems: 0,
        items: sectionInsightCandidateV4,
      },
      limitation: boundedString(PRESCHOOL_SECTION_LIMITATION_MAX_CHARS),
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

const executiveKeyFinding: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["takeaway", "sectionIds", "evidenceRefs"],
  properties: {
    takeaway: nonEmptyString,
    sectionIds: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: [...PRESCHOOL_SECTION_IDS] },
    },
    evidenceRefs: uniqueEvidenceRefs,
  },
};

/** Native value-output contract for the bounded Executive Synthesis stage. */
export const PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1 = {
  errorStrategy: "strict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "keyFindings"],
    properties: {
      status: { type: "string", enum: ["available", "empty"] },
      keyFindings: {
        type: "array",
        minItems: 0,
        maxItems: 4,
        items: executiveKeyFinding,
      },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

// Finding defects are isolated by the local materializer. Keep the Provider
// item envelope broad so one overlong or malformed sibling cannot discard the
// supported Findings before candidate-local validation runs.
const executiveFindingCandidateV4: JsonSchema = { type: "object" };

const executiveSummaryV4: JsonSchema = {
  ...sectionSummaryV4,
  properties: {
    ...sectionSummaryV4.properties,
    text: boundedString(PRESCHOOL_EXECUTIVE_SUMMARY_MAX_CHARS),
  },
};

/** Current bounded Key Findings proposal contract. Identity and Evidence lineage stay server-owned. */
export const PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4 = {
  errorStrategy: "warn",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "findings"],
    properties: {
      status: { type: "string", enum: ["available", "empty"] },
      summary: executiveSummaryV4,
      findings: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: executiveFindingCandidateV4,
      },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

const overviewDefinitionBlock: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "capabilityRevisionId"],
  properties: {
    key: nonEmptyString,
    capabilityRevisionId: nonEmptyString,
    windowId: nonEmptyString,
    emphasis: { type: "string", enum: ["primary", "standard", "supporting"] },
  },
};

const overviewDefinitionSection: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["key", "title", "managementQuestion", "primaryWindowId", "blocks"],
  properties: {
    key: nonEmptyString,
    title: nonEmptyString,
    managementQuestion: nonEmptyString,
    primaryWindowId: nonEmptyString,
    supportingWindowIds: { type: "array", uniqueItems: true, items: nonEmptyString },
    blocks: { type: "array", minItems: 1, maxItems: 40, items: overviewDefinitionBlock },
  },
};

/** Model output is only a typed proposal. Validation, preview and publishing remain server-owned. */
export const ENERGYIQ_TEMPLATE_CHANGE_PROPOSAL_STRUCTURED_OUTPUT_V1 = {
  errorStrategy: "strict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["contractRevision", "title", "rationale", "desiredDefinition"],
    properties: {
      contractRevision: { type: "string", const: "energyiq-overview-definition-change@1" },
      title: { type: "string", minLength: 1, maxLength: 120 },
      rationale: { type: "string", minLength: 1, maxLength: 800 },
      desiredDefinition: {
        type: "object",
        additionalProperties: false,
        required: ["contractRevision", "timePolicyRevisionId", "sections"],
        properties: {
          contractRevision: { type: "string", const: "energyiq-overview-definition@1" },
          timePolicyRevisionId: nonEmptyString,
          sections: { type: "array", minItems: 1, maxItems: 20, items: overviewDefinitionSection },
        },
      },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

const additionalAlert: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["severity", "certainty", "evidenceRefs"],
  properties: {
    severity: { type: "string", enum: ["attention", "urgent"] },
    certainty: { type: "string", enum: ["confirmed", "anomaly", "possible"] },
    evidenceRefs: uniqueEvidenceRefs,
  },
};

const additionalCandidate: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "text", "epistemicStatus", "evidenceRefs", "toolAuditIds"],
  properties: {
    id: nonEmptyString,
    title: { type: "string", minLength: 1, maxLength: 240 },
    text: { type: "string", minLength: 1, maxLength: 1_200 },
    epistemicStatus: { type: "string", enum: ["observed", "inferred", "speculative"] },
    evidenceRefs: uniqueEvidenceRefs,
    toolAuditIds: {
      type: "array",
      minItems: 0,
      uniqueItems: true,
      items: nonEmptyString,
    },
    deepDiveQuestion: { type: "string", minLength: 1, maxLength: 1_200 },
    alert: additionalAlert,
  },
};

const additionalCanvasIdentity: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["workspaceId", "projectId", "scopeId", "dataSnapshotId", "projectReleaseId"],
  properties: {
    workspaceId: nonEmptyString,
    projectId: nonEmptyString,
    scopeId: nonEmptyString,
    dataSnapshotId: nonEmptyString,
    projectReleaseId: nonEmptyString,
  },
};

const additionalCanvasFinding: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "title", "text", "evidenceRefs", "visualNeeded"],
  properties: {
    id: nonEmptyString,
    title: { type: "string", minLength: 1, maxLength: 240 },
    text: { type: "string", minLength: 1, maxLength: 1_600 },
    evidenceRefs: uniqueEvidenceRefs,
    visualNeeded: { type: "boolean" },
  },
};

const additionalCanvasBinding: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["evidenceRef", "entityId", "metricId", "value", "unit"],
  properties: {
    evidenceRef: nonEmptyString,
    entityId: nonEmptyString,
    metricId: nonEmptyString,
    value: { type: "number" },
    unit: nonEmptyString,
  },
};

const additionalCanvasBlock: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "visualization", "title", "bindings"],
  properties: {
    id: nonEmptyString,
    kind: { type: "string", enum: ["quantitative"] },
    visualization: { type: "string", enum: ["metric", "comparison", "trend"] },
    title: { type: "string", minLength: 1, maxLength: 240 },
    bindings: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: additionalCanvasBinding,
    },
  },
};

const additionalCanvasGap: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["thesis", "requestedCapability", "why", "requiredDataShape", "evidenceRefs", "safeFallback"],
  properties: {
    thesis: { type: "string", minLength: 1, maxLength: 600 },
    requestedCapability: { type: "string", minLength: 1, maxLength: 240 },
    why: { type: "string", minLength: 1, maxLength: 800 },
    requiredDataShape: { type: "string", minLength: 1, maxLength: 800 },
    evidenceRefs: uniqueEvidenceRefs,
    safeFallback: { type: "string", enum: ["prose", "table", "omit-visual"] },
  },
};

const additionalCanvasPlan: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["identity", "finding", "investigatorBlocks", "presentationGapRequests", "editorPlan"],
  properties: {
    identity: additionalCanvasIdentity,
    finding: additionalCanvasFinding,
    investigatorBlocks: {
      type: "array",
      minItems: 0,
      maxItems: 16,
      items: additionalCanvasBlock,
    },
    presentationGapRequests: {
      type: "array",
      minItems: 0,
      maxItems: 16,
      items: additionalCanvasGap,
    },
    editorPlan: {
      type: "object",
      additionalProperties: false,
      required: ["orderedBlockIds"],
      properties: {
        orderedBlockIds: {
          type: "array",
          minItems: 0,
          maxItems: 16,
          uniqueItems: true,
          items: nonEmptyString,
        },
      },
    },
  },
};

const additionalOriginDirectionMethodResourceIds: JsonSchema = {
  type: "array",
  minItems: 1,
  maxItems: 8,
  uniqueItems: true,
  items: nonEmptyString,
};

const additionalOriginProposal: JsonSchema = {
  type: "object",
  oneOf: [{
    type: "object",
    additionalProperties: false,
    required: ["kind", "directionMethodResourceIds"],
    properties: {
      kind: { type: "string", enum: ["ai-discovery"] },
      directionMethodResourceIds: {
        type: "array",
        minItems: 0,
        maxItems: 0,
        uniqueItems: true,
        items: nonEmptyString,
      },
    },
  }, {
    type: "object",
    additionalProperties: false,
    required: ["kind", "directionMethodResourceIds"],
    properties: {
      kind: { type: "string", enum: ["expert-sop"] },
      directionMethodResourceIds: additionalOriginDirectionMethodResourceIds,
    },
  }, {
    type: "object",
    additionalProperties: false,
    required: ["kind", "directionMethodResourceIds", "novelContribution"],
    properties: {
      kind: { type: "string", enum: ["hybrid"] },
      directionMethodResourceIds: additionalOriginDirectionMethodResourceIds,
      novelContribution: { type: "string", minLength: 1, maxLength: 800 },
    },
  }],
};

const additionalCandidateV2: JsonSchema = {
  ...additionalCandidate,
  required: [...additionalCandidate.required!, "origin"],
  properties: {
    ...additionalCandidate.properties,
    origin: additionalOriginProposal,
    canvas: additionalCanvasPlan,
  },
};

/** Open model proposal; acceptance and the three-card publication budget remain server-owned. */
export const PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V1 = {
  errorStrategy: "strict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        minItems: 0,
        items: additionalCandidate,
      },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

export const PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2 = {
  errorStrategy: "strict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        minItems: 0,
        items: additionalCandidateV2,
      },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

export const PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3 = {
  errorStrategy: "warn",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        minItems: 0,
        maxItems: 32,
        items: { type: "object" },
      },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

const additionalTransitionNew: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["transition", "currentFindingId", "currentEvidenceRefs"],
  properties: {
    transition: { type: "string", enum: ["new"] },
    currentFindingId: nonEmptyString,
    currentEvidenceRefs: uniqueEvidenceRefs,
  },
};

const additionalTransitionPaired: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "transition",
    "previousFindingId",
    "previousEvidenceRefs",
    "currentFindingId",
    "currentEvidenceRefs",
  ],
  properties: {
    transition: { type: "string", enum: ["changed", "still-supported", "resolved"] },
    previousFindingId: nonEmptyString,
    previousEvidenceRefs: uniqueEvidenceRefs,
    currentFindingId: nonEmptyString,
    currentEvidenceRefs: uniqueEvidenceRefs,
  },
};

const additionalTransitionNoMaterialChange: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["transition"],
  properties: {
    transition: { type: "string", enum: ["no-material-change"] },
  },
};

/** Evidence-bound Snapshot A-to-B classification; no arbitrary chart, code, or tool surface. */
export const PRESCHOOL_ADDITIONAL_AI_INSIGHTS_TRANSITION_STRUCTURED_OUTPUT_V1 = {
  errorStrategy: "warn",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["outcomes"],
    properties: {
      outcomes: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: {
          type: "object",
          oneOf: [
            additionalTransitionNew,
            additionalTransitionPaired,
            additionalTransitionNoMaterialChange,
          ],
        },
      },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

export const resolveOverviewAiStageStructuredOutput = (
  stage: PreschoolOverviewAiStage,
): PublicStructuredOutputOptions<StructuredEnvelope> | undefined => {
  if (stage === "section-interpreter") return PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3;
  if (stage === "executive-synthesis") return PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1;
  if (stage === "template-proposal") return ENERGYIQ_TEMPLATE_CHANGE_PROPOSAL_STRUCTURED_OUTPUT_V1;
  if (stage === "additional-insights-discovery") return PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3;
  if (stage === "additional-insights-transition") {
    return PRESCHOOL_ADDITIONAL_AI_INSIGHTS_TRANSITION_STRUCTURED_OUTPUT_V1;
  }
  if (stage === "html-slot") return PRESCHOOL_HTML_AI_SLOT_STRUCTURED_OUTPUT_V1;
  return undefined;
};

/** Explicit V4 entrypoint for the Pack-v2 workflow; the existing Page path remains on V3. */
export const resolveOverviewAiStageStructuredOutputV4 = (
  stage: PreschoolOverviewAiStage,
): PublicStructuredOutputOptions<StructuredEnvelope> | undefined => {
  if (stage === "section-interpreter") return PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4;
  if (stage === "executive-synthesis") return PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4;
  return resolveOverviewAiStageStructuredOutput(stage);
};
