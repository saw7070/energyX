/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configApi, type EnergyTemplateChangeContextDto } from "../../../lib/config-api";
import { TemplateChangeProposalPanel } from "./template-change-proposal-panel";

describe("TemplateChangeProposalPanel AI Slot presentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("publishes an explicit structured rollback without invoking the AI proposal workflow", async () => {
    const initial = templateChangeContext("html", "preschool-template-v10");
    const rolledBack = templateChangeContext("structured", "preschool-template-v11");
    vi.spyOn(configApi, "getEnergyTemplateChangeContext")
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(rolledBack);
    const publishPresentation = vi.spyOn(configApi, "publishEnergyAiSlotPresentation")
      .mockResolvedValue({
        revision: rolledBack.revision,
        overviewDefinition: rolledBack.overviewDefinition,
        diff: [{ kind: "ai_slot_presentation_mode_updated", before: "html", after: "structured" }],
      });
    const propose = vi.spyOn(configApi, "proposeEnergyTemplateChange");

    await act(async () => {
      root.render(<TemplateChangeProposalPanel
        projectId="preschool-demo"
        setupDocument={{ project: { name: "Preschool", timezone: "Asia/Singapore" }, tier_structure_locked: true, tiers: [], nodes: [] }}
        componentCatalog={[]}
        selectedMetricRevisionIds={new Set()}
        selectedRuleRevisionIds={new Set()}
        businessCalendarVersion="calendar-v1"
        previewRange={null}
      />);
      await Promise.resolve();
    });

    const rollback = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Roll back to structured Slots");
    expect(rollback).toBeDefined();
    await act(async () => rollback?.click());

    expect(publishPresentation).toHaveBeenCalledWith("preschool-demo", "structured");
    expect(propose).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Published preschool-template-v11 with structured AI Slots.");
  });

  it("reports that HTML artifacts still require explicit generation after the Release is published", async () => {
    const initial = templateChangeContext("structured", "preschool-template-v10");
    const published = templateChangeContext("html", "preschool-template-v11");
    vi.spyOn(configApi, "getEnergyTemplateChangeContext")
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(published);
    const publishPresentation = vi.spyOn(configApi, "publishEnergyAiSlotPresentation")
      .mockResolvedValue({
        revision: published.revision,
        overviewDefinition: published.overviewDefinition,
        diff: [{ kind: "ai_slot_presentation_mode_updated", before: "structured", after: "html" }],
      });

    await act(async () => {
      root.render(<TemplateChangeProposalPanel
        projectId="preschool-demo"
        setupDocument={{ project: { name: "Preschool", timezone: "Asia/Singapore" }, tier_structure_locked: true, tiers: [], nodes: [] }}
        componentCatalog={[]}
        selectedMetricRevisionIds={new Set()}
        selectedRuleRevisionIds={new Set()}
        businessCalendarVersion="calendar-v1"
        previewRange={null}
      />);
      await Promise.resolve();
    });

    const publishHtml = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Use accepted HTML Slots");
    expect(publishHtml).toBeDefined();
    await act(async () => publishHtml?.click());

    expect(publishPresentation).toHaveBeenCalledWith("preschool-demo", "html");
    expect(container.textContent).toContain("Published preschool-template-v11");
    expect(container.textContent).toContain("HTML artifacts still require explicit administrator generation");
    expect(container.textContent).not.toContain("accepted HTML Slots are now available");
  });

  it("keeps the successful Release visible and disables repeat publishing when refresh fails", async () => {
    const initial = templateChangeContext("structured", "preschool-template-v10");
    const published = templateChangeContext("html", "preschool-template-v11");
    vi.spyOn(configApi, "getEnergyTemplateChangeContext")
      .mockResolvedValueOnce(initial)
      .mockRejectedValueOnce(new Error("REFRESH_UNAVAILABLE"));
    const publishPresentation = vi.spyOn(configApi, "publishEnergyAiSlotPresentation")
      .mockResolvedValue({
        revision: published.revision,
        overviewDefinition: published.overviewDefinition,
        diff: [{ kind: "ai_slot_presentation_mode_updated", before: "structured", after: "html" }],
      });

    await act(async () => {
      root.render(<TemplateChangeProposalPanel
        projectId="preschool-demo"
        setupDocument={{ project: { name: "Preschool", timezone: "Asia/Singapore" }, tier_structure_locked: true, tiers: [], nodes: [] }}
        componentCatalog={[]}
        selectedMetricRevisionIds={new Set()}
        selectedRuleRevisionIds={new Set()}
        businessCalendarVersion="calendar-v1"
        previewRange={null}
      />);
      await Promise.resolve();
    });

    const publishHtml = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Use accepted HTML Slots");
    await act(async () => publishHtml?.click());

    expect(publishPresentation).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Published preschool-template-v11");
    expect(container.textContent).toContain("Release was published, but the latest Admin state could not be refreshed");
    const htmlButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Use accepted HTML Slots");
    const rollbackButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Roll back to structured Slots");
    expect(htmlButton?.disabled).toBe(true);
    expect(rollbackButton?.disabled).toBe(false);
  });

  it("does not offer Preschool HTML Slot controls for another Project renderer", async () => {
    vi.spyOn(configApi, "getEnergyTemplateChangeContext")
      .mockResolvedValue(templateChangeContext("structured", "ngee-template-v1", "ngee-ann-overview"));
    const publishPresentation = vi.spyOn(configApi, "publishEnergyAiSlotPresentation");

    await act(async () => {
      root.render(<TemplateChangeProposalPanel
        projectId="ngee-ann-polytechnic"
        setupDocument={{ project: { name: "Ngee Ann", timezone: "Asia/Singapore" }, tier_structure_locked: true, tiers: [], nodes: [] }}
        componentCatalog={[]}
        selectedMetricRevisionIds={new Set()}
        selectedRuleRevisionIds={new Set()}
        businessCalendarVersion="calendar-v1"
        previewRange={null}
      />);
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Published AI Slot presentation");
    expect(container.textContent).not.toContain("Use accepted HTML Slots");
    expect(publishPresentation).not.toHaveBeenCalled();
  });
});

function templateChangeContext(
  mode: "html" | "structured",
  revisionId: string,
  customerRenderer = "preschool-overview",
): EnergyTemplateChangeContextDto {
  return {
    fixedIdentity: {
      workspaceId: "workspace-preschool",
      projectId: "preschool-demo",
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-1",
      projectReleaseId: revisionId,
    },
    revision: {
      revision_id: revisionId,
      project_id: "preschool-demo",
      sequence: 10,
      source_template_draft_revision: 1,
      document: { schema_version: 2, templates: [] },
      hierarchy_revision_id: "hierarchy-1",
      meter_formula_revision_id: "formula-1",
      metric_config_revision: 1,
      selected_metric_revision_ids: [],
      rule_config_revision: 1,
      selected_rule_revision_ids: [],
      business_calendar_version: "calendar-v1",
      tariff_schedule_version: "tariff-v1",
      published_by: "admin",
      published_at: "2026-08-31T00:00:00.000Z",
    },
    overviewDefinition: {
      contractRevision: "energyiq-overview-definition@1",
      timePolicyRevisionId: "preschool-report-time@2",
      aiSlotPresentationMode: mode,
      sections: [],
    },
    catalog: [],
    proposals: [],
    rendererBoundary: {
      previewRenderer: "structured-template",
      customerRenderer,
      customerRendererAutomaticallyReordered: false,
      message: "Reviewed release control.",
    },
  };
}
