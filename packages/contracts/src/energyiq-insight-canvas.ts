export type InsightCanvasIdentity = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
};

export type InsightCanvasEvidenceFact = {
  identity: InsightCanvasIdentity;
  evidenceRef: string;
  entityId: string;
  metricId: string;
  value: number;
  unit: string;
};

export type InsightCanvasFactBinding = {
  evidenceRef: string;
  entityId: string;
  metricId: string;
  value: number;
  unit: string;
};

export type InsightCanvasFinding = {
  id: string;
  title: string;
  text: string;
  evidenceRefs: string[];
  visualNeeded: boolean;
};

export type InsightCanvasQuantitativeBlock = {
  id: string;
  kind: "quantitative";
  visualization: "metric" | "comparison" | "trend";
  title: string;
  bindings: InsightCanvasFactBinding[];
};

export type InsightCanvasEditorPlan = {
  orderedBlockIds: string[];
};

export type InsightCanvasPresentationGapRequest = {
  thesis: string;
  requestedCapability: string;
  why: string;
  requiredDataShape: string;
  evidenceRefs: string[];
  safeFallback: "prose" | "table" | "omit-visual";
};

export type InsightCanvasPlan = {
  identity: InsightCanvasIdentity;
  finding: InsightCanvasFinding;
  investigatorBlocks: InsightCanvasQuantitativeBlock[];
  presentationGapRequests: InsightCanvasPresentationGapRequest[];
  editorPlan: InsightCanvasEditorPlan;
};

export type InsightCanvasAcceptanceInput = {
  expectedIdentity: InsightCanvasIdentity;
  evidenceFacts: readonly InsightCanvasEvidenceFact[];
  plan: unknown;
};

export type InsightCanvasRejectionCode =
  | "INPUT_IDENTITY_INVALID"
  | "PLAN_INVALID"
  | "PLAN_IDENTITY_MISMATCH"
  | "FINDING_INVALID"
  | "INVESTIGATOR_BLOCK_INVALID"
  | "EVIDENCE_BINDING_MISMATCH"
  | "EDITOR_PLAN_INVALID"
  | "EDITOR_BLOCK_NOT_INVESTIGATED"
  | "PRESENTATION_BUDGET_EXCEEDED"
  | "PRESENTATION_GAP_INVALID";

export type InsightCanvasRejection = {
  code: InsightCanvasRejectionCode;
  subjectId: string;
};

export type InsightCanvasPresentationGap = InsightCanvasPresentationGapRequest & {
  roadmapEvidenceKey: string;
  occurrences: number;
  disposition: "human-roadmap-evidence-only";
};

export type InsightCanvasAcceptanceResult = {
  identity: InsightCanvasIdentity | null;
  acceptedFinding: InsightCanvasFinding | null;
  acceptedBlocks: InsightCanvasQuantitativeBlock[];
  rejections: InsightCanvasRejection[];
  gaps: InsightCanvasPresentationGap[];
};

const PLAN_KEYS = [
  "identity",
  "finding",
  "investigatorBlocks",
  "presentationGapRequests",
  "editorPlan",
] as const;
const FINDING_KEYS = ["id", "title", "text", "evidenceRefs", "visualNeeded"] as const;
const BLOCK_KEYS = ["id", "kind", "visualization", "title", "bindings"] as const;
const BINDING_KEYS = ["evidenceRef", "entityId", "metricId", "value", "unit"] as const;
const EDITOR_PLAN_KEYS = ["orderedBlockIds"] as const;
const GAP_KEYS = [
  "thesis",
  "requestedCapability",
  "why",
  "requiredDataShape",
  "evidenceRefs",
  "safeFallback",
] as const;
const MAX_GAPS = 16;
const FORBIDDEN_DECLARATION = /[<>]|https?:\/\/|www\.|javascript\s*:|data\s*:\s*text\/html|url\s*\(|@import\b|=>|\b(?:react|css|script|function)\b|on[a-z]+\s*=/iu;

/**
 * Accepts a declarative Insight Canvas plan without executing or publishing it.
 * The single seam owns identity, Evidence binding, local block rejection and
 * the Editor's select/delete/reorder-only authority.
 */
export function acceptInsightCanvasPlan(
  input: InsightCanvasAcceptanceInput,
): InsightCanvasAcceptanceResult {
  const expectedIdentity = parseIdentity(input.expectedIdentity);
  if (!expectedIdentity) return rejectedResult("INPUT_IDENTITY_INVALID", "expected-identity");
  if (!isRecord(input.plan) || !hasOnlyKeys(input.plan, PLAN_KEYS)) {
    return rejectedResult("PLAN_INVALID", "plan");
  }

  const planIdentity = parseIdentity(input.plan.identity);
  if (!planIdentity || !sameIdentity(planIdentity, expectedIdentity)) {
    return {
      identity: expectedIdentity,
      acceptedFinding: null,
      acceptedBlocks: [],
      gaps: [],
      rejections: [{ code: "PLAN_IDENTITY_MISMATCH", subjectId: "plan" }],
    };
  }

  const factsByReference = scopedFactsByReference(input.evidenceFacts, expectedIdentity);
  const acceptedFinding = parseFinding(input.plan.finding, factsByReference);
  const rejections: InsightCanvasRejection[] = [];
  if (!acceptedFinding) rejections.push({ code: "FINDING_INVALID", subjectId: "finding" });

  const rawBlocks = input.plan.investigatorBlocks;
  const acceptedById = new Map<string, InsightCanvasQuantitativeBlock>();
  const investigatedIds = new Set<string>();
  if (!Array.isArray(rawBlocks)) {
    rejections.push({ code: "INVESTIGATOR_BLOCK_INVALID", subjectId: "investigator-blocks" });
  } else {
    for (const rawBlock of rawBlocks) {
      const candidateId = isRecord(rawBlock) && isNonEmptyString(rawBlock.id)
        ? rawBlock.id
        : "investigator-block";
      investigatedIds.add(candidateId);
      const parsed = parseQuantitativeBlock(rawBlock, factsByReference);
      if (parsed.status === "invalid") {
        rejections.push({ code: parsed.code, subjectId: candidateId });
        continue;
      }
      if (acceptedById.has(parsed.block.id)) {
        rejections.push({ code: "INVESTIGATOR_BLOCK_INVALID", subjectId: parsed.block.id });
        acceptedById.delete(parsed.block.id);
        continue;
      }
      acceptedById.set(parsed.block.id, parsed.block);
    }
  }

  const editorPlan = parseEditorPlan(input.plan.editorPlan);
  if (!editorPlan) {
    rejections.push({ code: "EDITOR_PLAN_INVALID", subjectId: "editor-plan" });
    const gaps = acceptPresentationGaps(input.plan.presentationGapRequests, factsByReference, rejections);
    return {
      identity: expectedIdentity,
      acceptedFinding,
      acceptedBlocks: [],
      gaps,
      rejections,
    };
  }

  const acceptedBlocks = editorPlan.orderedBlockIds.flatMap<InsightCanvasQuantitativeBlock>((blockId) => {
    const block = acceptedById.get(blockId);
    if (block) return [block];
    if (!investigatedIds.has(blockId)) {
      rejections.push({ code: "EDITOR_BLOCK_NOT_INVESTIGATED", subjectId: blockId });
    }
    return [];
  });

  const gaps = acceptPresentationGaps(input.plan.presentationGapRequests, factsByReference, rejections);
  return {
    identity: expectedIdentity,
    acceptedFinding,
    acceptedBlocks,
    gaps,
    rejections,
  };
}

function parseIdentity(value: unknown): InsightCanvasIdentity | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["workspaceId", "projectId", "scopeId", "dataSnapshotId", "projectReleaseId"])
    || !isNonEmptyString(value.workspaceId)
    || !isNonEmptyString(value.projectId)
    || !isNonEmptyString(value.scopeId)
    || !isNonEmptyString(value.dataSnapshotId)
    || !isNonEmptyString(value.projectReleaseId)) return null;
  return {
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    scopeId: value.scopeId,
    dataSnapshotId: value.dataSnapshotId,
    projectReleaseId: value.projectReleaseId,
  };
}

function sameIdentity(left: InsightCanvasIdentity, right: InsightCanvasIdentity): boolean {
  return left.workspaceId === right.workspaceId
    && left.projectId === right.projectId
    && left.scopeId === right.scopeId
    && left.dataSnapshotId === right.dataSnapshotId
    && left.projectReleaseId === right.projectReleaseId;
}

function scopedFactsByReference(
  facts: readonly InsightCanvasEvidenceFact[],
  expectedIdentity: InsightCanvasIdentity,
): ReadonlyMap<string, InsightCanvasEvidenceFact | null> {
  const result = new Map<string, InsightCanvasEvidenceFact | null>();
  for (const fact of facts) {
    if (!isEvidenceFact(fact) || !sameIdentity(fact.identity, expectedIdentity)) continue;
    result.set(fact.evidenceRef, result.has(fact.evidenceRef) ? null : fact);
  }
  return result;
}

function isEvidenceFact(value: unknown): value is InsightCanvasEvidenceFact {
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["identity", "evidenceRef", "entityId", "metricId", "value", "unit"])
    || !parseIdentity(value.identity)
    || !isNonEmptyString(value.evidenceRef)
    || !isNonEmptyString(value.entityId)
    || !isNonEmptyString(value.metricId)
    || !isNonEmptyString(value.unit)) return false;
  return typeof value.value === "number" && Number.isFinite(value.value);
}

function parseFinding(
  value: unknown,
  factsByReference: ReadonlyMap<string, InsightCanvasEvidenceFact | null>,
): InsightCanvasFinding | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, FINDING_KEYS)
    || !safeIdentifier(value.id)
    || !safeDeclarationText(value.title, 240)
    || !safeDeclarationText(value.text, 1_600)
    || typeof value.visualNeeded !== "boolean") return null;
  const evidenceRefs = uniqueStringList(value.evidenceRefs);
  if (!evidenceRefs || evidenceRefs.some((reference) => !factsByReference.get(reference))) return null;
  return {
    id: value.id,
    title: value.title,
    text: value.text,
    evidenceRefs,
    visualNeeded: value.visualNeeded,
  };
}

function parseQuantitativeBlock(
  value: unknown,
  factsByReference: ReadonlyMap<string, InsightCanvasEvidenceFact | null>,
): { status: "accepted"; block: InsightCanvasQuantitativeBlock } | {
  status: "invalid";
  code: "INVESTIGATOR_BLOCK_INVALID" | "EVIDENCE_BINDING_MISMATCH";
} {
  if (!isRecord(value)
    || !hasOnlyKeys(value, BLOCK_KEYS)
    || !safeIdentifier(value.id)
    || value.kind !== "quantitative"
    || (value.visualization !== "metric" && value.visualization !== "comparison" && value.visualization !== "trend")
    || !safeDeclarationText(value.title, 240)
    || !Array.isArray(value.bindings)
    || value.bindings.length === 0
    || value.bindings.length > 32) {
    return { status: "invalid", code: "INVESTIGATOR_BLOCK_INVALID" };
  }
  const bindings = value.bindings.flatMap<InsightCanvasFactBinding>((candidate) => {
    const parsed = parseBinding(candidate);
    return parsed ? [parsed] : [];
  });
  if (bindings.length !== value.bindings.length) {
    return { status: "invalid", code: "INVESTIGATOR_BLOCK_INVALID" };
  }
  if (bindings.some((candidate) => !bindingMatchesFact(candidate, factsByReference.get(candidate.evidenceRef)))) {
    return { status: "invalid", code: "EVIDENCE_BINDING_MISMATCH" };
  }
  return {
    status: "accepted",
    block: {
      id: value.id,
      kind: "quantitative",
      visualization: value.visualization,
      title: value.title,
      bindings,
    },
  };
}

function parseBinding(value: unknown): InsightCanvasFactBinding | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, BINDING_KEYS)
    || !isNonEmptyString(value.evidenceRef)
    || !isNonEmptyString(value.entityId)
    || !isNonEmptyString(value.metricId)
    || !isNonEmptyString(value.unit)
    || typeof value.value !== "number"
    || !Number.isFinite(value.value)) return null;
  return {
    evidenceRef: value.evidenceRef,
    entityId: value.entityId,
    metricId: value.metricId,
    value: value.value,
    unit: value.unit,
  };
}

function bindingMatchesFact(
  binding: InsightCanvasFactBinding,
  fact: InsightCanvasEvidenceFact | null | undefined,
): boolean {
  return Boolean(fact)
    && binding.entityId === fact?.entityId
    && binding.metricId === fact.metricId
    && Object.is(binding.value, fact.value)
    && binding.unit === fact.unit;
}

function parseEditorPlan(value: unknown): InsightCanvasEditorPlan | null {
  if (!isRecord(value) || !hasOnlyKeys(value, EDITOR_PLAN_KEYS)) return null;
  const orderedBlockIds = uniqueStringList(value.orderedBlockIds, true);
  return orderedBlockIds ? { orderedBlockIds } : null;
}

function acceptPresentationGaps(
  value: unknown,
  factsByReference: ReadonlyMap<string, InsightCanvasEvidenceFact | null>,
  rejections: InsightCanvasRejection[],
): InsightCanvasPresentationGap[] {
  if (!Array.isArray(value) || value.length > MAX_GAPS) {
    rejections.push({ code: "PRESENTATION_GAP_INVALID", subjectId: "presentation-gaps" });
    return [];
  }
  const gapsByKey = new Map<string, InsightCanvasPresentationGap>();
  value.forEach((candidate, index) => {
    const parsed = parsePresentationGap(candidate, factsByReference);
    if (!parsed) {
      rejections.push({ code: "PRESENTATION_GAP_INVALID", subjectId: `presentation-gap:${index + 1}` });
      return;
    }
    const existing = gapsByKey.get(parsed.roadmapEvidenceKey);
    if (existing) {
      existing.occurrences += 1;
      return;
    }
    gapsByKey.set(parsed.roadmapEvidenceKey, parsed);
  });
  return [...gapsByKey.values()];
}

function parsePresentationGap(
  value: unknown,
  factsByReference: ReadonlyMap<string, InsightCanvasEvidenceFact | null>,
): InsightCanvasPresentationGap | null {
  if (!isRecord(value)
    || !hasOnlyKeys(value, GAP_KEYS)
    || !safeDeclarationText(value.thesis, 600)
    || !safeDeclarationText(value.requestedCapability, 240)
    || !safeDeclarationText(value.why, 800)
    || !safeDeclarationText(value.requiredDataShape, 800)
    || (value.safeFallback !== "prose" && value.safeFallback !== "table" && value.safeFallback !== "omit-visual")) {
    return null;
  }
  const evidenceRefs = uniqueStringList(value.evidenceRefs);
  if (!evidenceRefs || evidenceRefs.some((reference) => !factsByReference.get(reference))) return null;
  const request: InsightCanvasPresentationGapRequest = {
    thesis: value.thesis,
    requestedCapability: value.requestedCapability,
    why: value.why,
    requiredDataShape: value.requiredDataShape,
    evidenceRefs,
    safeFallback: value.safeFallback,
  };
  return {
    ...request,
    roadmapEvidenceKey: presentationGapRoadmapKey(request),
    occurrences: 1,
    disposition: "human-roadmap-evidence-only",
  };
}

function presentationGapRoadmapKey(value: InsightCanvasPresentationGapRequest): string {
  const parts = [
    value.thesis,
    value.requestedCapability,
    value.why,
    value.requiredDataShape,
    [...value.evidenceRefs].sort().join(","),
    value.safeFallback,
  ];
  return `insight-canvas-gap-v1:${parts.map((part) => `${part.length}:${part}`).join("|")}`;
}

function uniqueStringList(value: unknown, allowEmpty = false): string[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 64) return null;
  if (!value.every(isNonEmptyString) || new Set(value).size !== value.length) return null;
  return [...value];
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && /\S/u.test(value);
}

function safeIdentifier(value: unknown): value is string {
  return isNonEmptyString(value)
    && value.length <= 200
    && !FORBIDDEN_DECLARATION.test(value);
}

function safeDeclarationText(value: unknown, maximumLength: number): value is string {
  return isNonEmptyString(value)
    && value.length <= maximumLength
    && !FORBIDDEN_DECLARATION.test(value);
}

function rejectedResult(
  code: "INPUT_IDENTITY_INVALID" | "PLAN_INVALID",
  subjectId: string,
): InsightCanvasAcceptanceResult {
  return {
    identity: null,
    acceptedFinding: null,
    acceptedBlocks: [],
    gaps: [],
    rejections: [{ code, subjectId }],
  };
}
