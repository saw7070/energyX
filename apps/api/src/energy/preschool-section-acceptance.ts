import type {
  PreschoolOverviewAiBindingV4,
  PreschoolSectionAcceptanceV4,
  PreschoolAcceptedSectionInsightV4,
  PreschoolSectionCandidateRejectionV4,
  PreschoolSectionCandidateRejectionCodeV4,
  PreschoolSectionDiscoveryV4,
  PreschoolSectionIdV4,
  PreschoolSectionInsightCandidateV4,
  PreschoolSectionSummaryV4,
} from "@datafoundry/contracts";

type AcceptedValidation = { accepted: true };
type RejectedValidation = {
  accepted: false;
  code: PreschoolSectionCandidateRejectionCodeV4;
};

export type PreschoolSectionAcceptanceAuthority = {
  validateSummary: (
    summary: PreschoolSectionSummaryV4,
    context: { sectionId: PreschoolSectionIdV4; binding: PreschoolOverviewAiBindingV4 },
  ) => AcceptedValidation | { accepted: false };
  validateCandidate: (
    candidate: PreschoolSectionInsightCandidateV4,
    context: {
      sectionId: PreschoolSectionIdV4;
      binding: PreschoolOverviewAiBindingV4;
      sourceIndex: number;
    },
  ) => AcceptedValidation | RejectedValidation;
};

export const acceptPreschoolSectionInterpretation = (input: {
  expectedSectionId: PreschoolSectionIdV4;
  expectedBinding: PreschoolOverviewAiBindingV4;
  discovery: PreschoolSectionDiscoveryV4;
  authority: PreschoolSectionAcceptanceAuthority;
}): PreschoolSectionAcceptanceV4 => {
  if (input.discovery.sectionId !== input.expectedSectionId
    || !sameBinding(input.discovery.binding, input.expectedBinding)) {
    return {
      decision: "failed",
      code: "PRESCHOOL_SECTION_INTERPRETATION_BINDING_INVALID",
      rejectedCandidates: [],
    };
  }

  if (input.discovery.status === "empty") {
    return {
      decision: "accepted",
      value: {
        sectionId: input.discovery.sectionId,
        binding: input.discovery.binding,
        status: "empty",
        acceptedCandidates: [],
        rejectedCandidates: [],
      },
    };
  }

  if (!input.authority.validateSummary(input.discovery.summary, {
    sectionId: input.discovery.sectionId,
    binding: input.discovery.binding,
  }).accepted) {
    return {
      decision: "failed",
      code: "PRESCHOOL_SECTION_INTERPRETATION_SUMMARY_UNSUPPORTED",
      rejectedCandidates: [],
    };
  }

  const acceptedCandidates: PreschoolAcceptedSectionInsightV4[] = [];
  const rejectedCandidates: PreschoolSectionCandidateRejectionV4[] = [];
  input.discovery.candidates.forEach((candidate, sourceIndex) => {
    const candidateId = candidateIdFor(input.discovery.sectionId, sourceIndex);
    const validation = input.authority.validateCandidate(candidate, {
      sectionId: input.discovery.sectionId,
      binding: input.discovery.binding,
      sourceIndex,
    });
    if (!validation.accepted) {
      rejectedCandidates.push({ candidateId, sourceIndex, code: validation.code });
      return;
    }
    acceptedCandidates.push({
      candidateId,
      sourceIndex,
      title: candidate.title,
      epistemicStatus: candidate.epistemicStatus,
      text: candidate.text,
      evidenceRefs: [...new Set(candidate.evidenceRefs)],
      ...(candidate.label === undefined ? {} : { label: candidate.label }),
      ...(candidate.deepDiveQuestion === undefined
        ? {}
        : { deepDiveQuestion: candidate.deepDiveQuestion }),
    });
  });

  return {
    decision: "accepted",
    value: {
      sectionId: input.discovery.sectionId,
      binding: input.discovery.binding,
      status: "available",
      summary: input.discovery.summary,
      acceptedCandidates,
      rejectedCandidates,
      ...(input.discovery.limitation === undefined
        ? {}
        : { limitation: input.discovery.limitation }),
    },
  };
};

const sameBinding = (
  left: PreschoolOverviewAiBindingV4,
  right: PreschoolOverviewAiBindingV4,
): boolean => left.workspaceId === right.workspaceId
  && left.projectId === right.projectId
  && left.scopeId === right.scopeId
  && left.dataSnapshotId === right.dataSnapshotId
  && left.projectReleaseId === right.projectReleaseId
  && left.analysisPeriod.from === right.analysisPeriod.from
  && left.analysisPeriod.to === right.analysisPeriod.to
  && left.modelProfileId === right.modelProfileId
  && left.modelProfileRevision === right.modelProfileRevision;

const candidateIdFor = (
  sectionId: PreschoolSectionIdV4,
  sourceIndex: number,
): string => `preschool:${sectionId}:candidate:${sourceIndex + 1}`;
