/** @vitest-environment happy-dom */
import React from "react";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MODULES, darkColour, withDarkTheme } from "../../../../scripts/energyiq-dark-theme.mjs";
import { EnergyIqThemeSwitch } from "./energyiq-theme-switch";
import { THEME_STORAGE_KEY } from "./energyiq-theme-boot";

afterEach(() => { delete document.documentElement.dataset.energyiqTheme; localStorage.clear(); vi.unstubAllGlobals(); });

describe("dark theme styles", () => {
  it("keeps every CSS module's generated dark block in step with its light styles", () => {
    for (const file of MODULES as string[]) {
      const source = readFileSync(file, "utf8");
      expect(withDarkTheme(source), `${file} — run node scripts/energyiq-dark-theme.mjs`).toBe(source);
    }
  });

  it("darkens light surfaces, lightens dark text and keeps saturated fills", () => {
    expect(darkColour("#ffffff", "background")).toBe("#191919");
    expect(darkColour("#1f6b50", "text")).toBe("#79c2a3");
    expect(darkColour("#176b59", "background")).toBe("#176b59");
    expect(darkColour("#fff", "text")).toBe("#fff");
  });
});

describe("EnergyIqThemeSwitch", () => {
  it("flips between light and dark and remembers the choice", async () => {
    vi.stubGlobal("React", React);
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => root.render(<EnergyIqThemeSwitch />));
    const toggle = host.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Dark mode"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(document.documentElement.dataset.energyiqTheme).toBe("light");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.energyiqTheme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    await act(async () => toggle.click());
    expect(document.documentElement.dataset.energyiqTheme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    await act(async () => root.unmount());
    // Leaving EnergyX hands the page back to the rest of the app's light styling.
    expect(document.documentElement.dataset.energyiqTheme).toBeUndefined();
    host.remove();
  });
});
