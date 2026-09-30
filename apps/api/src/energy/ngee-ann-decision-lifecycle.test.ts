import type { EnergyIqSavedAnalysisRecord } from "@datafoundry/metadata";
import { describe, expect, it } from "vitest";

import type { EnergyDailyUsageAnomalies } from "./energy-analysis.js";
import {
  buildNgeeAnnDecisionLifecycle,
  ngeeAnnDecisionThemeKey,
} from "./ngee-ann-decision-lifecycle.js";
import type { NgeeAnnDecisionPriorities } from "./ngee-ann-decision-priorities.js";

describe("buildNgeeAnnDecisionLifecycle", () => {
  it("fails closed without a compatible saved Overview", () => {
    const result = buildLifecycle({ savedAnalyses: [] });

    expect(result).toMatchObject({
      status: "unavailable",
      reference: null,
      items: [],
      limitation: { code: "NO_COMPATIBLE_SAVED_ANALYSIS" },
    });
  });

  it("labels B as newly supported when saved A could not form governed anomaly Evidence", () => {
    const result = buildLifecycle({
      savedAnalyses: [savedAnalysis(unavailableDaily())],
    });

    expect(result).toMatchObject({
      status: "available",
      reference: {
        savedAnalysisId: "saved-a",
        dataSnapshotId: "snapshot-a",
        evidenceStatus: "unavailable",
      },
      items: [{
        themeKey: ngeeAnnDecisionThemeKey("project"),
        kind: "newly_supported",
        currentPriorityId: "priority-b",
        currentBundleId: "bundle-b",
        previousBundleId: null,
      }],
      limitation: null,
    });
  });

  it("distinguishes a new theme from a recurring theme", () => {
    const newTheme = buildLifecycle({
      savedAnalyses: [savedAnalysis(availableDaily([], "snapshot-a", "bundle-a"))],
    });
    const recurringTheme = buildLifecycle({
      savedAnalyses: [savedAnalysis(availableDaily(["triggered"], "snapshot-a", "bundle-a"))],
    });

    expect(newTheme.items[0]?.kind).toBe("new");
    expect(recurringTheme.items[0]).toMatchObject({
      kind: "recurring",
      previousBundleId: "bundle-a",
    });
  });

  it("calls a prior theme resolved only when current B has complete no-trigger Evidence", () => {
    const result = buildLifecycle({
      currentDailyUsageAnomalies: availableDaily(["within_threshold"], "snapshot-b", "bundle-b"),
      currentPriorities: emptyPriorities("empty"),
      savedAnalyses: [savedAnalysis(availableDaily(["triggered"], "snapshot-a", "bundle-a"))],
    });

    expect(result).toMatchObject({
      status: "available",
      items: [{
        kind: "resolved",
        currentPriorityId: null,
        currentBundleId: "bundle-b",
        previousBundleId: "bundle-a",
      }],
      limitation: null,
    });
  });

  it("uses no longer supported instead of resolved when current B is incomplete", () => {
    const result = buildLifecycle({
      currentDailyUsageAnomalies: availableDaily(["suppressed"], "snapshot-b", "bundle-b"),
      currentPriorities: emptyPriorities("suppressed"),
      savedAnalyses: [savedAnalysis(availableDaily(["triggered"], "snapshot-a", "bundle-a"))],
    });

    expect(result).toMatchObject({
      status: "available",
      items: [{ kind: "no_longer_supported" }],
      limitation: { code: "CURRENT_THEME_EVIDENCE_INCOMPLETE" },
    });
  });

  it("skips a newer incompatible record and uses the latest compatible Snapshot", () => {
    const incompatible = {
      ...savedAnalysis(unavailableDaily()),
      id: "saved-bad",
      created_at: "2026-08-07T01:00:00.000Z",
      analysis_json: "{}",
    };
    const result = buildLifecycle({
      savedAnalyses: [incompatible, savedAnalysis(unavailableDaily())],
    });

    expect(result.reference?.savedAnalysisId).toBe("saved-a");
  });
});

const buildLifecycle = (overrides: Partial<Parameters<typeof buildNgeeAnnDecisionLifecycle>[0]> = {}) =>
  buildNgeeAnnDecisionLifecycle({
    projectId: "ngee-ann-polytechnic",
    workspaceId: "workspace-ngee-ann",
    scopeId: "project",
    resource: "electricity",
    templateRevisionId: "template-v1",
    currentDataSnapshotId: "snapshot-b",
    currentPriorities: activePriorities(),
    currentDailyUsageAnomalies: availableDaily(["triggered"], "snapshot-b", "bundle-b"),
    savedAnalyses: [],
    ...overrides,
  });

const activePriorities = (): NgeeAnnDecisionPriorities => ({
  status: "available",
  limitation: null,
  evidencePins: {} as NgeeAnnDecisionPriorities["evidencePins"],
  items: [{ priorityId: "priority-b" } as NgeeAnnDecisionPriorities["items"][number]],
});

const emptyPriorities = (
  status: "empty" | "suppressed",
): NgeeAnnDecisionPriorities => ({
  status,
  limitation: status === "empty" ? null : {
    code: "ALL_CANDIDATE_DATES_SUPPRESSED",
    message: "Current Evidence is incomplete.",
  },
  evidencePins: {} as NgeeAnnDecisionPriorities["evidencePins"],
  items: [],
});

const availableDaily = (
  outcomes: Array<"triggered" | "within_threshold" | "suppressed">,
  snapshotId: string,
  bundleId: string,
): EnergyDailyUsageAnomalies => ({
  status: "available",
  bundleId,
  metricId: "energy.total_usage_kwh@1",
  queryId: "time_slot_anomaly_v1",
  ruleRevisionId: "comparison.daily_usage_above_baseline@1",
  evidencePins: { dataSnapshotId: snapshotId },
  scopes: [{ rows: outcomes.map((outcome) => ({ outcome })) }],
} as EnergyDailyUsageAnomalies);

const unavailableDaily = (): EnergyDailyUsageAnomalies => ({
  status: "unavailable",
  ruleRevisionId: "comparison.daily_usage_above_baseline@1",
  reason: {
    code: "BUSINESS_CALENDAR_NOT_EFFECTIVE_FOR_PERIOD",
    message: "The saved Period was outside the governed Calendar.",
  },
});

const savedAnalysis = (
  dailyUsageAnomalies: EnergyDailyUsageAnomalies,
): EnergyIqSavedAnalysisRecord => ({
  id: "saved-a",
  series_id: "series-a",
  sequence: 1,
  project_id: "ngee-ann-polytechnic",
  workspace_id: "workspace-ngee-ann",
  scope_id: "project",
  scope_name: "Whole project",
  resource: "electricity",
  title: "Saved A",
  query_json: JSON.stringify({
    projectId: "ngee-ann-polytechnic",
    scopeId: "project",
    resource: "electricity",
    analysisWindow: "current-month-to-date",
  }),
  analysis_json: JSON.stringify({
    provenance: { dataSnapshotId: "snapshot-a" },
    dailyUsageAnomalies,
  }),
  template_revision_id: "template-v1",
  data_snapshot_id: "snapshot-a",
  created_by: "dev-user",
  created_at: "2026-08-06T01:00:00.000Z",
});
