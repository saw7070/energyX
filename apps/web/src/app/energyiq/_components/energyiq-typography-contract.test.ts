import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const globalCss = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
const overviewNavigation = readFileSync(new URL("./overview-section-navigation.tsx", import.meta.url), "utf8");
const explorer = readFileSync(new URL("./project-explorer.tsx", import.meta.url), "utf8");
const adminSidebar = readFileSync(new URL("../admin/admin-sidebar.tsx", import.meta.url), "utf8");
const aiAnalyst = readFileSync(new URL("../../data-tasks/data-tasks-app.tsx", import.meta.url), "utf8");

describe("EnergyX typography roles", () => {
  it("defines a shared role scale without replacing the established font family", () => {
    expect(globalCss).toContain("--text-ui-body");
    expect(globalCss).toContain("--text-ui-support");
    expect(globalCss).toContain("--text-ui-label");
    expect(globalCss).toContain("--text-ui-meta");
    expect(globalCss).toContain("--font-sans: var(--font-inter)");
  });

  it("applies the role scale to each surface without merging their navigation structures", () => {
    expect(overviewNavigation).toContain("text-ui-body");
    expect(overviewNavigation).toContain('aria-label="Overview contents"');

    expect(aiAnalyst).toContain("text-ui-body");
    expect(aiAnalyst).toContain("SessionListItem");

    expect(explorer).toContain("text-ui-support");
    expect(explorer).toContain('role="tree"');

    expect(adminSidebar).toContain("text-ui-support");
    expect(adminSidebar).toContain('aria-label="Admin navigation"');
  });
});
