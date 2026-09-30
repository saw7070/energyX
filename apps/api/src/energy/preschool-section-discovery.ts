import type {
  PreschoolOverviewAiBindingV4,
  PreschoolSectionDiscoveryV4,
  PreschoolSectionIdV4,
  PreschoolSectionInsightCandidateV4,
  PreschoolSectionSummaryV4,
} from "@datafoundry/contracts";

import type { PreschoolSectionPackV2 } from "./preschool-section-pack-v2.js";
import {
  PRESCHOOL_SECTION_DEEP_DIVE_MAX_CHARS,
  PRESCHOOL_SECTION_INSIGHT_LABEL_MAX_CHARS,
  PRESCHOOL_SECTION_INSIGHT_TEXT_MAX_CHARS,
  PRESCHOOL_SECTION_INSIGHT_TITLE_MAX_CHARS,
  PRESCHOOL_SECTION_LIMITATION_MAX_CHARS,
  PRESCHOOL_SECTION_SUMMARY_MAX_CHARS,
} from "./preschool-overview-ai-structured-output.js";

export const MAX_PRESCHOOL_SECTION_MODEL_PROJECTION_CHARS = 96_000;

export type PreschoolSectionModelProjectionV2 = {
  contract: {
    id: "preschool-section-model-projection";
    revision: "v2";
  };
  sectionId: PreschoolSectionIdV4;
  audience: PreschoolSectionPackV2["audience"];
  analysisGoal: string;
  evidence: PreschoolSectionPackV2["evidence"];
  alreadyPresentedFacts: PreschoolSectionPackV2["alreadyPresentedFacts"];
  crossSectionIndex: PreschoolSectionPackV2["crossSectionIndex"];
  dataQuality: PreschoolSectionPackV2["dataQuality"];
  limitations: string[];
  missingEvidence: string[];
  capabilities: PreschoolSectionPackV2["capabilities"];
  capabilityBoundary: {
    sourcePackRevision: "preschool-section-pack-v2";
    factAccess: "inline-complete";
    omittedEvidenceCount: 0;
    tools: PreschoolSectionPackV2["capabilities"]["tools"];
  };
};

/**
 * A complete, bounded, model-facing projection. It may remove runtime identity,
 * but it must never rank, sample or truncate the server-owned Evidence rows.
 */
export const projectPreschoolSectionPackV2ForModel = (
  pack: PreschoolSectionPackV2,
): PreschoolSectionModelProjectionV2 => {
  const projection: PreschoolSectionModelProjectionV2 = {
    contract: {
      id: "preschool-section-model-projection",
      revision: "v2",
    },
    sectionId: pack.sectionId,
    audience: pack.audience,
    analysisGoal: pack.analysisGoal,
    evidence: pack.evidence.map((evidence) => ({
      ...evidence,
      value: projectEvidenceValue(pack.sectionId, evidence.value),
      entityRefs: [...evidence.entityRefs],
      evidenceRefs: [...evidence.evidenceRefs],
      ...(evidence.claimRelations
        ? { claimRelations: evidence.claimRelations.map((relation) => ({ ...relation })) }
        : {}),
    })),
    alreadyPresentedFacts: pack.alreadyPresentedFacts.map((fact) => ({
      ...fact,
      value: projectEvidenceValue(pack.sectionId, fact.value),
      evidenceRefs: [...fact.evidenceRefs],
    })),
    crossSectionIndex: pack.crossSectionIndex.map((signal) => ({
      ...signal,
      entityRefs: [...signal.entityRefs],
      evidenceRefs: [...signal.evidenceRefs],
      limitations: [...signal.limitations],
    })),
    dataQuality: { ...pack.dataQuality },
    limitations: [...pack.limitations],
    missingEvidence: [...pack.missingEvidence],
    capabilities: {
      revision: pack.capabilities.revision,
      mode: pack.capabilities.mode,
      tools: [...pack.capabilities.tools],
    },
    capabilityBoundary: {
      sourcePackRevision: "preschool-section-pack-v2",
      factAccess: "inline-complete",
      omittedEvidenceCount: 0,
      tools: [...pack.capabilities.tools],
    },
  };
  if (JSON.stringify(projection).length > MAX_PRESCHOOL_SECTION_MODEL_PROJECTION_CHARS) {
    throw new Error("PRESCHOOL_SECTION_DISCOVERY_MODEL_PROJECTION_TOO_LARGE");
  }
  return projection;
};

type ColumnarTable = {
  columns: string[];
  constants?: Record<string, unknown>;
  rows: unknown[][];
};

type IndexedRecord = {
  index: number;
  parentIndex?: number;
  value: Record<string, unknown>;
};

const compactPlanningEvidenceValue = (value: unknown): unknown => {
  if (!isRecord(value) || !isRecord(value.forecast) || !Array.isArray(value.forecast.scopes)) return value;
  const scopes = encodePlanningScopes(value.forecast.scopes);
  return scopes
    ? {
        ...value,
        forecast: {
          ...value.forecast,
          scopes,
        },
      }
    : value;
};

const projectEvidenceValue = (
  sectionId: PreschoolSectionPackV2["sectionId"],
  value: unknown,
): unknown => {
  if (sectionId === "planning-outlook") return compactPlanningEvidenceValue(value);
  if ((sectionId !== "standby-wastage" && sectionId !== "operating-behaviour")
    || !isRecord(value)
    || typeof value.spikeCount !== "number"
    || typeof value.centreCount !== "number"
    || (typeof value.closedHoursKwh !== "number" && typeof value.operatingHoursKwh !== "number")) return value;
  const { spikeCount, centreCount, ...rest } = value;
  return {
    ...rest,
    flaggedSpikeCount: spikeCount,
    centresWithFlaggedSpikes: centreCount,
  };
};

const encodePlanningScopes = (values: unknown[]): Record<string, unknown> | null => {
  const scopeGroups = new Map<string, IndexedRecord[]>();
  const bucketGroups = new Map<string, { grain: string; entries: IndexedRecord[] }>();
  const bucketCounts: Record<string, number> = {};

  for (const [scopeIndex, value] of values.entries()) {
    if (!isRecord(value) || !isRecord(value.buckets)) return null;
    const scopeValue = definedRecordEntries(value, "buckets");
    addRecordGroup(scopeGroups, scopeValue, { index: scopeIndex, value: scopeValue });
    for (const [grain, buckets] of Object.entries(value.buckets)) {
      if (!Array.isArray(buckets)) return null;
      bucketCounts[grain] = (bucketCounts[grain] ?? 0) + buckets.length;
      for (const [bucketIndex, bucket] of buckets.entries()) {
        if (!isRecord(bucket)) return null;
        const bucketValue = definedRecordEntries(bucket);
        const groupKey = JSON.stringify([grain, bucketIndex, sortedKeys(bucketValue)]);
        const group = bucketGroups.get(groupKey) ?? { grain, entries: [] };
        group.entries.push({ index: bucketIndex, parentIndex: scopeIndex, value: bucketValue });
        bucketGroups.set(groupKey, group);
      }
    }
  }

  return {
    encoding: { id: "energyiq-lossless-columnar-json", revision: "v1" },
    scopeRowPrefix: ["scopeIndex"],
    bucketRowPrefix: ["scopeIndex", "bucketIndex"],
    scopeCount: values.length,
    bucketCounts,
    scopeTables: [...scopeGroups.values()].map((entries) => columnarTable(entries, false)),
    bucketTables: [...bucketGroups.values()].map(({ grain, entries }) => ({
      grain,
      ...columnarTable(entries, true),
    })),
  };
};

const definedRecordEntries = (
  value: Record<string, unknown>,
  excludedKey?: string,
): Record<string, unknown> => Object.fromEntries(
  Object.entries(value).filter(([key, entry]) => key !== excludedKey && entry !== undefined),
);

const addRecordGroup = (
  groups: Map<string, IndexedRecord[]>,
  value: Record<string, unknown>,
  entry: IndexedRecord,
): void => {
  const key = JSON.stringify(sortedKeys(value));
  const group = groups.get(key) ?? [];
  group.push(entry);
  groups.set(key, group);
};

const columnarTable = (entries: IndexedRecord[], includeParentIndex: boolean): ColumnarTable => {
  const keys = sortedKeys(entries[0]?.value ?? {});
  const constantKeys = keys.filter((key) => entries.every((entry) =>
    JSON.stringify(entry.value[key]) === JSON.stringify(entries[0]?.value[key])));
  const columns = keys.filter((key) => !constantKeys.includes(key));
  const constants = Object.fromEntries(constantKeys.map((key) => [key, entries[0]?.value[key]]));
  return {
    columns,
    ...(constantKeys.length > 0 ? { constants } : {}),
    rows: entries.map((entry) => [
      ...(includeParentIndex ? [entry.parentIndex] : []),
      entry.index,
      ...columns.map((key) => entry.value[key]),
    ]),
  };
};

const sortedKeys = (value: Record<string, unknown>): string[] => Object.keys(value).sort();

export const parsePreschoolSectionDiscoveryV4 = (input: {
  answer: string;
  expectedSectionId: PreschoolSectionIdV4;
  binding: PreschoolOverviewAiBindingV4;
}): PreschoolSectionDiscoveryV4 => {
  if (input.answer.trim() === "[]") {
    return {
      sectionId: input.expectedSectionId,
      binding: input.binding,
      status: "empty",
      candidates: [],
    };
  }
  const parsed = parseResponseObject(input.answer, input.expectedSectionId);
  if (parsed.status === "empty") {
    if (parsed.summary !== undefined
      || parsed.limitation !== undefined
      || !Array.isArray(parsed.candidates)
      || parsed.candidates.length !== 0) {
      throw new Error("PRESCHOOL_SECTION_INTERPRETATION_MALFORMED");
    }
    return {
      sectionId: input.expectedSectionId,
      binding: input.binding,
      status: "empty",
      candidates: [],
    };
  }
  if (parsed.status !== "available" || !Array.isArray(parsed.candidates)) {
    throw new Error("PRESCHOOL_SECTION_INTERPRETATION_MALFORMED");
  }
  const summary = parseSummary(parsed.summary);
  if (!summary) throw new Error("PRESCHOOL_SECTION_INTERPRETATION_SUMMARY_UNSUPPORTED");
  const limitation = optionalText(parsed.limitation);
  if (parsed.limitation !== undefined
    && (!limitation || limitation.length > PRESCHOOL_SECTION_LIMITATION_MAX_CHARS)) {
    throw new Error("PRESCHOOL_SECTION_INTERPRETATION_SUMMARY_UNSUPPORTED");
  }
  return {
    sectionId: input.expectedSectionId,
    binding: input.binding,
    status: "available",
    summary,
    candidates: parsed.candidates.map(parseCandidate),
    ...(limitation ? { limitation } : {}),
  };
};

const parseSummary = (value: unknown): PreschoolSectionSummaryV4 | null => {
  if (!isRecord(value)) return null;
  const text = cleanText(value.text);
  const refs = parseEvidenceRefs(value.evidenceRefs);
  if (!text || text.length > PRESCHOOL_SECTION_SUMMARY_MAX_CHARS
    || !refs || hasUnexpectedKeys(value, ["text", "evidenceRefs"])) return null;
  return { text, evidenceRefs: refs };
};

const parseCandidate = (value: unknown): PreschoolSectionInsightCandidateV4 => {
  if (!isRecord(value)
    || hasUnexpectedKeys(value, [
      "title", "label", "epistemicStatus", "text", "evidenceRefs", "deepDiveQuestion",
    ])) return malformedCandidate();
  const title = cleanText(value.title);
  const label = optionalText(value.label);
  const text = cleanText(value.text);
  const evidenceRefs = parseEvidenceRefs(value.evidenceRefs);
  const deepDiveQuestion = optionalText(value.deepDiveQuestion);
  if (!title || title.length > PRESCHOOL_SECTION_INSIGHT_TITLE_MAX_CHARS
    || (label !== undefined && label.length > PRESCHOOL_SECTION_INSIGHT_LABEL_MAX_CHARS)
    || !text || text.length > PRESCHOOL_SECTION_INSIGHT_TEXT_MAX_CHARS
    || (deepDiveQuestion !== undefined && deepDiveQuestion.length > PRESCHOOL_SECTION_DEEP_DIVE_MAX_CHARS)
    || !evidenceRefs
    || (value.epistemicStatus !== "observed"
      && value.epistemicStatus !== "inferred"
      && value.epistemicStatus !== "speculative")) return malformedCandidate();
  return {
    title,
    ...(label ? { label } : {}),
    epistemicStatus: value.epistemicStatus,
    text,
    evidenceRefs,
    ...(deepDiveQuestion ? { deepDiveQuestion } : {}),
  };
};

const malformedCandidate = (): PreschoolSectionInsightCandidateV4 => ({
  title: "",
  epistemicStatus: "observed",
  text: "",
  evidenceRefs: [],
});

const parseEvidenceRefs = (value: unknown): string[] | null => {
  if (!Array.isArray(value)
    || value.length === 0
    || !value.every((reference) => typeof reference === "string" && Boolean(reference.trim()))) return null;
  return [...new Set(value.map((reference) => reference.trim()))];
};

const parseResponseObject = (
  answer: string,
  expectedSectionId: PreschoolSectionIdV4,
): Record<string, unknown> => {
  for (const candidate of [stripJsonFence(answer), ...jsonObjectCandidates(answer)]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed) && parsed.sectionId === expectedSectionId) return parsed;
    } catch {
      // Some compatible Providers wrap the structured object in brief prose.
    }
  }
  throw new Error("PRESCHOOL_SECTION_INTERPRETER_RESPONSE_MALFORMED");
};

const jsonObjectCandidates = (value: string): string[] => {
  const candidates: string[] = [];
  for (let start = value.indexOf("{"); start >= 0; start = value.indexOf("{", start + 1)) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(value.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return candidates;
};

const hasUnexpectedKeys = (value: Record<string, unknown>, allowed: string[]): boolean =>
  Object.keys(value).some((key) => !allowed.includes(key));

const stripJsonFence = (value: string): string => value.trim()
  .replace(/^```(?:json)?\s*/i, "")
  .replace(/\s*```$/, "");

const cleanText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const optionalText = (value: unknown): string | undefined =>
  value === undefined ? undefined : cleanText(value) ?? undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
