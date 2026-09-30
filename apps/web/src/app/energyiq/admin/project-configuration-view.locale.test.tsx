/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectConfigurationView } from "../_components/project-configuration-view";
import { EnergyIqLocaleProvider } from "../_components/energyiq-locale";
import { LANGUAGE_STORAGE_KEY, translatorFor } from "../_components/energyiq-messages";
import { projectConfigurationMessages } from "../_components/project-configuration-messages";
import type { EnergyOperationalPolicyConfigurationDto, EnergyProjectSetupDto } from "../../../lib/config-api";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

const setup = { project: { has_unpublished_changes: true }, draft: { document: { project: { name: "Campus", timezone: "Asia/Singapore" }, tiers: [{ id: "building", alias: "Building" }], nodes: [{ id: "a", name: "Block A", tier_definition_id: "building", area_sqm: 100, occupant_count: 20 }], meter_mapping: { rows: [{ id: "m", display_name: "Meter 03", presentation: { device_name: "Cooling", circuit_name: "L1P17" }, scope_id: "a", resource: "electricity", category: "aircon", aggregation_usage: "excluded", meter_role: "component" }], virtual_meters: [] } } } } as unknown as EnergyProjectSetupDto;

async function renderIn(locale: string) {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  vi.stubGlobal("React", React);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider><ProjectConfigurationView setup={setup} notes="" policies={null as unknown as EnergyOperationalPolicyConfigurationDto} projectId="campus" /></EnergyIqLocaleProvider>));
  return { host, unmount: () => act(async () => root.unmount()) };
}

it("shows the Facility tabs and floor layout frame in the reader's language, leaving site names as recorded", async () => {
  const zh = await renderIn("zh-Hans");
  const tabs = Array.from(zh.host.querySelectorAll("nav button span")).map(tab => tab.textContent);
  expect(tabs).toEqual(["楼层布局", "设备", "项目备注", "营业时间", "假期", "电价"]);
  // Publishing wording changes often; check it follows the language rather than its exact text.
  const zhText = translatorFor(projectConfigurationMessages, "zh-Hans");
  expect(zh.host.textContent).toContain(zhText("unpublished"));
  expect(zh.host.textContent).not.toContain(translatorFor(projectConfigurationMessages, "en")("unpublished"));
  expect(zh.host.textContent).toContain("Block A");
  await zh.unmount();

  const ms = await renderIn("ms");
  expect(Array.from(ms.host.querySelectorAll("nav button span")).map(tab => tab.textContent)).toEqual(["Susun atur lantai", "Peranti", "Nota projek", "Waktu operasi", "Cuti", "Kadar elektrik"]);
  expect(ms.host.querySelector("nav")?.getAttribute("aria-label")).toBe("Bahagian konfigurasi");
  await ms.unmount();
});
