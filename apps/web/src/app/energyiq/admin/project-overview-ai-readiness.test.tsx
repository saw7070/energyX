/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyProjectOverviewAdminStateDto } from "../../../lib/config-api";
import { ProjectOverviewAiReadiness } from "./project-overview-ai-readiness";

describe("ProjectOverviewAiReadiness", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("React", React);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows the customer-visible state, independent analysis items and one generation action", async () => {
    const initial = preschoolState();
    const ready = preschoolState({
      analysis: {
        ...initial.analysis,
        status: "ready",
        detail: "All 6 saved analysis results are ready.",
        readyCount: 6,
        items: initial.analysis.items.map((item) => ({ ...item, status: "ready" as const })),
      },
      allowedActions: [],
      recommendedNextAction: null,
    });
    const client = {
      getEnergyProjectOverviewAdminState: vi.fn().mockResolvedValue(initial),
      generateMissingEnergyProjectOverviewAnalysis: vi.fn().mockResolvedValue(ready),
    };

    await act(async () => {
      root.render(<ProjectOverviewAiReadiness projectId="preschool-demo" client={client} />);
    });

    expect(container.textContent).toContain("AI Analysis readiness");
    expect(container.textContent).toContain("1 of 6 ready");
    expect(container.textContent).toContain("Key Findings");
    expect(container.textContent).toContain("Centre benchmark");
    expect(container.textContent).toContain("Additional AI Insights");
    expect(container.textContent).toContain("Available for this Project");
    expect(container.textContent).toContain("Used for this Artifact");
    expect(container.textContent).toContain("Open discovery");
    expect(container.textContent).toContain("Portfolio demand stayed concentrated in two Centres.");
    expect(container.textContent).toContain("This may be a repeatable scheduling pattern worth testing.");
    expect(container.textContent).toContain("energy.evidence.read");
    expect(container.textContent).not.toContain("energy.metrics.compare was used");
    const traceTechnicalDetails = container.querySelector("details[data-ai-trace-technical]");
    expect(traceTechnicalDetails?.open).toBe(false);
    expect(traceTechnicalDetails?.querySelector("summary")?.textContent).toContain("Technical IDs");

    const generate = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Generate missing analysis");
    expect(generate).toBeDefined();
    await act(async () => generate?.click());

    expect(client.generateMissingEnergyProjectOverviewAnalysis).toHaveBeenCalledWith("preschool-demo");
    expect(container.textContent).toContain("6 of 6 ready");
    expect(container.textContent).not.toContain("Generate missing analysis");
  });

  it("does not invent Preschool Sections for Ngee Ann", async () => {
    const state: EnergyProjectOverviewAdminStateDto = {
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic",
      rendererKey: "ngee-ann-overview",
      customerOverview: { status: "ready", detail: "The published customer Overview is available.", url: "/energyiq/overview?projectId=ngee-ann-polytechnic" },
      currentIdentity: null,
      capabilities: { keyFindings: false, sectionAnalysis: [], additionalInsights: false },
      analysis: {
        supported: false,
        status: "ready",
        detail: "This Project uses its existing Ngee Ann Overview analysis path. Layer 1–3 readiness is not connected yet.",
        readyCount: 0,
        totalCount: 0,
        lastGeneratedAt: null,
        items: [],
      },
      allowedActions: [],
      recommendedNextAction: null,
    };
    const client = {
      getEnergyProjectOverviewAdminState: vi.fn().mockResolvedValue(state),
      generateMissingEnergyProjectOverviewAnalysis: vi.fn(),
    };

    await act(async () => {
      root.render(<ProjectOverviewAiReadiness projectId="ngee-ann-polytechnic" client={client} />);
    });

    expect(container.textContent).toContain("existing Ngee Ann Overview analysis path");
    expect(container.textContent).not.toContain("Centre benchmark");
    expect(container.textContent).not.toContain("Generate missing analysis");
  });

  it("shows a retry action when the server reports a failed current analysis item", async () => {
    const initial = preschoolState();
    const failed = preschoolState({
      analysis: {
        ...initial.analysis,
        status: "needs-attention",
        readyCount: 5,
        items: initial.analysis.items.map((item) => item.id === "section:centre-benchmark"
          ? { ...item, status: "needs-attention" as const, detail: "This analysis needs attention." }
          : { ...item, status: "ready" as const, detail: "Ready." }),
      },
      recommendedNextAction: {
        action: "generate-missing",
        label: "Retry failed analysis",
        detail: "Retry only failed current results.",
      },
    });
    const ready = preschoolState({
      analysis: {
        ...failed.analysis,
        status: "ready",
        readyCount: 6,
        items: failed.analysis.items.map((item) => ({ ...item, status: "ready" as const })),
      },
      allowedActions: [],
      recommendedNextAction: null,
    });
    const client = {
      getEnergyProjectOverviewAdminState: vi.fn().mockResolvedValue(failed),
      generateMissingEnergyProjectOverviewAnalysis: vi.fn().mockResolvedValue(ready),
    };

    await act(async () => {
      root.render(<ProjectOverviewAiReadiness projectId="preschool-demo" client={client} />);
    });

    const retry = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Retry failed analysis");
    expect(retry).toBeDefined();
    await act(async () => retry?.click());

    expect(client.generateMissingEnergyProjectOverviewAnalysis).toHaveBeenCalledWith("preschool-demo");
    expect(container.textContent).toContain("6 of 6 ready");
  });

  it("does not say no action is needed when saved analysis needs attention", async () => {
    const initial = preschoolState();
    const state = preschoolState({
      allowedActions: [],
      recommendedNextAction: null,
      analysis: {
        ...initial.analysis,
        status: "needs-attention",
      },
    });
    const client = {
      getEnergyProjectOverviewAdminState: vi.fn().mockResolvedValue(state),
      generateMissingEnergyProjectOverviewAnalysis: vi.fn(),
    };

    await act(async () => {
      root.render(<ProjectOverviewAiReadiness projectId="preschool-demo" client={client} variant="summary" />);
    });

    expect(container.textContent).toContain("Review readiness details");
    expect(container.textContent).not.toContain("No action needed");
  });

  it("binds Useful, Not useful, append-only Comment and Method Proposal actions to the exact Finding", async () => {
    const state = preschoolState();
    const client = {
      getEnergyProjectOverviewAdminState: vi.fn().mockResolvedValue(state),
      generateMissingEnergyProjectOverviewAnalysis: vi.fn(),
      getEnergyAdditionalInsightFeedback: vi.fn().mockResolvedValue(null),
      putEnergyAdditionalInsightFeedback: vi.fn().mockImplementation(async (
        _projectId: string,
        artifactId: string,
        findingId: string,
        body: { rating: "useful" | "not-useful"; expectedRevision: number },
      ) => ({
        id: "feedback-current",
        artifactId,
        findingId,
        rating: body.rating,
        revision: 1,
      })),
      listEnergyAdditionalInsightComments: vi.fn().mockResolvedValue({ comments: [] }),
      appendEnergyAdditionalInsightComment: vi.fn().mockResolvedValue({
        id: "comment-current",
        actorId: "dev-user",
        text: "Verify this pattern against the next comparable week.",
        createdAt: "2026-08-15T02:00:00.000Z",
      }),
      createEnergyInsightMethodProposal: vi.fn().mockResolvedValue({
        id: "proposal-current",
        status: "provisional",
        revision: 1,
      }),
    };

    await act(async () => root.render(
      <ProjectOverviewAiReadiness projectId="preschool-demo" client={client} />,
    ));
    await act(async () => undefined);

    const useful = [...container.querySelectorAll("button")].find((button) => button.textContent === "Useful");
    const notUseful = [...container.querySelectorAll("button")].find((button) => button.textContent === "Not useful");
    expect(useful).toBeDefined();
    expect(notUseful).toBeDefined();
    await act(async () => useful!.click());
    expect(client.putEnergyAdditionalInsightFeedback).toHaveBeenCalledWith(
      "preschool-demo",
      "additional-current",
      "additional-finding-1",
      { rating: "useful", expectedRevision: 0 },
    );

    const comment = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Admin comment"]');
    await act(async () => setControlValue(comment!, "Verify this pattern against the next comparable week."));
    const addComment = [...container.querySelectorAll("button")].find((button) => button.textContent === "Add comment");
    await act(async () => addComment!.click());
    expect(client.appendEnergyAdditionalInsightComment).toHaveBeenCalledWith(
      "preschool-demo",
      "additional-current",
      "additional-finding-1",
      expect.objectContaining({
        text: "Verify this pattern against the next comparable week.",
        idempotencyKey: expect.any(String),
      }),
    );
    expect(container.textContent).toContain("Verify this pattern against the next comparable week.");

    const propose = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Propose Method revision");
    await act(async () => propose!.click());
    const title = container.querySelector<HTMLInputElement>('input[aria-label="Proposal title"]');
    const guidance = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Proposal guidance"]');
    await act(async () => setControlValue(title!, "Review repeated concentration"));
    await act(async () => setControlValue(guidance!, "Check comparable weeks before reusing this analysis direction."));
    const createProposal = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Create proposal");
    await act(async () => createProposal!.click());
    expect(client.createEnergyInsightMethodProposal).toHaveBeenCalledWith(
      "preschool-demo",
      "additional-current",
      "additional-finding-1",
      expect.objectContaining({
        title: "Review repeated concentration",
        guidance: "Check comparable weeks before reusing this analysis direction.",
        idempotencyKey: expect.any(String),
      }),
    );
    expect(container.textContent).toContain("Proposal created as provisional");
    expect(container.textContent).not.toContain("Edit published Method");
  });
});

function setControlValue(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), "value")?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

function preschoolState(overrides: Partial<EnergyProjectOverviewAdminStateDto> = {}): EnergyProjectOverviewAdminStateDto {
  const base = {
    projectId: "preschool-demo",
    projectName: "Preschool Portfolio",
    rendererKey: "preschool-overview",
    customerOverview: { status: "ready", detail: "The published customer Overview is available.", url: "/energyiq/overview?projectId=preschool-demo" },
    currentIdentity: {
      dataSnapshotId: "snapshot-current",
      projectReleaseId: "release-current",
      analysisPeriod: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-31T16:00:00.000Z" },
      modelProfileRevision: 8,
    },
    capabilities: {
      keyFindings: true,
      sectionAnalysis: ["centre-benchmark", "standby-wastage", "operating-behaviour", "planning-outlook"],
      additionalInsights: true,
    },
    analysis: {
      supported: true,
      status: "needs-attention",
      detail: "1 of 6 saved analysis results are ready; one or more items need attention.",
      readyCount: 1,
      totalCount: 6,
      lastGeneratedAt: "2026-08-15T01:00:00.000Z",
      items: [
        { id: "key-findings", label: "Key Findings", status: "needs-attention", detail: "This analysis needs attention." },
        { id: "section:centre-benchmark", label: "Centre benchmark", status: "ready", detail: "Ready." },
        { id: "section:standby-wastage", label: "Closed-hours use", status: "not-generated", detail: "Not generated." },
        { id: "section:operating-behaviour", label: "Operating-hours behaviour", status: "not-generated", detail: "Not generated." },
        { id: "section:planning-outlook", label: "Planning outlook", status: "not-generated", detail: "Not generated." },
        { id: "additional-insights", label: "Additional AI Insights", status: "not-generated", detail: "Not generated." },
      ],
    },
    allowedActions: ["generate-missing"],
    recommendedNextAction: {
      action: "generate-missing",
      label: "Generate missing analysis",
      detail: "Create only missing results.",
    },
    explainability: {
      status: "available",
      detail: "Declared capabilities and the exact saved Additional Insight trace are available.",
      declared: {
        status: "available",
        detail: "Published capabilities declared for the Project.",
        skills: [{ id: "energyiq-open-discovery", revision: "1.0.0", availability: "declared-available" }],
        methods: [{
          skillId: "energyiq-open-discovery",
          semanticVersion: "1.0.0",
          resourceId: "builtin:energyiq-open-discovery",
          resourceRevision: 1,
          scope: "builtin",
          lifecycle: "published",
          availability: "declared-available",
          technical: {
            contentSha256: "a".repeat(64),
            workspaceId: "preschool-demo-org",
            ownerId: "energyiq-system",
            role: "core-method",
          },
        }],
        tools: [
          { id: "energy.evidence.read", availability: "declared-available" },
          { id: "energy.metrics.compare", availability: "declared-available" },
        ],
      },
      governance: { status: "available", detail: "Project Method Proposal lifecycle.", proposals: [] },
      currentArtifact: {
        status: "available",
        artifactId: "additional-current",
        readOnly: true,
        historical: false,
        detail: "This is an immutable trace of the exact current saved Artifact.",
        technical: {
          runId: "run-current",
          outputContractRevision: "energyiq-additional-ai-insights-v2",
          methodSetId: "preschool-additional-insights-current",
          methodSetRevision: "v1",
          methodSetFingerprint: `sha256:${"b".repeat(64)}`,
          capabilityRevision: "scoped-read-only-v1",
        },
        loadedMethods: [{
          skillId: "energyiq-open-discovery",
          semanticVersion: "1.0.0",
          resourceId: "builtin:energyiq-open-discovery",
          resourceRevision: 1,
          scope: "builtin",
          role: "core-method",
          usage: "actually-loaded",
          technical: {
            contentSha256: "a".repeat(64),
            workspaceId: "preschool-demo-org",
            ownerId: "energyiq-system",
          },
        }],
        findings: [{
          id: "additional-finding-1",
          title: "Test a repeatable scheduling pattern",
          status: "available",
          detail: "Exact Finding attribution and successful Tool audits from the saved Artifact.",
          evidenceSignal: "Portfolio demand stayed concentrated in two Centres.",
          aiAngle: "This may be a repeatable scheduling pattern worth testing.",
          origin: "ai-discovery",
          evidenceRefs: ["fact:portfolio-demand"],
          attributedMethods: [{
            skillId: "energyiq-open-discovery",
            semanticVersion: "1.0.0",
            resourceId: "builtin:energyiq-open-discovery",
            resourceRevision: 1,
            scope: "builtin",
            role: "core-method",
            usage: "finding-attributed",
            technical: {
              contentSha256: "a".repeat(64),
              workspaceId: "preschool-demo-org",
              ownerId: "energyiq-system",
            },
          }],
          successfulTools: [{
            auditId: "audit-evidence-success",
            toolName: "energy.evidence.read",
            evidenceRefs: ["fact:portfolio-demand"],
            usage: "tool-succeeded",
          }],
        }],
      },
    },
  } as unknown as EnergyProjectOverviewAdminStateDto;
  return { ...base, ...overrides };
}
