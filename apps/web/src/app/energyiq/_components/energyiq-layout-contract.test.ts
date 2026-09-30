import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const globalCss = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
const overview = readFileSync(new URL("./published-decision-dashboard.tsx", import.meta.url), "utf8");
const explorer = readFileSync(new URL("./project-explorer.tsx", import.meta.url), "utf8");
const adminSidebar = readFileSync(new URL("../admin/admin-sidebar.tsx", import.meta.url), "utf8");
const adminWorkbench = readFileSync(new URL("../admin/project-setup-workbench.tsx", import.meta.url), "utf8");
const aiAnalyst = readFileSync(new URL("../../data-tasks/data-tasks-app.tsx", import.meta.url), "utf8");

describe("EnergyX surface layout contract", () => {
  it("defines shared geometry without introducing a universal surface component", () => {
    expect(globalCss).toContain("--energyiq-surface-header-height: 4rem");
    expect(globalCss).toContain("--energyiq-sidebar-rail-width: 3.5rem");
    expect(globalCss).toContain("--energyiq-collapse-control-size: 2.25rem");
    expect(globalCss).toContain("--energyiq-content-gutter");
    expect(globalCss).toContain("flex: 0 0 var(--energyiq-collapse-control-size)");
    expect(globalCss).toContain(".energyiq-collapsed-rail .energyiq-sidebar-header");
  });

  it("aligns functional sidebar headers and collapsed rails while preserving topology", () => {
    expect(aiAnalyst).toContain("energyiq-sidebar-header");
    expect(aiAnalyst).toContain("energyiq-collapsed-rail");
    expect(aiAnalyst).toContain("SessionListItem");

    expect(adminSidebar).toContain("energyiq-sidebar-header");
    expect(adminSidebar).toContain("energyiq-collapsed-rail");
    expect(adminSidebar).toContain('aria-label="Admin navigation"');

    expect(explorer).toContain("energyiq-sidebar-header");
    expect(explorer).toContain('role="tree"');
  });

  it("uses the shared surface gutter without merging page content structures", () => {
    expect(overview).toContain("energyiq-content-gutter");
    expect(explorer).toContain("energyiq-content-gutter");
    expect(adminWorkbench).toContain("energyiq-content-gutter");
    expect(adminWorkbench).toContain("energyiq-surface-header");
    expect(aiAnalyst).toContain("energyiq-surface-header");
  });
});
