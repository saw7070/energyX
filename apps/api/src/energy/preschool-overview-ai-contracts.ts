import type { EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";
import type { AdditionalAiInsightsArtifact } from "@datafoundry/contracts";

export type {
  PreschoolAcceptedSectionInsightV4,
  PreschoolAcceptedSectionValueV4,
  PreschoolOverviewAiBindingV4,
  PreschoolPublishedSectionInsightV4,
  PreschoolSectionAcceptanceV4,
  PreschoolSectionCapabilityV4,
  PreschoolSectionCandidateRejectionCodeV4,
  PreschoolSectionCandidateRejectionV4,
  PreschoolSectionDiscoveryV4,
  PreschoolSectionEpistemicStatusV4,
  PreschoolSectionIdV4,
  PreschoolSectionInsightCandidateV4,
  PreschoolSectionInsightToolNameV4,
  PreschoolSectionInterpretationResultV4,
  PreschoolSectionPublicationAuditV4,
  PreschoolSectionSummaryV4,
  PreschoolSectionToolAuditV4,
} from "@datafoundry/contracts";

export const PRESCHOOL_SECTION_IDS = [
  "centre-benchmark",
  "standby-wastage",
  "operating-behaviour",
  "planning-outlook",
] as const;

export type PreschoolSectionId = typeof PRESCHOOL_SECTION_IDS[number];

export type PreschoolOverviewAiBinding = {
  workspaceId: string;
  projectId: "preschool-demo";
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  modelProfileId: string;
  modelProfileRevision: number;
};

export type PreschoolSectionPackEvidence = {
  id: string;
  label: string;
  value: unknown;
  unit?: string;
  entityRefs: string[];
  evidenceRefs: string[];
  claimRelations?: Array<{
    subject: string;
    predicate: string;
    object: string;
  }>;
};

export type PreschoolSectionPack = {
  sectionId: PreschoolSectionId;
  audience: "non-technical energy manager";
  decisionQuestion: string;
  binding: PreschoolOverviewAiBinding;
  evidence: PreschoolSectionPackEvidence[];
  dataQuality: { status: string; detail?: string };
  limitations: string[];
  missingEvidence: string[];
  pageCoverage: string[];
  allowedNextChecks: string[];
};

export type PreschoolSectionKeyPoint = {
  kind: "priority" | "finding" | "meaning" | "next-check";
  label?: string;
  text: string;
  evidenceRefs: string[];
};

export type PreschoolSectionInterpretationResultV3 = {
  artifactKind: "section-interpretation";
  status: "available" | "empty";
  providerProfileId: string;
  runId: string;
  contract: { id: "preschool-section-interpretation"; revision: "preschool-section-interpretation-v3" };
  binding: PreschoolOverviewAiBinding;
  sectionId: PreschoolSectionId;
  summary?: string;
  keyPoints: PreschoolSectionKeyPoint[];
  limitation?: string;
};

export type PreschoolSectionInterpretationResult =
  | PreschoolSectionInterpretationResultV3
  | import("@datafoundry/contracts").PreschoolSectionInterpretationResultV4;

export type PreschoolExecutiveKeyFinding = {
  id: string;
  takeaway: string;
  sectionIds: PreschoolSectionId[];
  evidenceRefs: string[];
};

export type PreschoolExecutiveSynthesisResultV3 = {
  artifactKind: "executive-synthesis";
  status: "available" | "empty";
  providerProfileId: string;
  runId: string;
  contract: { id: "preschool-executive-synthesis"; revision: "preschool-executive-synthesis-v1" };
  binding: PreschoolOverviewAiBinding;
  sourceSectionArtifactIds: string[];
  keyFindings: PreschoolExecutiveKeyFinding[];
};

export type PreschoolOverviewKeyFinding = {
  id: string;
  title: string;
  text: string;
  sectionIds: PreschoolSectionId[];
  evidenceRefs: string[];
  alert?: {
    severity: "attention" | "urgent";
    certainty: "confirmed" | "anomaly" | "possible";
  };
};

export type PreschoolExecutiveOverviewEvidenceLineage = {
  contract: "analysis-context-evidence@1";
  sourceId: string;
  pins: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    dataCutoff: string;
    projectReleaseId: string;
    metricVersion: string;
  };
  factIds: string[];
  facts: Array<{
    id: string;
    label: string;
    metricId: string;
    value: string | number | boolean | null;
    unit?: string;
    status: "confirmed" | "provisional" | "partial";
    evidenceRefs: string[];
    dimensions: Record<string, string>;
  }>;
};

type PreschoolExecutiveSynthesisResultV4Base = {
  artifactKind: "executive-synthesis";
  providerProfileId: string;
  runId: string;
  contract: { id: "preschool-executive-synthesis"; revision: "preschool-executive-synthesis-v4" };
  binding: PreschoolOverviewAiBinding;
  sourceSectionArtifactIds: string[];
};

export type PreschoolExecutiveSynthesisResultV4 = PreschoolExecutiveSynthesisResultV4Base & ({
  status: "available";
  summary: {
    text: string;
    evidenceRefs: string[];
  };
  overviewEvidence?: PreschoolExecutiveOverviewEvidenceLineage;
  findings: PreschoolOverviewKeyFinding[];
} | {
  status: "empty";
  summary?: never;
  overviewEvidence?: never;
  findings: [];
});

export type PreschoolExecutiveSynthesisResult =
  | PreschoolExecutiveSynthesisResultV3
  | PreschoolExecutiveSynthesisResultV4;

export type PreschoolOverviewAiUnitStatus<T> =
  | { status: "queued" | "running" }
  | { status: "available"; artifactId: string; completedAt?: string; result: T }
  | { status: "empty"; artifactId: string; completedAt?: string; result: T }
  | { status: "unavailable"; artifactId?: string; completedAt?: string; reason: string };

export type PreschoolOverviewAiReadModel = {
  artifactKind: "preschool-overview-ai-read-model";
  status: "available";
  binding: PreschoolOverviewAiBinding;
  sections: Record<PreschoolSectionId, PreschoolOverviewAiUnitStatus<PreschoolSectionInterpretationResult>>;
  executive: PreschoolOverviewAiUnitStatus<PreschoolExecutiveSynthesisResult>;
  additional?: PreschoolOverviewAiUnitStatus<AdditionalAiInsightsArtifact>;
  /** Historical v3 Saved Analysis compatibility only; current reads never populate this field. */
  autonomous?: unknown;
};

export const isPreschoolSectionId = (value: string): value is PreschoolSectionId =>
  (PRESCHOOL_SECTION_IDS as readonly string[]).includes(value);

export const preschoolOverviewAiBindingFromIdentity = (
  identity: EnergyIqOverviewAiArtifactIdentity,
): PreschoolOverviewAiBinding => ({
  workspaceId: identity.workspaceId,
  projectId: "preschool-demo",
  scopeId: identity.scopeId,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  analysisPeriod: {
    from: identity.analysisPeriodFrom,
    to: identity.analysisPeriodTo,
  },
  modelProfileId: identity.modelProfileId,
  modelProfileRevision: identity.modelProfileRevision,
});
