import type {
  AnalysisContextEvidenceCatalog,
  AnalysisContextEvidenceFact,
} from "@datafoundry/agent-runtime";
import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { createHash, randomUUID } from "node:crypto";

import {
  createPreschoolOverviewAiExecutiveArtifactIdentityV4,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
  createPreschoolOverviewAiValueArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
} from "./overview-ai-artifact.js";
import {
  PRESCHOOL_SECTION_IDS,
  isPreschoolSectionId,
  preschoolOverviewAiBindingFromIdentity,
  type PreschoolExecutiveKeyFinding,
  type PreschoolExecutiveOverviewEvidenceLineage,
  type PreschoolExecutiveSynthesisResultV4,
  type PreschoolExecutiveSynthesisResult,
  type PreschoolOverviewAiBinding,
  type PreschoolOverviewKeyFinding,
  type PreschoolSectionId,
  type PreschoolSectionInterpretationResultV3,
  type PreschoolSectionInterpretationResultV4,
} from "./preschool-overview-ai-contracts.js";
import {
  PRESCHOOL_EXECUTIVE_FINDING_TEXT_MAX_CHARS,
  PRESCHOOL_EXECUTIVE_FINDING_TITLE_MAX_CHARS,
  PRESCHOOL_EXECUTIVE_SUMMARY_MAX_CHARS,
  PRESCHOOL_EXECUTIVE_SUMMARY_TARGET_CHARS,
  resolveOverviewAiStageStructuredOutputV4,
} from "./preschool-overview-ai-structured-output.js";
import { decisionBriefCopyGuidance } from "./energyiq-decision-brief-copy-profile.js";

const LEASE_MS = 3 * 60 * 1_000;
export const MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS = 64_000;
const BANNED_INTERNAL_TEXT = /\b(?:parent_node_id|dataSnapshotId|projectReleaseId|SQL)\b/i;
const SQL_STATEMENT = /\bSELECT\b[\s\S]{0,500}\b(?:FROM|JOIN)\b/i;
const NUMBER_TOKEN = /(?<![A-Za-z0-9_-])-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;

export type PreschoolExecutiveSynthesisRunner = (input: {
  prompt: string;
  identity: EnergyIqOverviewAiArtifactIdentity;
  user: UserRecord;
  workspaceId: string;
  runId: string;
  sessionId: string;
  structuredOutput?: NonNullable<ReturnType<typeof resolveOverviewAiStageStructuredOutputV4>>;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export type PreschoolExecutiveSynthesizer = {
  execute(input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
    retry: boolean;
    authoritativeOverviewEvidence?: PreschoolAuthoritativeOverviewEvidence;
  }): Promise<EnergyIqOverviewAiArtifactRecord>;
};

type AcceptedSection = {
  artifactId: string;
  result: PreschoolSectionInterpretationResultV3 & { status: "available" };
};

type AcceptedSectionV4 = {
  artifactId: string;
  result: PreschoolSectionInterpretationResultV4 & { status: "available" };
};

export type PreschoolAuthoritativeOverviewEvidence = {
  binding: PreschoolOverviewAiBinding;
  catalog: AnalysisContextEvidenceCatalog;
};

export const createPreschoolExecutiveSynthesizer = (input: {
  metadataStore: MetadataStore;
  runSynthesis: PreschoolExecutiveSynthesisRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
  revision?: "v3" | "v4";
  authoritativeOverviewEvidence?: PreschoolAuthoritativeOverviewEvidence;
}): PreschoolExecutiveSynthesizer => {
  if (input.revision === "v4") return createPreschoolExecutiveSynthesizerV4(input);
  return ({
  async execute({ baseIdentity, user, retry }) {
    const store = input.metadataStore.energyIq.overviewAiArtifacts;
    const accepted = acceptedSections(store, baseIdentity);
    const identity = createPreschoolOverviewAiValueArtifactIdentity({
      baseIdentity,
      artifactKind: "executive-synthesis",
      targetId: preschoolExecutiveSynthesisTargetId(accepted.map(({ artifactId }) => artifactId)),
    });
    const current = store.find(identity) ?? store.queue({ identity, triggeredBy: user.id });
    if (current.status === "available") return current;
    if (current.status === "running" && !retry) return current;
    if (current.status === "failed" && !retry) return current;

    const workerId = `executive-synthesis:${randomUUID()}`;
    const claim = store.claim({ identity, workerId, leaseMs: LEASE_MS });
    if (!claim.claimed) return claim.artifact;
    const sessionId = `preschool-executive-synthesis-${randomUUID()}`;
    const runId = `preschool-executive-synthesis-${randomUUID()}`;

    try {
      if (accepted.length === 0) {
        input.assertRuntimeIdentity?.(identity);
        return store.complete({
          identity,
          workerId,
          sessionId,
          runId,
          resultJson: JSON.stringify(emptyResult(identity, runId)),
        });
      }
      const prompt = buildExecutivePrompt(accepted);
      const response = await input.runSynthesis({
        prompt,
        identity,
        user,
        workspaceId: identity.workspaceId,
        runId,
        sessionId,
      });
      if (response.runId !== runId || response.sessionId !== sessionId) {
        throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_RUN_IDENTITY_MISMATCH");
      }
      const result = materializeExecutiveResult({
        answer: response.answer,
        accepted,
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
        return store.fail({
          identity,
          workerId,
          errorCode: synthesisErrorCode(error),
        });
      } catch {
        return store.get(identity);
      }
    }
  },
  });
};

const createPreschoolExecutiveSynthesizerV4 = (input: {
  metadataStore: MetadataStore;
  runSynthesis: PreschoolExecutiveSynthesisRunner;
  assertRuntimeIdentity?: (identity: EnergyIqOverviewAiArtifactIdentity) => void;
  authoritativeOverviewEvidence?: PreschoolAuthoritativeOverviewEvidence;
}): PreschoolExecutiveSynthesizer => ({
  async execute({ baseIdentity, user, retry, authoritativeOverviewEvidence: executionOverviewEvidence }) {
    const store = input.metadataStore.energyIq.overviewAiArtifacts;
    const accepted = acceptedSectionsV4(store, baseIdentity);
    const identity = createPreschoolOverviewAiExecutiveArtifactIdentityV4({
      baseIdentity,
      targetId: preschoolExecutiveSynthesisTargetId(accepted.map(({ artifactId }) => artifactId)),
    });
    const current = store.find(identity) ?? store.queue({ identity, triggeredBy: user.id });
    if (current.status === "available") return current;
    if (current.status === "running" && !retry) return current;
    if (current.status === "failed" && !retry) return current;

    const workerId = `executive-synthesis-v4:${randomUUID()}`;
    const claim = store.claim({ identity, workerId, leaseMs: LEASE_MS });
    if (!claim.claimed) return claim.artifact;
    const sessionId = `preschool-executive-synthesis-v4-${randomUUID()}`;
    const runId = `preschool-executive-synthesis-v4-${randomUUID()}`;

    try {
      if (accepted.length < 2) {
        input.assertRuntimeIdentity?.(identity);
        return store.complete({
          identity,
          workerId,
          sessionId,
          runId,
          resultJson: JSON.stringify(emptyResultV4(identity, runId)),
        });
      }
      const suppliedOverviewEvidence = executionOverviewEvidence ?? input.authoritativeOverviewEvidence;
      const authoritativeOverviewEvidence = suppliedOverviewEvidence
        ? requireAuthoritativeOverviewEvidence(suppliedOverviewEvidence, identity)
        : undefined;
      const response = await input.runSynthesis({
        prompt: buildExecutivePromptV4(accepted, authoritativeOverviewEvidence),
        identity,
        user,
        workspaceId: identity.workspaceId,
        runId,
        sessionId,
        structuredOutput: resolveOverviewAiStageStructuredOutputV4("executive-synthesis")!,
      });
      if (response.runId !== runId || response.sessionId !== sessionId) {
        throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_RUN_IDENTITY_MISMATCH");
      }
      const result = materializeExecutiveResultV4({
        answer: response.answer,
        accepted,
        identity,
        runId,
        ...(authoritativeOverviewEvidence
          ? { authoritativeOverviewEvidence }
          : {}),
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
        return store.fail({ identity, workerId, errorCode: synthesisErrorCode(error) });
      } catch {
        return store.get(identity);
      }
    }
  },
});

export const preschoolExecutiveSynthesisTargetId = (sourceSectionArtifactIds: string[]): string => {
  if (sourceSectionArtifactIds.length === 0) return "sections:none";
  const digest = createHash("sha256")
    .update([...sourceSectionArtifactIds].sort().join("\n"))
    .digest("hex");
  return `sections:${digest}`;
};

const acceptedSections = (
  store: MetadataStore["energyIq"]["overviewAiArtifacts"],
  baseIdentity: OverviewAiArtifactIdentityV13,
): AcceptedSection[] => PRESCHOOL_SECTION_IDS.flatMap((sectionId) => {
  const identity = createPreschoolOverviewAiValueArtifactIdentity({
    baseIdentity,
    artifactKind: "section-interpretation",
    targetId: sectionId,
  });
  const artifact = store.find(identity);
  if (!artifact || artifact.status !== "available" || !artifact.result_json) return [];
  const result = parseAcceptedSection(artifact.result_json, identity);
  return result?.status === "available"
    ? [{ artifactId: artifact.id, result: result as PreschoolSectionInterpretationResultV3 & { status: "available" } }]
    : [];
});

const acceptedSectionsV4 = (
  store: MetadataStore["energyIq"]["overviewAiArtifacts"],
  baseIdentity: OverviewAiArtifactIdentityV13,
): AcceptedSectionV4[] => PRESCHOOL_SECTION_IDS.flatMap((sectionId) => {
  const identity = createPreschoolOverviewAiSectionArtifactIdentityV4({ baseIdentity, targetId: sectionId });
  const artifact = store.find(identity);
  if (!artifact || artifact.status !== "available" || !artifact.result_json) return [];
  const result = parseAcceptedSectionV4(artifact.result_json, identity);
  return result?.status === "available" ? [{ artifactId: artifact.id, result }] : [];
});

const parseAcceptedSectionV4 = (
  resultJson: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): (PreschoolSectionInterpretationResultV4 & { status: "available" }) | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)
    || parsed.artifactKind !== "section-interpretation"
    || parsed.status !== "available"
    || parsed.sectionId !== identity.targetId
    || !isRecord(parsed.contract)
    || parsed.contract.revision !== "preschool-section-interpretation-v4"
    || parsed.contract.revision !== identity.outputContractRevision
    || parsed.packRevision !== "v2"
    || !sameBinding(parsed.binding, identity)
    || !isRecord(parsed.summary)
    || !cleanText(parsed.summary.text)
    || !stringArray(parsed.summary.evidenceRefs)
    || !Array.isArray(parsed.insights)
    || !parsed.insights.every(validSectionInsightV4)) return null;
  return parsed as unknown as PreschoolSectionInterpretationResultV4 & { status: "available" };
};

const parseAcceptedSection = (
  resultJson: string,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolSectionInterpretationResultV3 | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)
    || parsed.artifactKind !== "section-interpretation"
    || (parsed.status !== "available" && parsed.status !== "empty")
    || parsed.sectionId !== identity.targetId
    || !isRecord(parsed.binding)
    || parsed.binding.dataSnapshotId !== identity.dataSnapshotId
    || parsed.binding.projectReleaseId !== identity.projectReleaseId
    || !Array.isArray(parsed.keyPoints)) return null;
  return parsed as unknown as PreschoolSectionInterpretationResultV3;
};

const buildExecutivePrompt = (accepted: AcceptedSection[]): string => {
  const prompt = [
    "You are the Preschool Overview Executive Key Findings synthesizer, not an investigator.",
    "Use only the accepted Section Interpretations below. Do not read raw Facts, query SQL, add a number, or add a fact.",
    "Combine duplicate management messages instead of copying each Section verbatim.",
    "Return 0-4 concise plain-English findings for a non-technical manager.",
    "Each takeaway may use limited inline Markdown only: **bold** for the few words carrying the decision, and _italics_ for a caveat. Keep most text unformatted. Do not use headings, lists, links, images, code, HTML, or Markdown tables.",
    "Each finding must cite one or more source sectionIds and exact evidenceRefs already present in those Sections.",
    "Return JSON only: {\"status\":\"available\"|\"empty\",\"keyFindings\":[{\"takeaway\":string,\"sectionIds\":string[],\"evidenceRefs\":string[]}]}",
    `Binding: ${JSON.stringify(accepted[0]!.result.binding)}`,
    `Accepted Sections: ${JSON.stringify(accepted.map(({ result }) => ({
      sectionId: result.sectionId,
      summary: result.summary,
      keyPoints: result.keyPoints,
      ...(result.limitation ? { limitation: result.limitation } : {}),
    })))}`,
  ].join("\n\n");
  if (prompt.length > MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_PROMPT_TOO_LARGE");
  return prompt;
};

const buildExecutivePromptV4 = (
  accepted: AcceptedSectionV4[],
  authoritativeOverviewEvidence?: PreschoolAuthoritativeOverviewEvidence,
): string => {
  const prompt = [
    "You are the Preschool Overview Key Findings synthesizer, not a new investigator.",
    "Use only the accepted current-v4 Section summaries and insights below, plus any explicitly supplied authoritative Overview Evidence.",
    "Select the few cross-Section themes that matter most. Do not mechanically rewrite every Section or invent a cause, number, date, entity relationship, or action.",
    "Before using an absolute cohort claim such as 'none of these Centres', check every named Centre against every cited Section. If even one named Centre belongs to the stated cohort, do not publish the absolute claim; preserve a different supported angle instead.",
    "Key Findings are cross-Section synthesis: every published Finding must cite and be supported by at least two accepted Sections. A one-Section restatement belongs only in that Section and must not be published here.",
    "Preserve source epistemic status: an inferred or speculative Section Insight may support only explicitly qualified Key Findings. Never upgrade a signal, relationship, hypothesis, or possibility into a confirmed fact.",
    "Qualify the Summary sentence, Finding title, and every Finding sentence independently. A cautious word in the body never makes an unqualified headline safe.",
    "A Section screening priority does not mean that Centre dominates total energy. Do not use 'dominated', 'proves', or 'confirms' unless that exact relationship is explicit in the cited source narrative.",
    "Different named circuits may form a management theme, but they do not prove shared equipment or a shared cause; keep that connection explicitly possible or separate.",
    ...decisionBriefCopyGuidance("Finding"),
    "Default to one cross-Section Finding; add a second only when it changes the manager's decision or next check. A third should be rare. A high-priority alert is optional and must be supported by the supplied Evidence.",
    `Target at most ${PRESCHOOL_EXECUTIVE_SUMMARY_TARGET_CHARS} characters for the Summary, 8-14 words for a Finding title, and 35 words for Finding text. Technical safety ceilings are ${PRESCHOOL_EXECUTIVE_SUMMARY_MAX_CHARS} Summary characters, ${PRESCHOOL_EXECUTIVE_FINDING_TITLE_MAX_CHARS} title characters, and ${PRESCHOOL_EXECUTIVE_FINDING_TEXT_MAX_CHARS} Finding-text characters. Editorial targets never cause Runtime rejection.`,
    "In customer-facing narrative, say 'all Centres' instead of 'Portfolio'. Internal Evidence labels may still use portfolio.",
    "Narrative text may use only limited inline **bold** and _italics_; do not return headings, links, images, HTML, code, tables, or custom styling.",
    "Every summary and finding must cite exact evidenceRefs. Every finding must declare the exact contributing sectionIds.",
    "Compact projections are lossless: resolve evidenceRefIndexes through evidenceRefs, and read Overview fact rows using their declared dictionaries and columns. Every accepted Insight and Overview fact is present. For an Overview fact, cite its fact-row id as the evidenceRef; its evidence set is provenance only.",
    "sourceArtifactId and encoding indexes are provenance only; never repeat them in customer text.",
    "Return JSON only: {\"status\":\"available\"|\"empty\",\"summary\"?:{\"text\":string,\"evidenceRefs\":string[]},\"findings\":[{\"title\":string,\"text\":string,\"sectionIds\":string[],\"evidenceRefs\":string[],\"alert\"?:{\"severity\":\"attention\"|\"urgent\",\"certainty\":\"confirmed\"|\"anomaly\"|\"possible\"}}]}",
    `Binding: ${JSON.stringify(accepted[0]!.result.binding)}`,
    `Accepted Sections: ${JSON.stringify(projectAcceptedSectionsV4ForModel(accepted))}`,
    ...(authoritativeOverviewEvidence ? [
      `Authoritative Overview Evidence: ${JSON.stringify(projectPreschoolExecutiveOverviewEvidenceForModel(authoritativeOverviewEvidence.catalog))}`,
    ] : []),
  ].join("\n\n");
  if (prompt.length > MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_PROMPT_TOO_LARGE");
  return prompt;
};

const projectAcceptedSectionsV4ForModel = (accepted: AcceptedSectionV4[]) => {
  const evidenceRefs = uniqueProjectionStrings(accepted.flatMap(({ result }) => [
    ...result.summary.evidenceRefs,
    ...result.insights.flatMap((insight) => insight.evidenceRefs),
  ]));
  const evidenceRefIndex = new Map(evidenceRefs.map((reference, index) => [reference, index]));
  const indexes = (references: string[]) => references.map((reference) => evidenceRefIndex.get(reference)!);
  return {
    encoding: { id: "preschool-executive-section-projection", revision: "v1" },
    evidenceRefs,
    sections: accepted.map(({ artifactId, result }) => ({
      sourceArtifactId: artifactId,
      sectionId: result.sectionId,
      summary: {
        text: result.summary.text,
        evidenceRefIndexes: indexes(result.summary.evidenceRefs),
      },
      insights: result.insights.map((insight) => ({
        id: insight.id,
        title: insight.title,
        epistemicStatus: insight.epistemicStatus,
        text: insight.text,
        evidenceRefIndexes: indexes(insight.evidenceRefs),
        ...(insight.label === undefined ? {} : { label: insight.label }),
        ...(insight.deepDiveQuestion === undefined ? {} : { deepDiveQuestion: insight.deepDiveQuestion }),
      })),
      ...(result.limitation ? { limitation: result.limitation } : {}),
    })),
  };
};

export const projectPreschoolExecutiveOverviewEvidenceForModel = (catalog: AnalysisContextEvidenceCatalog) => {
  const metricIds = uniqueProjectionStrings(catalog.facts.map((fact) => fact.metricId));
  const units = uniqueProjectionStrings(catalog.facts.flatMap((fact) => fact.unit === undefined ? [] : [fact.unit]));
  const statuses = uniqueProjectionStrings(catalog.facts.map((fact) => fact.status));
  const evidenceRefs = uniqueProjectionStrings(catalog.facts.flatMap((fact) => fact.evidenceRefs));
  const evidenceSets = uniqueJsonValues(catalog.facts.map((fact) =>
    fact.evidenceRefs.map((reference) => evidenceRefs.indexOf(reference))));
  const dimensions = uniqueJsonValues(catalog.facts.map((fact) => fact.dimensions));
  return {
    encoding: { id: "analysis-context-evidence-columnar-json", revision: "v1" },
    contract: catalog.contract,
    sourceId: catalog.sourceId,
    pins: catalog.pins,
    dictionaries: { metricIds, units, statuses, evidenceRefs, evidenceSets, dimensions },
    factTable: {
      columns: ["id", "label", "metricIdIndex", "value", "unitIndex", "statusIndex", "evidenceSetIndex", "dimensionsIndex"],
      rows: catalog.facts.map((fact) => [
        fact.id,
        fact.label,
        metricIds.indexOf(fact.metricId),
        fact.value,
        fact.unit === undefined ? -1 : units.indexOf(fact.unit),
        statuses.indexOf(fact.status),
        indexOfJsonValue(evidenceSets, fact.evidenceRefs.map((reference) => evidenceRefs.indexOf(reference))),
        indexOfJsonValue(dimensions, fact.dimensions),
      ]),
    },
  };
};

const uniqueProjectionStrings = (values: string[]): string[] => [...new Set(values)];

const uniqueJsonValues = <T>(values: T[]): T[] => {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const indexOfJsonValue = <T>(values: T[], value: T): number => {
  const key = JSON.stringify(value);
  return values.findIndex((candidate) => JSON.stringify(candidate) === key);
};

const materializeExecutiveResultV4 = (input: {
  answer: string;
  accepted: AcceptedSectionV4[];
  identity: EnergyIqOverviewAiArtifactIdentity;
  runId: string;
  authoritativeOverviewEvidence?: PreschoolAuthoritativeOverviewEvidence;
}): PreschoolExecutiveSynthesisResultV4 => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(input.answer));
  } catch {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.findings)) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  if (parsed.status === "empty") {
    if (parsed.summary !== undefined || parsed.findings.length !== 0) {
      throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
    }
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_EMPTY_UNSUPPORTED");
  }
  if (parsed.status !== "available"
    || !isRecord(parsed.summary)
    || parsed.findings.length > 3) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  const rawSummaryText = cleanText(parsed.summary.text);
  const rawSummaryEvidenceRefs = stringArray(parsed.summary.evidenceRefs);
  if (!rawSummaryText || rawSummaryText.length > PRESCHOOL_EXECUTIVE_SUMMARY_MAX_CHARS
    || !rawSummaryEvidenceRefs || rawSummaryEvidenceRefs.length === 0
    || hasBannedCustomerText(rawSummaryText)) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
  }
  const acceptedBySection = new Map(input.accepted.map((accepted) => [accepted.result.sectionId, accepted]));
  const evidenceOwners = sectionEvidenceOwners(input.accepted);
  const evidenceEpistemicRequirements = sectionEvidenceEpistemicRequirements(input.accepted);
  const narrativesByEvidenceRef = sectionNarrativesByEvidenceRef(input.accepted);
  const allAcceptedNarratives = [...new Set([...narrativesByEvidenceRef.values()].flat())];
  const summaryText = removeUnsupportedEnergyCostRelation(rawSummaryText, allAcceptedNarratives);
  const overviewFacts = input.authoritativeOverviewEvidence?.catalog.facts ?? [];
  const authoritativeEvidence = new Set(overviewFacts.map(({ id }) => id));
  const overviewFactsByProvenanceRef = new Map<string, typeof overviewFacts>();
  for (const fact of overviewFacts) {
    for (const reference of fact.evidenceRefs) {
      const facts = overviewFactsByProvenanceRef.get(reference) ?? [];
      facts.push(fact);
      overviewFactsByProvenanceRef.set(reference, facts);
    }
  }
  const usedOverviewFactIds = new Set<string>();
  const summaryOverviewFactIds = new Set<string>();
  const requireSupportedEvidence = (
    reference: string,
    narrativeText: string,
    usedFactIds: Set<string> = usedOverviewFactIds,
  ): {
    canonicalReference: string;
    owners: Set<PreschoolSectionId>;
  } => {
    const owners = evidenceOwners.get(reference);
    if (owners) return { canonicalReference: reference, owners };
    if (authoritativeEvidence.has(reference)) {
      usedFactIds.add(reference);
      return { canonicalReference: reference, owners: new Set() };
    }
    const aliasedFact = resolveOverviewFactAlias(
      reference,
      narrativeText,
      overviewFactsByProvenanceRef.get(reference) ?? [],
    );
    if (aliasedFact) {
      usedFactIds.add(aliasedFact.id);
      return { canonicalReference: aliasedFact.id, owners: new Set() };
    }
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED");
  };
  const contributingSections = new Set<PreschoolSectionId>();
  const summaryContributingSections = new Set<PreschoolSectionId>();
  const summaryEvidenceRefs = [...new Set(rawSummaryEvidenceRefs.map((reference) => {
    const supported = requireSupportedEvidence(reference, summaryText, summaryOverviewFactIds);
    for (const sectionId of supported.owners) summaryContributingSections.add(sectionId);
    return supported.canonicalReference;
  }))];
  restoreImplicitOverviewFactRefs({
    narrativeText: summaryText,
    evidenceRefs: summaryEvidenceRefs,
    overviewFacts,
    narrativesByEvidenceRef,
    usedOverviewFactIds: summaryOverviewFactIds,
  });
  if (summaryEvidenceRefs.length === 0) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED");
  }
  const summaryIsSupported = summaryContributingSections.size >= 2
    && !isSingleSectionSummaryRestatement(summaryText, input.accepted)
    && !hasUnsupportedNumber(summaryText, numbersSupportedByEvidenceRefs(
    summaryEvidenceRefs,
    narrativesByEvidenceRef,
    overviewFacts,
  )) && narrativePreservesSourceEpistemicStatus(
    summaryText,
    summaryEvidenceRefs,
    evidenceEpistemicRequirements,
  );
  const findings: PreschoolOverviewKeyFinding[] = parsed.findings.flatMap((candidate, index) => {
    if (!isRecord(candidate)) return [];
    let title = cleanText(candidate.title);
    const text = cleanText(candidate.text);
    const sectionIds = stringArray(candidate.sectionIds)?.filter(isPreschoolSectionId);
    const rawEvidenceRefs = stringArray(candidate.evidenceRefs);
    if (!title || title.length > PRESCHOOL_EXECUTIVE_FINDING_TITLE_MAX_CHARS
      || !text || text.length > PRESCHOOL_EXECUTIVE_FINDING_TEXT_MAX_CHARS
      || !sectionIds || sectionIds.length < 2
      || sectionIds.length !== (candidate.sectionIds as unknown[]).length
      || new Set(sectionIds).size !== sectionIds.length
      || sectionIds.some((sectionId) => !acceptedBySection.has(sectionId))
      || !rawEvidenceRefs || rawEvidenceRefs.length === 0
      || hasBannedCustomerText(title) || hasBannedCustomerText(text)) {
      return [];
    }
    const declaredSections = new Set(sectionIds);
    const evidenceBackedSections = new Set<PreschoolSectionId>();
    const evidenceRefs: string[] = [];
    const candidateOverviewFactIds = new Set<string>();
    try {
      for (const reference of rawEvidenceRefs) {
        const supported = requireSupportedEvidence(
          reference,
          `${title} ${text}`,
          candidateOverviewFactIds,
        );
        const { owners } = supported;
        if (owners.size > 0 && ![...owners].some((sectionId) => declaredSections.has(sectionId))) {
          return [];
        }
        for (const sectionId of owners) {
          if (declaredSections.has(sectionId)) evidenceBackedSections.add(sectionId);
        }
        evidenceRefs.push(supported.canonicalReference);
      }
    } catch (error) {
      if (error instanceof Error
        && error.message === "PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED") return [];
      throw error;
    }
    if ([...declaredSections].some((sectionId) => !evidenceBackedSections.has(sectionId))) {
      return [];
    }
    if (isSingleSectionFindingRestatement(title, text, input.accepted)) return [];
    if (hasContradictoryAbsoluteCohortNegation(
      `${title} ${text}`,
      evidenceRefs,
      narrativesByEvidenceRef,
    )) return [];
    if (hasUnsupportedNumber(`${title} ${text}`, numbersSupportedByEvidenceRefs(
      evidenceRefs,
      narrativesByEvidenceRef,
      overviewFacts,
    ))) return [];
    if (!narrativePreservesSourceEpistemicStatus(
      text,
      evidenceRefs,
      evidenceEpistemicRequirements,
    )) return [];
    if (!narrativePreservesSourceEpistemicStatus(
      title,
      evidenceRefs,
      evidenceEpistemicRequirements,
    )) {
      const calibratedTitle = `Possible: ${title}`;
      if (calibratedTitle.length > PRESCHOOL_EXECUTIVE_FINDING_TITLE_MAX_CHARS
        || !narrativePreservesSourceEpistemicStatus(
          calibratedTitle,
          evidenceRefs,
          evidenceEpistemicRequirements,
        )) return [];
      title = calibratedTitle;
    }
    let alert: PreschoolOverviewKeyFinding["alert"] | undefined;
    try {
      alert = parseAlert(candidate.alert);
    } catch {
      // Alert metadata is optional. A malformed alert must not discard an
      // otherwise supported Finding; publish the Finding without the alert.
      alert = undefined;
    }
    if (alert && alert.certainty !== "possible"
      && evidenceRefs.some((reference) => evidenceEpistemicRequirements.has(reference))) {
      alert = { ...alert, certainty: "possible" };
    }
    for (const sectionId of declaredSections) contributingSections.add(sectionId);
    for (const factId of candidateOverviewFactIds) usedOverviewFactIds.add(factId);
    return [{
      id: `overview-key-finding-${index + 1}`,
      title,
      text,
      sectionIds: [...declaredSections],
      evidenceRefs: [...new Set(evidenceRefs)],
      ...(alert ? { alert } : {}),
    }];
  });
  if (findings.length === 0) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_NO_SUPPORTED_FINDINGS");
  }
  let publishedSummaryText = summaryText;
  let publishedSummaryEvidenceRefs = summaryEvidenceRefs;
  if (summaryIsSupported) {
    for (const sectionId of summaryContributingSections) contributingSections.add(sectionId);
    for (const factId of summaryOverviewFactIds) usedOverviewFactIds.add(factId);
  } else {
    const fallback = findings[0];
    if (!fallback) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_NO_SUPPORTED_FINDINGS");
    publishedSummaryText = /[.!?]$/u.test(fallback.title) ? fallback.title : `${fallback.title}.`;
    publishedSummaryEvidenceRefs = [...fallback.evidenceRefs];
  }
  const sourceSectionArtifactIds = PRESCHOOL_SECTION_IDS.flatMap((sectionId) => {
    const accepted = acceptedBySection.get(sectionId);
    return contributingSections.has(sectionId) && accepted ? [accepted.artifactId] : [];
  });
  if (sourceSectionArtifactIds.length < 2) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_NO_SUPPORTED_FINDINGS");
  }
  return {
    artifactKind: "executive-synthesis",
    status: "available",
    providerProfileId: input.identity.modelProfileId,
    runId: input.runId,
    contract: { id: "preschool-executive-synthesis", revision: "preschool-executive-synthesis-v4" },
    binding: preschoolOverviewAiBindingFromIdentity(input.identity),
    sourceSectionArtifactIds,
    summary: { text: publishedSummaryText, evidenceRefs: publishedSummaryEvidenceRefs },
    ...(input.authoritativeOverviewEvidence && usedOverviewFactIds.size > 0 ? {
      overviewEvidence: overviewEvidenceLineage(
        input.authoritativeOverviewEvidence.catalog,
        usedOverviewFactIds,
      ),
    } : {}),
    findings,
  };
};

const materializeExecutiveResult = (input: {
  answer: string;
  accepted: AcceptedSection[];
  identity: EnergyIqOverviewAiArtifactIdentity;
  runId: string;
}): PreschoolExecutiveSynthesisResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(input.answer));
  } catch {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.keyFindings)) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  if (parsed.status === "empty") {
    if (parsed.keyFindings.length !== 0) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
    return emptyResult(input.identity, input.runId, input.accepted.map(({ artifactId }) => artifactId));
  }
  if (parsed.status !== "available" || parsed.keyFindings.length < 1 || parsed.keyFindings.length > 4) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
  }
  const sourcesBySection = new Map(input.accepted.map(({ result }) => [result.sectionId, result]));
  const sourceNumbers = collectNumbers(input.accepted.flatMap(({ result }) => [
    result.summary,
    ...result.keyPoints.flatMap(({ label, text }) => label ? [label, text] : [text]),
    result.limitation,
  ]));
  const keyFindings: PreschoolExecutiveKeyFinding[] = parsed.keyFindings.map((candidate, index) => {
    if (!isRecord(candidate)) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_MALFORMED");
    const takeaway = cleanText(candidate.takeaway);
    const sectionIds = stringArray(candidate.sectionIds)?.filter(isPreschoolSectionId);
    const evidenceRefs = stringArray(candidate.evidenceRefs);
    if (!takeaway || !sectionIds || sectionIds.length === 0 || !evidenceRefs || evidenceRefs.length === 0
      || sectionIds.length !== (candidate.sectionIds as unknown[]).length
      || hasBannedCustomerText(takeaway)
      || hasUnsupportedNumber(takeaway, sourceNumbers)) {
      throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
    }
    const allowedEvidence = new Set(sectionIds.flatMap((sectionId) =>
      sourcesBySection.get(sectionId)?.keyPoints.flatMap(({ evidenceRefs: refs }) => refs) ?? []));
    if (evidenceRefs.some((reference) => !allowedEvidence.has(reference))) {
      throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_EVIDENCE_UNSUPPORTED");
    }
    return {
      id: `executive-key-finding-${index + 1}`,
      takeaway,
      sectionIds: [...new Set(sectionIds)],
      evidenceRefs: [...new Set(evidenceRefs)],
    };
  });
  return {
    artifactKind: "executive-synthesis",
    status: "available",
    providerProfileId: input.identity.modelProfileId,
    runId: input.runId,
    contract: {
      id: "preschool-executive-synthesis",
      revision: "preschool-executive-synthesis-v1",
    },
    binding: preschoolOverviewAiBindingFromIdentity(input.identity),
    sourceSectionArtifactIds: input.accepted.map(({ artifactId }) => artifactId),
    keyFindings,
  };
};

const emptyResult = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  runId: string,
  sourceSectionArtifactIds: string[] = [],
): PreschoolExecutiveSynthesisResult => ({
  artifactKind: "executive-synthesis",
  status: "empty",
  providerProfileId: identity.modelProfileId,
  runId,
  contract: {
    id: "preschool-executive-synthesis",
    revision: "preschool-executive-synthesis-v1",
  },
  binding: preschoolOverviewAiBindingFromIdentity(identity),
  sourceSectionArtifactIds,
  keyFindings: [],
});

const emptyResultV4 = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  runId: string,
): PreschoolExecutiveSynthesisResultV4 => ({
  artifactKind: "executive-synthesis",
  status: "empty",
  providerProfileId: identity.modelProfileId,
  runId,
  contract: { id: "preschool-executive-synthesis", revision: "preschool-executive-synthesis-v4" },
  binding: preschoolOverviewAiBindingFromIdentity(identity),
  sourceSectionArtifactIds: [],
  findings: [],
});

const requireAuthoritativeOverviewEvidence = (
  value: PreschoolAuthoritativeOverviewEvidence,
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolAuthoritativeOverviewEvidence => {
  const catalog = value.catalog;
  if (!sameBinding(value.binding, identity)
    || catalog.contract !== "analysis-context-evidence@1"
    || !cleanText(catalog.sourceId)
    || catalog.pins.workspaceId !== identity.workspaceId
    || catalog.pins.projectId !== identity.projectId
    || catalog.pins.scopeId !== identity.scopeId
    || catalog.pins.dataSnapshotId !== identity.dataSnapshotId
    || catalog.pins.projectReleaseId !== identity.projectReleaseId
    || !cleanText(catalog.pins.dataCutoff)
    || !cleanText(catalog.pins.metricVersion)
    || !Array.isArray(catalog.facts)
    || !catalog.facts.every(validAuthoritativeOverviewFact)
    || new Set(catalog.facts.map(({ id }) => id)).size !== catalog.facts.length) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_OVERVIEW_EVIDENCE_IDENTITY_MISMATCH");
  }
  return value;
};

const validAuthoritativeOverviewFact = (value: AnalysisContextEvidenceFact): boolean =>
  Boolean(cleanText(value.id))
  && Boolean(cleanText(value.label))
  && Boolean(cleanText(value.metricId))
  && (typeof value.value === "string"
    || typeof value.value === "number"
    || typeof value.value === "boolean"
    || value.value === null)
  && (value.unit === undefined || Boolean(cleanText(value.unit)))
  && (value.status === "confirmed" || value.status === "provisional" || value.status === "partial")
  && Array.isArray(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && value.evidenceRefs.every((reference) => Boolean(cleanText(reference)))
  && new Set(value.evidenceRefs).size === value.evidenceRefs.length
  && isRecord(value.dimensions)
  && Object.values(value.dimensions).every((dimension) => typeof dimension === "string");

const overviewEvidenceLineage = (
  catalog: AnalysisContextEvidenceCatalog,
  usedFactIds: ReadonlySet<string>,
): PreschoolExecutiveOverviewEvidenceLineage => ({
  contract: catalog.contract,
  sourceId: catalog.sourceId,
  pins: { ...catalog.pins },
  factIds: catalog.facts.flatMap(({ id }) => usedFactIds.has(id) ? [id] : []),
  facts: catalog.facts.filter(({ id }) => usedFactIds.has(id)).map((fact) => ({
    ...fact,
    evidenceRefs: [...fact.evidenceRefs],
    dimensions: { ...fact.dimensions },
  })),
});

const sectionEvidenceOwners = (
  accepted: AcceptedSectionV4[],
): Map<string, Set<PreschoolSectionId>> => {
  const owners = new Map<string, Set<PreschoolSectionId>>();
  for (const { result } of accepted) {
    for (const reference of [
      ...result.summary.evidenceRefs,
      ...result.insights.flatMap(({ evidenceRefs }) => evidenceRefs),
    ]) {
      const sections = owners.get(reference) ?? new Set<PreschoolSectionId>();
      sections.add(result.sectionId);
      owners.set(reference, sections);
    }
  }
  return owners;
};

const sectionEvidenceEpistemicRequirements = (
  accepted: AcceptedSectionV4[],
): Map<string, "inferred" | "speculative"> => {
  const directlyObserved = new Set<string>();
  for (const { result } of accepted) {
    for (const reference of result.summary.evidenceRefs) directlyObserved.add(reference);
    for (const insight of result.insights) {
      if (insight.epistemicStatus !== "observed") continue;
      for (const reference of insight.evidenceRefs) directlyObserved.add(reference);
    }
  }
  const requirements = new Map<string, "inferred" | "speculative">();
  for (const { result } of accepted) {
    for (const insight of result.insights) {
      if (insight.epistemicStatus === "observed") continue;
      for (const reference of insight.evidenceRefs) {
        if (directlyObserved.has(reference)) continue;
        const current = requirements.get(reference);
        if (current !== "speculative") requirements.set(reference, insight.epistemicStatus);
      }
    }
  }
  return requirements;
};

const narrativePreservesSourceEpistemicStatus = (
  text: string,
  evidenceRefs: string[],
  requirements: Map<string, "inferred" | "speculative">,
): boolean => {
  const required = evidenceRefs.flatMap((reference) => requirements.get(reference) ?? []);
  if (required.length === 0) return true;
  const claims = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)]
    .map(({ segment }) => segment.trim())
    .filter(Boolean);
  return claims.length > 0 && claims.every((claim) => {
    if (/\b(?:proves?|proven|establish(?:es|ed)?|definitive(?:ly)?|is\s+caused\s+by)\b/iu.test(claim)) {
      return false;
    }
    const qualified = /\b(?:may|might|could|plausible|plausibly|possible|possibly|potential(?:ly)?|suggest(?:s|ed|ing)?|indicat(?:es|ed|ing)?|appears?|looks?\s+like|points?\s+to|consistent\s+with|signal|hypothesis|inferred|speculative|needs?\s+context|not\s+(?:an?\s+)?(?:alarm|confirmed|proof)|worth\s+(?:checking|reviewing|testing))\b/iu
      .test(claim);
    if (!qualified) return false;
    return !required.includes("speculative")
      || /\b(?:may|might|could|possible|possibly|potential(?:ly)?|hypothesis|speculative|test(?:able|ing)?)\b/iu.test(claim);
  });
};

const sectionNarrativesByEvidenceRef = (
  accepted: AcceptedSectionV4[],
): Map<string, string[]> => {
  const narratives = new Map<string, string[]>();
  const add = (reference: string, text: string): void => {
    const values = narratives.get(reference) ?? [];
    values.push(text);
    narratives.set(reference, values);
  };
  for (const { result } of accepted) {
    for (const reference of result.summary.evidenceRefs) add(reference, result.summary.text);
    for (const insight of result.insights) {
      const text = [insight.title, insight.label, insight.text].filter(Boolean).join(" ");
      for (const reference of insight.evidenceRefs) add(reference, text);
    }
  }
  return narratives;
};

const isSingleSectionSummaryRestatement = (
  summaryText: string,
  accepted: AcceptedSectionV4[],
): boolean => accepted.some(({ result }) => sectionNarratives(result).some((source) =>
  isNearVerbatimRestatement(summaryText, source)));

const isSingleSectionFindingRestatement = (
  title: string,
  text: string,
  accepted: AcceptedSectionV4[],
): boolean => accepted.some(({ result }) => {
  const narratives = sectionNarratives(result);
  return narratives.some((source) => isNearVerbatimRestatement(title, source))
    && narratives.some((source) => isNearVerbatimRestatement(text, source));
});

const sectionNarratives = (result: AcceptedSectionV4["result"]): string[] => [
  result.summary.text,
  ...result.insights.flatMap((insight) => [insight.title, insight.text]),
];

const hasContradictoryAbsoluteCohortNegation = (
  text: string,
  evidenceRefs: string[],
  narrativesByEvidenceRef: Map<string, string[]>,
): boolean => {
  const allNamedCentres = namedCentreCodes(text);
  const citedNarratives = evidenceRefs.flatMap((reference) => narrativesByEvidenceRef.get(reference) ?? []);
  const claims = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)]
    .map(({ segment }) => segment.replaceAll(/[*_`]/gu, "").trim())
    .filter(Boolean);
  return claims.some((claim) => {
    if (!/\b(?:none\s+of|no)\b/iu.test(claim)) return false;
    const claimCentres = namedCentreCodes(claim);
    const centres = claimCentres.size > 0
      ? claimCentres
      : /\b(?:these|those)\b/iu.test(claim) ? allNamedCentres : new Set<string>();
    if (centres.size === 0) return false;
    const predicate = claim.split(/\b(?:is|are|was|were|belongs?\s+to)\b/iu).slice(1).join(" ");
    const predicateTokens = cohortRelationTokens(predicate);
    if (predicateTokens.size === 0) return false;
    return [...centres].some((centre) => citedNarratives.some((source) => {
      if (!namedCentreCodes(source).has(centre)) return false;
      const sourceTokens = cohortRelationTokens(source);
      return [...predicateTokens].some((token) => sourceTokens.has(token));
    }));
  });
};

const namedCentreCodes = (text: string): Set<string> => {
  const codes = new Set<string>();
  for (const match of text.matchAll(/\bCentres?\s+([^.;:!?]+)/gu)) {
    for (const code of match[1]?.matchAll(/\b[A-Z]{1,3}\b/gu) ?? []) codes.add(code[0]);
  }
  return codes;
};

const cohortRelationTokens = (text: string): Set<string> => {
  const stop = new Set([
    "a", "an", "and", "are", "as", "at", "be", "been", "being", "centre", "centres",
    "cohort", "group", "in", "is", "it", "of", "or", "set", "that", "the", "these",
    "this", "those", "to", "was", "were",
  ]);
  return new Set(text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .match(/[a-z][a-z-]{3,}/gu)
    ?.filter((token) => !stop.has(token)) ?? []);
};

const isNearVerbatimRestatement = (candidate: string, source: string): boolean => {
  const normalizedCandidate = normalizeNarrativeForRestatement(candidate);
  const normalizedSource = normalizeNarrativeForRestatement(source);
  if (!normalizedCandidate || !normalizedSource) return false;
  if (normalizedCandidate === normalizedSource) return true;
  const shorter = normalizedCandidate.length <= normalizedSource.length ? normalizedCandidate : normalizedSource;
  const longer = normalizedCandidate.length > normalizedSource.length ? normalizedCandidate : normalizedSource;
  return shorter.length >= 32 && shorter.length / longer.length >= 0.9 && longer.includes(shorter);
};

const normalizeNarrativeForRestatement = (value: string): string => value
  .normalize("NFKC")
  .toLocaleLowerCase("en")
  .replace(/[\p{P}\p{S}_]+/gu, " ")
  .replace(/\s+/gu, " ")
  .trim();

const numbersSupportedByEvidenceRefs = (
  evidenceRefs: string[],
  narrativesByEvidenceRef: Map<string, string[]>,
  overviewFacts: AnalysisContextEvidenceCatalog["facts"],
): number[] => [
  ...collectNumbers(evidenceRefs.flatMap((reference) => narrativesByEvidenceRef.get(reference) ?? [])),
  ...overviewFacts.flatMap(({ id, value }) => evidenceRefs.includes(id) && typeof value === "number" ? [value] : []),
];

const restoreImplicitOverviewFactRefs = (input: {
  narrativeText: string;
  evidenceRefs: string[];
  overviewFacts: AnalysisContextEvidenceCatalog["facts"];
  narrativesByEvidenceRef: Map<string, string[]>;
  usedOverviewFactIds: Set<string>;
}): void => {
  const supported = numbersSupportedByEvidenceRefs(
    input.evidenceRefs,
    input.narrativesByEvidenceRef,
    input.overviewFacts,
  );
  for (const match of input.narrativeText.replaceAll("−", "-").matchAll(NUMBER_TOKEN)) {
    const raw = match[0].replaceAll(",", "");
    const reportedValue = Number(raw);
    const precision = raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0;
    if (supported.some((value) => reportedNumberMatches(value, reportedValue, precision))) continue;
    const matchingFacts = input.overviewFacts.filter(({ value }) => typeof value === "number"
      && reportedNumberMatches(value, reportedValue, precision));
    if (matchingFacts.length !== 1) continue;
    const factId = matchingFacts[0]!.id;
    if (!input.evidenceRefs.includes(factId)) input.evidenceRefs.push(factId);
    input.usedOverviewFactIds.add(factId);
    supported.push(matchingFacts[0]!.value as number);
  }
};

const removeUnsupportedEnergyCostRelation = (text: string, sourceNarratives: string[]): string => {
  const sourcePairs = sourceNarratives.flatMap(energyCostPairs);
  const unsupported = energyCostPairs(text).some((candidate) => !sourcePairs.some((source) =>
    reportedNumberMatches(source.energyKwh, candidate.energyKwh, candidate.energyPrecision)
    && reportedNumberMatches(source.cost, candidate.cost, candidate.costPrecision)));
  if (!unsupported) return text;
  return text.replace(
    /\s+at\s+(?:a\s+)?(?:provisional\s+|estimated\s+)?cost\s+of\s+(?:about\s+|roughly\s+)?(?:S\$|SGD)\s*[\d,.]+\s*(?:before\s+GST)?/giu,
    "",
  );
};

const energyCostPairs = (text: string): Array<{
  energyKwh: number;
  energyPrecision: number;
  cost: number;
  costPrecision: number;
}> => [...text.matchAll(/([\d,.]+)\s*kWh\b[^.!?;]{0,120}?(?:S\$|SGD)\s*([\d,.]+)/giu)]
  .map((match) => ({
    energyKwh: Number(match[1]!.replaceAll(",", "")),
    energyPrecision: decimalPrecision(match[1]!),
    cost: Number(match[2]!.replaceAll(",", "")),
    costPrecision: decimalPrecision(match[2]!),
  }));

const decimalPrecision = (raw: string): number => {
  const normalized = raw.replaceAll(",", "");
  return normalized.includes(".") ? normalized.length - normalized.indexOf(".") - 1 : 0;
};

const parseAlert = (value: unknown): PreschoolOverviewKeyFinding["alert"] | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || (value.severity !== "attention" && value.severity !== "urgent")) {
    throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
  }
  const certainty = value.certainty === "confirmed" || value.certainty === "anomaly" || value.certainty === "possible"
    ? value.certainty
    : value.certainty === "observed"
      ? "anomaly"
      : value.certainty === "inferred" || value.certainty === "speculative"
        ? "possible"
        : null;
  if (!certainty) throw new Error("PRESCHOOL_EXECUTIVE_SYNTHESIS_FACT_UNSUPPORTED");
  return { severity: value.severity, certainty };
};

const validSectionInsightV4 = (value: unknown): boolean => isRecord(value)
  && Boolean(cleanText(value.id))
  && Boolean(cleanText(value.title))
  && (value.label === undefined || Boolean(cleanText(value.label)))
  && (value.epistemicStatus === "observed"
    || value.epistemicStatus === "inferred"
    || value.epistemicStatus === "speculative")
  && Boolean(cleanText(value.text))
  && Boolean(stringArray(value.evidenceRefs))
  && (value.deepDiveQuestion === undefined || Boolean(cleanText(value.deepDiveQuestion)));

const sameBinding = (
  value: unknown,
  identity: EnergyIqOverviewAiArtifactIdentity,
): boolean => isRecord(value)
  && value.workspaceId === identity.workspaceId
  && value.projectId === identity.projectId
  && value.scopeId === identity.scopeId
  && value.dataSnapshotId === identity.dataSnapshotId
  && value.projectReleaseId === identity.projectReleaseId
  && value.modelProfileId === identity.modelProfileId
  && value.modelProfileRevision === identity.modelProfileRevision
  && isRecord(value.analysisPeriod)
  && value.analysisPeriod.from === identity.analysisPeriodFrom
  && value.analysisPeriod.to === identity.analysisPeriodTo;

const collectNumbers = (values: unknown[]): number[] => values.flatMap((value) => {
  if (typeof value !== "string") return [];
  return [...value.matchAll(NUMBER_TOKEN)].map(([raw]) => Number(raw.replaceAll(",", "")));
});

const hasUnsupportedNumber = (text: string, supported: number[]): boolean =>
  [...text.replaceAll("−", "-").matchAll(NUMBER_TOKEN)].some((match) => {
    const token = match[0];
    const raw = token.replaceAll(",", "");
    const value = Number(raw);
    const precision = raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0;
    const exactlySupported = supported.some((candidate) => reportedNumberMatches(candidate, value, precision));
    const downwardMagnitudeSupported = value >= 0
      && /\b(?:below|under|lower|down|decrease|decreased|reduction)\b/iu.test(
        text.slice(Math.max(0, (match.index ?? 0) - 24), (match.index ?? 0) + token.length + 32),
      )
      && supported.some((candidate) => candidate < 0
        && reportedNumberMatches(Math.abs(candidate), value, precision));
    return !exactlySupported && !downwardMagnitudeSupported;
  });

const reportedNumberMatches = (sourceValue: number, reportedValue: number, precision: number): boolean => {
  const tolerance = 0.5 * (10 ** -precision);
  const floatingPointSlack = Number.EPSILON
    * Math.max(1, Math.abs(sourceValue), Math.abs(reportedValue))
    * 8;
  return Math.abs(sourceValue - reportedValue) <= tolerance + floatingPointSlack;
};

const resolveOverviewFactAlias = <T extends {
  id: string;
  metricId: string;
  value: string | number | boolean | null;
}>(reference: string, narrativeText: string, referencedFacts: T[]): T | null => {
  if (referencedFacts.length === 0) return null;
  const evidenceMetricId = /:([^:]+)@\d+$/u.exec(reference)?.[1];
  const compatibleMetricIds = evidenceMetricId
    ? new Set([evidenceMetricId, ...(OVERVIEW_EVIDENCE_METRIC_ALIASES[evidenceMetricId] ?? [])])
    : null;
  const metricCandidates = compatibleMetricIds
    ? referencedFacts.filter(({ metricId }) => compatibleMetricIds.has(metricId))
    : [];
  const candidates = metricCandidates.length > 0 ? metricCandidates : referencedFacts;
  const valueMatches = candidates.filter(({ value }) => overviewFactValueAppearsInNarrative(value, narrativeText));
  if (valueMatches.length === 1) return valueMatches[0]!;
  return candidates.length === 1 ? candidates[0]! : null;
};

const OVERVIEW_EVIDENCE_METRIC_ALIASES: Record<string, string[]> = {
  "energy.peak_demand_kw": ["energy.peak_interval_average_kw"],
};

const overviewFactValueAppearsInNarrative = (
  value: string | number | boolean | null,
  narrativeText: string,
): boolean => {
  if (typeof value === "number") {
    return [...narrativeText.replaceAll("−", "-").matchAll(NUMBER_TOKEN)].some((match) => {
      const raw = match[0].replaceAll(",", "");
      const reportedValue = Number(raw);
      const precision = raw.includes(".") ? raw.length - raw.indexOf(".") - 1 : 0;
      return reportedNumberMatches(value, reportedValue, precision);
    });
  }
  if (typeof value === "string") return narrativeText.toLocaleLowerCase().includes(value.toLocaleLowerCase());
  if (typeof value === "boolean") return new RegExp(`\\b${String(value)}\\b`, "iu").test(narrativeText);
  return false;
};

const hasBannedCustomerText = (text: string): boolean =>
  BANNED_INTERNAL_TEXT.test(text) || SQL_STATEMENT.test(text);

const stripJsonFence = (value: string): string => value.trim()
  .replace(/^```(?:json)?\s*/i, "")
  .replace(/\s*```$/, "");

const stringArray = (value: unknown): string[] | null => Array.isArray(value)
  && value.every((item) => typeof item === "string" && Boolean(item.trim()))
  ? value as string[]
  : null;

const cleanText = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const synthesisErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_");
  return normalized.slice(0, 160) || "PRESCHOOL_EXECUTIVE_SYNTHESIS_FAILED";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
