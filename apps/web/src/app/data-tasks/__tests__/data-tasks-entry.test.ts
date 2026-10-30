import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("data-tasks production entry", () => {
  it("keeps the route module as a thin dynamic import shell", () => {
    const entry = readFileSync(join(__dirname, "../data-tasks-entry.tsx"), "utf8");
    expect(entry).toContain('nextDynamic(() => import("./data-tasks-app")');
    expect(entry).not.toContain("@copilotkit/react-core");
    expect(entry.split("\n").length).toBeLessThan(40);
  });

  it("sends people to EnergyX on deployed servers unless the legacy workbench is turned on", () => {
    const page = readFileSync(join(__dirname, "../page.tsx"), "utf8");
    expect(page).toContain('redirect("/energyiq/overview")');
    expect(page).toContain("ENERGYX_LEGACY_WORKBENCH_ENABLED");
    expect(page).not.toContain("use client");
  });
});
