import type { MetadataStore } from "@datafoundry/metadata";
import { describe, expect, it, vi } from "vitest";

import {
  resolveProjectOverviewProfile,
  resolveProjectOverviewProfileForRelease,
  resolveSnapshotReportTimePolicy,
  type PublishedProjectRelease,
} from "./project-analysis-resolver.js";

describe("resolveProjectOverviewProfile", () => {
  it("resolves the renderer and current window from the immutable Overview Definition", () => {
    const metadata = definitionMetadata({
      projectId: "customer-project",
      rendererKey: "ngee-ann-overview",
      strategy: { kind: "calendar_month_to_date" },
    });
    expect(resolveProjectOverviewProfile(metadata, "customer-project")).toMatchObject({
      rendererKey: "ngee-ann-overview",
      rendererVersion: "1",
      contractVersion: "project-analysis-snapshot@1",
      primaryWindowId: "primary",
      currentAnalysisWindow: "current-month-to-date",
      source: "overview-definition",
    });
  });

  it("does not invent a customer renderer for an unregistered project", () => {
    expect(resolveProjectOverviewProfile(definitionMetadata(null), "new-project")).toBeNull();
  });

  it("keeps a legacy Preschool Release on the published calendar-month primary window", () => {
    expect(resolveProjectOverviewProfile(definitionMetadata(null), "preschool-demo")).toMatchObject({
      rendererKey: "preschool-overview",
      releaseVersion: 2,
      reportTimePolicyRevisionId: "preschool-report-time@2",
      primaryWindowId: "current-overview",
      currentAnalysisWindow: "current-month-to-date",
      source: "legacy-profile",
    });
  });

  it("resolves a legacy Release from its pinned policy instead of the mutable latest policy", () => {
    const pinnedPolicy = { policyId: "preschool-report-time", revision: "2", windows: [] };
    const latestPolicy = { policyId: "preschool-report-time", revision: "3", windows: [] };
    const getLatest = vi.fn(() => ({ policy: latestPolicy }));
    const metadataStore = {
      energyIq: {
        overviewDefinitions: { get: () => null },
        reportTimePolicies: {
          get: (projectId: string, revisionId: string) => projectId === "preschool-demo"
            && revisionId === "preschool-report-time@2"
            ? { policy: pinnedPolicy }
            : null,
          getLatest,
        },
      },
    } as unknown as MetadataStore;
    const release = {
      projectId: "preschool-demo",
      templateRevisionId: null,
      reportTimePolicyRevisionId: "preschool-report-time@2",
      renderer: { key: "preschool-overview" },
    } as PublishedProjectRelease;

    expect(resolveSnapshotReportTimePolicy({ metadataStore, projectRelease: release }))
      .toEqual(pinnedPolicy);
    expect(getLatest).not.toHaveBeenCalled();
  });

  it("resolves an immutable Release from its exact Definition instead of a newer candidate", () => {
    const getLatestProjectRevision = vi.fn(() => ({ revision_id: "template-b", project_id: "customer-project" }));
    const definitions = {
      "template-a": {
        renderer_key: "ngee-ann-overview",
        time_policy_revision_id: "project-overview-time@1",
        definition: { sections: [{ primaryWindowId: "month-a" }] },
      },
      "template-b": {
        renderer_key: "ngee-ann-overview",
        time_policy_revision_id: "project-overview-time@2",
        definition: { sections: [{ primaryWindowId: "week-b" }] },
      },
    } as const;
    const metadataStore = {
      energyIq: {
        templates: {
          getLatestProjectRevision,
          getProjectRevision: (revisionId: string) => ({
            revision_id: revisionId,
            project_id: "customer-project",
          }),
        },
        overviewDefinitions: {
          get: (revisionId: keyof typeof definitions) => definitions[revisionId] ?? null,
        },
        reportTimePolicies: {
          get: (_projectId: string, revisionId: string) => revisionId === "project-overview-time@1"
            ? { policy: { windows: [{ windowId: "month-a", strategy: { kind: "calendar_month_to_date" } }] } }
            : { policy: { windows: [{ windowId: "week-b", strategy: { kind: "rolling_complete_days", days: 7 } }] } },
        },
      },
    } as unknown as MetadataStore;
    const releaseA = {
      id: "template-a",
      source: "template-revision",
      projectId: "customer-project",
      templateRevisionId: "template-a",
      reportTimePolicyRevisionId: "project-overview-time@1",
      renderer: { key: "ngee-ann-overview" },
    } as PublishedProjectRelease;

    expect(resolveProjectOverviewProfileForRelease(metadataStore, releaseA)).toMatchObject({
      primaryWindowId: "month-a",
      currentAnalysisWindow: "current-month-to-date",
      reportTimePolicyRevisionId: "project-overview-time@1",
    });
    expect(getLatestProjectRevision).not.toHaveBeenCalled();
  });
});

function definitionMetadata(input: null | {
  projectId: string;
  rendererKey: "ngee-ann-overview" | "preschool-overview";
  strategy: { kind: "calendar_month_to_date" } | { kind: "rolling_complete_days"; days: number };
}): MetadataStore {
  const revisionId = input ? `${input.projectId}-template-v1` : null;
  return {
    energyIq: {
      templates: {
        getLatestProjectRevision: (projectId: string) => projectId === input?.projectId
          ? { revision_id: revisionId }
          : null,
      },
      overviewDefinitions: {
        get: (candidateRevisionId: string) => candidateRevisionId === revisionId && input
          ? {
              renderer_key: input.rendererKey,
              time_policy_revision_id: "project-overview-time@1",
              definition: {
                sections: [{ primaryWindowId: "primary" }],
              },
            }
          : null,
      },
      reportTimePolicies: {
        get: (projectId: string, policyRevisionId: string) => projectId === input?.projectId
          && policyRevisionId === "project-overview-time@1"
          ? { policy: { windows: [{ windowId: "primary", strategy: input.strategy }] } }
          : null,
      },
    },
  } as unknown as MetadataStore;
}
