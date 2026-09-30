import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const overview = readFileSync(new URL("./overview-section-navigation.tsx", import.meta.url), "utf8");
const explorer = readFileSync(new URL("./project-explorer.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../admin/admin-sidebar.tsx", import.meta.url), "utf8");
const aiAnalyst = readFileSync(new URL("../../data-tasks/data-tasks-app.tsx", import.meta.url), "utf8");

describe("EnergyX role-based navigation contract", () => {
  it("keeps Overview navigation quiet while exposing the current section", () => {
    expect(overview).toContain('aria-current={active ? "location" : undefined}');
    expect(overview).toContain("bg-surface-subtle text-foreground ring-1 ring-inset ring-border");
    expect(overview).toContain("focus-visible:ring-2 focus-visible:ring-primary/20");
  });

  it("exposes current location and keyboard focus in functional sidebars", () => {
    expect(aiAnalyst).toContain('aria-current={active ? "page" : undefined}');
    expect(aiAnalyst).toContain("focus-visible:ring-2 focus-visible:ring-primary/20");

    expect(explorer).toContain("aria-selected={selected}");
    expect(explorer).toContain("focus-visible:ring-2 focus-visible:ring-primary/20");

    expect(admin).toContain('aria-current={active ? "page" : undefined}');
    expect(admin).toContain("focus-visible:ring-2 focus-visible:ring-primary/20");
  });

  it("preserves each surface's distinct navigation model", () => {
    expect(overview).toContain('aria-label="Overview contents"');
    expect(aiAnalyst).toContain("SessionListItem");
    expect(explorer).toContain('role="treeitem"');
    expect(admin).toContain('aria-label="Admin navigation"');
  });
});
