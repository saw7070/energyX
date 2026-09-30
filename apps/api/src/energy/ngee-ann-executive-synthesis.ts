import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  EnergyIqAdditionalInsightModelProfileSnapshot,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { createHash, randomUUID } from "node:crypto";

import { NGEE_ANN_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1 } from "./ngee-ann-overview-ai-structured-output.js";
import type { NgeeAnnSectionInterpretationResult, NgeeAnnSectionInsight } from "./ngee-ann-section-interpreter.js";
import type { NgeeAnnSectionId } from "./ngee-ann-section-pack.js";
import {
  createNgeeAnnOverviewAiExecutiveArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";

const LEASE_MS = 4 * 60 * 1_000;
const MAX_PROMPT_CHARS = 90_000;
const MAX_ANSWER_CHARS = 120_000;
const NUMBER_TOKEN = /(?<![A-Za-z0-9_-])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu;

export type NgeeAnnExecutiveSource = {
  sectionId: NgeeAnnSectionId;
  artifactId: string;
  result: NgeeAnnSectionInterpretationResult;
};

export type NgeeAnnExecutiveFinding = {
  id: string;
  title: string;
  text: string;
  epistemicStatus: "observed" | "inferred" | "speculative";
  sectionIds: NgeeAnnSectionId[];
  sourceInsightIds: string[];
  evidenceRefs: string[];
  windowIds?: string[];
};

export type NgeeAnnExecutiveSynthesisResult = {
  artifactKind: "executive-synthesis";
  status: "available" | "empty";
  providerProfileId: string;
  runId: string;
  contract: {
    id: "energyiq-project-executive-synthesis";
    revision: "energyiq-project-executive-synthesis-v1";
  };
  binding: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
    modelProfileId: string;
    modelProfileRevision: number;
  };
  sourceSectionArtifactIds: string[];
  summary?: { text: string; evidenceRefs: string[]; windowIds?: string[] };
  findings: NgeeAnnExecutiveFinding[];
};

export type NgeeAnnExecutiveRunner = (input: {
  prompt: string;
  identity: EnergyIqOverviewAiArtifactIdentity;
  user: UserRecord;
  workspaceId: string;
  runId: string;
  sessionId: string;
  structuredOutput: typeof NGEE_ANN_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1;
  modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export const ngeeAnnExecutiveTargetId = (
  sectionRecords: readonly EnergyIqOverviewAiArtifactRecord[],
): string => {
  if (sectionRecords.length === 0) return "sections:none-v1";
  const basis = sectionRecords
    .map(({ id, identity_hash, status, run_id, result_json, error_code }) => {
      const valueDigest = createHash("sha256")
        .update(result_json ?? error_code ?? "")
        .digest("hex")
        .slice(0, 16);
      return `${id}:${identity_hash}:${status}:${run_id ?? "none"}:${valueDigest}`;
    })
    .sort((left, right) => left.localeCompare(right))
    .join("|");
  return `sections:${createHash("sha256").update(basis).digest("hex").slice(0, 24)}`;
};

export const createNgeeAnnExecutiveSynthesizer = (input: {
  metadataStore: MetadataStore;
  runExecutive: NgeeAnnExecutiveRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
  createArtifactIdentity?: typeof createNgeeAnnOverviewAiExecutiveArtifactIdentity;
  productLabel?: string;
  runPrefix?: string;
  allowNumericClaims?: boolean;
  requireWindowLineage?: boolean;
}) => ({
  async execute({
    baseIdentity,
    sectionRecords,
    user,
    retry = false,
    modelProfileSnapshot,
  }: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    sectionRecords: readonly EnergyIqOverviewAiArtifactRecord[];
    user: UserRecord;
    retry?: boolean;
    modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
  }): Promise<EnergyIqOverviewAiArtifactRecord> {
    const store = input.metadataStore.energyIq.overviewAiArtifacts;
    const identity = (input.createArtifactIdentity ?? createNgeeAnnOverviewAiExecutiveArtifactIdentity)({
      baseIdentity,
      targetId: ngeeAnnExecutiveTargetId(sectionRecords),
    });
    const current = store.find(identity)
      ?? store.queue({ identity, triggeredBy: user.id });
    if (current.status === "available" || current.status === "running") return current;
    if (current.status === "failed" && !retry) return current;
    const runPrefix = input.runPrefix ?? "ngee-ann-executive";
    const workerId = `${runPrefix}:${randomUUID()}`;
    const claim = store.claim({ identity, workerId, leaseMs: LEASE_MS });
    if (!claim.claimed) return claim.artifact;
    const sources = acceptedSources(sectionRecords);
    const sessionId = `${runPrefix}-${randomUUID()}`;
    const runId = `${runPrefix}-${randomUUID()}`;
    try {
      if (sources.length < 2) {
        input.assertRuntimeIdentity?.(identity);
        return store.complete({
          identity,
          workerId,
          sessionId,
          runId,
          resultJson: JSON.stringify(resultBase(identity, runId, sources, "empty", [])),
        });
      }
      input.assertRuntimeIdentity?.(identity);
      const response = await input.runExecutive({
        prompt: buildNgeeAnnExecutivePrompt(
          sources,
          input.productLabel ?? "Ngee Ann Overview",
          input.allowNumericClaims ?? true,
        ),
        identity,
        user,
        workspaceId: baseIdentity.workspaceId,
        runId,
        sessionId,
        structuredOutput: NGEE_ANN_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V1,
        ...(modelProfileSnapshot ? { modelProfileSnapshot } : {}),
      });
      if (response.runId !== runId || response.sessionId !== sessionId) {
        throw new Error("ENERGYIQ_NGEE_ANN_EXECUTIVE_RUN_IDENTITY_MISMATCH");
      }
      const result = materializeNgeeAnnExecutiveResult({
        answer: response.answer,
        identity,
        runId,
        sources,
        allowNumericClaims: input.allowNumericClaims ?? true,
        requireWindowLineage: input.requireWindowLineage ?? false,
      });
      input.assertRuntimeIdentity?.(identity);
      return store.complete({
        identity,
        workerId,
        sessionId,
        runId,
        resultJson: JSON.stringify(result),
      });
    } catch (error) {
      try {
        return store.fail({ identity, workerId, errorCode: executiveErrorCode(error) });
      } catch {
        return store.get(identity);
      }
    }
  },
});

export const materializeNgeeAnnExecutiveResult = (input: {
  answer: string;
  identity: EnergyIqOverviewAiArtifactIdentity;
  runId: string;
  sources: NgeeAnnExecutiveSource[];
  allowNumericClaims?: boolean;
  requireWindowLineage?: boolean;
}): NgeeAnnExecutiveSynthesisResult => {
  const proposal = parseProposal(input.answer);
  if (proposal.status === "empty") {
    if (proposal.summary !== undefined || proposal.findings.length !== 0) {
      throw new Error("ENERGYIQ_NGEE_ANN_EXECUTIVE_RESULT_INVALID");
    }
    return resultBase(input.identity, input.runId, input.sources, "empty", []);
  }
  const evidenceIds = new Set(input.sources.flatMap(({ result }) => [
    ...(result.summary?.evidenceRefs ?? []),
    ...result.insights.flatMap(({ evidenceRefs }) => evidenceRefs),
  ]));
  const sourceText = JSON.stringify(input.sources);
  const findings = proposal.findings
    .map((candidate) => parseFinding(
      candidate,
      input.sources,
      sourceText,
      input.allowNumericClaims ?? true,
      input.requireWindowLineage ?? false,
    ))
    .filter((finding): finding is NgeeAnnExecutiveFinding => finding !== null)
    .slice(0, 3);
  if (findings.length === 0) {
    throw new Error("ENERGYIQ_NGEE_ANN_EXECUTIVE_RESULT_INVALID");
  }
  const proposedSummary = parseSummary(
    proposal.summary,
    evidenceIds,
    sourceText,
    input.allowNumericClaims ?? true,
  );
  const summary = proposedSummary ?? (findings[0]
    ? {
        text: findings[0]!.text,
        evidenceRefs: [...findings[0]!.evidenceRefs],
      }
    : null);
  if (!summary) throw new Error("ENERGYIQ_NGEE_ANN_EXECUTIVE_RESULT_INVALID");
  const windowIds = sourceWindowIds(input.sources);
  if (input.requireWindowLineage && windowIds.length === 0) {
    throw new Error("ENERGYIQ_NGEE_ANN_EXECUTIVE_RESULT_INVALID");
  }
  return {
    ...resultBase(input.identity, input.runId, input.sources, "available", findings),
    summary: { ...summary, ...(windowIds.length > 0 ? { windowIds } : {}) },
  };
};

export const buildNgeeAnnExecutivePrompt = (
  sources: NgeeAnnExecutiveSource[],
  productLabel = "Ngee Ann Overview",
  allowNumericClaims = true,
): string => {
  const prompt = [
    `Create the ${productLabel} Key Findings from the accepted Section results below.`,
    "Summarise across Sections; do not merely repeat one card. Prefer the 1-3 conclusions that most change a manager's attention or line of inquiry.",
    "status=available requires at least one Finding. Every Finding must combine source Insights from at least two distinct Sections; otherwise return status=empty.",
    "Findings may be observed, inferred, or speculative. Preserve or lower the uncertainty of source Insights; never upgrade a hypothesis to fact.",
    "Use only exact source sectionIds, source Insight IDs and Evidence refs. Do not invent measurements or causes.",
    ...(allowNumericClaims ? [] : ["Do not repeat numeric values in Key Findings; the deterministic Overview already presents metrics, and this synthesis must avoid cross-entity numeric attribution."]),
    "Return only one JSON object: {\"status\":\"available\"|\"empty\",\"summary\"?:{\"text\":string,\"evidenceRefs\":string[]},\"findings\":[{\"id\":string,\"title\":string,\"text\":string,\"epistemicStatus\":\"observed\"|\"inferred\"|\"speculative\",\"sectionIds\":string[],\"sourceInsightIds\":string[],\"evidenceRefs\":string[]}]}",
    `Accepted Section results: ${JSON.stringify(sources)}`,
  ].join("\n\n");
  if (prompt.length > MAX_PROMPT_CHARS) throw new Error("ENERGYIQ_NGEE_ANN_EXECUTIVE_PROMPT_TOO_LARGE");
  return prompt;
};

const acceptedSources = (
  records: readonly EnergyIqOverviewAiArtifactRecord[],
): NgeeAnnExecutiveSource[] => records.flatMap((record) => {
  if (record.status !== "available" || !record.result_json) return [];
  try {
    const result = JSON.parse(record.result_json) as NgeeAnnSectionInterpretationResult;
    return result.artifactKind === "section-interpretation"
      && result.status === "available"
      && typeof result.sectionId === "string"
      ? [{ sectionId: result.sectionId, artifactId: record.id, result }]
      : [];
  } catch {
    return [];
  }
});

const parseProposal = (answer: string): {
  status: "available" | "empty";
  summary?: unknown;
  findings: unknown[];
} => {
  if (!answer.startsWith("{") || answer.length > MAX_ANSWER_CHARS) {
    throw new Error("ENERGYIQ_NGEE_ANN_EXECUTIVE_RESULT_INVALID");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(answer) as unknown; } catch {
    throw new Error("ENERGYIQ_NGEE_ANN_EXECUTIVE_RESULT_INVALID");
  }
  if (!isRecord(parsed)
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !Array.isArray(parsed.findings)) {
    throw new Error("ENERGYIQ_NGEE_ANN_EXECUTIVE_RESULT_INVALID");
  }
  return {
    status: parsed.status,
    findings: parsed.findings,
    ...(parsed.summary !== undefined ? { summary: parsed.summary } : {}),
  };
};

const parseSummary = (
  value: unknown,
  evidenceIds: Set<string>,
  sourceText: string,
  allowNumericClaims: boolean,
): { text: string; evidenceRefs: string[] } | null => {
  const text = isRecord(value) && typeof value.text === "string"
    ? normalizeNgeeAnnHourlyEnergyUnit(value.text)
    : value;
  return isRecord(value)
    && boundedString(text, 720)
    && validRefs(value.evidenceRefs, evidenceIds)
    && (allowNumericClaims || [...text.matchAll(NUMBER_TOKEN)].length === 0)
    && numbersSupported(text, sourceText)
    ? { text, evidenceRefs: [...value.evidenceRefs] }
    : null;
};

const parseFinding = (
  value: unknown,
  sources: NgeeAnnExecutiveSource[],
  sourceText: string,
  allowNumericClaims: boolean,
  requireWindowLineage: boolean,
): NgeeAnnExecutiveFinding | null => {
  if (!isRecord(value)) return null;
  const title = typeof value.title === "string"
    ? normalizeNgeeAnnHourlyEnergyUnit(value.title)
    : value.title;
  const text = typeof value.text === "string"
    ? normalizeNgeeAnnHourlyEnergyUnit(value.text)
    : value.text;
  if (!boundedString(value.id, 160)
    || !boundedString(title, 120)
    || !boundedString(text, 720)
    || (value.epistemicStatus !== "observed"
      && value.epistemicStatus !== "inferred"
      && value.epistemicStatus !== "speculative")
    || !Array.isArray(value.sectionIds)
    || value.sectionIds.length === 0
    || !Array.isArray(value.sourceInsightIds)
    || !Array.isArray(value.evidenceRefs)) return null;
  const sectionIds = value.sectionIds;
  const sourceInsightIds = value.sourceInsightIds;
  const evidenceRefs = value.evidenceRefs;
  const sectionSet = new Set(sources.map(({ sectionId }) => sectionId));
  if (new Set(sectionIds).size < 2
    || new Set(sectionIds).size !== sectionIds.length
    || !sectionIds.every((sectionId) => typeof sectionId === "string" && sectionSet.has(sectionId as NgeeAnnSectionId))) return null;
  const referencedSources = sources.filter(({ sectionId }) => sectionIds.includes(sectionId));
  const insights = referencedSources.flatMap(({ result }) => result.insights);
  const insightById = new Map(insights.map((insight) => [insight.id, insight]));
  if (new Set(sourceInsightIds).size !== sourceInsightIds.length
    || !sourceInsightIds.every((id) => typeof id === "string" && insightById.has(id))
    || !referencedSources.every(({ result }) => result.insights.some(({ id }) => sourceInsightIds.includes(id)))) return null;
  const evidenceIds = new Set(referencedSources.flatMap(({ result }) => [
    ...(result.summary?.evidenceRefs ?? []),
    ...result.insights.flatMap(({ evidenceRefs }) => evidenceRefs),
  ]));
  if (!validRefs(evidenceRefs, evidenceIds)) return null;
  const sourceInsights = sourceInsightIds.map((id) => insightById.get(id as string)!).filter(Boolean);
  const narrative = `${title} ${text}`;
  if ((!allowNumericClaims && [...narrative.matchAll(NUMBER_TOKEN)].length > 0)
    || !numbersSupported(narrative, sourceText)) return null;
  const epistemicStatus = lowerToSourceUncertainty(value.epistemicStatus, sourceInsights);
  const windowIds = uniqueStrings(sourceInsights.flatMap((insight) => {
    const value = insight as NgeeAnnSectionInsight & { windowId?: string };
    return typeof value.windowId === "string" && value.windowId.trim() ? [value.windowId] : [];
  }));
  if (requireWindowLineage && windowIds.length === 0) return null;
  return {
    id: value.id,
    title,
    text,
    epistemicStatus,
    sectionIds: [...sectionIds] as NgeeAnnSectionId[],
    sourceInsightIds: [...sourceInsightIds] as string[],
    evidenceRefs: [...evidenceRefs] as string[],
    ...(windowIds.length > 0 ? { windowIds } : {}),
  };
};

const sourceWindowIds = (sources: NgeeAnnExecutiveSource[]): string[] => uniqueStrings(
  sources.flatMap(({ result }) => result.insights.flatMap((insight) => {
    const value = insight as NgeeAnnSectionInsight & { windowId?: string };
    return typeof value.windowId === "string" && value.windowId.trim() ? [value.windowId] : [];
  })),
);

const uniqueStrings = (values: readonly string[]): string[] => [...new Set(values)];

const normalizeNgeeAnnHourlyEnergyUnit = (value: string): string => value
  .replace(/\bkWh\s*\/\s*(?:h|hour)\b/giu, "kWh per hourly bucket");

const lowerToSourceUncertainty = (
  proposed: NgeeAnnExecutiveFinding["epistemicStatus"],
  sources: NgeeAnnSectionInsight[],
): NgeeAnnExecutiveFinding["epistemicStatus"] => {
  const rank = { observed: 0, inferred: 1, speculative: 2 } as const;
  const floor = Math.max(rank[proposed], ...sources.map(({ epistemicStatus }) => rank[epistemicStatus]));
  return (Object.keys(rank) as Array<keyof typeof rank>).find((status) => rank[status] === floor)
    ?? "speculative";
};

const resultBase = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  runId: string,
  sources: NgeeAnnExecutiveSource[],
  status: "available" | "empty",
  findings: NgeeAnnExecutiveFinding[],
): NgeeAnnExecutiveSynthesisResult => ({
  artifactKind: "executive-synthesis",
  status,
  providerProfileId: identity.modelProfileId,
  runId,
  contract: {
    id: "energyiq-project-executive-synthesis",
    revision: "energyiq-project-executive-synthesis-v1",
  },
  binding: {
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    scopeId: identity.scopeId,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
    modelProfileId: identity.modelProfileId,
    modelProfileRevision: identity.modelProfileRevision,
  },
  sourceSectionArtifactIds: sources.map(({ artifactId }) => artifactId),
  findings,
});

const validRefs = (value: unknown, allowed: Set<string>): value is string[] =>
  Array.isArray(value) && value.length > 0
  && value.every((item) => typeof item === "string" && item.trim() && allowed.has(item))
  && new Set(value).size === value.length;

const numbersSupported = (text: string, sourceText: string): boolean =>
  [...text.matchAll(NUMBER_TOKEN)].every(([token]) => sourceText.includes(token.replaceAll(",", ""))
    || sourceText.includes(token));

const boundedString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const executiveErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().toUpperCase().replace(/[^A-Z0-9_]+/gu, "_").slice(0, 160)
    || "ENERGYIQ_NGEE_ANN_EXECUTIVE_FAILED";
};
