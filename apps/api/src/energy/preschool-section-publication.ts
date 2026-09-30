import type {
  PreschoolAcceptedSectionInsightV4,
  PreschoolAcceptedSectionValueV4,
  PreschoolPublishedSectionInsightV4,
  PreschoolSectionInterpretationResultV4,
  PreschoolSectionPublicationAuditV4,
  PreschoolSectionCapabilityV4,
  PreschoolSectionToolAuditV4,
} from "@datafoundry/contracts";

const MAX_PUBLISHED_INSIGHTS = 3;

export const publishPreschoolSectionInterpretation = (input: {
  accepted: PreschoolAcceptedSectionValueV4;
  providerProfileId: string;
  runId: string;
  capability: PreschoolSectionCapabilityV4;
  toolAudits: PreschoolSectionToolAuditV4[];
}): PreschoolSectionInterpretationResultV4 => {
  const common = {
    artifactKind: "section-interpretation" as const,
    providerProfileId: input.providerProfileId,
    runId: input.runId,
    contract: {
      id: "preschool-section-interpretation" as const,
      revision: "preschool-section-interpretation-v4" as const,
    },
    binding: input.accepted.binding,
    sectionId: input.accepted.sectionId,
    packRevision: "v2" as const,
    capability: {
      revision: input.capability.revision,
      mode: input.capability.mode,
      tools: [...input.capability.tools],
    },
    toolAudits: structuredClone(input.toolAudits),
  };

  if (input.accepted.status === "empty") {
    return {
      ...common,
      status: "empty",
      insights: [],
      publication: publicationAudit({
        discoveredCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        publishedCount: 0,
        suppressedCandidateIds: [],
      }),
    };
  }

  const seen = new Set<string>();
  const publishable: PreschoolAcceptedSectionInsightV4[] = [];
  const suppressedCandidateIds: string[] = [];

  const candidatesInModelOrder = [...input.accepted.acceptedCandidates].sort((left, right) =>
    left.sourceIndex - right.sourceIndex || left.candidateId.localeCompare(right.candidateId));
  for (const candidate of candidatesInModelOrder) {
    const fingerprint = exactCandidateFingerprint(candidate);
    if (seen.has(fingerprint)) {
      suppressedCandidateIds.push(candidate.candidateId);
      continue;
    }
    seen.add(fingerprint);
    if (publishable.length >= MAX_PUBLISHED_INSIGHTS) {
      suppressedCandidateIds.push(candidate.candidateId);
      continue;
    }
    publishable.push(candidate);
  }

  const insights = publishable.map(publishedInsight);
  return {
    ...common,
    status: "available",
    summary: input.accepted.summary,
    insights,
    ...(input.accepted.limitation === undefined
      ? {}
      : { limitation: input.accepted.limitation }),
    publication: publicationAudit({
      discoveredCount:
        input.accepted.acceptedCandidates.length + input.accepted.rejectedCandidates.length,
      acceptedCount: input.accepted.acceptedCandidates.length,
      rejectedCount: input.accepted.rejectedCandidates.length,
      publishedCount: insights.length,
      suppressedCandidateIds,
    }),
  };
};

const exactCandidateFingerprint = (
  candidate: PreschoolAcceptedSectionInsightV4,
): string => JSON.stringify({
  title: candidate.title,
  label: candidate.label ?? null,
  epistemicStatus: candidate.epistemicStatus,
  text: candidate.text,
  evidenceRefs: candidate.evidenceRefs,
  deepDiveQuestion: candidate.deepDiveQuestion ?? null,
});

const publishedInsight = (
  candidate: PreschoolAcceptedSectionInsightV4,
): PreschoolPublishedSectionInsightV4 => ({
  id: candidate.candidateId,
  title: candidate.title,
  epistemicStatus: candidate.epistemicStatus,
  text: candidate.text,
  evidenceRefs: candidate.evidenceRefs,
  ...(candidate.label === undefined ? {} : { label: candidate.label }),
  ...(candidate.deepDiveQuestion === undefined
    ? {}
    : { deepDiveQuestion: candidate.deepDiveQuestion }),
});

const publicationAudit = (
  counts: Omit<PreschoolSectionPublicationAuditV4, "policyId" | "policyRevision">,
): PreschoolSectionPublicationAuditV4 => ({
  policyId: "preschool-section-publication",
  policyRevision: "v1",
  ...counts,
});
