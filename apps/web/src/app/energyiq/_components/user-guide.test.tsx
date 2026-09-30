/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("./energyiq-access", () => ({ useEnergyIqAccess: () => ({ access: { role: "user" } }) }));
import { UserGuide } from "./user-guide";
import { GUIDE_PAGES, GUIDE_SAMPLES, GUIDE_START } from "./user-guide-content";

it("lists every page with a working link and filters the guide by search", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<UserGuide />));
  const links = [...host.querySelectorAll<HTMLAnchorElement>("#pages a")].map(link => link.getAttribute("href"));
  expect(links).toEqual(GUIDE_PAGES.map(page => page.href));
  expect(host.textContent).toContain("Update the electricity rate");
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(input, "heatmap"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(host.querySelector("#terms")).toBeNull();
  expect(host.querySelector("#charts")?.textContent).toContain("Heatmap");
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(input, "zzzz"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(host.textContent).toContain("Nothing in the guide matches");
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

it("reads and searches in the reader's language, keeping every link and entry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const { EnergyIqLocaleProvider } = await import("./energyiq-locale");
  const { LANGUAGE_STORAGE_KEY } = await import("./energyiq-messages");
  const { GUIDE_CHARTS, GUIDE_QUESTIONS, GUIDE_TASKS, GUIDE_TERMS, guideContent } = await import("./user-guide-content");
  for (const locale of ["zh-Hans", "ms"] as const) {
    const content = guideContent(locale);
    expect(content.pages.map(page => [page.href, page.icon, page.points.length])).toEqual(GUIDE_PAGES.map(page => [page.href, page.icon, page.points.length]));
    expect(content.tasks.map(task => [task.adminOnly, task.steps.length])).toEqual(GUIDE_TASKS.map(task => [task.adminOnly, task.steps.length]));
    expect([content.charts.length, content.terms.length, content.questions.length]).toEqual([GUIDE_CHARTS.length, GUIDE_TERMS.length, GUIDE_QUESTIONS.length]);
    // Every entry is translated, and entries stay distinct (they are used as list keys).
    expect(content.pages.some((page, index) => page.title === GUIDE_PAGES[index]!.title || page.purpose === GUIDE_PAGES[index]!.purpose)).toBe(false);
    expect(content.tasks.some((task, index) => task.title === GUIDE_TASKS[index]!.title || task.steps[0] === GUIDE_TASKS[index]!.steps[0])).toBe(false);
    expect(content.questions.some((item, index) => item.answer === GUIDE_QUESTIONS[index]!.answer)).toBe(false);
    expect(new Set(content.tasks.map(task => task.title)).size).toBe(GUIDE_TASKS.length);
    expect(new Set(content.terms.map(item => item.term)).size).toBe(GUIDE_TERMS.length);
  }

  localStorage.setItem(LANGUAGE_STORAGE_KEY, "zh-Hans");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider><UserGuide /></EnergyIqLocaleProvider>));
  expect(host.querySelector("h1")?.textContent).toBe("如何看懂 EnergyX 并据此行动");
  expect([...host.querySelectorAll<HTMLAnchorElement>("#pages a")].map(link => link.getAttribute("href"))).toEqual(GUIDE_PAGES.map(page => page.href));
  expect(host.querySelector("#pages")?.textContent).toContain("打开“楼层布局”");
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(input.getAttribute("aria-label")).toBe("搜索指南");
  const search = async (value: string) => act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await search("热力图");
  expect(host.querySelector("#charts")?.textContent).toContain("热力图");
  expect(host.querySelector("#questions")).toBeNull();
  await search("zzzz");
  const empty = host.querySelector('[role="status"]')!;
  expect(empty.textContent).toBe("指南中没有与“zzzz”相符的内容。请试试更短的词，或咨询能源顾问。");
  expect(empty.querySelector("a")?.textContent).toBe("咨询能源顾问");
  await act(async () => root.unmount());

  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ms");
  const malay = createRoot(host);
  await act(async () => malay.render(<EnergyIqLocaleProvider><UserGuide /></EnergyIqLocaleProvider>));
  expect(host.querySelector("#tasks")?.textContent).toContain("Kemas kini kadar elektrik");
  expect(host.querySelector("footer")?.textContent).toBe("Masih buntu? Tanya penasihat tenaga. Penasihat mengetahui data premis anda dan boleh menerangkan sebarang angka.");
  await act(async () => malay.unmount()); host.remove(); localStorage.clear(); document.documentElement.lang = "en"; vi.unstubAllGlobals();
});

it("teaches a newcomer with a walkthrough and drawn chart examples, in every language", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const { EnergyIqLocaleProvider } = await import("./energyiq-locale");
  const { LANGUAGE_STORAGE_KEY } = await import("./energyiq-messages");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider><UserGuide /></EnergyIqLocaleProvider>));

  // Five numbered steps that end in a decision, before anything else on the page.
  const start = host.querySelector("#start")!;
  expect(start.querySelectorAll("li").length).toBe(GUIDE_START.length);
  expect(start.textContent).toContain("Start on the Overview");
  expect(start.textContent).toContain("Come back in a week");
  expect([...host.querySelectorAll("section")].indexOf(start as HTMLElement)).toBe(0);

  // Each chart example is drawn, described for a screen reader, and says what to look for.
  const samples = host.querySelector("#samples")!;
  expect(samples.querySelectorAll("article").length).toBe(GUIDE_SAMPLES.length);
  expect(samples.querySelectorAll("svg[role='img']").length).toBe(GUIDE_SAMPLES.length);
  expect([...samples.querySelectorAll("svg")].every(figure => (figure.getAttribute("aria-label") ?? "").length > 10)).toBe(true);
  expect(samples.textContent).toContain("running 24 hours");
  // The examples carry no real site's figures.
  expect(samples.textContent).toContain("The figures here are made up.");

  // Searching reaches the new sections too.
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "stripes"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(host.querySelector("#samples")?.querySelectorAll("article").length).toBe(1);
  expect(host.querySelector("#start")).toBeNull();
  // "heatmap" appears in the walkthrough as well, so both sections answer it.
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "heatmap"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(host.querySelector("#start")).not.toBeNull();
  expect(host.querySelector("#samples")).not.toBeNull();
  await act(async () => root.unmount());

  for (const [language, step, sample] of [["zh-Hans", "先看“概览”", "热力图：设备什么时候运行"], ["ms", "Mula di Gambaran keseluruhan", "Peta haba: bila sesuatu peranti berjalan"]] as const) {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    const translated = createRoot(host);
    await act(async () => translated.render(<EnergyIqLocaleProvider><UserGuide /></EnergyIqLocaleProvider>));
    expect(host.querySelector("#start")?.textContent).toContain(step);
    expect(host.querySelector("#samples")?.textContent).toContain(sample);
    expect(host.querySelectorAll("#samples svg[role='img']").length).toBe(GUIDE_SAMPLES.length);
    await act(async () => translated.unmount());
  }
  host.remove(); localStorage.clear(); document.documentElement.lang = "en"; vi.unstubAllGlobals();
});
