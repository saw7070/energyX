/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteSavingsView } from "./site-savings";
import { siteSavingsMessages } from "./site-savings-messages";
import { affectedParts, changeProblems, pickerFrom, type SiteChangesDto } from "./site-changes-model";

beforeEach(() => {
  vi.stubGlobal("React", React);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // happy-dom has no modal dialogs.
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ""; });

// SKTC-like sample: two blocks of lights, a pavilion meter in no group.
const information = {
  locations: [{ id: "site", name: "SKTC", parentId: null }, { id: "b264e", name: "Block 264E", parentId: "site", sortOrder: 1 }, { id: "b264e-l2", name: "Level 2-17", parentId: "b264e" }, { id: "b264f", name: "Block 264F", parentId: "site", sortOrder: 0 }],
  meters: [
    { id: "e1", name: "264E corridor lights", locationId: "b264e-l2" }, { id: "e2", name: "264E lift lobby lights", locationId: "b264e" },
    { id: "f1", name: "264F corridor lights", locationId: "b264f" }, { id: "p1", name: "Pavilion lights", locationId: "site" },
  ],
};
const picker = pickerFrom(information);
const data: SiteChangesDto = {
  projectId: "sktc", canEdit: true,
  checks: [
    { id: "c1", projectId: "sktc", name: "Smart lighting: 30% night dimming", changeDate: "2026-12-01", meterIds: [], note: "Installed by Charles", createdAt: "2026-11-19T00:00:00.000Z" },
    { id: "c2", projectId: "sktc", name: "LED fittings", changeDate: "2026-11-01", meterIds: ["e1", "e2", "p1"], createdAt: "2026-11-02T00:00:00.000Z" },
  ],
};

async function render(props: Partial<Parameters<typeof SiteSavingsView>[0]> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onSave = vi.fn().mockResolvedValue(true), onRemove = vi.fn().mockResolvedValue(true);
  await act(async () => root.render(<SiteSavingsView projectId="sktc" data={data} picker={picker} today="2026-11-19" busy={false} error={null} onSave={onSave} onRemove={onRemove} {...props} />));
  const button = (label: string) => Array.from(host.querySelectorAll("button")).find(item => item.textContent === label || item.getAttribute("aria-label") === label) as HTMLButtonElement | undefined;
  const click = async (label: string) => { await act(async () => button(label)!.click()); };
  const type = async (label: string, value: string) => {
    const input = host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  const submit = async () => { await act(async () => host.querySelector("form")!.requestSubmit()); };
  return { host, onSave, onRemove, button, click, type, submit, unmount: () => act(async () => root.unmount()) };
}

describe("Facility → Savings: changes made on site", () => {
  it("lists each change with when it starts, what it affects and a link to its before and after", async () => {
    const view = await render();
    const text = view.host.textContent ?? "";
    expect(text).toContain("Smart lighting: 30% night dimming");
    expect(text).toContain("Starts Tue 1 Dec 2026 · Whole site");
    expect(text).toContain("Installed by Charles");
    // Every meter of Block 264E is listed, so the block is named once; the pavilion by itself.
    expect(text).toContain("Started Sun 1 Nov 2026 · Block 264E, Pavilion lights");
    const link = view.host.querySelector('a[href*="/energyiq/analysis"]') as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/energyiq/analysis?projectId=sktc&section=story-change");
    await view.unmount();
  });

  it("checks a new change before saving it: a name, a real date no more than a year ahead, and at least one meter", async () => {
    const view = await render({ data: { ...data, checks: [] } });
    expect(view.host.textContent).toContain("No changes recorded yet");
    await view.click("Record a change");
    await view.type("What changed", "  ");
    await view.type("Date it starts", "2028-01-01");
    await act(async () => (view.host.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).click());
    await view.submit();
    expect(Array.from(view.host.querySelectorAll('[role="alert"]')).map(item => item.textContent)).toEqual(["Say what changed.", "Choose a date no more than a year from today.", "Pick at least one group or meter."]);
    expect(view.onSave).not.toHaveBeenCalled();

    await view.type("What changed", "Smart lighting");
    await view.type("Date it starts", "2026-12-01");
    // Ticking a group picks every meter in it, nested groups included.
    const group = Array.from(view.host.querySelectorAll("label")).find(label => label.textContent === "All of Block 264E (2)")!.querySelector("input")!;
    await act(async () => group.click());
    await view.type("Note (optional)", " 30% at night ");
    await view.submit();
    expect(view.onSave).toHaveBeenCalledWith({ name: "Smart lighting", changeDate: "2026-12-01", meterIds: ["e1", "e2"], note: "30% at night" });
    await view.unmount();
  });

  it("edits a change in place and asks before removing one", async () => {
    const view = await render();
    await view.click("Edit “LED fittings”");
    expect((view.host.querySelector('input[aria-label="What changed"]') as HTMLInputElement).value).toBe("LED fittings");
    expect((view.host.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).checked).toBe(true);
    // One meter of Block 264E untouched: the group box shows it as partly picked.
    await act(async () => (Array.from(view.host.querySelectorAll("label")).find(label => label.textContent === "264E corridor lights")!.querySelector("input")!).click());
    const groupBox = Array.from(view.host.querySelectorAll("label")).find(label => label.textContent === "All of Block 264E (2)")!.querySelector("input")!;
    expect(groupBox.checked).toBe(false);
    expect(groupBox.indeterminate).toBe(true);
    await view.type("Date it starts", "2026-11-02");
    await view.submit();
    expect(view.onSave).toHaveBeenCalledWith({ name: "LED fittings", changeDate: "2026-11-02", meterIds: ["e2", "p1"] }, "c2");

    await view.click("Remove “Smart lighting: 30% night dimming”");
    expect(view.host.querySelector("dialog")?.textContent).toContain("Its before and after will no longer show on Analysis.");
    expect(view.onRemove).not.toHaveBeenCalled();
    await act(async () => (view.host.querySelector("dialog button:last-child") as HTMLButtonElement).click());
    expect(view.onRemove).toHaveBeenCalledWith("c1");
    await view.unmount();
  });

  it("shows people who may not change the Facility page the list only", async () => {
    const view = await render({ data: { ...data, canEdit: false } });
    expect(view.button("Record a change")).toBeUndefined();
    expect(view.button("Edit")).toBeUndefined();
    expect(view.button("Remove")).toBeUndefined();
    expect(view.host.textContent).toContain("Smart lighting: 30% night dimming");
    await view.unmount();
    const empty = await render({ data: { ...data, canEdit: false, checks: [] } });
    expect(empty.host.textContent).toContain("No changes recorded yet.");
    expect(empty.host.textContent).not.toContain("Record one");
    await empty.unmount();
  });

  it("groups the meters by top-level group in their saved order, and names the rest by meter", () => {
    expect(picker).toEqual({
      groups: [{ id: "b264f", name: "Block 264F", meters: [{ id: "f1", name: "264F corridor lights" }] }, { id: "b264e", name: "Block 264E", meters: [{ id: "e1", name: "264E corridor lights" }, { id: "e2", name: "264E lift lobby lights" }] }],
      ungrouped: [{ id: "p1", name: "Pavilion lights" }],
    });
    expect(affectedParts([], picker)).toEqual({ site: true, groups: [], meters: [] });
    expect(affectedParts(["e1", "gone"], picker)).toEqual({ site: false, groups: [], meters: ["264E corridor lights", "gone"] });
    expect(changeProblems({ name: "x", changeDate: "2026-02-30", whole: true, meterIds: [], note: "" }, "2026-11-19")).toEqual(["date"]);
    expect(changeProblems({ name: "x", changeDate: "2027-11-20", whole: true, meterIds: [], note: "" }, "2026-11-19")).toEqual([]);
    expect(changeProblems({ name: "x", changeDate: "2027-11-21", whole: true, meterIds: [], note: "" }, "2026-11-19")).toEqual(["dateAhead"]);
  });

  it("words every sentence in every language, with the same blanks", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    const keys = Object.keys(siteSavingsMessages.en).sort() as Array<keyof typeof siteSavingsMessages.en>;
    for (const locale of ["zh-Hans", "ms"] as const) {
      expect(Object.keys(siteSavingsMessages[locale]).sort()).toEqual(keys);
      for (const key of keys) {
        expect(siteSavingsMessages[locale][key].trim(), `${key} (${locale})`).toBeTruthy();
        expect(placeholders(siteSavingsMessages[locale][key]), `${key} (${locale})`).toEqual(placeholders(siteSavingsMessages.en[key]));
      }
    }
  });
});
