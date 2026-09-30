/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnergyIqLanguageSwitch } from "./energyiq-language-switch";
import { EnergyIqLocaleProvider, useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { LANGUAGE_BOOT_SCRIPT, LANGUAGE_STORAGE_KEY, defineMessages, translator, translatorFor } from "./energyiq-messages";
import { formatPeriod } from "./report-period";

afterEach(() => { document.documentElement.lang = "en"; localStorage.clear(); vi.unstubAllGlobals(); });

function Heading() { const { t } = useEnergyIqLocale(); return <h1>{t("nav.overview")}</h1>; }

async function renderSwitch() {
  vi.stubGlobal("React", React);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider><EnergyIqLanguageSwitch /><Heading /></EnergyIqLocaleProvider>));
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("EnergyX language", () => {
  it("switches the app frame's language and remembers the choice", async () => {
    const { host, unmount } = await renderSwitch();
    expect(host.querySelector("h1")?.textContent).toBe("Overview");
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
    expect(trigger.getAttribute("aria-label")).toBe("Language: English");
    await act(async () => trigger.click());
    const options = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
    expect(options.map(option => option.textContent)).toEqual(["English", "简体中文", "Bahasa Melayu"]);
    expect(options[0].getAttribute("aria-checked")).toBe("true");
    await act(async () => options[1].click());
    expect(host.querySelector("h1")?.textContent).toBe("概览");
    expect(trigger.getAttribute("aria-label")).toBe("语言：简体中文");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("zh-Hans");
    expect(document.documentElement.lang).toBe("zh-Hans");
    await unmount();
    // Leaving EnergyX hands the page back to the rest of the app's English.
    expect(document.documentElement.lang).toBe("en");
  });

  it("restores a saved language and ignores unknown values", async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "ms");
    const saved = await renderSwitch();
    expect(saved.host.querySelector("h1")?.textContent).toBe("Gambaran keseluruhan");
    await saved.unmount();
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr");
    const unknown = await renderSwitch();
    expect(unknown.host.querySelector("h1")?.textContent).toBe("Overview");
    await unknown.unmount();
  });

  it("sets the page language before first paint only for supported languages", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "ms");
    new Function(LANGUAGE_BOOT_SCRIPT)();
    expect(document.documentElement.lang).toBe("ms");
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr");
    document.documentElement.lang = "en";
    new Function(LANGUAGE_BOOT_SCRIPT)();
    expect(document.documentElement.lang).toBe("en");
  });

  it("writes date ranges the way each language reads them", () => {
    expect(formatPeriod("2026-08-16", "2026-09-13")).toBe("16 Aug – 13 Sep 2026");
    expect(formatPeriod("2026-08-16", "2026-09-13", "zh-Hans")).toBe("2026年8月16日 – 9月13日");
    expect(formatPeriod("2026-08-01", "2026-08-31", "zh-Hans")).toBe("2026年8月1日–31日");
    expect(formatPeriod("2025-12-01", "2026-01-03", "zh-Hans")).toBe("2025年12月1日 – 2026年1月3日");
    expect(formatPeriod("2026-08-16", "2026-08-31", "ms")).toBe("16–31 Ogo 2026");
  });

  it("gives each area its own wording that follows the chosen language", async () => {
    const book = defineMessages({ greeting: "Hello {name}" }, { "zh-Hans": { greeting: "你好，{name}" }, ms: { greeting: "Helo {name}" } });
    expect(translatorFor(book, "zh-Hans")("greeting", { name: "Tuya" })).toBe("你好，Tuya");
    function Greeting() { const t = useMessages(book); return <p>{t("greeting", { name: "Tuya" })}</p>; }
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "ms");
    vi.stubGlobal("React", React);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => root.render(<EnergyIqLocaleProvider><Greeting /></EnergyIqLocaleProvider>));
    expect(host.textContent).toBe("Helo Tuya");
    await act(async () => root.unmount()); host.remove();
  });

  it("fills placeholders in translated text", () => {
    expect(translator("en")("notifications.count", { count: 3 })).toBe("Notifications, 3 new");
    expect(translator("zh-Hans")("notifications.count", { count: 3 })).toBe("通知，3 条新消息");
    expect(translator("ms")("shell.adminRequiredFor", { label: "Peranti" })).toBe("Peranti memerlukan akses pentadbir");
  });
});
