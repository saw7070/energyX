import type {
  PreschoolSectionPackCrossSectionSignal,
  PreschoolSectionPackV2,
} from "./preschool-section-pack-v2.js";
import type { PreschoolSectionId, PreschoolSectionPackEvidence } from "./preschool-overview-ai-contracts.js";

export const PRESCHOOL_SECTION_INSIGHT_TOOL_NAMES = [
  "compare_centres",
  "inspect_time_pattern",
  "inspect_load_composition",
  "inspect_related_section_signals",
] as const;

export type PreschoolSectionInsightToolName = typeof PRESCHOOL_SECTION_INSIGHT_TOOL_NAMES[number];

export type PreschoolSectionInsightToolInvocation =
  | {
    toolName: "compare_centres";
    toolCallId: string;
    input: {
      centreScopeIds: string[];
      dimensions: Array<"absoluteUsage" | "floorAreaNormalised" | "peopleNormalised">;
    };
  }
  | {
    toolName: "inspect_time_pattern" | "inspect_load_composition";
    toolCallId: string;
    input: { evidenceIds: string[] };
  }
  | {
    toolName: "inspect_related_section_signals";
    toolCallId: string;
    input: { signalIds: string[] };
  };

export type PreschoolSectionInsightStatement =
  | { kind: "confirmed-fact"; text: string; evidenceRefs: string[] }
  | { kind: "inference"; text: string; evidenceRefs: string[] }
  | { kind: "hypothesis"; text: string; evidenceRefs: string[] }
  | { kind: "missing-evidence"; text: string; evidenceRefs: [] };

export type PreschoolSectionInsightToolResult = {
  contract: { id: "preschool-section-insight-tool-result"; revision: "v1" };
  capability: { revision: "scoped-read-only-v1"; mode: "scoped-read-only"; readOnly: true };
  binding: PreschoolSectionPackV2["binding"] & {
    sectionId: PreschoolSectionId;
    resource: "electricity";
  };
  audit: {
    auditId: string;
    runId: string;
    toolCallId: string;
    toolName: PreschoolSectionInsightToolName;
    sourcePackRevision: "preschool-section-pack-v2";
    evidenceRefs: string[];
  };
  evidence: PreschoolSectionPackEvidence[];
  relatedSignals?: PreschoolSectionPackCrossSectionSignal[];
  statements: PreschoolSectionInsightStatement[];
  missingEvidence: string[];
};

export type PreschoolSectionInsightRuntime = {
  invoke(input: PreschoolSectionInsightToolInvocation): Promise<PreschoolSectionInsightToolResult>;
};

const TOOL_SECTIONS: Record<PreschoolSectionInsightToolName, readonly PreschoolSectionId[]> = {
  compare_centres: ["centre-benchmark"],
  inspect_time_pattern: ["standby-wastage", "operating-behaviour"],
  inspect_load_composition: ["standby-wastage", "operating-behaviour"],
  inspect_related_section_signals: [
    "centre-benchmark",
    "standby-wastage",
    "operating-behaviour",
    "planning-outlook",
  ],
};

const COMPARISON_DIMENSIONS = new Set([
  "absoluteUsage",
  "floorAreaNormalised",
  "peopleNormalised",
]);

export const preschoolSectionInsightToolsForSection = (
  sectionId: PreschoolSectionId,
): PreschoolSectionInsightToolName[] => PRESCHOOL_SECTION_INSIGHT_TOOL_NAMES.filter((toolName) =>
  TOOL_SECTIONS[toolName].includes(sectionId));

export const createPreschoolSectionInsightRuntime = (input: {
  pack: PreschoolSectionPackV2;
  runId: string;
  createAuditId: () => string;
}): PreschoolSectionInsightRuntime => {
  requirePack(input.pack);
  if (!nonEmptyString(input.runId) || typeof input.createAuditId !== "function") {
    throw new Error("PRESCHOOL_SECTION_INSIGHT_RUNTIME_IDENTITY_INVALID");
  }
  const pack = structuredClone(input.pack);
  const evidenceById = new Map(pack.evidence.map((item) => [item.id, item]));
  const signalById = new Map(pack.crossSectionIndex.map((signal) => [signal.signalId, signal]));
  const usedToolCallIds = new Set<string>();
  const usedAuditIds = new Set<string>();

  return {
    async invoke(invocation) {
      requireInvocationEnvelope(invocation);
      if (!TOOL_SECTIONS[invocation.toolName].includes(pack.sectionId)) {
        throw new Error("PRESCHOOL_SECTION_INSIGHT_TOOL_FORBIDDEN_FOR_SECTION");
      }
      if (usedToolCallIds.has(invocation.toolCallId)) {
        throw new Error("PRESCHOOL_SECTION_INSIGHT_TOOL_CALL_REPLAYED");
      }

      const selection = selectToolEvidence({ invocation, pack, evidenceById, signalById });
      const auditId = input.createAuditId();
      if (!nonEmptyString(auditId) || usedAuditIds.has(auditId)) {
        throw new Error("PRESCHOOL_SECTION_INSIGHT_AUDIT_IDENTITY_INVALID");
      }
      usedToolCallIds.add(invocation.toolCallId);
      usedAuditIds.add(auditId);
      const evidenceRefs = uniqueStrings([
        ...selection.evidence.flatMap((item) => item.evidenceRefs),
        ...selection.relatedSignals.flatMap((signal) => signal.evidenceRefs),
      ]);
      const statements: PreschoolSectionInsightStatement[] = [
        ...selection.evidence.map((item) => ({
          kind: "confirmed-fact" as const,
          text: item.label,
          evidenceRefs: [...item.evidenceRefs],
        })),
        ...selection.relatedSignals.map((signal) => ({
          kind: "confirmed-fact" as const,
          text: signal.label,
          evidenceRefs: [...signal.evidenceRefs],
        })),
      ];

      return {
        contract: { id: "preschool-section-insight-tool-result", revision: "v1" },
        capability: { revision: "scoped-read-only-v1", mode: "scoped-read-only", readOnly: true },
        binding: {
          ...pack.binding,
          sectionId: pack.sectionId,
          resource: "electricity",
        },
        audit: {
          auditId,
          runId: input.runId,
          toolCallId: invocation.toolCallId,
          toolName: invocation.toolName,
          sourcePackRevision: pack.contract.revision,
          evidenceRefs,
        },
        evidence: structuredClone(selection.evidence),
        ...(selection.relatedSignals.length > 0
          ? { relatedSignals: structuredClone(selection.relatedSignals) }
          : {}),
        statements,
        missingEvidence: [...pack.missingEvidence],
      };
    },
  };
};

const selectToolEvidence = (input: {
  invocation: PreschoolSectionInsightToolInvocation;
  pack: PreschoolSectionPackV2;
  evidenceById: ReadonlyMap<string, PreschoolSectionPackEvidence>;
  signalById: ReadonlyMap<string, PreschoolSectionPackCrossSectionSignal>;
}): { evidence: PreschoolSectionPackEvidence[]; relatedSignals: PreschoolSectionPackCrossSectionSignal[] } => {
  if (input.invocation.toolName === "compare_centres") {
    requireExactKeys(input.invocation.input, ["centreScopeIds", "dimensions"]);
    const centreScopeIds = requireUniqueStrings(input.invocation.input.centreScopeIds);
    const dimensions = requireUniqueStrings(input.invocation.input.dimensions);
    if (dimensions.some((dimension) => !COMPARISON_DIMENSIONS.has(dimension))) {
      throw new Error("PRESCHOOL_SECTION_INSIGHT_DIMENSION_NOT_ALLOWED");
    }
    const evidence = centreScopeIds.map((scopeId) => {
      const matches = input.pack.evidence.filter((item) => item.entityRefs.includes(scopeId));
      if (matches.length !== 1) throw new Error("PRESCHOOL_SECTION_INSIGHT_ENTITY_NOT_FOUND");
      const item = matches[0]!;
      const value = item.value;
      if (!isRecord(value) || !isRecord(value.metrics)) {
        throw new Error("PRESCHOOL_SECTION_INSIGHT_DIMENSION_NOT_AVAILABLE");
      }
      const metrics = value.metrics;
      if (dimensions.some((dimension) => !isRecord(metrics[dimension]))) {
        throw new Error("PRESCHOOL_SECTION_INSIGHT_DIMENSION_NOT_AVAILABLE");
      }
      const projectedMetrics = Object.fromEntries(dimensions.map((dimension) => [
        dimension,
        structuredClone(metrics[dimension]),
      ]));
      const projectedUnits = dimensions.flatMap((dimension) => {
        const metric = metrics[dimension];
        return isRecord(metric) && nonEmptyString(metric.unit) ? [metric.unit] : [];
      });
      return {
        ...item,
        value: {
          ...(nonEmptyString(value.centreCode) ? { centreCode: value.centreCode } : {}),
          ...(nonEmptyString(value.name) ? { name: value.name } : {}),
          metrics: projectedMetrics,
        },
        ...(projectedUnits.length > 0 ? { unit: uniqueStrings(projectedUnits).join(", ") } : {}),
      };
    });
    return { evidence, relatedSignals: [] };
  }
  if (input.invocation.toolName === "inspect_time_pattern") {
    requireExactKeys(input.invocation.input, ["evidenceIds"]);
    const evidence = resolveIds(input.invocation.input.evidenceIds, input.evidenceById, "EVIDENCE_NOT_FOUND");
    if (!evidence.every(isTimePatternEvidence)) {
      throw new Error("PRESCHOOL_SECTION_INSIGHT_EVIDENCE_KIND_NOT_ALLOWED");
    }
    return {
      evidence,
      relatedSignals: [],
    };
  }
  if (input.invocation.toolName === "inspect_load_composition") {
    requireExactKeys(input.invocation.input, ["evidenceIds"]);
    const evidence = resolveIds(input.invocation.input.evidenceIds, input.evidenceById, "EVIDENCE_NOT_FOUND");
    if (!evidence.every(isLoadCompositionEvidence)) {
      throw new Error("PRESCHOOL_SECTION_INSIGHT_EVIDENCE_KIND_NOT_ALLOWED");
    }
    return {
      evidence,
      relatedSignals: [],
    };
  }
  if (input.invocation.toolName === "inspect_related_section_signals") {
    requireExactKeys(input.invocation.input, ["signalIds"]);
    return {
      evidence: [],
      relatedSignals: resolveIds(input.invocation.input.signalIds, input.signalById, "SIGNAL_NOT_FOUND"),
    };
  }
  throw new Error("PRESCHOOL_SECTION_INSIGHT_REQUEST_INVALID");
};

const isTimePatternEvidence = (evidence: PreschoolSectionPackEvidence): boolean => {
  if (!isRecord(evidence.value)) return false;
  if (isRecord(evidence.value.worstSpike)) {
    const localHour = evidence.value.worstSpike.localHour;
    return Number.isInteger(localHour) && (localHour as number) >= 0 && (localHour as number) <= 23;
  }
  return Number.isFinite(evidence.value.closedHoursKwh)
    || Number.isFinite(evidence.value.operatingHoursKwh);
};

const isLoadCompositionEvidence = (evidence: PreschoolSectionPackEvidence): boolean =>
  isRecord(evidence.value)
  && nonEmptyString(evidence.value.name)
  && nonEmptyString(evidence.value.applianceGroup)
  && Number.isFinite(evidence.value.usageKwh)
  && Number.isFinite(evidence.value.sharePct)
  && Number.isFinite(evidence.value.centreCount);

function requireInvocationEnvelope(value: unknown): asserts value is PreschoolSectionInsightToolInvocation {
  if (!isRecord(value)
    || !nonEmptyString(value.toolCallId)
    || !PRESCHOOL_SECTION_INSIGHT_TOOL_NAMES.includes(value.toolName as PreschoolSectionInsightToolName)
    || !isRecord(value.input)
    || !exactKeys(value, ["toolName", "toolCallId", "input"])) {
    throw new Error("PRESCHOOL_SECTION_INSIGHT_REQUEST_INVALID");
  }
}

const requirePack = (pack: PreschoolSectionPackV2): void => {
  if (!isRecord(pack)
    || !isRecord(pack.contract)
    || pack.contract.id !== "preschool-section-pack"
    || pack.contract.revision !== "preschool-section-pack-v2"
    || !TOOL_SECTIONS.inspect_related_section_signals.includes(pack.sectionId)
    || !validBinding(pack.binding)
    || !Array.isArray(pack.evidence)
    || !pack.evidence.every(validEvidence)
    || new Set(pack.evidence.map(({ id }) => id)).size !== pack.evidence.length
    || !Array.isArray(pack.crossSectionIndex)
    || !pack.crossSectionIndex.every(validRelatedSignal)
    || new Set(pack.crossSectionIndex.map(({ signalId }) => signalId)).size !== pack.crossSectionIndex.length
    || !Array.isArray(pack.missingEvidence)
    || !pack.missingEvidence.every(nonEmptyString)
    || !isRecord(pack.capabilities)
    || pack.capabilities.revision !== "scoped-read-only-v1"
    || pack.capabilities.mode !== "scoped-read-only"
    || !Array.isArray(pack.capabilities.tools)
    || !sameStrings(
      pack.capabilities.tools,
      preschoolSectionInsightToolsForSection(pack.sectionId),
    )) {
    throw new Error("PRESCHOOL_SECTION_INSIGHT_PACK_INVALID");
  }
};

const validBinding = (value: unknown): boolean => isRecord(value)
  && nonEmptyString(value.workspaceId)
  && nonEmptyString(value.projectId)
  && nonEmptyString(value.scopeId)
  && nonEmptyString(value.dataSnapshotId)
  && nonEmptyString(value.projectReleaseId)
  && isRecord(value.analysisPeriod)
  && nonEmptyString(value.analysisPeriod.from)
  && nonEmptyString(value.analysisPeriod.to)
  && value.analysisPeriod.from < value.analysisPeriod.to
  && nonEmptyString(value.modelProfileId)
  && Number.isSafeInteger(value.modelProfileRevision)
  && (value.modelProfileRevision as number) > 0;

const validEvidence = (value: unknown): value is PreschoolSectionPackEvidence => isRecord(value)
  && nonEmptyString(value.id)
  && nonEmptyString(value.label)
  && uniqueStringArray(value.entityRefs, true)
  && uniqueStringArray(value.evidenceRefs)
  && value.evidenceRefs.includes(value.id)
  && (value.unit === undefined || nonEmptyString(value.unit))
  && isJsonValue(value.value);

const validRelatedSignal = (value: unknown): value is PreschoolSectionPackCrossSectionSignal => isRecord(value)
  && nonEmptyString(value.signalId)
  && TOOL_SECTIONS.inspect_related_section_signals.includes(value.relatedSectionId as PreschoolSectionId)
  && nonEmptyString(value.kind)
  && nonEmptyString(value.label)
  && Number.isFinite(value.priority)
  && uniqueStringArray(value.entityRefs, true)
  && uniqueStringArray(value.evidenceRefs)
  && uniqueStringArray(value.limitations, true);

const resolveIds = <T>(
  rawIds: unknown,
  byId: ReadonlyMap<string, T>,
  errorCode: "EVIDENCE_NOT_FOUND" | "SIGNAL_NOT_FOUND",
): T[] => requireUniqueStrings(rawIds).map((id) => {
  const value = byId.get(id);
  if (!value) throw new Error(`PRESCHOOL_SECTION_INSIGHT_${errorCode}`);
  return value;
});

const requireExactKeys = (value: unknown, keys: string[]): void => {
  if (!isRecord(value) || !exactKeys(value, keys)) {
    throw new Error("PRESCHOOL_SECTION_INSIGHT_REQUEST_INVALID");
  }
};

const exactKeys = (value: Record<string, unknown>, keys: string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const requireUniqueStrings = (value: unknown): string[] => {
  if (!uniqueStringArray(value)) throw new Error("PRESCHOOL_SECTION_INSIGHT_REQUEST_INVALID");
  return value;
};

const uniqueStringArray = (value: unknown, allowEmpty = false): value is string[] => Array.isArray(value)
  && (allowEmpty || value.length > 0)
  && value.every(nonEmptyString)
  && new Set(value).size === value.length;

const uniqueStrings = (values: string[]): string[] => [...new Set(values)];

const sameStrings = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isJsonValue = (value: unknown): boolean => value === null
  || typeof value === "string"
  || typeof value === "number"
  || typeof value === "boolean"
  || (Array.isArray(value) && value.every(isJsonValue))
  || (isRecord(value) && Object.values(value).every(isJsonValue));
