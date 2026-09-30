import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const genericRenderer = readFileSync(new URL("./energy-template-renderer.tsx", import.meta.url), "utf8");
const ngeeAnnRenderer = readFileSync(new URL("./ngee-ann-overview-renderer.tsx", import.meta.url), "utf8");
const preschoolRenderer = readFileSync(new URL("./preschool-overview-renderer.tsx", import.meta.url), "utf8");

const renderers = [genericRenderer, ngeeAnnRenderer, preschoolRenderer];

describe("EnergyX Overview renderer state contract", () => {
  it.each(renderers)("distinguishes loading, empty, unsupported and error states", (source) => {
    expect(source).toContain('loading: { label: "Loading"');
    expect(source).toContain('empty: { label: "No data"');
    expect(source).toContain('unsupported: { label: "Unsupported"');
    expect(source).toContain('error: { label: "Unavailable"');
  });

  it.each(renderers)("announces loading politely and errors assertively", (source) => {
    expect(source).toContain('aria-live={state.status === "loading" ? "polite" : undefined}');
    expect(source).toContain('state.status === "error"');
    expect(source).toContain("Try again");
    expect(source).toContain("focus-visible:ring-2 focus-visible:ring-primary/20");
  });

  it("preserves project-specific renderer evidence hooks", () => {
    expect(ngeeAnnRenderer).toContain('data-ngee-ann-overview="true"');
    expect(ngeeAnnRenderer).toContain("data-renderer-state={state.status}");
    expect(preschoolRenderer).toContain("data-renderer-state={state.status}");
  });
});
