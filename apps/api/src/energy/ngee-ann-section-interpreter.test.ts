import {
  createMetadataStore,
  type EnergyIqOverviewAiArtifactIdentity,
  type EnergyIqOverviewAiArtifactRecord,
  type MetadataStore,
  type UserRecord,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import { assembleNgeeAnnSectionPacks } from "./ngee-ann-section-pack.js";
import {
  buildNgeeAnnSectionPrompt,
  createNgeeAnnSectionInterpreter,
  materializeNgeeAnnSectionResult,
} from "./ngee-ann-section-interpreter.js";
import {
  createNgeeAnnOverviewAiSectionArtifactIdentity,
  createOverviewAiArtifactIdentity,
} from "./overview-ai-artifact.js";

describe("materializeNgeeAnnSectionResult", () => {
  it("publishes a useful supported sibling while locally rejecting a malformed candidate", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["trend-and-demand"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "trend-and-demand",
        status: "available",
        summary: {
          text: "Project use was 9736.42 kWh and peak demand was 138.8 kW in the current period.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:kept",
          title: "Peak demand moved differently from total use",
          text: "This contrast may point to a short-duration operational driver rather than a broad rise in consumption.",
          epistemicStatus: "inferred",
          evidenceRefs: [evidenceRef],
          deepDiveQuestion: "Which time blocks contributed most to the 138.8 kW peak?",
        }, {
          id: "candidate:rejected",
          title: "Unsupported exact claim",
          text: "Demand increased by 999.9 kW.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:trend",
    });

    expect(result).toMatchObject({
      status: "available",
      sectionId: "trend-and-demand",
      summary: { evidenceRefs: [evidenceRef] },
      insights: [{ id: "candidate:kept", epistemicStatus: "inferred" }],
      publication: {
        discoveredCount: 2,
        acceptedCount: 1,
        rejectedCount: 1,
        publishedCount: 1,
        suppressedCandidateIds: [],
        rejectedCandidateIds: ["candidate:rejected"],
      },
    });
  });

  it("removes one unsupported Summary sentence without discarding supported Insights", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["trend-and-demand"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: "Project use was 9736.42 kWh in the current period. Average daily use was 197.7 kWh. Peak demand reached 138.8 kW.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:kept-after-summary-repair",
          title: "Peak demand moved differently from total use",
          text: "This contrast may point to a short-duration operational driver rather than a broad rise in consumption.",
          epistemicStatus: "inferred",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:summary-sentence-repair",
    });

    expect(result).toMatchObject({
      status: "available",
      summary: {
        text: "Project use was 9736.42 kWh in the current period. Peak demand reached 138.8 kW.",
      },
      insights: [{ id: "candidate:kept-after-summary-repair" }],
    });
  });

  it("normalizes hourly energy-bucket units instead of publishing kWh as a rate", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;
    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: "The hourly profile is reported in kWh/h.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:hourly-unit",
          title: "Weekend hourly buckets remain visible",
          text: "The accepted profile remains near the supplied kWh/h values.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:hourly-unit",
    });

    expect(result.summary?.text).toBe("The hourly profile is reported in kWh per hourly bucket.");
    expect(result.insights[0]?.text).toBe("The accepted profile remains near the supplied kWh per hourly bucket values.");
  });

  it("removes a contradicted day-type ranking while preserving supported siblings", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    pack.facts.timeBehaviour = {
      metricId: "energy.total_usage_kwh@1",
      grain: "hour",
      unit: "kWh",
      timezone: "Asia/Singapore",
      queryId: "time_bucket_grid_v1",
      scopes: [],
      dayProfiles: [
        dayProfile("weekday", 17),
        dayProfile("weekend", 5),
        dayProfile("public_holiday", 9.4),
      ],
    };
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;
    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: "Weekday usage is highest. Public holiday is lowest.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:false-ranking",
          title: "Public holiday usage is the lowest",
          text: "The supplied day profiles put public holiday below weekend usage.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }, {
          id: "candidate:supported-ranking",
          title: "Weekday usage is the highest",
          text: "The supplied day profiles place weekday above weekend and public holiday usage.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:day-type-ranking",
    });

    expect(result.summary?.text).toBe("Weekday usage is highest.");
    expect(result.insights.map(({ id }) => id)).toEqual(["candidate:supported-ranking"]);
    expect(result.publication.rejectedCandidateIds).toContain("candidate:false-ranking");
  });

  it("rejects a reversed day-type comparison without discarding a supported sibling", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    pack.facts.timeBehaviour = {
      metricId: "energy.total_usage_kwh@1",
      grain: "hour",
      unit: "kWh",
      timezone: "Asia/Singapore",
      queryId: "time_bucket_grid_v1",
      scopes: [],
      dayProfiles: [
        dayProfile("weekday", 17),
        dayProfile("weekend", 5),
        dayProfile("public_holiday", 9.4),
      ],
    };
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;
    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: "Weekday usage is highest and the day-type profiles are available for review.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:reversed-comparison",
          title: "Weekend and holiday profiles remain distinct",
          text: "Weekend usage sits around 5.3 kWh, with public holiday demand similar but slightly lower.",
          epistemicStatus: "inferred",
          evidenceRefs: [evidenceRef],
        }, {
          id: "candidate:supported-comparison",
          title: "Public holiday usage remains above weekend usage",
          text: "The supplied day profiles place public holiday usage above weekend usage.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:day-type-comparison",
    });

    expect(result.insights.map(({ id }) => id)).toEqual(["candidate:supported-comparison"]);
    expect(result.publication.rejectedCandidateIds).toContain("candidate:reversed-comparison");
  });

  it("keeps a clearly labelled speculative angle when its observation Evidence is current", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "time-behaviour",
        status: "available",
        summary: { text: "The hourly profile has a visible daytime concentration.", evidenceRefs: [evidenceRef] },
        candidates: [{
          id: "candidate:hypothesis",
          title: "A timetable boundary may be shaping the profile",
          text: "One possibility is that a shared operating timetable creates the daytime concentration; the current data does not prove the cause.",
          epistemicStatus: "speculative",
          evidenceRefs: [evidenceRef],
          deepDiveQuestion: "Does the pattern persist on non-teaching days?",
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:time",
    });

    expect(result.insights).toEqual([
      expect.objectContaining({ id: "candidate:hypothesis", epistemicStatus: "speculative" }),
    ]);
  });

  it("accepts display-precision rounding while still rejecting an unrelated numeric claim", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["decision-priorities"];
    pack.facts.decisionPriorities = {
      status: "available",
      limitation: null,
      evidencePins: {} as never,
      items: [{ finding: { relativePct: 26.3762, impactKwh: 319.4721 } } as never],
    };
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "decision-priorities",
        status: "available",
        summary: {
          text: "Rolling usage is 26.4% above its comparison baseline.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:rounded",
          title: "The recent comparison moved materially",
          text: "The current difference is about 319.5 kWh, which may merit a closer look.",
          epistemicStatus: "inferred",
          evidenceRefs: [evidenceRef],
        }, {
          id: "candidate:unsupported",
          title: "An unrelated exact claim",
          text: "The current difference is 777.7 kWh.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:rounded",
    });

    expect(result).toMatchObject({
      status: "available",
      insights: [{ id: "candidate:rounded" }],
      publication: {
        discoveredCount: 2,
        acceptedCount: 1,
        rejectedCount: 1,
        rejectedCandidateIds: ["candidate:unsupported"],
      },
    });
  });

  it("accepts a positive display magnitude when explicit wording preserves a negative change direction", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["trend-and-demand"];
    if (!pack.facts.comparison) throw new Error("Expected comparison fixture.");
    pack.facts.comparison = {
      ...pack.facts.comparison,
      changePct: -6.8829,
    };
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: "Project usage was down 6.9% versus the previous period.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:direction-preserved",
          title: "The current period used less energy",
          text: "Usage fell 6.9% versus the previous period; the supplied facts do not establish a cause.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:direction-preserved",
    });

    expect(result.summary?.text).toBe("Project usage was down 6.9% versus the previous period.");
    expect(result.insights.map(({ id }) => id)).toEqual(["candidate:direction-preserved"]);
  });

  it("keeps supported anomaly actual-versus-baseline wording and a below-baseline decrease", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["decision-priorities"];
    pack.facts.decisionPriorities = {
      status: "available",
      limitation: null,
      evidencePins: {} as never,
      items: [{
        finding: {
          code: "DAILY_USAGE_ABOVE_BASELINE",
          actualKwh: 196.7027,
          baselineKwh: 156.6008,
          relativePct: 25.6078,
        },
        horizons: [{
          horizon: "latest_complete_day",
          relativePct: -4.5222,
        }, {
          horizon: "rolling_7d",
          relativePct: 1.3805,
        }],
        driver: {
          status: "available",
          label: "Level 6",
          impactKwh: 21.4275,
        },
        evidence: {
          occurrence: {
            scopeId: "project",
            scopeName: "Ngee Ann Polytechnic",
            scopeType: "project",
            localDate: "2026-08-01",
          },
        },
      } as never],
    };
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: "One daily usage exception is available for review.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:supported-actual-versus-baseline",
          title: "The daily exception was above its comparison baseline",
          text: "Daily usage was 25.6% above baseline (196.7 kWh vs 156.6 kWh).",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }, {
          id: "candidate:supported-below-baseline",
          title: "Recent usage returned close to baseline",
          text: "The latest complete day was 4.5% below baseline.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }, {
          id: "candidate:wrong-direction",
          title: "Latest usage rose above baseline",
          text: "The latest complete day was 4.5% above baseline.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:decision-phrasing",
    });

    expect(result.insights.map(({ id }) => id)).toEqual([
      "candidate:supported-actual-versus-baseline",
      "candidate:supported-below-baseline",
    ]);
    expect(result.publication.rejectedCandidateIds).toEqual(["candidate:wrong-direction"]);
  });

  it("rejects year-over-year wording when the Pack only supplies a previous-period comparison", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["circuit-concentration"];
    pack.facts.categories = [{
      category: "light",
      usageKwh: 100,
      sharePct: 20,
      comparison: { usageKwh: 110, changeKwh: -10, changePct: -10 },
    } as never];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: "Load and lighting comparisons are available for the selected periods.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:unsupported-yoy",
          title: "Lighting changed year-over-year",
          text: "Lighting fell 10% year-over-year.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }, {
          id: "candidate:supported-previous-period",
          title: "Lighting changed from the previous comparison period",
          text: "Lighting fell 10% versus the previous comparison period.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:comparison-time-basis",
    });

    expect(result.insights.map(({ id }) => id)).toEqual(["candidate:supported-previous-period"]);
    expect(result.publication.rejectedCandidateIds).toEqual(["candidate:unsupported-yoy"]);
  });

  it("removes an unknown Level from Summary while preserving an exact Circuit name", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["circuit-concentration"];
    pack.facts.levels = [{
      nodeId: "level-7",
      name: "Level 7",
      usageKwh: 700,
    }, {
      nodeId: "level-6",
      name: "Level 6",
      usageKwh: 600,
    }] as never;
    pack.facts.circuits = [{
      scopeId: "l7-load-4",
      parentScopeId: "level-7",
      name: "Lvl 7 Office Load 4",
      usageKwh: 400,
    }, {
      scopeId: "l7-load-3",
      parentScopeId: "level-7",
      name: "Lvl 7 Office Load 3",
      usageKwh: 300,
    }] as never;
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: "The load comparison identifies Level 7 as the larger contributor. The top components are Lvl 7 Office Load 4 and Lvl 3 circuits.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:exact-circuit-name",
          title: "Lvl 7 Office Load 3 remains a named circuit",
          text: "Lvl 7 Office Load 3 is present in the published Circuit list.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:level-vocabulary",
    });

    expect(result.summary?.text).toBe("The load comparison identifies Level 7 as the larger contributor.");
    expect(result.insights.map(({ id }) => id)).toEqual(["candidate:exact-circuit-name"]);
  });

  it("rejects numeric facts attached to the wrong metric meaning while preserving a supported sibling", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["decision-priorities"];
    pack.facts.decisionPriorities = {
      status: "available",
      limitation: null,
      evidencePins: {} as never,
      items: [{
        finding: {
          code: "DAILY_USAGE_ABOVE_BASELINE",
          title: "Level 7 recorded a daily usage exception.",
          actualKwh: 3_046.478,
          baselineKwh: 2_025.584,
          relativePct: 50.4,
        },
        evidence: {
          occurrence: {
            scopeId: "level-7",
            scopeName: "Level 7",
            scopeType: "level",
          },
        },
      } as never],
    };
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: "Level 7 recorded a daily usage exception in the current period.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:wrong-metric-binding",
          title: "Half of all usage occurs outside operating hours",
          text: "50.4% of total usage (3,046.478 kWh) happened outside operating hours.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }, {
          id: "candidate:wrong-entity-binding",
          title: "Level 6 is materially above its daily baseline",
          text: "Level 6 used 3,046.478 kWh, which is 50.4% above its 2,025.584 kWh baseline.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }, {
          id: "candidate:correct-metric-binding",
          title: "Level 7 is materially above its daily baseline",
          text: "Level 7 used 3,046.478 kWh, which is 50.4% above its 2,025.584 kWh baseline.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:semantic-number-binding",
    });

    expect(result.insights.map(({ id }) => id)).toEqual(["candidate:correct-metric-binding"]);
    expect(result.publication.rejectedCandidateIds).toEqual([
      "candidate:wrong-metric-binding",
      "candidate:wrong-entity-binding",
    ]);
  });

  it("keeps the same off-hours wording when the cited numbers come from the off-hours facts", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    pack.facts.offHours = {
      status: "available",
      usageKwh: 2_255.9,
      standbyKwh: 2_255.9,
      operatingKwh: 2_220.29,
      sharePct: 50.4,
    } as never;
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: "The current time-behaviour facts include an off-hours split.",
          evidenceRefs: [evidenceRef],
        },
        candidates: [{
          id: "candidate:correct-off-hours-binding",
          title: "Off-hours usage is material",
          text: "50.4% of total usage (2,255.9 kWh) happened outside operating hours.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:correct-off-hours-binding",
    });

    expect(result.insights.map(({ id }) => id)).toEqual(["candidate:correct-off-hours-binding"]);
  });

  it("keeps an exploratory angle but lowers an observed label when the narrative contains a hypothesis", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;
    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "time-behaviour",
        status: "available",
        summary: { text: "The current hourly pattern is available for review.", evidenceRefs: [evidenceRef] },
        candidates: [{
          id: "candidate:honest-hypothesis",
          title: "The flat base may indicate an always-on load",
          text: "The observed shape suggests that one or more systems remain active outside occupied hours.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:honest-hypothesis",
    });

    expect(result.insights).toEqual([expect.objectContaining({
      id: "candidate:honest-hypothesis",
      epistemicStatus: "inferred",
    })]);
  });

  it("does not present a suggesting relationship as directly observed", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["trend-and-demand"];
    if (!pack.facts.dailyTotals) throw new Error("Expected daily totals fixture.");
    pack.facts.dailyTotals = {
      ...pack.facts.dailyTotals,
      scopes: [{ scopeId: "level-7", scopeName: "Level 7", rows: [] } as never],
    };
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;
    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "trend-and-demand",
        status: "available",
        summary: { text: "The current demand trend is available for review.", evidenceRefs: [evidenceRef] },
        candidates: [{
          id: "candidate:suggesting-relationship",
          title: "The change is concentrated on one level",
          text: "The difference is concentrated on Level 7, suggesting a level-specific operational change.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:suggesting-relationship",
    });

    expect(result.insights).toEqual([expect.objectContaining({
      id: "candidate:suggesting-relationship",
      epistemicStatus: "inferred",
    })]);
  });

  it("keeps an actionable angle but does not label the recommendation as directly observed", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["decision-priorities"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;
    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "decision-priorities",
        status: "available",
        summary: { text: "The current priority signal is available for review.", evidenceRefs: [evidenceRef] },
        candidates: [{
          id: "candidate:actionable",
          title: "Load circuits drive current consumption",
          text: "Focus efficiency efforts on load circuits before changing the operating schedule.",
          epistemicStatus: "observed",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:actionable",
    });

    expect(result.insights).toEqual([expect.objectContaining({
      id: "candidate:actionable",
      epistemicStatus: "inferred",
    })]);
  });

  it("keeps a useful summary and insight within the readable Ngee Ann card budget", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;
    const summaryText = `A supported operational pattern matters to the current review. ${"It links the observed schedule to a focused management question. ".repeat(8)}`;
    const insightText = `This is a supported, decision-relevant explanation of the current hourly pattern. ${"It preserves the useful reasoning instead of deleting the whole card at an arbitrary sentence boundary. ".repeat(6)}`;

    const result = materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "time-behaviour",
        status: "available",
        summary: { text: summaryText, evidenceRefs: [evidenceRef] },
        candidates: [{
          id: "candidate:readable-long-form",
          title: "The current schedule supports a focused operational question",
          text: insightText,
          epistemicStatus: "inferred",
          evidenceRefs: [evidenceRef],
        }],
      }),
      pack,
      identity,
      runId: "run:ngee:readable-long-form",
    });

    expect(summaryText.length).toBeGreaterThan(480);
    expect(insightText.length).toBeGreaterThan(480);
    expect(result).toMatchObject({
      status: "available",
      summary: { text: summaryText },
      insights: [{ id: "candidate:readable-long-form", text: insightText }],
    });
  });

  it("rejects an embedded or wrong-root response instead of searching for JSON inside text", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["circuit-concentration"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });

    expect(() => materializeNgeeAnnSectionResult({
      answer: `Here is the result: ${JSON.stringify({ sectionId: pack.sectionId, status: "empty", candidates: [] })}`,
      pack,
      identity,
      runId: "run:ngee:bad",
    })).toThrow("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
  });
});

describe("buildNgeeAnnSectionPrompt", () => {
  it("gives the Provider authoritative project-local report dates and peak time instead of raw UTC instants", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["trend-and-demand"];

    const prompt = buildNgeeAnnSectionPrompt(pack);

    expect(prompt).toContain('"timezone":"Asia/Singapore"');
    expect(prompt).toContain('"displayLabel":"20 May 2026–16 Jun 2026"');
    expect(prompt).toContain('"peakAtLocal":"2026-06-05 14:15"');
    expect(prompt).toContain("Do not call one day type higher or lower than another unless the profile values support that direction.");
    expect(prompt).toContain("Comparison fields describe the previous comparison period, never year-over-year");
    expect(prompt).toContain('"fromLocalDate":"2026-04-22"');
    expect(prompt).toContain('"toExclusiveLocalDate":"2026-05-20"');
    expect(prompt).not.toContain("2026-06-05T06:15:00.000Z");
    expect(prompt).not.toContain("2026-04-21T16:00:00.000Z");
    expect(prompt).not.toContain('"analysisPeriod":{"from":"2026-05-19T16:00:00.000Z"');
  });

  it("accepts an exact project-local peak time and rejects the raw UTC clock time", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["trend-and-demand"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const evidenceRef = pack.evidence[0]!.id;
    const resultFor = (clockTime: string) => materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: `Peak demand was recorded at ${clockTime} project time.`,
          evidenceRefs: [evidenceRef],
        },
        candidates: [],
      }),
      pack,
      identity,
      runId: "run:ngee:local-time",
    });

    expect(resultFor("14:15")).toMatchObject({ status: "available" });
    expect(() => resultFor("06:15")).toThrow("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
  });

  it("projects local-hour buckets as readable clock labels and accepts an exact local-hour conclusion", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    const timeBehaviour = pack.facts.timeBehaviour;
    if (!timeBehaviour) throw new Error("TEST_TIME_BEHAVIOUR_REQUIRED");
    pack.facts.timeBehaviour = {
      ...timeBehaviour,
      scopes: [{
        scopeId: "project",
        scopeName: "Ngee Ann Polytechnic",
        scopeType: "project",
        cells: [{
          localDate: "2026-06-05",
          localHour: 18,
          from: "2026-06-05T10:00:00.000Z",
          to: "2026-06-05T11:00:00.000Z",
          usageKwh: 4.6,
          dataHealth: {
            status: "complete",
            coveragePct: 100,
            expectedMeterIntervalCount: 2,
            validIntervalCount: 2,
            qualityEventCount: 0,
          },
        }],
      }],
    };
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const prompt = buildNgeeAnnSectionPrompt(pack);

    expect(prompt).toContain('"cellFieldOrder":["localDate","localHourLocal"');
    expect(prompt).toContain('"18:00"');
    expect(materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: pack.sectionId,
        status: "available",
        summary: {
          text: "The accepted weekday profile drops after 18:00 local time.",
          evidenceRefs: [pack.evidence[0]!.id],
        },
        candidates: [],
      }),
      pack,
      identity,
      runId: "run:ngee:local-hour",
    })).toMatchObject({ status: "available" });
  });

  it("recovers only the observed root-anchored summary-wrapper punctuation defect", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["trend-and-demand"];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    const malformed = `{"sectionId":"${pack.sectionId}","status":"available","summary":{"text":"The current Pack supports a useful conclusion.","evidenceRefs":["${pack.evidence[0]!.id}"],"candidates":[],"limitation":"No occupancy data was supplied."}`;

    expect(materializeNgeeAnnSectionResult({
      answer: malformed,
      pack,
      identity,
      runId: "run:ngee:bounded-envelope-repair",
    })).toMatchObject({
      status: "available",
      summary: { text: "The current Pack supports a useful conclusion." },
      limitation: "No occupancy data was supplied.",
      publication: { discoveredCount: 0 },
    });
    expect(() => materializeNgeeAnnSectionResult({
      answer: `Here is the result: ${malformed}`,
      pack,
      identity,
      runId: "run:ngee:no-preamble-repair",
    })).toThrow("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
  });

  it("keeps every current time cell in a compact projection instead of rejecting a complete Pack", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    const timeBehaviour = pack.facts.timeBehaviour;
    if (!timeBehaviour) throw new Error("TEST_TIME_BEHAVIOUR_REQUIRED");
    pack.facts.timeBehaviour = {
      ...timeBehaviour,
      scopes: Array.from({ length: 3 }, (_, scopeIndex) => ({
        scopeId: `scope-${scopeIndex + 1}`,
        scopeName: `Scope ${scopeIndex + 1}`,
        scopeType: scopeIndex === 0 ? "project" : "level",
        cells: Array.from({ length: 672 }, (_, index) => ({
          localDate: `2026-06-${String(Math.floor(index / 24) + 1).padStart(2, "0")}`,
          localHour: index % 24,
          from: `from-${scopeIndex}-${index}`,
          to: `to-${scopeIndex}-${index}`,
          usageKwh: scopeIndex * 1_000 + index + 0.125,
          dataHealth: {
            status: "complete",
            coveragePct: 100,
            expectedMeterIntervalCount: 2,
            validIntervalCount: 2,
            qualityEventCount: 0,
          },
        })),
      })),
    };

    const prompt = buildNgeeAnnSectionPrompt(pack);

    expect(prompt.length).toBeLessThan(220_000);
    expect(prompt).toContain("scope-3");
    expect(prompt).toContain("2671.125");
    expect(prompt).toContain("projectedRowCount");
    expect(prompt).toContain("2016");
    expect(prompt).not.toContain('"hourlyProfile"');
    expect(prompt).toContain("mean energy per complete classified day");
    expect(prompt).toContain("never label it kWh/h");
  });

  it("bounds the Holiday prompt without discarding the authoritative comparison", () => {
    const source = snapshot();
    const comparisonEvidence = {
      dataSnapshotId: "snapshot-ngee",
      projectReleaseId: "release-ngee",
      comparisonWindowId: "school-holiday-comparison" as const,
      reportTimePolicyRevision: "ngee-ann-report-time@2",
      businessCalendarVersion: "sg-calendar-holiday-v2",
      ruleRevision: "comparison.school_holiday_context@1",
      metricId: "energy.total_usage_kwh@1" as const,
      queryIds: ["school_holiday_context_facts_v1"] as ["school_holiday_context_facts_v1"],
      period: { from: "2026-02-17", toExclusive: "2026-06-17" },
      actualRefs: Array.from({ length: 80 }, (_, index) => `actual:${index}`),
      baselineRefs: Array.from({ length: 80 }, (_, index) => `baseline:${index}`),
    };
    source.schoolHolidayComparison = {
      status: "available",
      contract: "energyiq-school-holiday-comparison@1",
      identity: {
        projectId: "ngee-ann-polytechnic",
        scopeId: "ngee-ann-polytechnic",
        dataSnapshotId: "snapshot-ngee",
        projectReleaseId: "release-ngee",
        comparisonWindowId: "school-holiday-comparison",
        reportTimePolicyRevision: "ngee-ann-report-time@2",
        period: { from: "2026-02-17", toExclusive: "2026-06-17" },
        businessCalendarVersion: "sg-calendar-holiday-v2",
        ruleRevision: "comparison.school_holiday_context@1",
      },
      selectedHolidayInterval: {
        academicPhase: "term_break",
        from: "2026-05-25",
        toExclusive: "2026-06-16",
      },
      comparisons: [{
        dayContext: "weekday",
        weekPart: "weekday",
        isPublicHoliday: false,
        status: "available",
        actual: { academicPhase: "term_break", averageKwh: 91.25, sampleCount: 12 },
        baseline: { academicPhase: "teaching", averageKwh: 103.5, sampleCount: 24 },
        deltaKwh: -12.25,
        deltaPercent: -11.84,
        evidence: comparisonEvidence,
      }],
      hourlyProfile: {
        status: "available",
        dayContext: "weekday",
        actualSampleCount: 12,
        baselineSampleCount: 24,
        values: Array.from({ length: 24 }, (_, localHour) => ({
          localHour,
          actualAverageKwh: 2 + localHour,
          baselineAverageKwh: 3 + localHour,
          deltaKwh: -1,
        })),
      },
      anomalies: Array.from({ length: 120 }, (_, index) => ({
        localDate: `2026-05-${String((index % 28) + 1).padStart(2, "0")}`,
        academicPhase: "term_break" as const,
        schoolHolidayState: "school_holiday" as const,
        dayContext: "weekday" as const,
        actualKwh: 100 + index,
        baselineKwh: 90,
        baselineSampleCount: 24,
        deltaKwh: 10 + index,
        deltaPercent: 11.11 + index,
        baselineDates: Array.from({ length: 80 }, (_, baselineIndex) => `2026-04-${baselineIndex}:${index}`),
        evidence: comparisonEvidence,
      })),
      quality: {
        expectedDayCount: 120,
        completeDayCount: 120,
        coveragePct: 100,
        excludedLocalDates: [],
      },
      excludedAcademicPhases: [],
      limitations: ["The comparison is limited to the supplied same-context cohort."],
    };
    const pack = assembleNgeeAnnSectionPacks(source, ["school-holiday-comparison"])
      ["school-holiday-comparison"];

    const prompt = buildNgeeAnnSectionPrompt(pack);

    expect(prompt.length).toBeLessThan(80_000);
    expect(prompt).toContain('"anomalyCount":120');
    expect(prompt).toContain('"deltaPercent":-11.84');
    expect(prompt).toContain('"topAnomalies"');
    expect(prompt).not.toContain('"actual:79"');
    expect(prompt).not.toContain('"baseline:79"');
    expect(prompt).not.toContain('"2026-04-79:119"');
  });

  it("does not validate a number from a raw field that was intentionally omitted from the prompt", () => {
    const pack = assembleNgeeAnnSectionPacks(snapshot())["time-behaviour"];
    pack.facts.hourlyProfile = [{
      hour: 14,
      usageKwh: 360.2,
      averageKw: 12.86,
      peakKw: 22.5,
      observationCount: 28,
    }];
    const identity = createNgeeAnnOverviewAiSectionArtifactIdentity({
      baseIdentity: baseIdentity(),
      targetId: pack.sectionId,
    });
    expect(() => materializeNgeeAnnSectionResult({
      answer: JSON.stringify({
        sectionId: "time-behaviour",
        status: "available",
        summary: {
          text: "The hourly profile reaches 360.2 kWh/h.",
          evidenceRefs: [pack.evidence[0]!.id],
        },
        candidates: [],
      }),
      pack,
      identity,
      runId: "run:ngee:omitted-raw-field",
    })).toThrow("ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID");
  });
});

describe("createNgeeAnnSectionInterpreter", () => {
  it("stores the Holiday explanation under the exact Overview period while retaining 120-day evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "ngee-holiday-artifact-binding-"));
    const metadataStore = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadataStore.workspaces.upsert({
        id: "workspace-ngee",
        owner_user_id: "dev-user",
        name: "Ngee Ann test",
        kind: "customer",
      });
      metadataStore.energyIq.upsertProject({
        id: "ngee-ann-polytechnic",
        workspace_id: "workspace-ngee",
        name: "Ngee Ann Polytechnic",
        status: "published",
      });
      const source = snapshot();
      source.schoolHolidayComparison = {
        status: "unavailable",
        contract: "energyiq-school-holiday-comparison@1",
        identity: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "ngee-ann-polytechnic",
          dataSnapshotId: "snapshot-ngee",
          projectReleaseId: "release-ngee",
          comparisonWindowId: "school-holiday-comparison",
          reportTimePolicyRevision: "ngee-ann-report-time@2",
          period: { from: "2026-02-17", toExclusive: "2026-06-17" },
          businessCalendarVersion: "sg-calendar-holiday-v2",
          ruleRevision: "comparison.school_holiday_context@1",
        },
        reason: { code: "FACT_COVERAGE_INCOMPLETE", message: "Holiday facts are incomplete." },
      };
      const packs = assembleNgeeAnnSectionPacks(source, ["school-holiday-comparison"]);
      const interpreter = createNgeeAnnSectionInterpreter({
        metadataStore,
        runSection: async ({ identity, runId, sessionId }) => ({
          answer: JSON.stringify({
            sectionId: identity.targetId,
            status: "available",
            summary: {
              text: "The exact Holiday comparison is available for management review.",
              evidenceRefs: ["evidence:snapshot-ngee:project"],
            },
            candidates: [],
          }),
          runId,
          sessionId,
        }),
      });

      const result = await interpreter.execute({
        baseIdentity: baseIdentity(),
        packs,
        sectionIds: ["school-holiday-comparison"],
        user: { id: "dev-user" } as UserRecord,
      });

      expect(result["school-holiday-comparison"].status).toBe("available");
      expect(JSON.parse(result["school-holiday-comparison"].result_json!).binding.analysisPeriod).toEqual({
        from: "2026-05-19T16:00:00.000Z",
        to: "2026-06-16T16:00:00.000Z",
      });
      expect(packs["school-holiday-comparison"].facts.schoolHolidayComparison).toMatchObject({
        identity: { period: { from: "2026-02-17", toExclusive: "2026-06-17" } },
      });
    } finally {
      metadataStore.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("runs at most two independent Sections together and keeps good siblings when one fails", async () => {
    const records = new Map<string, EnergyIqOverviewAiArtifactRecord>();
    const store = fakeArtifactStore(records);
    let active = 0;
    let maxActive = 0;
    const runSection = vi.fn(async (input: {
      identity: EnergyIqOverviewAiArtifactIdentity;
      runId: string;
      sessionId: string;
    }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      const sectionId = input.identity.targetId!;
      const answer = sectionId === "circuit-concentration"
        ? "not-json"
        : JSON.stringify({
            sectionId,
            status: "available",
            summary: {
              text: "The current Section Evidence supports a concise management summary.",
              evidenceRefs: ["evidence:snapshot-ngee:project"],
            },
            candidates: [],
          });
      return { answer, runId: input.runId, sessionId: input.sessionId };
    });
    const interpreter = createNgeeAnnSectionInterpreter({
      metadataStore: { energyIq: { overviewAiArtifacts: store } } as unknown as MetadataStore,
      runSection,
    });
    const source = snapshot();
    const packs = assembleNgeeAnnSectionPacks(source);

    const first = await interpreter.execute({
      baseIdentity: baseIdentity(),
      packs,
      user: { id: "dev-user" } as UserRecord,
    });

    expect(runSection).toHaveBeenCalledTimes(5);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(first["trend-and-demand"].status).toBe("available");
    expect(first["time-behaviour"].status).toBe("available");
    expect(first["circuit-concentration"]).toMatchObject({
      status: "failed",
      error_code: "ENERGYIQ_NGEE_ANN_SECTION_RESULT_INVALID",
    });
    expect(first["decision-priorities"].status).toBe("available");
    expect(first["school-holiday-comparison"].status).toBe("available");
    expect(JSON.parse(first["school-holiday-comparison"].result_json!).binding.analysisPeriod).toEqual({
      from: "2026-05-19T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z",
    });
    await interpreter.execute({
      baseIdentity: baseIdentity(),
      packs,
      user: { id: "dev-user" } as UserRecord,
    });
    expect(runSection).toHaveBeenCalledTimes(5);

    runSection.mockImplementationOnce(async (input) => ({
      answer: JSON.stringify({
        sectionId: input.identity.targetId,
        status: "available",
        summary: {
          text: "The current Circuit Evidence supports a concise management summary.",
          evidenceRefs: ["evidence:snapshot-ngee:project"],
        },
        candidates: [],
      }),
      runId: input.runId,
      sessionId: input.sessionId,
    }));
    const retried = await interpreter.execute({
      baseIdentity: baseIdentity(),
      packs,
      user: { id: "dev-user" } as UserRecord,
      retryTargets: ["circuit-concentration"],
    });
    expect(runSection).toHaveBeenCalledTimes(6);
    expect(retried["circuit-concentration"].status).toBe("available");
  });
});

const baseIdentity = () => createOverviewAiArtifactIdentity({
  workspaceId: "workspace-ngee",
  projectId: "ngee-ann-polytechnic",
  scopeId: "ngee-ann-polytechnic",
  dataSnapshotId: "snapshot-ngee",
  projectReleaseId: "release-ngee",
  analysisPeriodFrom: "2026-05-19T16:00:00.000Z",
  analysisPeriodTo: "2026-06-16T16:00:00.000Z",
  rendererKey: "ngee-ann-overview",
  rendererVersion: "1",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 8,
});

const dayProfile = (
  dayType: "weekday" | "weekend" | "public_holiday",
  usageKwh: number,
) => ({
  dayType,
  scopeId: "ngee-ann-polytechnic",
  scopeName: "Ngee Ann Polytechnic",
  status: "available" as const,
  sampleDayCount: 1,
  values: [{ localHour: 14, usageKwh }],
});

const snapshot = (): ProjectAnalysisSnapshot => ({
  context: {
    workspaceId: "workspace-ngee",
    projectId: "ngee-ann-polytechnic",
    scopeId: "ngee-ann-polytechnic",
    primaryPeriod: { start: "2026-05-19T16:00:00.000Z", endExclusive: "2026-06-16T16:00:00.000Z" },
    timezone: "Asia/Singapore",
  } as ProjectAnalysisSnapshot["context"],
  projectRelease: { id: "release-ngee" } as ProjectAnalysisSnapshot["projectRelease"],
  recipe: { id: "energy-scope-analysis", version: "1" },
  renderer: { key: "ngee-ann-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
  dataQuality: { status: "complete", coveragePct: 100, expectedMeterIntervalCount: 1, validIntervalCount: 1, qualityEventCount: 0, cumulativeDeltaMismatchCount: 0, averageKwMismatchCount: 0, invalidIntervalDurationCount: 0, importBatchIds: ["batch"] },
  evidence: [{ id: "evidence:snapshot-ngee:project", metricId: "energy.total_usage_kwh@1", queryIds: ["scope_summary_v1", "time_bucket_grid_v1", "meter_breakdown_v1"] }],
  findings: [],
  decisionPriorities: { status: "empty", limitation: null, evidencePins: {} as never, items: [] },
  dataSnapshot: { id: "snapshot-ngee", importBatchIds: ["batch"], lastSeenAt: null },
  reportTimeContext: {
    contractRevision: "energyiq-report-time-context@1",
    binding: {
      workspaceId: "workspace-ngee",
      projectId: "ngee-ann-polytechnic",
      scopeId: "ngee-ann-polytechnic",
      resource: "electricity",
      dataSnapshotId: "snapshot-ngee",
      projectReleaseId: "release-ngee",
    },
    timezone: "Asia/Singapore",
    asOf: "2026-06-16T16:00:00.000Z",
    acceptedDataEndExclusive: "2026-06-16T16:00:00.000Z",
    dataThroughLocalDate: "2026-06-16",
    lastRefreshedAt: "2026-06-16T16:00:00.000Z",
    policyId: "ngee-ann-report-time",
    policyRevision: "2",
    windows: [{
      windowId: "school-holiday-comparison",
      role: "comparison",
      label: "School Holiday comparison",
      strategy: { kind: "rolling_complete_days", days: 120 },
      phase: "complete",
      from: "2026-02-16T16:00:00.000Z",
      toExclusive: "2026-06-16T16:00:00.000Z",
      completeDayCount: 120,
      segments: [{ from: "2026-02-16T16:00:00.000Z", toExclusive: "2026-06-16T16:00:00.000Z" }],
      comparisonCompatibilityKey: "school-holiday-comparison",
    }],
  },
  metadata: { status: "missing" } as ProjectAnalysisSnapshot["metadata"],
  analysis: {
    context: {} as never,
    latestAcceptedReading: { status: "not_applicable", queryId: "latest_accepted_reading_v1", reason: { code: "INTERVAL_USAGE_SOURCE", message: "Interval source" } },
    summary: {
      usageKwh: 9_736.42,
      averageDailyUsageKwh: 347.73,
      peakKw: 138.8,
      peakAt: "2026-06-05T06:15:00.000Z",
      validIntervalCount: 1,
      qualityEventCount: 0,
    },
    hourlyProfile: [{ hour: 9, usageKwh: 100, averageKw: 12, peakKw: 18, observationCount: 28 }],
    dailyTotals: { metricId: "energy.total_usage_kwh@1", grain: "day", timezone: "Asia/Singapore", scopes: [] },
    timeBehaviour: { metricId: "energy.total_usage_kwh@1", grain: "hour", unit: "kWh", timezone: "Asia/Singapore", queryId: "time_bucket_grid_v1", scopes: [], dayProfiles: [] },
    componentHourlyProfiles: { metricId: "energy.total_usage_kwh@1", queryId: "component_hourly_profiles_v1", accountingBasis: "published_component_circuits", grain: "hour", unit: "kWh", timezone: "Asia/Singapore", scopes: [] },
    comparison: { from: "2026-04-21T16:00:00.000Z", to: "2026-05-19T16:00:00.000Z", usageKwh: 9_000, changeKwh: 736.42, changePct: 8.18 },
    categories: [], childScopes: [], circuits: [], topCircuits: [], designatedTotals: [], virtualMeters: [],
    componentReconciliation: { officialUsageKwh: 9_736.42, componentUsageKwh: 9_000, gapKwh: 736.42, ratioPct: 92.44, officialMeterNodeIds: [], componentMeterNodeIds: [] },
    offHours: { status: "unavailable", reason: { code: "OPERATING_CALENDAR_VERSION_MISSING", message: "Calendar unavailable" } },
    cost: { status: "unavailable", reason: { code: "TARIFF_VERSION_MISSING", message: "Tariff unavailable" } },
    dataHealth: { status: "complete", coveragePct: 100, expectedMeterIntervalCount: 1, validIntervalCount: 1, qualityEventCount: 0, cumulativeDeltaMismatchCount: 0, averageKwMismatchCount: 0, invalidIntervalDurationCount: 0, importBatchIds: ["batch"] },
    units: { usage: "kWh", demand: "kW", intervalMinutes: 30, timezone: "Asia/Singapore" },
    attention: [],
    provenance: { dataSnapshotId: "snapshot-ngee", hierarchyRevisionId: "hierarchy", meterMappingRevisionId: "mapping", meterFormulaRevisionId: "formula", metricVersion: "metrics", ruleRevisionIds: [], aggregationRule: "designated_total", sourceView: "facts", queryIds: ["scope_summary_v1", "time_bucket_grid_v1", "meter_breakdown_v1"] },
    metadata: {} as never,
  },
});

const fakeArtifactStore = (
  records: Map<string, EnergyIqOverviewAiArtifactRecord>,
) => ({
  find: (identity: EnergyIqOverviewAiArtifactIdentity) => records.get(JSON.stringify(identity)),
  get: (identity: EnergyIqOverviewAiArtifactIdentity) => records.get(JSON.stringify(identity))!,
  queue: ({ identity, triggeredBy }: { identity: EnergyIqOverviewAiArtifactIdentity; triggeredBy: string }) => {
    const record = artifactRecord(identity, "queued", triggeredBy);
    records.set(JSON.stringify(identity), record);
    return record;
  },
  claim: ({ identity }: { identity: EnergyIqOverviewAiArtifactIdentity }) => {
    const record = artifactRecord(identity, "running", "dev-user");
    records.set(JSON.stringify(identity), record);
    return { claimed: true, artifact: record };
  },
  complete: ({ identity, resultJson }: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    resultJson: string;
  }) => {
    const record = { ...artifactRecord(identity, "available", "dev-user"), result_json: resultJson };
    records.set(JSON.stringify(identity), record);
    return record;
  },
  fail: ({ identity, errorCode }: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    errorCode: string;
  }) => {
    const record = { ...artifactRecord(identity, "failed", "dev-user"), error_code: errorCode };
    records.set(JSON.stringify(identity), record);
    return record;
  },
});

const artifactRecord = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  status: EnergyIqOverviewAiArtifactRecord["status"],
  triggeredBy: string,
): EnergyIqOverviewAiArtifactRecord => ({
  id: `artifact:${identity.targetId}`,
  identity_hash: "hash",
  identity_json: JSON.stringify(identity),
  workspace_id: identity.workspaceId,
  project_id: identity.projectId,
  scope_id: identity.scopeId,
  resource: "electricity",
  data_snapshot_id: identity.dataSnapshotId,
  project_release_id: identity.projectReleaseId,
  renderer_key: identity.rendererKey,
  renderer_version: identity.rendererVersion,
  analysis_pack_id: identity.analysisPackId,
  analysis_pack_revision: identity.analysisPackRevision,
  model_profile_id: identity.modelProfileId,
  model_profile_revision: identity.modelProfileRevision,
  output_contract_revision: identity.outputContractRevision,
  validator_revision: identity.validatorRevision,
  status,
  attempt_count: status === "queued" ? 0 : 1,
  triggered_by: triggeredBy,
  created_at: "2026-08-17T00:00:00.000Z",
  updated_at: "2026-08-17T00:01:00.000Z",
  ...(status === "available" || status === "failed"
    ? { completed_at: "2026-08-17T00:01:00.000Z" }
    : {}),
});
