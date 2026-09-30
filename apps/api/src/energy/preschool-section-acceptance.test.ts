import { describe, expect, it } from "vitest";

import type {
  PreschoolOverviewAiBindingV4,
  PreschoolSectionInsightCandidateV4,
  PreschoolSectionSummaryV4,
} from "@datafoundry/contracts";
import { acceptPreschoolSectionInterpretation } from "./preschool-section-acceptance.js";

const binding: PreschoolOverviewAiBindingV4 = {
  workspaceId: "workspace-1",
  projectId: "preschool-demo",
  scopeId: "project",
  dataSnapshotId: "snapshot-1",
  projectReleaseId: "release-1",
  analysisPeriod: { from: "2026-05-01", to: "2026-05-31" },
  modelProfileId: "profile-1",
  modelProfileRevision: 3,
};

const authority = {
  validateSummary: (_summary: PreschoolSectionSummaryV4) => ({ accepted: true as const }),
  validateCandidate: (_candidate: PreschoolSectionInsightCandidateV4) => ({ accepted: true as const }),
};

describe("Preschool Section acceptance", () => {
  it("accepts an available summary when discovery found no insight candidates", () => {
    expect(acceptPreschoolSectionInterpretation({
      expectedSectionId: "centre-benchmark",
      expectedBinding: binding,
      discovery: {
        sectionId: "centre-benchmark",
        binding,
        status: "available",
        summary: {
          text: "Three centres form the highest-use group.",
          evidenceRefs: ["benchmark:peer-matrix"],
        },
        candidates: [],
      },
      authority,
    })).toEqual({
      decision: "accepted",
      value: {
        sectionId: "centre-benchmark",
        binding,
        status: "available",
        summary: {
          text: "Three centres form the highest-use group.",
          evidenceRefs: ["benchmark:peer-matrix"],
        },
        acceptedCandidates: [],
        rejectedCandidates: [],
      },
    });
  });

  it("locally rejects unsupported observed claims while preserving a supported sibling", () => {
    const candidates: Array<PreschoolSectionInsightCandidateV4 & { candidateId?: string }> = [
      {
        title: "Unsupported number",
        epistemicStatus: "observed",
        text: "Centre G used 999 kWh.",
        evidenceRefs: ["benchmark:peer-matrix"],
      },
      {
        title: "Unsupported date",
        epistemicStatus: "observed",
        text: "The event occurred on 31 June 2026.",
        evidenceRefs: ["benchmark:peer-matrix"],
      },
      {
        title: "Unsupported entity relation",
        epistemicStatus: "observed",
        text: "Centre G contains Circuit Z.",
        evidenceRefs: ["benchmark:peer-matrix"],
      },
      {
        candidateId: "model-controlled-id",
        title: "Supported grouping",
        epistemicStatus: "observed",
        text: "Three centres form the highest-use group in this peer matrix.",
        evidenceRefs: ["benchmark:peer-matrix"],
      },
    ];

    const result = acceptPreschoolSectionInterpretation({
      expectedSectionId: "centre-benchmark",
      expectedBinding: binding,
      discovery: {
        sectionId: "centre-benchmark",
        binding,
        status: "available",
        summary: {
          text: "The peer matrix contains one distinct high-use group.",
          evidenceRefs: ["benchmark:peer-matrix"],
        },
        candidates,
      },
      authority: {
        ...authority,
        validateCandidate: (candidate) => {
          if (candidate.title === "Unsupported number") {
            return { accepted: false, code: "NUMBER_OR_UNIT_UNSUPPORTED" as const };
          }
          if (candidate.title === "Unsupported date") {
            return { accepted: false, code: "DATE_UNSUPPORTED" as const };
          }
          if (candidate.title === "Unsupported entity relation") {
            return { accepted: false, code: "ENTITY_RELATION_UNSUPPORTED" as const };
          }
          return { accepted: true as const };
        },
      },
    });

    expect(result).toMatchObject({
      decision: "accepted",
      value: {
        status: "available",
        rejectedCandidates: [
          {
            candidateId: "preschool:centre-benchmark:candidate:1",
            sourceIndex: 0,
            code: "NUMBER_OR_UNIT_UNSUPPORTED",
          },
          {
            candidateId: "preschool:centre-benchmark:candidate:2",
            sourceIndex: 1,
            code: "DATE_UNSUPPORTED",
          },
          {
            candidateId: "preschool:centre-benchmark:candidate:3",
            sourceIndex: 2,
            code: "ENTITY_RELATION_UNSUPPORTED",
          },
        ],
        acceptedCandidates: [{
          candidateId: "preschool:centre-benchmark:candidate:4",
          sourceIndex: 3,
          title: "Supported grouping",
          epistemicStatus: "observed",
        }],
      },
    });
  });

  it("preserves an accepted speculative insight without upgrading it to observed", () => {
    const result = acceptPreschoolSectionInterpretation({
      expectedSectionId: "standby-wastage",
      expectedBinding: binding,
      discovery: {
        sectionId: "standby-wastage",
        binding,
        status: "available",
        summary: {
          text: "A small number of closed-hour events merit attention.",
          evidenceRefs: ["closed-hours:events"],
        },
        candidates: [{
          title: "A one-off activity may explain the event",
          epistemicStatus: "speculative",
          text: "A cleaning activity or manual override could be one explanation.",
          evidenceRefs: ["closed-hours:events"],
        }],
      },
      authority,
    });

    expect(result).toMatchObject({
      decision: "accepted",
      value: {
        acceptedCandidates: [{ epistemicStatus: "speculative" }],
      },
    });
  });

  it("preserves a valid summary and the full rejection audit when every candidate is rejected", () => {
    const result = acceptPreschoolSectionInterpretation({
      expectedSectionId: "operating-behaviour",
      expectedBinding: binding,
      discovery: {
        sectionId: "operating-behaviour",
        binding,
        status: "available",
        summary: {
          text: "Operating-hour behaviour has one proposed interpretation.",
          evidenceRefs: ["operating-hours:events"],
        },
        candidates: [{
          title: "Unsupported relationship",
          epistemicStatus: "observed",
          text: "Every centre shares the same circuit pattern.",
          evidenceRefs: ["operating-hours:events"],
        }],
      },
      authority: {
        ...authority,
        validateCandidate: () => ({
          accepted: false,
          code: "ENTITY_RELATION_UNSUPPORTED" as const,
        }),
      },
    });

    expect(result).toEqual({
      decision: "accepted",
      value: {
        sectionId: "operating-behaviour",
        binding,
        status: "available",
        summary: {
          text: "Operating-hour behaviour has one proposed interpretation.",
          evidenceRefs: ["operating-hours:events"],
        },
        acceptedCandidates: [],
        rejectedCandidates: [{
          candidateId: "preschool:operating-behaviour:candidate:1",
          sourceIndex: 0,
          code: "ENTITY_RELATION_UNSUPPORTED",
        }],
      },
    });
  });

  it("fails the whole Section when binding or summary acceptance fails", () => {
    const discovery = {
      sectionId: "planning-outlook" as const,
      binding,
      status: "available" as const,
      summary: {
        text: "The outlook is supported by the current plan.",
        evidenceRefs: ["planning:forecast"],
      },
      candidates: [],
    };

    expect(acceptPreschoolSectionInterpretation({
      expectedSectionId: "planning-outlook",
      expectedBinding: { ...binding, dataSnapshotId: "snapshot-2" },
      discovery,
      authority,
    })).toEqual({
      decision: "failed",
      code: "PRESCHOOL_SECTION_INTERPRETATION_BINDING_INVALID",
      rejectedCandidates: [],
    });

    expect(acceptPreschoolSectionInterpretation({
      expectedSectionId: "planning-outlook",
      expectedBinding: binding,
      discovery,
      authority: {
        ...authority,
        validateSummary: () => ({ accepted: false as const }),
      },
    })).toEqual({
      decision: "failed",
      code: "PRESCHOOL_SECTION_INTERPRETATION_SUMMARY_UNSUPPORTED",
      rejectedCandidates: [],
    });
  });
});
