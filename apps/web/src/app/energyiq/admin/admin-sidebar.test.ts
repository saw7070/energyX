import { describe, expect, it } from "vitest";

import { isAdminSection } from "./admin-sidebar";

describe("EnergyX Admin navigation", () => {
  it("restores the operational-policy route from the URL", () => {
    expect(isAdminSection("operational-policies")).toBe(true);
  });

  it("restores the AI Analysis and Methods routes from the URL", () => {
    expect(isAdminSection("ai-analysis")).toBe(true);
    expect(isAdminSection("methods")).toBe(true);
  });

  it("restores the Harness Configuration route from the URL", () => {
    expect(isAdminSection("harness")).toBe(true);
  });
});
