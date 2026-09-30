export const PRESCHOOL_SECTION_IDS_V4 = [
  "centre-benchmark",
  "standby-wastage",
  "operating-behaviour",
  "planning-outlook",
] as const;

export type PreschoolSectionIdV4 = typeof PRESCHOOL_SECTION_IDS_V4[number];

export type PreschoolOverviewAiBindingV4 = {
  workspaceId: string;
  projectId: "preschool-demo";
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  modelProfileId: string;
  modelProfileRevision: number;
};

export type PreschoolSectionEpistemicStatusV4 =
  | "observed"
  | "inferred"
  | "speculative";

export type PreschoolSectionSummaryV4 = {
  text: string;
  evidenceRefs: string[];
};

/** Raw model output. Candidate identity is deliberately not model-controlled. */
export type PreschoolSectionInsightCandidateV4 = {
  title: string;
  label?: string;
  epistemicStatus: PreschoolSectionEpistemicStatusV4;
  text: string;
  evidenceRefs: string[];
  deepDiveQuestion?: string;
};

export type PreschoolSectionDiscoveryV4 =
  | {
      sectionId: PreschoolSectionIdV4;
      binding: PreschoolOverviewAiBindingV4;
      status: "available";
      summary: PreschoolSectionSummaryV4;
      candidates: PreschoolSectionInsightCandidateV4[];
      limitation?: string;
    }
  | {
      sectionId: PreschoolSectionIdV4;
      binding: PreschoolOverviewAiBindingV4;
      status: "empty";
      summary?: never;
      candidates: [];
      limitation?: never;
    };

export type PreschoolSectionCandidateRejectionCodeV4 =
  | "EVIDENCE_REF_UNSUPPORTED"
  | "OBSERVED_FACT_UNSUPPORTED"
  | "ENTITY_RELATION_UNSUPPORTED"
  | "NUMBER_OR_UNIT_UNSUPPORTED"
  | "DATE_UNSUPPORTED"
  | "MARKDOWN_UNSAFE"
  | "SAFETY_CLAIM_UNSUPPORTED"
  | "PRESENTED_LIMITATION_RESTATED"
  | "CANDIDATE_MALFORMED";

export type PreschoolSectionCandidateRejectionV4 = {
  candidateId: string;
  sourceIndex: number;
  code: PreschoolSectionCandidateRejectionCodeV4;
};

export type PreschoolAcceptedSectionInsightV4 = PreschoolSectionInsightCandidateV4 & {
  candidateId: string;
  sourceIndex: number;
};

export type PreschoolAcceptedSectionValueV4 =
  | {
      sectionId: PreschoolSectionIdV4;
      binding: PreschoolOverviewAiBindingV4;
      status: "available";
      summary: PreschoolSectionSummaryV4;
      acceptedCandidates: PreschoolAcceptedSectionInsightV4[];
      rejectedCandidates: PreschoolSectionCandidateRejectionV4[];
      limitation?: string;
    }
  | {
      sectionId: PreschoolSectionIdV4;
      binding: PreschoolOverviewAiBindingV4;
      status: "empty";
      acceptedCandidates: [];
      rejectedCandidates: [];
    };

export type PreschoolSectionAcceptanceV4 =
  | { decision: "accepted"; value: PreschoolAcceptedSectionValueV4 }
  | {
      decision: "failed";
      code:
        | "PRESCHOOL_SECTION_INTERPRETATION_BINDING_INVALID"
        | "PRESCHOOL_SECTION_INTERPRETATION_SUMMARY_UNSUPPORTED"
        | "PRESCHOOL_SECTION_INTERPRETATION_ALL_CANDIDATES_REJECTED";
      rejectedCandidates: PreschoolSectionCandidateRejectionV4[];
    };

export type PreschoolPublishedSectionInsightV4 = PreschoolSectionInsightCandidateV4 & {
  id: string;
};

export type PreschoolSectionPublicationAuditV4 = {
  policyId: "preschool-section-publication";
  policyRevision: "v1";
  discoveredCount: number;
  acceptedCount: number;
  rejectedCount: number;
  publishedCount: number;
  suppressedCandidateIds: string[];
};

export type PreschoolSectionInsightToolNameV4 =
  | "compare_centres"
  | "inspect_time_pattern"
  | "inspect_load_composition"
  | "inspect_related_section_signals";

export type PreschoolSectionCapabilityV4 = {
  revision: "scoped-read-only-v1";
  mode: "scoped-read-only";
  tools: PreschoolSectionInsightToolNameV4[];
};

export type PreschoolSectionToolAuditV4 = {
  auditId: string;
  runId: string;
  toolCallId: string;
  toolName: PreschoolSectionInsightToolNameV4;
  sourcePackRevision: "preschool-section-pack-v2";
  evidenceRefs: string[];
};

type PreschoolSectionInterpretationResultV4Base = {
  artifactKind: "section-interpretation";
  providerProfileId: string;
  runId: string;
  contract: {
    id: "preschool-section-interpretation";
    revision: "preschool-section-interpretation-v4";
  };
  binding: PreschoolOverviewAiBindingV4;
  sectionId: PreschoolSectionIdV4;
  packRevision: "v2";
  capability: PreschoolSectionCapabilityV4;
  toolAudits: PreschoolSectionToolAuditV4[];
};

export type PreschoolSectionInterpretationResultV4 =
  | PreschoolSectionInterpretationResultV4Base & {
      status: "available";
      summary: PreschoolSectionSummaryV4;
      insights: PreschoolPublishedSectionInsightV4[];
      limitation?: string;
      publication: PreschoolSectionPublicationAuditV4;
    }
  | PreschoolSectionInterpretationResultV4Base & {
      status: "empty";
      summary?: never;
      insights: [];
      limitation?: never;
      publication: PreschoolSectionPublicationAuditV4;
    };
