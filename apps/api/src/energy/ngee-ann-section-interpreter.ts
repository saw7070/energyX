import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  EnergyIqAdditionalInsightModelProfileSnapshot,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { randomUUID } from "node:crypto";

import { NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1 } from "./ngee-ann-overview-ai-structured-output.js";
import { createNgeeAnnOverviewAiSectionArtifactIdentity, type OverviewAiArtifactIdentityV13 } from "./overview-ai-artifact.js";
import type {
  NgeeAnnSectionPacks,
  NgeeAnnSectionId,
  NgeeAnnSectionPack,
} from "./ngee-ann-section-pack.js";
import { NGEE_ANN_SECTION_IDS } from "./ngee-ann-section-pack.js";

const MAX_ANSWER_CHARS = 160_000;
const MAX_SUMMARY_CHARS = 600;
const MAX_TITLE_CHARS = 120;
const MAX_TEXT_CHARS = 720;
const MAX_DEEP_DIVE_CHARS = 220;
const MAX_SCHOOL_HOLIDAY_PROMPT_ANOMALIES = 12;
export const NGEE_ANN_SECTION_MESSAGE_MAX_CHARS = 220_000;
const MAX_PROMPT_CHARS = NGEE_ANN_SECTION_MESSAGE_MAX_CHARS;
const LEASE_MS = 4 * 60 * 1_000;
const NUMBER_TOKEN = /(?<![A-Za-z0-9_-])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu;
const CLOCK_TIME_TOKEN = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/gu;

export type NgeeAnnSectionSummary = {
  text: string;
  evidenceRefs: string[];
};

export type NgeeAnnSectionInsight = {
  id: string;
  title: string;
  text: string;
  epistemicStatus: "observed" | "inferred" | "speculative";
  evidenceRefs: string[];
  deepDiveQuestion?: string;
};

export type NgeeAnnSectionInterpretationResult = {
  artifactKind: "section-interpretation";
  status: "available" | "empty";
  providerProfileId: string;
  runId: string;
  contract: {
    id: "energyiq-project-section-interpretation";
    revision: "energyiq-project-section-interpretation-v1";
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
  sectionId: NgeeAnnSectionId;
  packRevision: "v2";
  capability: {
    revision: "pack-only-v1";
    mode: "pack-only";
    tools: [];
  };
  summary?: NgeeAnnSectionSummary;
  insights: NgeeAnnSectionInsight[];
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

export type NgeeAnnSectionInterpreterRunner = (input: {
  prompt: string;
  identity: EnergyIqOverviewAiArtifactIdentity;
  user: UserRecord;
  workspaceId: string;
  runId: string;
  sessionId: string;
  structuredOutput: typeof NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1;
  modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export const createNgeeAnnSectionInterpreter = (input: {
  metadataStore: MetadataStore;
  runSection: NgeeAnnSectionInterpreterRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
}) => ({
  async execute({
    baseIdentity,
    packs,
    user,
    retryTargets = [],
    sectionIds = NGEE_ANN_SECTION_IDS,
    modelProfileSnapshot,
  }: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    packs: Partial<NgeeAnnSectionPacks>;
    user: UserRecord;
    retryTargets?: NgeeAnnSectionId[];
    sectionIds?: readonly NgeeAnnSectionId[];
    modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
  }): Promise<Record<NgeeAnnSectionId, EnergyIqOverviewAiArtifactRecord>> {
    const store = input.metadataStore.energyIq.overviewAiArtifacts;
    const selectedPacks = Object.fromEntries(sectionIds.map((sectionId) => {
      const pack = packs[sectionId];
      if (!pack) throw new Error(`ENERGYIQ_NGEE_ANN_SECTION_PACK_REQUIRED:${sectionId}`);
      return [sectionId, pack];
    })) as Record<NgeeAnnSectionId, NgeeAnnSectionPack>;
    const identities = Object.fromEntries(sectionIds.map((sectionId) => [
      sectionId,
      createNgeeAnnOverviewAiSectionArtifactIdentity({ baseIdentity, targetId: sectionId }),
    ])) as Record<NgeeAnnSectionId, EnergyIqOverviewAiArtifactIdentity>;
    for (const sectionId of sectionIds) {
      requirePackIdentity(selectedPacks[sectionId], identities[sectionId]);
    }
    const current = Object.fromEntries(sectionIds.map((sectionId) => [
      sectionId,
      store.find(identities[sectionId])
        ?? store.queue({ identity: identities[sectionId], triggeredBy: user.id }),
    ])) as Record<NgeeAnnSectionId, EnergyIqOverviewAiArtifactRecord>;
    const retrySet = new Set(retryTargets);
    const pending = sectionIds.filter((sectionId) => current[sectionId].status === "queued"
      || (current[sectionId].status === "failed" && retrySet.has(sectionId)));

    await mapWithConcurrency(pending, 2, async (sectionId) => {
      const identity = identities[sectionId];
      const workerId = `ngee-ann-section:${sectionId}:${randomUUID()}`;
      const claim = store.claim({ identity, workerId, leaseMs: LEASE_MS });
      current[sectionId] = claim.artifact;
      if (!claim.claimed) return;
      const sessionId = `ngee-ann-section-${sectionId}-${randomUUID()}`;
      const runId = `ngee-ann-section-${sectionId}-${randomUUID()}`;
      try {
        input.assertRuntimeIdentity?.(identity);
        const response = await input.runSection({
          prompt: buildNgeeAnnSectionPrompt(selectedPacks[sectionId]),
          identity,
          user,
          workspaceId: baseIdentity.workspaceId,
          runId,
          sessionId,
          structuredOutput: NGEE_ANN_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V1,
          ...(modelProfileSnapshot ? { modelProfileSnapshot } : {}),
        });
        if (response.runId !== runId || response.sessionId !== sessionId) {
          throw new Error("ENERGYIQ_NGEE_ANN_SECTION_RUN_IDENTITY_MISMATCH");
        }
        const result = materializeNgeeAnnSectionResult({
          answer: response.answer,
          pack: selectedPacks[sectionId],
          identity,
          runId,
        });
        input.assertRuntimeIdentity?.(identity);
        current[sectionId] = store.complete({
          identity,
          workerId,
          sessionId,
          runId,
          resultJson: JSON.stringify(result),
        });
      } catch (error) {
        try {
          current[sectionId] = store.fail({
            identity,
            workerId,
            errorCode: sectionErrorCode(error),
          });
        } catch {
          current[sectionId] = store.get(identity);
        }
      }
    });
    return current;
  },
});

export const buildNgeeAnnSectionPrompt = (
  pack: NgeeAnnSectionPack,
): string => {
  const prompt = [
    "You interpret one Ngee Ann energy Overview Section for facilities and energy managers.",
    "Use only the supplied Section analysis projection. Do not call tools, query SQL, or introduce factual numbers that are absent from the projection.",
    "The projection preserves every Section-level row in a compact field-order representation while omitting repeated low-level detail owned by another Section. Do not infer omitted detail.",
    "Report dates and clock times must use reportTime and fields ending in Local. They are authoritative Project-local values; do not reconstruct or narrate UTC boundaries.",
    "Write a concise Summary of what matters in this Section, then propose only genuinely useful Insights. Do not restate every visible metric.",
    "Insights may be observed, inferred, or speculative. Inference and speculation are encouraged when they offer a relevant new angle, but label them honestly and never present a possible cause as confirmed.",
    "The epistemicStatus applies to the whole title and text. If any sentence proposes a cause, possibility or action that is not directly observed, use inferred or speculative rather than observed.",
    "Evidence refs anchor the observation beneath an Insight; they do not claim that a hypothesis has been proven.",
    "Keep every factual number bound to its supplied field meaning and entity. A comparison percentage is not a share of total, a Level total is not off-hours usage, and a baseline value is not an actual value.",
    "Comparison fields describe the previous comparison period, never year-over-year. Do not write YoY, year-over-year, last year or previous year unless a future Pack explicitly supplies that basis.",
    "A speculative Insight may suggest a relationship, counterexample, question, or low-risk line of inquiry without inventing measurements.",
    "When comparing day types, follow the direction of the supplied Project-scope profiles. Do not call one day type higher or lower than another unless the profile values support that direction.",
    "For school-holiday-comparison, treat the supplied comparison result as authoritative: explain it, but do not calculate, sum, average or derive replacement metrics. Keep the exact same-context cohort and its limitations explicit.",
    "Each candidate must cite one or more exact Evidence IDs from the Pack. Aim for Summary under 480 characters, titles under 96, text under 480, and deep-dive questions under 220; preserve a useful explanation when it needs a little more room.",
    "Return status=empty only when the Pack supports no useful Summary or angle. One malformed candidate must not prevent other candidates from being useful.",
    `Required sectionId: ${JSON.stringify(pack.sectionId)}.`,
    "Return only one JSON object with no Markdown fence, preface or afterword: {\"sectionId\":string,\"status\":\"available\"|\"empty\",\"summary\"?:{\"text\":string,\"evidenceRefs\":string[]},\"candidates\":[{\"id\":string,\"title\":string,\"text\":string,\"epistemicStatus\":\"observed\"|\"inferred\"|\"speculative\",\"evidenceRefs\":string[],\"deepDiveQuestion\"?:string}],\"limitation\"?:string}",
    `Section analysis projection: ${JSON.stringify(projectSectionPackForPrompt(pack))}`,
  ].join("\n\n");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_PROMPT_TOO_LARGE");
  }
  return prompt;
};

export const materializeNgeeAnnSectionResult = <SectionId extends NgeeAnnSectionId>(input: {
  answer: string;
  pack: NgeeAnnSectionPack<SectionId>;
  identity: EnergyIqOverviewAiArtifactIdentity;
  runId: string;
}): NgeeAnnSectionInterpretationResult => {
  requirePackIdentity(input.pack, input.identity);
  const proposal = parseProposal(input.answer, input.pack.sectionId);
  const evidenceIds = new Set(input.pack.evidence.map(({ id }) => id));
  const packProjection = projectSectionPackForPrompt(input.pack);
  const narrativeAuthority = createNarrativeFactAuthority(
    packProjection,
    knownLevelCodesForPack(input.pack),
  );
  const dayTypeProfileMeans = dayTypeProfileMeansForPack(input.pack);

  if (proposal.status === "empty") {
    if (proposal.summary !== undefined || proposal.candidates.length !== 0) {
      throw new Error("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
    }
    return resultBase(input, "empty", [], [], 0);
  }

  const summary = parseSummary(
    proposal.summary,
    evidenceIds,
    narrativeAuthority,
    dayTypeProfileMeans,
  );
  if (!summary) throw new Error("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
  const accepted: NgeeAnnSectionInsight[] = [];
  const rejectedCandidateIds: string[] = [];
  const seenCandidateIds = new Set<string>();
  for (let index = 0; index < proposal.candidates.length; index += 1) {
    const candidate = proposal.candidates[index];
    const candidateId = isRecord(candidate) && nonEmptyString(candidate.id)
      ? candidate.id
      : `candidate:${index + 1}`;
    if (seenCandidateIds.has(candidateId)) {
      rejectedCandidateIds.push(candidateId);
      continue;
    }
    seenCandidateIds.add(candidateId);
    const insight = parseInsight(candidate, evidenceIds, narrativeAuthority, dayTypeProfileMeans);
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
    ...(nonEmptyString(proposal.limitation) && proposal.limitation.length <= 320
      ? { limitation: proposal.limitation }
      : {}),
  };
};

const resultBase = <SectionId extends NgeeAnnSectionId>(
  input: {
    pack: NgeeAnnSectionPack<SectionId>;
    identity: EnergyIqOverviewAiArtifactIdentity;
    runId: string;
  },
  status: "available" | "empty",
  insights: NgeeAnnSectionInsight[],
  rejectedCandidateIds: string[],
  discoveredCount: number,
  suppressedCandidateIds: string[] = [],
): NgeeAnnSectionInterpretationResult => ({
  artifactKind: "section-interpretation",
  status,
  providerProfileId: input.identity.modelProfileId,
  runId: input.runId,
  contract: {
    id: "energyiq-project-section-interpretation",
    revision: "energyiq-project-section-interpretation-v1",
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
    modelProfileId: input.identity.modelProfileId,
    modelProfileRevision: input.identity.modelProfileRevision,
  },
  sectionId: input.pack.sectionId,
  packRevision: "v2",
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
  sectionId: NgeeAnnSectionId,
): {
  status: "available" | "empty";
  summary?: unknown;
  candidates: unknown[];
  limitation?: unknown;
} => {
  if (answer.length === 0 || answer.length > MAX_ANSWER_CHARS || !answer.startsWith("{")) {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
  }
  const parsed = parseNgeeAnnProposalEnvelope(answer);
  if (!isRecord(parsed)
    || parsed.sectionId !== sectionId
    || (parsed.status !== "available" && parsed.status !== "empty")
    || !Array.isArray(parsed.candidates)) {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
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
  evidenceIds: Set<string>,
  narrativeAuthority: NarrativeFactAuthority,
  dayTypeProfileMeans: ReadonlyMap<NgeeAnnDayType, number>,
): NgeeAnnSectionSummary | null => {
  const text = isRecord(value) && typeof value.text === "string"
    ? normalizeNgeeAnnHourlyEnergyUnit(value.text)
    : value;
  if (!isRecord(value)
    || !boundedString(text, MAX_SUMMARY_CHARS)
    || !validEvidenceRefs(value.evidenceRefs, evidenceIds)) return null;
  if (narrativeFactsSupported(text, narrativeAuthority, dayTypeProfileMeans)) {
    return { text, evidenceRefs: [...value.evidenceRefs] };
  }
  const supportedText = [...new Intl.Segmenter("en", { granularity: "sentence" })
    .segment(text)]
    .map(({ segment }) => segment.trim())
    .filter((sentence) => sentence.length > 0
      && narrativeFactsSupported(sentence, narrativeAuthority, dayTypeProfileMeans))
    .join(" ");
  return supportedText.length > 0
    ? { text: supportedText, evidenceRefs: [...value.evidenceRefs] }
    : null;
};

const parseInsight = (
  value: unknown,
  evidenceIds: Set<string>,
  narrativeAuthority: NarrativeFactAuthority,
  dayTypeProfileMeans: ReadonlyMap<NgeeAnnDayType, number>,
): NgeeAnnSectionInsight | null => {
  if (!isRecord(value)) return null;
  const title = typeof value.title === "string"
    ? normalizeNgeeAnnHourlyEnergyUnit(value.title)
    : value.title;
  const text = typeof value.text === "string"
    ? normalizeNgeeAnnHourlyEnergyUnit(value.text)
    : value.text;
  const deepDiveQuestion = typeof value.deepDiveQuestion === "string"
    ? normalizeNgeeAnnHourlyEnergyUnit(value.deepDiveQuestion)
    : value.deepDiveQuestion;
  if (Object.keys(value).some((key) => ![
      "id", "title", "text", "epistemicStatus", "evidenceRefs", "deepDiveQuestion",
    ].includes(key))
    || !nonEmptyString(value.id)
    || !boundedString(title, MAX_TITLE_CHARS)
    || !boundedString(text, MAX_TEXT_CHARS)
    || (value.epistemicStatus !== "observed"
      && value.epistemicStatus !== "inferred"
      && value.epistemicStatus !== "speculative")
    || !validEvidenceRefs(value.evidenceRefs, evidenceIds)
    || (deepDiveQuestion !== undefined
      && !boundedString(deepDiveQuestion, MAX_DEEP_DIVE_CHARS))) return null;
  const narrative = [title, text, deepDiveQuestion ?? ""].join(" ");
  if (!narrativeFactsSupported(narrative, narrativeAuthority, dayTypeProfileMeans)) return null;
  return {
    id: value.id,
    title,
    text,
    epistemicStatus: lowerSectionEpistemicStatus(value.epistemicStatus, `${title} ${text}`),
    evidenceRefs: [...value.evidenceRefs],
    ...(typeof deepDiveQuestion === "string"
      ? { deepDiveQuestion }
      : {}),
  };
};

const normalizeNgeeAnnHourlyEnergyUnit = (value: string): string => value
  .replace(/\bkWh\s*\/\s*(?:h|hour)\b/giu, "kWh per hourly bucket");

const lowerSectionEpistemicStatus = (
  proposed: NgeeAnnSectionInsight["epistemicStatus"],
  narrative: string,
): NgeeAnnSectionInsight["epistemicStatus"] => proposed === "observed"
  && /\b(?:may|might|could|likely|possibly|suggest(?:s|ing|ed)?|indicat(?:e|es|ing|ed)|points?\s+to|warrants?|investigat\w*|recommends?|reviews?|verif(?:y|ies)|focus(?:es|ed|ing)?|treat(?:s|ed|ing)?|opportunit\w*|should|would)\b/iu.test(narrative)
  ? "inferred"
  : proposed;

const validEvidenceRefs = (
  value: unknown,
  evidenceIds: Set<string>,
): value is string[] => Array.isArray(value)
  && value.length > 0
  && value.every((item) => nonEmptyString(item) && evidenceIds.has(item))
  && new Set(value).size === value.length;

type NumericFact = {
  value: number;
  path: string;
  context: string;
};

type NarrativeFactAuthority = {
  packText: string;
  numericFacts: NumericFact[];
  knownLevelCodes: ReadonlySet<string>;
};

const createNarrativeFactAuthority = (
  projection: Record<string, unknown>,
  knownLevelCodes: ReadonlySet<string>,
): NarrativeFactAuthority => ({
  packText: JSON.stringify(projection),
  numericFacts: collectNumericFacts(projection),
  knownLevelCodes,
});

const numbersSupported = (
  text: string,
  authority: NarrativeFactAuthority,
): boolean => [...text.matchAll(NUMBER_TOKEN)].every((match) => {
  const token = match[0];
  const clause = match.index === undefined ? "" : narrativeClauseAt(text, match.index);
  const matchingFacts = authority.numericFacts.filter((fact) =>
    numericValuesMatch(token, fact.value)
    || directionalMagnitudeMatches(token, fact.value, clause));
  return semanticNumberBindingSupported(text, match, matchingFacts);
});

const narrativeFactsSupported = (
  text: string,
  authority: NarrativeFactAuthority,
  dayTypeProfileMeans: ReadonlyMap<NgeeAnnDayType, number>,
): boolean =>
  numbersSupported(text, authority)
  && !/\b(?:year[- ]over[- ]year|yoy|last\s+year|previous\s+year)\b/iu.test(text)
  && levelEntitiesSupported(text, authority.knownLevelCodes)
  && [...text.matchAll(CLOCK_TIME_TOKEN)].every(([token]) => authority.packText.includes(token))
  && dayTypeRelationsSupported(text, dayTypeProfileMeans);

const knownLevelCodesForPack = (pack: NgeeAnnSectionPack): ReadonlySet<string> => {
  if (pack.sectionId !== "circuit-concentration") return new Set();
  return new Set((pack as NgeeAnnSectionPack<"circuit-concentration">).facts.levels.flatMap((level) => {
    const nameCode = /\b(?:level|lvl)\s+([0-9]+)\b/iu.exec(level.name)?.[1];
    const idCode = /^level-([0-9]+)$/iu.exec(level.nodeId)?.[1];
    return [nameCode, idCode].filter((value): value is string => value !== undefined);
  }));
};

const levelEntitiesSupported = (
  text: string,
  knownLevelCodes: ReadonlySet<string>,
): boolean => knownLevelCodes.size === 0
  || [...text.matchAll(/\b(?:level|lvl)\s+([0-9]+)\b/giu)]
    .every((match) => match[1] !== undefined && knownLevelCodes.has(match[1]));

const collectNumericFacts = (
  value: unknown,
  path: string[] = [],
  arrayItemContext = "",
): NumericFact[] => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return [{ value, path: path.join("."), context: `${path.join(" ")} ${arrayItemContext}`.toLowerCase() }];
  }
  if (typeof value === "string") {
    return [...value.matchAll(NUMBER_TOKEN)].flatMap(([token]) => {
      const numericValue = Number(token.replaceAll(",", ""));
      return Number.isFinite(numericValue)
        ? [{
            value: numericValue,
            path: path.join("."),
            context: `${path.join(" ")} ${arrayItemContext} ${value}`.toLowerCase(),
          }]
        : [];
    });
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectNumericFacts(
      item,
      [...path, `[${index}]`],
      isRecord(item) ? collectPrimitiveStrings(item).join(" ").toLowerCase() : arrayItemContext,
    ));
  }
  if (!isRecord(value)) return [];
  const localContext = Object.values(value)
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();
  return Object.entries(value).flatMap(([key, item]) => collectNumericFacts(
    item,
    [...path, key],
    [arrayItemContext, localContext].filter(Boolean).join(" "),
  ));
};

const collectPrimitiveStrings = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectPrimitiveStrings);
  if (!isRecord(value)) return [];
  return Object.values(value).flatMap(collectPrimitiveStrings);
};

const semanticNumberBindingSupported = (
  text: string,
  match: RegExpMatchArray,
  facts: NumericFact[],
): boolean => {
  const matchIndex = match.index;
  if (facts.length === 0 || matchIndex === undefined) return false;
  const tokenEnd = matchIndex + match[0].length;
  const rawClause = narrativeClauseAt(text, matchIndex);
  const clause = rawClause.toLowerCase();
  const unitTail = text.slice(tokenEnd, tokenEnd + 16).trimStart();
  const unit = unitTail.startsWith("%")
    ? "pct"
    : /^kwh\b/iu.test(unitTail)
      ? "kwh"
      : /^kw\b/iu.test(unitTail)
        ? "kw"
        : null;
  const entityRefs = [...rawClause.matchAll(/\b(level|circuit)\s+([a-z0-9_-]+)\b/giu)]
    .filter((entity) => isEntityCodeToken(entity[2]!))
    .map((entity) => `${entity[1]} ${entity[2]}`.toLowerCase());
  return facts.some((fact) => {
    const path = fact.path.toLowerCase();
    const context = fact.context;
    if (unit === "pct" && !/(?:pct|percent|ratio)$/u.test(path)) return false;
    if (unit === "kwh" && !/kwh$/u.test(path)) return false;
    if (unit === "kw" && (!/kw$/u.test(path) || /kwh$/u.test(path))) return false;
    if (entityRefs.length > 0 && !entityRefs.every((entity) => context.includes(entity))) return false;
    if (/\b(?:off[- ]?hours?|outside\s+(?:of\s+)?(?:normal\s+)?operating\s+hours?|non[- ]operating|standby)\b/iu.test(clause)
      && !/(?:offhours|nonoperating|standby)/u.test(`${path} ${context}`)) return false;
    if (unit === "pct"
      && /\b(?:of\s+(?:all\s+|total\s+)?(?:energy\s+)?usage|share\s+of|accounts?\s+for)\b/iu.test(clause)
      && !/(?:sharepct|ratiopct|percentage)/u.test(path)) return false;
    if (unit === "pct"
      && /\b(?:above|below|higher|lower|increase|decrease|change|difference|down|fell|fallen|reduced|declined|dropped)\b/iu.test(clause)
      && /\b(?:baseline|comparison|previous|prior)\b/iu.test(clause)
      && !/(?:relativepct|changepct|deltapct)/u.test(path)) return false;
    if (unit === "kwh"
      && numberDescribesBaseline(text, matchIndex, tokenEnd)
      && !/baselinekwh$/u.test(path)) return false;
    if (unit === "kw" && /\bpeak\b/iu.test(clause) && !/peakkw$/u.test(path)) return false;
    return true;
  });
};

const isEntityCodeToken = (value: string): boolean => /^[0-9]+$/u.test(value)
  || /^(?=[A-Za-z0-9_-]*[0-9])[A-Za-z0-9_-]+$/u.test(value)
  || /^[A-Z]{1,3}$/u.test(value);

const narrativeClauseAt = (text: string, index: number): string => {
  const boundaries = [...text.matchAll(/[,;?!]|(?<!\d)\.(?!\d)/gu)]
    .flatMap((match) => match.index === undefined ? [] : [match.index]);
  const start = Math.max(-1, ...boundaries.filter((boundary) => boundary < index)) + 1;
  const following = boundaries.filter((boundary) => boundary >= index);
  const end = following.length > 0 ? Math.min(...following) : text.length;
  return text.slice(start, end);
};

const numberDescribesBaseline = (text: string, start: number, end: number): boolean => {
  const before = text.slice(Math.max(0, start - 28), start);
  const after = text.slice(end, Math.min(text.length, end + 24));
  return /\bbaseline(?:\s+(?:was|is|of|at))?\s*$/iu.test(before)
    || /^\s*(?:kwh|kw|%)?\s*(?:as\s+the\s+)?baseline\b/iu.test(after);
};

type NgeeAnnDayType = "weekday" | "weekend" | "public_holiday";

const DAY_TYPE_RANKING = /\b(weekday|weekend|public\s+holiday)(?:\s+(?:usage|profile))?\s+(?:is|was|remains?)\s+(?:the\s+)?(highest|lowest)\b/giu;
const DAY_TYPE_DIRECT_COMPARISON = /\b(weekday|weekend|public\s+holiday)(?:\s+(?:usage|profile|demand|load))?\s+(?:(?:is|was|remains?|sits?|runs?|appears?|stays?)\s+)?(?:(?:materially|slightly|clearly|well)\s+)?(above|below|higher\s+than|lower\s+than)\s+(?:the\s+)?(weekday|weekend|public\s+holiday)\b/giu;
const DAY_TYPE_CONTRAST_COMPARISON = /\b(weekday|weekend|public\s+holiday)\b(?:(?![.!?]).){0,160}\b(?:and|while|whereas|with)\s+(?:the\s+)?(weekday|weekend|public\s+holiday)(?:\s+(?:usage|profile|demand|load))?\s+(?:(?:shows?|has|is|was|remains?)\s+)?(?:a\s+)?similar\s+but\s+(?:(?:materially|slightly|clearly)\s+)?(higher|lower)\b/giu;

const dayTypeProfileMeansForPack = (
  pack: NgeeAnnSectionPack,
): ReadonlyMap<NgeeAnnDayType, number> => {
  if (pack.sectionId !== "time-behaviour") return new Map();
  const timePack = pack as NgeeAnnSectionPack<"time-behaviour">;
  return new Map(timePack.facts.timeBehaviour?.dayProfiles.flatMap((profile) => {
    if (profile.status !== "available"
      || profile.scopeId !== pack.binding.scopeId
      || profile.values.length === 0) return [];
    return [[profile.dayType, profile.values.reduce((sum, value) => sum + value.usageKwh, 0)
      / profile.values.length] as const];
  }) ?? []);
};

const dayTypeRelationsSupported = (
  text: string,
  means: ReadonlyMap<NgeeAnnDayType, number>,
): boolean => [...text.matchAll(DAY_TYPE_RANKING)].every((match) => {
  const dayType = match[1]?.toLowerCase().replaceAll(" ", "_") as NgeeAnnDayType | undefined;
  const direction = match[2]?.toLowerCase();
  const value = dayType ? means.get(dayType) : undefined;
  const values = [...means.values()];
  if (value === undefined || values.length < 2) return false;
  return direction === "highest"
    ? value >= Math.max(...values) - Number.EPSILON
    : value <= Math.min(...values) + Number.EPSILON;
}) && [...text.matchAll(DAY_TYPE_DIRECT_COMPARISON)].every((match) =>
  dayTypeComparisonSupported(means, match[1], match[3], match[2]))
  && [...text.matchAll(DAY_TYPE_CONTRAST_COMPARISON)].every((match) =>
    dayTypeComparisonSupported(means, match[2], match[1], match[3]));

const dayTypeComparisonSupported = (
  means: ReadonlyMap<NgeeAnnDayType, number>,
  leftLabel: string | undefined,
  rightLabel: string | undefined,
  directionLabel: string | undefined,
): boolean => {
  const leftDayType = normalizeDayType(leftLabel);
  const rightDayType = normalizeDayType(rightLabel);
  if (!leftDayType || !rightDayType || leftDayType === rightDayType) return false;
  const left = means.get(leftDayType);
  const right = means.get(rightDayType);
  if (left === undefined || right === undefined) return false;
  const direction = directionLabel?.toLowerCase();
  return direction?.startsWith("above") === true || direction?.startsWith("higher") === true
    ? left > right + Number.EPSILON
    : direction?.startsWith("below") === true || direction?.startsWith("lower") === true
      ? left < right - Number.EPSILON
      : false;
};

const normalizeDayType = (value: string | undefined): NgeeAnnDayType | undefined => {
  const normalized = value?.toLowerCase().replaceAll(" ", "_");
  return normalized === "weekday" || normalized === "weekend" || normalized === "public_holiday"
    ? normalized
    : undefined;
};

const numericValuesMatch = (token: string, sourceValue: number): boolean => {
  const normalized = token.replaceAll(",", "");
  const reportedValue = Number(normalized);
  if (!Number.isFinite(reportedValue)) return false;
  const precision = normalized.split(".")[1]?.length ?? 0;
  const tolerance = 0.5 * (10 ** -precision);
  const floatingPointSlack = Number.EPSILON * Math.max(1, Math.abs(reportedValue)) * 4;
  return Math.abs(sourceValue - reportedValue) <= tolerance + floatingPointSlack;
};

const directionalMagnitudeMatches = (
  token: string,
  sourceValue: number,
  clause: string,
): boolean => sourceValue < 0
  && !token.startsWith("-")
  && /\b(?:down|fell|fallen|decreased|reduced|declined|dropped|lower|below)\b/iu.test(clause)
  && numericValuesMatch(token, Math.abs(sourceValue));

const projectSectionPackForPrompt = (pack: NgeeAnnSectionPack): Record<string, unknown> => {
  const { analysisPeriod: _analysisPeriod, ...bindingWithoutUtcPeriod } = pack.binding;
  const common = {
    contract: pack.contract,
    sectionId: pack.sectionId,
    audience: pack.audience,
    analysisGoal: pack.analysisGoal,
    binding: bindingWithoutUtcPeriod,
    reportTime: pack.reportTime,
    evidence: pack.evidence.map(({ id, metricId }) => ({ id, metricId })),
    dataQuality: pack.dataQuality,
    limitations: pack.limitations,
    missingEvidence: pack.missingEvidence,
    capabilities: pack.capabilities,
  };
  if (pack.sectionId === "trend-and-demand") {
    const facts = (pack as NgeeAnnSectionPack<"trend-and-demand">).facts;
    return {
      ...common,
      projection: {
        revision: "ngee-ann-section-prompt-projection-v3",
        rowPolicy: "all-section-rows",
        omittedRepeatedFields: ["baselineSamples", "hourlyComparison", "detailSeries"],
        projectedRowCount: facts.dailyUsageAnomalies?.status === "available"
          ? facts.dailyUsageAnomalies.scopes.reduce((sum, scope) => sum + scope.rows.length, 0)
          : 0,
      },
      facts: {
        summary: projectSummary(facts.summary, pack.reportTime.timezone),
        comparison: projectComparison(facts.comparison, pack.reportTime.timezone),
        dailyTotals: facts.dailyTotals,
        dailyUsageAnomalies: projectDailyUsageAnomalies(facts.dailyUsageAnomalies),
        peakBreakdown: projectPeakBreakdown(facts.peakBreakdown, pack.reportTime.timezone),
      },
    };
  }
  if (pack.sectionId === "time-behaviour") {
    const facts = (pack as NgeeAnnSectionPack<"time-behaviour">).facts;
    const projectedRowCount = facts.timeBehaviour?.scopes
      .reduce((sum, scope) => sum + scope.cells.length, 0) ?? 0;
    return {
      ...common,
      projection: {
        revision: "ngee-ann-section-prompt-projection-v3",
        rowPolicy: "all-section-rows",
        projectedRowCount,
        valueSemantics: {
          cellUsageKwh: "energy in one local-date/hour bucket, expressed in kWh; never label it kWh/h",
          dayProfileUsageKwh: "mean energy per complete classified day for that local-hour bucket, expressed in kWh",
          componentProfileUsageKwh: "mean component energy per complete classified day for that local-hour bucket, expressed in kWh",
          publicHoliday: "unavailable unless the supplied profile status is available; do not infer public-holiday behaviour",
        },
      },
      facts: {
        timeBehaviour: projectTimeBehaviour(facts.timeBehaviour),
        componentHourlyProfiles: projectComponentHourlyProfiles(facts.componentHourlyProfiles),
        offHours: facts.offHours,
      },
    };
  }
  if (pack.sectionId === "school-holiday-comparison") {
    const facts = (pack as NgeeAnnSectionPack<"school-holiday-comparison">).facts;
    return {
      ...common,
      projection: {
        revision: "ngee-ann-section-prompt-projection-v4",
        rowPolicy: "authoritative-cohorts-and-bounded-anomalies",
        anomalyRowLimit: MAX_SCHOOL_HOLIDAY_PROMPT_ANOMALIES,
        omittedRepeatedFields: ["actualRefs", "baselineRefs", "baselineDates"],
      },
      facts: {
        schoolHolidayComparison: projectSchoolHolidayComparison(
          facts.schoolHolidayComparison,
        ),
      },
    };
  }
  return {
    ...common,
    projection: {
      revision: "ngee-ann-section-prompt-projection-v3",
      rowPolicy: "all-section-rows",
    },
    facts: pack.sectionId === "circuit-concentration"
      ? {
          ...pack.facts,
          peakBreakdown: projectPeakBreakdown(
            (pack as NgeeAnnSectionPack<"circuit-concentration">).facts.peakBreakdown,
            pack.reportTime.timezone,
          ),
        }
      : pack.facts,
  };
};

const projectSchoolHolidayComparison = (
  comparison: NgeeAnnSectionPack<"school-holiday-comparison">["facts"]["schoolHolidayComparison"],
): Record<string, unknown> | undefined => {
  if (!comparison || comparison.status === "unavailable") return comparison;
  const comparisons = comparison.comparisons.map((cohort) => {
    if (cohort.status === "unavailable") return cohort;
    const { actualRefs: _actualRefs, baselineRefs: _baselineRefs, ...evidence } = cohort.evidence;
    return { ...cohort, evidence };
  });
  const topAnomalies = [...comparison.anomalies]
    .sort((left, right) => (
      Math.abs(right.deltaKwh) - Math.abs(left.deltaKwh)
      || left.localDate.localeCompare(right.localDate)
    ))
    .slice(0, MAX_SCHOOL_HOLIDAY_PROMPT_ANOMALIES)
    .map((anomaly) => {
      const { baselineDates: _baselineDates, evidence: rawEvidence, ...projected } = anomaly;
      const { actualRefs: _actualRefs, baselineRefs: _baselineRefs, ...evidence } = rawEvidence;
      return { ...projected, evidence };
    });
  const { anomalies: _anomalies, ...authoritativeComparison } = comparison;
  return {
    ...authoritativeComparison,
    comparisons,
    anomalyCount: comparison.anomalies.length,
    topAnomalies,
  };
};

const parseNgeeAnnProposalEnvelope = (answer: string): unknown => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer) as unknown;
  } catch {
    try {
      parsed = JSON.parse(`${answer}}`) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(parsed) || Array.isArray(parsed.candidates) || !isRecord(parsed.summary)) {
    return parsed;
  }
  const summary = parsed.summary;
  if (!Array.isArray(summary.candidates)
    || Object.keys(parsed).some((key) => !["sectionId", "status", "summary"].includes(key))
    || Object.keys(summary).some((key) => ![
      "text", "evidenceRefs", "candidates", "limitation",
    ].includes(key))) return parsed;
  return {
    sectionId: parsed.sectionId,
    status: parsed.status,
    summary: {
      text: summary.text,
      evidenceRefs: summary.evidenceRefs,
    },
    candidates: summary.candidates,
    ...(summary.limitation !== undefined ? { limitation: summary.limitation } : {}),
  };
};

const projectSummary = (
  value: NgeeAnnSectionPack<"trend-and-demand">["facts"]["summary"],
  timezone: string,
): Record<string, unknown> => {
  const { peakAt, ...withoutUtcPeak } = value;
  return {
    ...withoutUtcPeak,
    ...(peakAt ? { peakAtLocal: localDateTime(peakAt, timezone) } : {}),
  };
};

const projectComparison = (
  value: NgeeAnnSectionPack<"trend-and-demand">["facts"]["comparison"],
  timezone: string,
): Record<string, unknown> => {
  const { from, to, ...withoutUtcPeriod } = value;
  return {
    ...withoutUtcPeriod,
    fromLocalDate: localDate(from, timezone),
    toExclusiveLocalDate: localDate(to, timezone),
  };
};

const projectPeakBreakdown = (
  value: NgeeAnnSectionPack<"trend-and-demand">["facts"]["peakBreakdown"],
  timezone: string,
): unknown => {
  if (!value || value.status !== "available") return value;
  return {
    ...value,
    peak: {
      ...value.peak,
      fromLocal: localDateTime(value.peak.from, timezone),
      toLocal: localDateTime(value.peak.to, timezone),
      from: undefined,
      to: undefined,
    },
  };
};

const localDate = (value: string, timezone: string): string => localDateTime(value, timezone).slice(0, 10);

const localDateTime = (value: string, timezone: string): string => {
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
  const result = `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u.test(result)) {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_REPORT_TIME_INVALID");
  }
  return result;
};

const projectDailyUsageAnomalies = (
  value: NgeeAnnSectionPack<"trend-and-demand">["facts"]["dailyUsageAnomalies"],
): unknown => {
  if (!value || value.status !== "available") return value;
  return {
    ...value,
    rowFieldOrder: [
      "anomalyId", "incidentId", "localDate", "dayType", "baselineDates", "baselineSampleCount",
      "actualKwh", "baselineKwh", "impactKwh", "relativePct", "coveragePct",
      "expectedMeterIntervalCount", "validIntervalCount", "qualityEventCount", "outcome",
      "suppressionCode",
    ],
    scopes: value.scopes.map((scope) => ({
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      rollingComparisons: scope.rollingComparisons,
      rows: scope.rows.map((row) => [
        row.anomalyId,
        row.incidentId,
        row.localDate,
        row.dayType,
        row.baselineDates,
        row.baselineSampleCount,
        row.actualKwh,
        row.baselineKwh,
        row.impactKwh,
        row.relativePct,
        row.coveragePct,
        row.expectedMeterIntervalCount,
        row.validIntervalCount,
        row.qualityEventCount,
        row.outcome,
        row.suppressionReason?.code ?? null,
      ]),
    })),
  };
};

const projectTimeBehaviour = (
  value: NgeeAnnSectionPack<"time-behaviour">["facts"]["timeBehaviour"],
): unknown => {
  if (!value) return value;
  return {
    metricId: value.metricId,
    grain: value.grain,
    unit: value.unit,
    timezone: value.timezone,
    queryId: value.queryId,
    cellFieldOrder: [
      "localDate", "localHourLocal", "usageKwh", "coveragePct",
      "expectedMeterIntervalCount", "validIntervalCount", "qualityEventCount",
    ],
    scopes: value.scopes.map((scope) => ({
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      cells: scope.cells.map((cell) => [
        cell.localDate,
        localHourLabel(cell.localHour),
        cell.usageKwh,
        cell.dataHealth.coveragePct,
        cell.dataHealth.expectedMeterIntervalCount,
        cell.dataHealth.validIntervalCount,
        cell.dataHealth.qualityEventCount,
      ]),
    })),
    dayProfiles: value.dayProfiles.map((profile) => profile.status === "available"
      ? {
          dayType: profile.dayType,
          scopeId: profile.scopeId,
          scopeName: profile.scopeName,
          status: profile.status,
          sampleDayCount: profile.sampleDayCount,
          valueFieldOrder: ["localHourLocal", "usageKwh"],
          values: profile.values.map(({ localHour, usageKwh }) => [localHourLabel(localHour), usageKwh]),
        }
      : profile),
  };
};

const projectComponentHourlyProfiles = (
  value: NgeeAnnSectionPack<"time-behaviour">["facts"]["componentHourlyProfiles"],
): unknown => {
  if (!value) return value;
  return {
    metricId: value.metricId,
    queryId: value.queryId,
    accountingBasis: value.accountingBasis,
    grain: value.grain,
    unit: value.unit,
    timezone: value.timezone,
    valueFieldOrder: ["localHourLocal", "usageKwh"],
    scopes: value.scopes.map((scope) => ({
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
      profiles: scope.profiles.map((profile) => profile.status === "available"
        ? {
            dayType: profile.dayType,
            status: profile.status,
            sampleDayCount: profile.sampleDayCount,
            categories: profile.categories.map((category) => ({
              category: category.category,
              values: category.values.map(({ localHour, usageKwh }) => [localHourLabel(localHour), usageKwh]),
            })),
            circuits: profile.circuits.map((circuit) => ({
              meterNodeId: circuit.meterNodeId,
              name: circuit.name,
              category: circuit.category,
              values: circuit.values.map(({ localHour, usageKwh }) => [localHourLabel(localHour), usageKwh]),
            })),
          }
        : profile),
    })),
  };
};

const localHourLabel = (localHour: number): string => {
  if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_REPORT_TIME_INVALID");
  }
  return `${String(localHour).padStart(2, "0")}:00`;
};

const requirePackIdentity = (
  pack: NgeeAnnSectionPack,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  const expectedPromptRevision = "energyiq-project-section-discovery-v8";
  if (identity.identityContractRevision !== "ngee-ann-section-v16"
    || identity.targetId !== pack.sectionId
    || identity.workspaceId !== pack.binding.workspaceId
    || identity.projectId !== pack.binding.projectId
    || identity.scopeId !== pack.binding.scopeId
    || identity.dataSnapshotId !== pack.binding.dataSnapshotId
    || identity.projectReleaseId !== pack.binding.projectReleaseId
    || identity.analysisPeriodFrom !== pack.binding.analysisPeriod.from
    || identity.analysisPeriodTo !== pack.binding.analysisPeriod.to
    || identity.investigatorPromptRevision !== expectedPromptRevision
    || identity.validatorRevision !== "energyiq-project-section-acceptance-v14"
    || identity.analysisPackRevision !== "v2") {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_PACK_IDENTITY_MISMATCH");
  }
};

const boundedString = (value: unknown, maxLength: number): value is string =>
  nonEmptyString(value) && value.length <= maxLength;

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sectionErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toUpperCase().replace(/[^A-Z0-9_]+/gu, "_");
  return normalized.slice(0, 160) || "ENERGYIQ_NGEE_ANN_SECTION_INTERPRETER_FAILED";
};

const mapWithConcurrency = async <Item>(
  items: readonly Item[],
  limit: number,
  task: (item: Item) => Promise<void>,
): Promise<void> => {
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await task(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
};
