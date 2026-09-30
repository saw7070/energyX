/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type {
  EnergyProjectSetupDocumentDto,
  EnergyProjectSetupDto,
} from "../../../lib/config-api";
import { ProjectProfile } from "./project-setup-workbench";

const baseDocument: EnergyProjectSetupDocumentDto = {
  project: { name: "Ngee Ann Polytechnic", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [],
  nodes: [],
};

const setup = {
  project: { id: "ngee-ann-polytechnic", workspace_id: "ngee-ann", hierarchy_revision_id: "hier-v1" },
  published: { tiers: [], nodes: [], revisions: [], templateRevisions: [] },
} as unknown as EnergyProjectSetupDto;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  // The admin workbench is compiled by Next with the automatic JSX runtime; tests run the classic one.
  vi.stubGlobal("React", React);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.querySelectorAll("[role='listbox']").forEach((element) => element.remove());
  container.remove();
});

const renderProfile = async (
  document_: EnergyProjectSetupDocumentDto,
  changeDocument: (updater: (current: EnergyProjectSetupDocumentDto) => EnergyProjectSetupDocumentDto) => void,
): Promise<void> => {
  await act(async () => {
    root.render(
      <ProjectProfile
        setup={setup}
        document={document_}
        validation={null}
        errorCount={0}
        warningCount={0}
        changeDocument={changeDocument}
        onBack={() => {}}
      />,
    );
  });
};

const cadenceTrigger = (): HTMLButtonElement => {
  const trigger = Array.from(container.querySelectorAll<HTMLButtonElement>("[role='combobox']"))
    .find((candidate) => candidate.getAttribute("aria-label") === "Overview shows");
  if (!trigger) throw new Error("Overview cadence control is missing from Project basics");
  return trigger;
};

it("shows the monthly report as the Overview default when the project has never chosen", async () => {
  await renderProfile(baseDocument, () => {});
  expect(cadenceTrigger().textContent).toContain("Monthly report");
  expect(container.textContent).toContain("Which saved report the Overview page shows for this project.");
});

it("patches the setup document when an administrator picks the weekly report", async () => {
  let current = baseDocument;
  await renderProfile(current, (updater) => { current = updater(current); });

  await act(async () => cadenceTrigger().click());
  const weekly = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"))
    .find((option) => option.textContent?.includes("Weekly report"));
  await act(async () => weekly?.click());

  expect(current.project.overview_cadence).toBe("weekly");
  // The rest of the project identity is untouched.
  expect(current.project.name).toBe("Ngee Ann Polytechnic");
  expect(current.project.timezone).toBe("Asia/Singapore");
});

it("reflects a project that already reads the weekly report", async () => {
  await renderProfile(
    { ...baseDocument, project: { ...baseDocument.project, overview_cadence: "weekly" } },
    () => {},
  );
  expect(cadenceTrigger().textContent).toContain("Weekly report");
});
