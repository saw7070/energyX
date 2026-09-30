import type {
  EnergyIqAdditionalInsightModelProfileSnapshot,
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import type { PublicStructuredOutputOptions } from "@mastra/core/agent";
import { randomUUID } from "node:crypto";

import {
  createTuyaOfficeOverviewAiSectionArtifactIdentity,
  requireCurrentTuyaOfficeBaseIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import type { ProjectOverviewAiSectionDefinition } from "./project-overview-ai-adapter.js";
import {
  TUYA_OFFICE_SECTION_IDS,
  type TuyaOfficeSectionId,
  type TuyaOfficeSectionPack,
} from "./tuya-office-section-pack.js";
import { TUYA_OFFICE_PROJECT_ID } from "./tuya-office-project.js";

const MAX_ANSWER_CHARS = 160_000;
const MAX_SUMMARY_CHARS = 600;
const MAX_TITLE_CHARS = 120;
const MAX_TEXT_CHARS = 720;
const MAX_DEEP_DIVE_CHARS = 220;
const MAX_PROMPT_CHARS = 100_000;
const MAX_COMPONENT_PROFILE_CIRCUITS = 8;
const LEASE_MS = 4 * 60 * 1_000;
const NUMBER_TOKEN = /(?<![A-Za-z0-9_-])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const ISO_LOCAL_DATE = /\b\d{4}-\d{2}-\d{2}\b/gu;
const CLOCK_TIME = /\b(?:[01]\d|2[0-3]):[0-5]\d\b/gu;
const DISPLAY_DATE = /\b(\d{1,2})(?:\s*[–—-]\s*(\d{1,2}))?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+(\d{4}))?\b/giu;
type StructuredEnvelope = Record<string, unknown>;

export const TUYA_OFFICE_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1 = {
  errorStrategy: "warn",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sectionId", "status", "candidates"],
    properties: {
      sectionId: { type: "string", enum: [...TUYA_OFFICE_SECTION_IDS] },
      status: { type: "string", enum: ["available", "empty"] },
      summary: {
        type: "object",
        additionalProperties: false,
        required: ["text", "evidenceRefs", "claimRefs"],
        properties: {
          text: { type: "string", minLength: 1, maxLength: MAX_SUMMARY_CHARS },
          evidenceRefs: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
          claimRefs: {
            type: "array",
            minItems: 0,
            uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
        },
      },
      candidates: { type: "array", minItems: 0, maxItems: 12, items: { type: "object" } },
      limitation: { type: "string", minLength: 1, maxLength: 320 },
    },
  },
} satisfies PublicStructuredOutputOptions<StructuredEnvelope>;

export type TuyaOfficeSectionSummary = {
  text: string;
  evidenceRefs: string[];
  claimRefs: string[];
  windowId: string;
};

export type TuyaOfficeSectionInsight = {
  id: string;
  title: string;
  text: string;
  epistemicStatus: "observed" | "inferred" | "speculative";
  evidenceRefs: string[];
  claimRefs: string[];
  windowId: string;
  deepDiveQuestion?: string;
};

export type TuyaOfficeSectionInterpretationResult = {
  artifactKind: "section-interpretation";
  status: "available" | "empty";
  providerProfileId: string;
  runId: string;
  contract: {
    id: "energyiq-project-section-interpretation";
    revision: "energyiq-project-section-interpretation-v2";
  };
  binding: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
    reportTime: {
      policyId: string;
      policyRevision: string;
      contextFingerprint: string;
      windowId: string;
      from: string;
      toExclusive: string;
      phase: "complete" | "partial" | "forecast";
    };
    modelProfileId: string;
    modelProfileRevision: number;
  };
  sectionId: TuyaOfficeSectionId;
  packRevision: "v4";
  capability: {
    revision: "pack-only-v1";
    mode: "pack-only";
    tools: [];
  };
  summary?: TuyaOfficeSectionSummary;
  insights: TuyaOfficeSectionInsight[];
  limitation?: string;
  publication: {
    policyId: "energyiq-project-section-publication";
    policyRevision: "energyiq-project-section-publication-v1";
    discoveredCount: number;
    acceptedCount: number;
    rejectedCount: number;
    publishedCount: number;
    suppressedCandidateIds: string[];
    rejectedCandidateIds: string[];
  };
};

export type TuyaOfficeSectionInterpreterRunner = (input: {
  prompt: string;
  identity: EnergyIqOverviewAiArtifactIdentity;
  user: UserRecord;
  workspaceId: string;
  runId: string;
  sessionId: string;
  structuredOutput: typeof TUYA_OFFICE_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1;
  modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export const createTuyaOfficeSectionInterpreter = (input: {
  metadataStore: MetadataStore;
  runSection: TuyaOfficeSectionInterpreterRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
}) => ({
  async execute<SectionId extends TuyaOfficeSectionId>({
    baseIdentity,
    pack,
    unit,
    user,
    retry = false,
    modelProfileSnapshot,
  }: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    pack: TuyaOfficeSectionPack<SectionId>;
    unit: ProjectOverviewAiSectionDefinition;
    user: UserRecord;
    retry?: boolean;
    modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
  }): Promise<EnergyIqOverviewAiArtifactRecord> {
    const currentBaseIdentity = requireCurrentTuyaOfficeBaseIdentity(baseIdentity);
    const identity = createTuyaOfficeOverviewAiSectionArtifactIdentity({
      baseIdentity: currentBaseIdentity,
      targetId: pack.sectionId,
      unit,
    });
    requirePackIdentity(pack, identity);
    const store = input.metadataStore.energyIq.overviewAiArtifacts;
    const current = store.find(identity)
      ?? store.queue({ identity, triggeredBy: user.id });
    if (current.status !== "queued" && !(current.status === "failed" && retry)) {
      return current;
    }

    const workerId = `tuya-office-section:${pack.sectionId}:${randomUUID()}`;
    const claim = store.claim({ identity, workerId, leaseMs: LEASE_MS });
    if (!claim.claimed) return claim.artifact;
    const sessionId = `tuya-office-section-${pack.sectionId}-${randomUUID()}`;
    const runId = `tuya-office-section-${pack.sectionId}-${randomUUID()}`;
    try {
      input.assertRuntimeIdentity?.(identity);
      const response = await input.runSection({
        prompt: buildTuyaOfficeSectionPrompt(pack),
        identity,
        user,
        workspaceId: currentBaseIdentity.workspaceId,
        runId,
        sessionId,
        structuredOutput: TUYA_OFFICE_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1,
        ...(modelProfileSnapshot ? { modelProfileSnapshot } : {}),
      });
      if (response.runId !== runId || response.sessionId !== sessionId) {
        throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_RUN_IDENTITY_MISMATCH");
      }
      const result = materializeTuyaOfficeSectionResult({
        answer: response.answer,
        pack,
        identity,
        runId,
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
        return store.fail({ identity, workerId, errorCode: sectionErrorCode(error) });
      } catch {
        return store.get(identity);
      }
    }
  },
});

export const buildTuyaOfficeSectionPrompt = (
  pack: TuyaOfficeSectionPack,
): string => {
  const prompt = [
    "You interpret one Tuya Office energy Overview Section for office facilities and energy managers.",
    "Use only the supplied Section Pack. Do not call tools, query SQL, expose Connector identifiers, or introduce factual numbers absent from the Pack projection.",
    "Evidence is the factual base. Inferred and speculative angles are welcome when they help the user think, but label them honestly and never present a possible cause as observed fact.",
    "Every number in the Summary or an Insight must be present in the Pack projection. Evidence refs must be exact Evidence IDs from the Pack.",
    "For every factual number, cite its exact semantic numeric claim in claimRefs. A number that belongs to another subject or metric is invalid even when the same value appears elsewhere in the Section. Use an empty claimRefs array when the narrative contains no factual number.",
    "Pack fact timestamps are already converted to reportTime.timezone. Use those projected local dates and clock times exactly; do not reinterpret them as UTC or repeat the server-owned Artifact pin.",
    "Do not add official totals, component Meters and virtual Meters together. Do not call night load waste, infer equipment purpose from a label, or claim causation without direct Evidence.",
    "A candidate with a weak field, unsupported number or invalid Evidence ref will be rejected independently; other useful candidates can still be published.",
    "Return status=empty only when the Pack supports no useful Summary or angle.",
    `Required sectionId: ${JSON.stringify(pack.sectionId)}.`,
    "Return only one JSON object with no Markdown fence, preface or afterword: {\"sectionId\":string,\"status\":\"available\"|\"empty\",\"summary\"?:{\"text\":string,\"evidenceRefs\":string[],\"claimRefs\":string[]},\"candidates\":[{\"id\":string,\"title\":string,\"text\":string,\"epistemicStatus\":\"observed\"|\"inferred\"|\"speculative\",\"evidenceRefs\":string[],\"claimRefs\":string[],\"deepDiveQuestion\"?:string}],\"limitation\"?:string}",
    `Section Pack projection: ${JSON.stringify(projectPackForPrompt(pack))}`,
  ].join("\n\n");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_PROMPT_TOO_LARGE");
  }
  return prompt;
};

export const materializeTuyaOfficeSectionResult = <SectionId extends TuyaOfficeSectionId>(input: {
  answer: string;
  pack: TuyaOfficeSectionPack<SectionId>;
  identity: EnergyIqOverviewAiArtifactIdentity;
  runId: string;
}): TuyaOfficeSectionInterpretationResult => {
  requirePackIdentity(input.pack, input.identity);
  const proposal = parseProposal(input.answer, input.pack.sectionId);
  const evidenceIds = new Set(input.pack.evidence.map(({ id }) => id));
  const projection = projectPackForPrompt(input.pack);
  const numericClaims = numericClaimMap(projection.numericClaims);

  if (proposal.status === "empty") {
    if (proposal.summary !== undefined || proposal.candidates.length !== 0) {
      throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_RESULT_INVALID");
    }
    return resultBase(input, "empty", [], [], 0);
  }

  const summary = parseSummary(
    proposal.summary,
    evidenceIds,
    numericClaims,
    projection,
    input.pack.reportTime.window.windowId,
  );
  if (!summary) throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_RESULT_INVALID");
  const accepted: TuyaOfficeSectionInsight[] = [];
  const rejectedCandidateIds: string[] = [];
  const seenIds = new Set<string>();
  for (let index = 0; index < proposal.candidates.length; index += 1) {
    const candidate = proposal.candidates[index];
    const candidateId = isRecord(candidate) && nonEmptyString(candidate.id)
      ? candidate.id
      : `candidate:${index + 1}`;
    if (seenIds.has(candidateId)) {
      rejectedCandidateIds.push(candidateId);
      continue;
    }
    seenIds.add(candidateId);
    const insight = parseInsight(
      candidate,
      input.pack.sectionId,
      evidenceIds,
      numericClaims,
      projection,
      input.pack.reportTime.window.windowId,
    );
    if (!insight) {
      rejectedCandidateIds.push(candidateId);
      continue;
    }
    accepted.push(insight);
  }
  const published = accepted.slice(0, 3);
  const suppressedCandidateIds = accepted.slice(3).map(({ id }) => id);
  return {
    ...resultBase(
      input,
      "available",
      published,
      rejectedCandidateIds,
      proposal.candidates.length,
      suppressedCandidateIds,
    ),
    summary,
    ...(boundedString(proposal.limitation, 320) ? { limitation: proposal.limitation } : {}),
  };
};

const resultBase = <SectionId extends TuyaOfficeSectionId>(
  input: {
    pack: TuyaOfficeSectionPack<SectionId>;
    identity: EnergyIqOverviewAiArtifactIdentity;
    runId: string;
  },
  status: "available" | "empty",
  insights: TuyaOfficeSectionInsight[],
  rejectedCandidateIds: string[],
  discoveredCount: number,
  suppressedCandidateIds: string[] = [],
): TuyaOfficeSectionInterpretationResult => ({
  artifactKind: "section-interpretation",
  status,
  providerProfileId: input.identity.modelProfileId,
  runId: input.runId,
  contract: {
    id: "energyiq-project-section-interpretation",
    revision: "energyiq-project-section-interpretation-v2",
  },
  binding: {
    workspaceId: input.identity.workspaceId,
    projectId: input.identity.projectId,
    scopeId: input.identity.scopeId,
    dataSnapshotId: input.identity.dataSnapshotId,
    projectReleaseId: input.identity.projectReleaseId,
    analysisPeriod: {
      from: input.identity.analysisPeriodFrom,
      to: input.identity.analysisPeriodTo,
    },
    reportTime: {
      policyId: input.pack.reportTime.policyId,
      policyRevision: input.pack.reportTime.policyRevision,
      contextFingerprint: input.identity.reportTimeContextFingerprint!,
      windowId: input.pack.reportTime.window.windowId,
      from: input.pack.reportTime.window.from,
      toExclusive: input.pack.reportTime.window.toExclusive,
      phase: input.pack.reportTime.window.phase,
    },
    modelProfileId: input.identity.modelProfileId,
    modelProfileRevision: input.identity.modelProfileRevision,
  },
  sectionId: input.pack.sectionId,
  packRevision: "v4",
  capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
  insights,
  publication: {
    policyId: "energyiq-project-section-publication",
    policyRevision: "energyiq-project-section-publication-v1",
    discoveredCount,
    acceptedCount: insights.length + suppressedCandidateIds.length,
    rejectedCount: rejectedCandidateIds.length,
    publishedCount: insights.length,
    suppressedCandidateIds,
    rejectedCandidateIds,
  },
});

const parseProposal = (
  answer: string,
  sectionId: TuyaOfficeSectionId,
): {
  status: "available" | "empty";
  summary?: unknown;
  candidates: unknown[];
  limitation?: unknown;
} => {
  if (answer.length === 0 || answer.length > MAX_ANSWER_CHARS || !answer.startsWith("{")) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_RESULT_INVALID");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer) as unknown;
  } catch {
    throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_RESULT_INVALID");
  }
  if (!isRecord(parsed)
    || Object.keys(parsed).some((key) => ![
      "sectionId", "status", "summary", "candidates", "limitation",
    ].includes(key))
    || parsed.sectionId !== sectionId
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !Array.isArray(parsed.candidates)) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_RESULT_INVALID");
  }
  return {
    status: parsed.status,
    candidates: parsed.candidates,
    ...(parsed.summary !== undefined ? { summary: parsed.summary } : {}),
    ...(parsed.limitation !== undefined ? { limitation: parsed.limitation } : {}),
  };
};

const parseSummary = (
  value: unknown,
  evidenceIds: ReadonlySet<string>,
  numericClaims: ReadonlyMap<string, NumericClaim>,
  projection: Record<string, unknown>,
  windowId: string,
): TuyaOfficeSectionSummary | null => {
  if (!isRecord(value)
    || Object.keys(value).some((key) => !["text", "evidenceRefs", "claimRefs"].includes(key))
    || !boundedString(value.text, MAX_SUMMARY_CHARS)
    || !validEvidenceRefs(value.evidenceRefs, evidenceIds)
    || !validClaimRefs(value.claimRefs, numericClaims)
    || !numbersSupported(value.text, projection, value.claimRefs, numericClaims)) return null;
  return {
    text: value.text,
    evidenceRefs: [...value.evidenceRefs],
    claimRefs: [...value.claimRefs],
    windowId,
  };
};

const parseInsight = (
  value: unknown,
  sectionId: TuyaOfficeSectionId,
  evidenceIds: ReadonlySet<string>,
  numericClaims: ReadonlyMap<string, NumericClaim>,
  projection: Record<string, unknown>,
  windowId: string,
): TuyaOfficeSectionInsight | null => {
  if (!isRecord(value)
    || Object.keys(value).some((key) => ![
      "id", "title", "text", "epistemicStatus", "evidenceRefs", "claimRefs", "deepDiveQuestion",
    ].includes(key))
    || !nonEmptyString(value.id)
    || !boundedString(value.title, MAX_TITLE_CHARS)
    || !boundedString(value.text, MAX_TEXT_CHARS)
    || (value.epistemicStatus !== "observed"
      && value.epistemicStatus !== "inferred"
      && value.epistemicStatus !== "speculative")
    || !validEvidenceRefs(value.evidenceRefs, evidenceIds)
    || !validClaimRefs(value.claimRefs, numericClaims)
    || (value.deepDiveQuestion !== undefined
      && !boundedString(value.deepDiveQuestion, MAX_DEEP_DIVE_CHARS))) return null;
  const narrative = [value.title, value.text, value.deepDiveQuestion ?? ""].join(" ");
  if (!numbersSupported(narrative, projection, value.claimRefs, numericClaims)) return null;
  return {
    id: `${sectionId}::${value.id}`,
    title: value.title,
    text: value.text,
    epistemicStatus: lowerEpistemicStatus(value.epistemicStatus, narrative),
    evidenceRefs: [...value.evidenceRefs],
    claimRefs: [...value.claimRefs],
    windowId,
    ...(typeof value.deepDiveQuestion === "string"
      ? { deepDiveQuestion: value.deepDiveQuestion }
      : {}),
  };
};

const lowerEpistemicStatus = (
  proposed: TuyaOfficeSectionInsight["epistemicStatus"],
  narrative: string,
): TuyaOfficeSectionInsight["epistemicStatus"] => proposed === "observed"
  && /\b(?:may|might|could|likely|possibly|suggest(?:s|ing|ed)?|indicat(?:e|es|ing|ed)|warrants?|investigat\w*|recommends?|reviews?|verif(?:y|ies)|should|would|opportunit\w*)\b/iu.test(narrative)
  ? "inferred"
  : proposed;

const numbersSupported = (
  text: string,
  projection: Record<string, unknown>,
  claimRefs: readonly string[],
  numericClaims: ReadonlyMap<string, NumericClaim>,
): boolean => {
  const narrativeWithoutTemporalValues = validateAndMaskTemporalValues(text, projection);
  if (narrativeWithoutTemporalValues === null) return false;
  const reportedNumbers = [...narrativeWithoutTemporalValues.matchAll(NUMBER_TOKEN)];
  if (reportedNumbers.length !== claimRefs.length) return false;
  return reportedNumbers.every((match, index) => {
    const token = match[0];
    const reported = Number(token.replaceAll(",", ""));
    if (!Number.isFinite(reported)) return false;
    const claim = numericClaims.get(claimRefs[index]!);
    if (!claim || !claimLabelsSupported(text, match.index ?? 0, claim.labels)) return false;
    const source = claim.value;
    const normalized = token.replaceAll(",", "");
    const precision = normalized.split(".")[1]?.length ?? 0;
    const tolerance = 0.5 * (10 ** -precision)
      + Number.EPSILON * Math.max(1, Math.abs(reported)) * 4;
    return Math.abs(source - reported) <= tolerance;
  });
};

const validateAndMaskTemporalValues = (
  text: string,
  projection: Record<string, unknown>,
): string | null => {
  const support = collectTemporalSupport({
    reportTime: projection.reportTime,
    facts: projection.facts,
  });
  const spans: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(ISO_LOCAL_DATE)) {
    if (!support.dates.has(match[0])) return null;
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  for (const match of text.matchAll(DISPLAY_DATE)) {
    const day = match[1];
    const monthName = match[3];
    if (!day || !monthName) return null;
    const month = monthNumber(monthName);
    const year = match[4];
    if (!month
      || !supportsDisplayDate(support.dates, day, month, year)
      || (match[2] !== undefined
        && !supportsDisplayDate(support.dates, match[2], month, year))) return null;
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  for (const match of text.matchAll(CLOCK_TIME)) {
    if (!support.times.has(match[0])) return null;
    spans.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }
  const characters = [...text];
  for (const { start, end } of spans) {
    for (let index = start; index < end; index += 1) characters[index] = " ";
  }
  return characters.join("");
};

const collectTemporalSupport = (value: unknown): {
  dates: Set<string>;
  times: Set<string>;
} => {
  const dates = new Set<string>();
  const times = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate === "string") {
      for (const match of candidate.matchAll(ISO_LOCAL_DATE)) dates.add(match[0]);
      for (const match of candidate.matchAll(CLOCK_TIME)) times.add(match[0]);
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (isRecord(candidate)) Object.values(candidate).forEach(visit);
  };
  visit(value);
  return { dates, times };
};

const supportsDisplayDate = (
  supportedDates: ReadonlySet<string>,
  day: string,
  month: string,
  year?: string,
): boolean => {
  const suffix = `-${month}-${day.padStart(2, "0")}`;
  return year
    ? supportedDates.has(`${year}${suffix}`)
    : [...supportedDates].some((date) => date.endsWith(suffix));
};

const monthNumber = (month: string): string | null => {
  const index = [
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
  ].indexOf(month.slice(0, 3).toLowerCase());
  return index < 0 ? null : String(index + 1).padStart(2, "0");
};

const projectPackForPrompt = (pack: TuyaOfficeSectionPack): Record<string, unknown> => {
  const facts = boundFactsForPrompt(projectFactsForPrompt(
    pack.facts,
    pack.reportTime.timezone,
  ));
  return {
    contract: pack.contract,
    sectionId: pack.sectionId,
    audience: pack.audience,
    analysisGoal: pack.analysisGoal,
    binding: pack.binding,
    reportTime: pack.reportTime,
    evidence: pack.evidence.map(({ id, metricId }) => ({ id, metricId })),
    facts,
    numericClaims: collectNumericClaims(facts),
    limitations: pack.limitations,
    missingEvidence: pack.missingEvidence,
    capabilities: pack.capabilities,
  };
};

type NumericClaim = { id: string; path: string; value: number; labels: string[] };

const collectNumericClaims = (value: unknown): NumericClaim[] => {
  const claims: NumericClaim[] = [];
  const visit = (candidate: unknown, path: string, inheritedLabels: readonly string[]): void => {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      claims.push({ id: `fact:${path}`, path, value: candidate, labels: [...inheritedLabels] });
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${path}[${index}]`, inheritedLabels));
      return;
    }
    if (!isRecord(candidate)) return;
    const labels = [...new Set([...inheritedLabels, ...entityLabels(candidate)])];
    for (const [key, item] of Object.entries(candidate)) {
      visit(item, path ? `${path}.${key}` : key, labels);
    }
  };
  visit(value, "", []);
  return claims;
};

const numericClaimMap = (value: unknown): Map<string, NumericClaim> => {
  if (!Array.isArray(value)) return new Map();
  return new Map(value.flatMap((candidate) => isRecord(candidate)
    && nonEmptyString(candidate.id)
    && nonEmptyString(candidate.path)
    && typeof candidate.value === "number"
    && Number.isFinite(candidate.value)
    && Array.isArray(candidate.labels)
    && candidate.labels.every(nonEmptyString)
    ? [[candidate.id, {
        id: candidate.id,
        path: candidate.path,
        value: candidate.value,
        labels: [...candidate.labels],
      }] as const]
    : []));
};

const entityLabels = (value: Record<string, unknown>): string[] => {
  const primaryKeys = ["name", "meterNodeId", "scopeName", "scopeId"] as const;
  const primary = primaryKeys.flatMap((key) => nonEmptyString(value[key]) ? [value[key]] : []);
  if (primary.length > 0) return primary;
  return nonEmptyString(value.category) ? [value.category] : [];
};

const claimLabelsSupported = (
  narrative: string,
  numericIndex: number,
  labels: readonly string[],
): boolean => {
  if (labels.length === 0) return true;
  const nearby = narrative.slice(Math.max(0, numericIndex - 160), numericIndex + 160).toLocaleLowerCase("en");
  return labels.some((label) => nearby.includes(label.toLocaleLowerCase("en")));
};

const boundFactsForPrompt = (value: unknown): unknown => {
  if (!isRecord(value) || !isRecord(value.componentHourlyProfiles)) return value;
  const componentHourlyProfiles = value.componentHourlyProfiles;
  if (!Array.isArray(componentHourlyProfiles.scopes)) return value;
  return {
    ...value,
    componentHourlyProfiles: {
      ...componentHourlyProfiles,
      scopes: componentHourlyProfiles.scopes.map((scope) => {
        if (!isRecord(scope) || !Array.isArray(scope.profiles)) return scope;
        return {
          ...scope,
          profiles: scope.profiles.map((profile) => {
            if (!isRecord(profile) || !Array.isArray(profile.circuits)) return profile;
            return {
              ...profile,
              circuits: [...profile.circuits]
                .sort((left, right) => circuitProfileTotal(right) - circuitProfileTotal(left)
                  || circuitProfileIdentity(left).localeCompare(circuitProfileIdentity(right)))
                .slice(0, MAX_COMPONENT_PROFILE_CIRCUITS),
            };
          }),
        };
      }),
    },
  };
};

const circuitProfileTotal = (value: unknown): number => isRecord(value) && Array.isArray(value.values)
  ? value.values.reduce<number>((total, candidate) => total
      + (typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0), 0)
  : Number.NEGATIVE_INFINITY;

const circuitProfileIdentity = (value: unknown): string => isRecord(value)
  ? [value.meterNodeId, value.name].filter(nonEmptyString).join(":")
  : "";

const projectFactsForPrompt = (value: unknown, timezone: string): unknown => {
  if (typeof value === "string") {
    return ISO_INSTANT.test(value) ? formatReportInstant(value, timezone) : value;
  }
  if (Array.isArray(value)) return value.map((item) => projectFactsForPrompt(item, timezone));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    projectFactsForPrompt(item, timezone),
  ]));
};

const formatReportInstant = (value: string, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")} ${timezone}`;
};

const requirePackIdentity = (
  pack: TuyaOfficeSectionPack,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  if (identity.projectId !== TUYA_OFFICE_PROJECT_ID
    || identity.rendererKey !== "tuya-office-overview"
    || identity.identityContractRevision !== "tuya-office-section-v3"
    || identity.targetId !== pack.sectionId
    || identity.workspaceId !== pack.binding.workspaceId
    || identity.projectId !== pack.binding.projectId
    || identity.scopeId !== pack.binding.scopeId
    || identity.dataSnapshotId !== pack.binding.dataSnapshotId
    || identity.projectReleaseId !== pack.binding.projectReleaseId
    || identity.analysisPeriodFrom !== pack.binding.analysisPeriod.from
    || identity.analysisPeriodTo !== pack.binding.analysisPeriod.to
    || identity.reportTimePolicyId !== pack.reportTime.policyId
    || identity.reportTimePolicyRevision !== pack.reportTime.policyRevision
    || !identity.reportTimeContextFingerprint
    || identity.investigatorPromptRevision !== "tuya-office-section-discovery-v4"
    || identity.validatorRevision !== "tuya-office-section-acceptance-v4"
    || identity.analysisPackId !== "tuya-office-section-pack"
    || identity.analysisPackRevision !== "v4") {
    throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_PACK_IDENTITY_MISMATCH");
  }
};

const validEvidenceRefs = (
  value: unknown,
  evidenceIds: ReadonlySet<string>,
): value is string[] => Array.isArray(value)
  && value.length > 0
  && value.every((item) => nonEmptyString(item) && evidenceIds.has(item))
  && new Set(value).size === value.length;

const validClaimRefs = (
  value: unknown,
  numericClaims: ReadonlyMap<string, NumericClaim>,
): value is string[] => Array.isArray(value)
  && value.every((item) => nonEmptyString(item) && numericClaims.has(item))
  && new Set(value).size === value.length;

const boundedString = (value: unknown, maxLength: number): value is string =>
  nonEmptyString(value) && value.length <= maxLength;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sectionErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toUpperCase().replace(/[^A-Z0-9_]+/gu, "_");
  return normalized.slice(0, 160) || "ENERGYIQ_TUYA_OFFICE_SECTION_INTERPRETER_FAILED";
};
