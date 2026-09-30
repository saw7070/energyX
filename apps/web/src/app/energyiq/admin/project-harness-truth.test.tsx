/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnergyProjectHarnessConfigurationDto } from "../../../lib/config-api";
import { ProjectHarnessConfiguration } from "./project-harness-configuration";

describe("ProjectHarnessConfiguration managed Overview truth", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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

  it("shows the exact managed Overview inputs and Ngee Ann Stage contracts", async () => {
    const client = {
      getEnergyProjectHarnessConfiguration: vi.fn().mockResolvedValue(ngeeHarnessState()),
    };

    await act(async () => {
      root.render(<ProjectHarnessConfiguration projectId="ngee-ann-polytechnic" client={client} />);
    });

    expect(container.textContent).toContain("Managed Overview");
    expect(container.textContent).toContain("Published definition");
    expect(container.textContent).toContain("Report time policy");
    expect(container.textContent).toContain("Current month to date");
    expect(container.textContent).toContain("Management overview");
    expect(container.textContent).toContain("Executive Synthesis");
    expect(container.textContent).toContain("Section Interpretation");
    expect(container.textContent).toContain("Code-owned current contract");
    expect(container.textContent).toContain("energyiq-project-executive-prompt-v2");
    expect(container.textContent).not.toContain("raw customer prompt");

    const technical = Array.from(container.querySelectorAll<HTMLDetailsElement>("details[data-harness-technical]"));
    expect(technical.length).toBeGreaterThan(0);
    expect(technical.every((details) => !details.open)).toBe(true);
  });
});

function ngeeHarnessState(): EnergyProjectHarnessConfigurationDto {
  return {
    status: "partially-unavailable",
    detail: "Current Harness configuration is available with one or more locally unavailable resources.",
    project: {
      id: "ngee-ann-polytechnic",
      name: "Ngee Ann Polytechnic",
      workspaceId: "default",
      rendererKey: "ngee-ann-overview",
    },
    resources: { models: [], skills: [], methods: [], tools: [], mcpServers: [] },
    managedOverview: {
      status: "available",
      source: "overview-definition",
      rendererKey: "ngee-ann-overview",
      definition: {
        status: "available",
        templateRevisionId: "ngee-ann-polytechnic-template-v7",
        contractRevision: "energyiq-overview-definition@1",
        fingerprint: "a".repeat(64),
      },
      reportTimePolicy: {
        status: "available",
        revisionId: "ngee-ann-report-time@1",
        policyId: "ngee-ann-report-time",
        revision: "1",
        windows: [{
          id: "current-month-progress",
          role: "current_progress",
          label: "Current month to date",
          strategy: "calendar_month_to_date",
        }],
      },
      sections: [{
        id: "executive-summary",
        title: "Management overview",
        primaryWindowId: "current-month-progress",
        supportingWindowIds: [],
      }],
    },
    harnesses: [
      stage("key-findings", "Executive Synthesis", "executive-synthesis", {
        artifactIdentityRevision: "ngee-ann-executive-v7",
        workflowRevision: "energyiq-project-executive-synthesis-v2",
        promptRevisions: ["energyiq-project-executive-prompt-v2"],
        validatorRevision: "energyiq-project-executive-acceptance-v6",
        outputContractRevision: "energyiq-project-executive-synthesis-v1",
      }),
      stage("section-analysis", "Section Interpretation", "section-interpreter", {
        artifactIdentityRevision: "ngee-ann-section-v16",
        workflowRevision: "energyiq-project-section-discover-publish-v1",
        promptRevisions: ["energyiq-project-section-discovery-v8"],
        validatorRevision: "energyiq-project-section-acceptance-v14",
        outputContractRevision: "energyiq-project-section-interpretation-v1",
      }),
    ],
    unavailable: [{ id: "server-system-model", detail: "The server-managed model is unavailable." }],
  } as unknown as EnergyProjectHarnessConfigurationDto;
}

function stage(
  id: "key-findings" | "section-analysis",
  label: string,
  runtimeStageId: string,
  contract: {
    artifactIdentityRevision: string;
    workflowRevision: string;
    promptRevisions: string[];
    validatorRevision: string;
    outputContractRevision: string;
  },
) {
  return {
    id,
    label,
    resolution: "fixed-stage-contract",
    status: "unavailable",
    detail: `${label} uses the exact Ngee Ann contract.`,
    runtimeStageIds: [runtimeStageId],
    contract: { provenance: "code-owned-current", ...contract },
    modelIds: [],
    skillIds: [],
    methodResourceIds: [],
    toolIds: [],
    mcpServerIds: [],
    context: { mode: "run-planned", sources: ["project-identity", "evidence-catalog"] },
    instructions: [{
      kind: "workflow-stage",
      label: `${label} workflow prompt`,
      revision: contract.promptRevisions[0] ?? null,
      revisionStatus: "run-pinned",
      visibility: "summary-only",
    }],
  };
}
