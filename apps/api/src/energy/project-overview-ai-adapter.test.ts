import { describe, expect, it } from "vitest";

import {
  findProjectOverviewAiAdapter,
  type ProjectOverviewAiAdapter,
} from "./project-overview-ai-adapter.js";

describe("Project Overview AI Adapter selection", () => {
  it("keeps a shared Renderer Adapter bound to its exact Project", () => {
    const tuyaAdapter = adapterFor("tuya-office-overview", "tuya-office");

    expect(findProjectOverviewAiAdapter(
      [tuyaAdapter],
      "tuya-office-overview",
      "tuya-office",
    )).toBe(tuyaAdapter);
    expect(findProjectOverviewAiAdapter(
      [tuyaAdapter],
      "tuya-office-overview",
      "another-project",
    )).toBeNull();
  });

  it("fails closed for duplicate exact registrations", () => {
    const first = adapterFor("tuya-office-overview", "tuya-office");
    const duplicate = adapterFor("tuya-office-overview", "tuya-office");

    expect(() => findProjectOverviewAiAdapter(
      [first, duplicate],
      "tuya-office-overview",
      "tuya-office",
    )).toThrow("ENERGYIQ_PROJECT_OVERVIEW_AI_ADAPTER_DUPLICATE");
  });
});

const adapterFor = (
  rendererKey: ProjectOverviewAiAdapter["rendererKey"],
  projectId: string,
): ProjectOverviewAiAdapter => ({
  rendererKey,
  projectId,
  keyFindings: false,
  sections: [],
  additionalInsights: false,
  async resolveIdentity() {
    throw new Error("not used");
  },
  async readExact() {
    return null;
  },
  async generateMissing() {
    throw new Error("not used");
  },
});
