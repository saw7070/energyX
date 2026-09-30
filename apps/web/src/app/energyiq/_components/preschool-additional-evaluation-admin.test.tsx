/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreschoolAdditionalEvaluationAdmin } from "./preschool-additional-evaluation-admin";

describe("PreschoolAdditionalEvaluationAdmin", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lets an admin compare an approved A baseline with the exact B pin from Overview", async () => {
    const client = {
      listEvaluations: vi.fn().mockResolvedValue([approvedEvaluation]),
      listTransitions: vi.fn().mockResolvedValue([]),
      createTransition: vi.fn().mockResolvedValue({
        transitionId: "transition-a-b",
        status: "completed",
        previousSnapshotId: "snapshot-a",
        currentSnapshotId: "snapshot-b",
        outcomeCount: 3,
        outcomeCounts: {
          new: 1,
          changed: 1,
          "still-supported": 1,
          resolved: 0,
          "no-material-change": 0,
        },
      }),
      getTransition: vi.fn(),
      publishEvaluation: vi.fn(),
    };

    await act(async () => root.render(
      <PreschoolAdditionalEvaluationAdmin
        projectId="preschool-demo"
        initialPin={{
          scopeId: "preschool-project",
          dataSnapshotId: "snapshot-b",
          projectReleaseId: "release-b",
          from: "2026-06-01T00:00:00.000Z",
          to: "2026-07-01T00:00:00.000Z",
        }}
        client={client}
      />,
    ));
    await act(async () => undefined);

    expect(container.textContent).toContain("Snapshot A/B comparison");
    expect(container.textContent).toContain("snapshot-a");
    expect(container.textContent).toContain("snapshot-b");
    const compare = [...container.querySelectorAll("button")].find((button) => (
      button.textContent === "Compare A with current B"
    ));
    await act(async () => compare!.click());

    expect(client.createTransition).toHaveBeenCalledWith({
      projectId: "preschool-demo",
      body: {
        idempotencyKey: "overview-ab:evaluation-a:snapshot-b",
        previousEvaluationId: "evaluation-a",
        previousAttemptId: "attempt-a",
        scopeId: "preschool-project",
        dataSnapshotId: "snapshot-b",
        projectReleaseId: "release-b",
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-07-01T00:00:00.000Z",
      },
    });
    expect(container.textContent).toContain("New 1");
    expect(container.textContent).toContain("Changed 1");
    expect(container.textContent).toContain("Still supported 1");
  });

  it("does not offer a fake comparison when no approved A baseline exists", async () => {
    const client = {
      listEvaluations: vi.fn().mockResolvedValue([]),
      listTransitions: vi.fn().mockResolvedValue([]),
      createTransition: vi.fn(),
      getTransition: vi.fn(),
      publishEvaluation: vi.fn(),
    };
    await act(async () => root.render(
      <PreschoolAdditionalEvaluationAdmin
        projectId="preschool-demo"
        initialPin={null}
        client={client}
      />,
    ));
    await act(async () => undefined);

    expect(container.textContent).toContain("No approved A baseline is available");
    expect(container.querySelector("button")).toBeNull();
    expect(client.createTransition).not.toHaveBeenCalled();
  });

  it("shows approval and publication separately and publishes without starting a comparison", async () => {
    const published = {
      ...approvedEvaluation,
      publication: {
        sourceAttemptId: "attempt-a",
        artifactId: "overview-ai-artifact-current",
        artifactIdentityHash: `sha256:${"a".repeat(64)}`,
        actorId: "admin-1",
        publishedAt: "2026-08-15T01:00:00.000Z",
        revision: 1,
      },
    };
    const client = {
      listEvaluations: vi.fn().mockResolvedValue([approvedEvaluation]),
      listTransitions: vi.fn().mockResolvedValue([]),
      createTransition: vi.fn(),
      getTransition: vi.fn(),
      publishEvaluation: vi.fn().mockResolvedValue(published),
    };
    await act(async () => root.render(
      <PreschoolAdditionalEvaluationAdmin
        projectId="preschool-demo"
        initialPin={{
          scopeId: "preschool-project",
          dataSnapshotId: "snapshot-a",
          projectReleaseId: "release-a",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-06-01T00:00:00.000Z",
        }}
        client={client}
      />,
    ));
    await act(async () => undefined);

    expect(container.textContent).toContain("Review complete");
    expect(container.textContent).toContain("Approved candidate");
    expect(container.textContent).toContain("Not published");
    const publish = [...container.querySelectorAll("button")].find((button) => (
      button.textContent === "Publish to current Overview"
    ));
    await act(async () => publish!.click());

    expect(client.publishEvaluation).toHaveBeenCalledWith("preschool-demo", "evaluation-a", 0);
    expect(client.createTransition).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Published");
  });
});

const approvedEvaluation = {
  evaluationId: "evaluation-a",
  status: "approved-candidate" as const,
  target: {
    dataSnapshotId: "snapshot-a",
    projectReleaseId: "release-a",
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
  },
  completedAttemptCount: 3,
  failedAttemptCount: 0,
  humanReviewedCount: 3,
  approval: {
    selectedAttemptId: "attempt-a",
    approvedAt: "2026-08-14T00:00:00.000Z",
    disposition: "publication-candidate-only" as const,
  },
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
};
