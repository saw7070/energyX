/** @vitest-environment happy-dom */
import React, { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnergyOperatingCalendarRevisionDto } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "../_components/energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale } from "../_components/energyiq-messages";
import { OperatingHoursView } from "../_components/operating-hours-view";
import { calendarPublishEntries, createEmptyCalendarEntry, type OperatingCalendarEntryDraft } from "./operational-policy-model";
import { CalendarEntryEditor } from "./operational-policy-settings";

let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
async function render(node: ReactNode, locale: EnergyIqLocale = "en") {
  vi.stubGlobal("React", React); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
}
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });

const setInput = async (element: HTMLInputElement | HTMLSelectElement, value: string) => { await act(async () => {
  Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}); };
const click = async (element: Element) => { await act(async () => { (element as HTMLElement).click(); }); };
/** The "Add hours" button of each weekday, Monday first. */
const addHours = () => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).filter(button => button.textContent === "Add hours");

/** The editor as a page uses it: it keeps the draft and hands it back on every change. */
function Harness({ onDraft }: { onDraft: (entry: OperatingCalendarEntryDraft) => void }) {
  const [entry, setEntry] = useState<OperatingCalendarEntryDraft>({ ...createEmptyCalendarEntry("e1"), effectiveFrom: "2026-07-01" });
  return <CalendarEntryEditor entry={entry} index={0} scopeOptions={[{ value: "project", label: "Estate" }]} removable={false}
    onChange={next => { setEntry(next); onDraft(next); }} onRemove={() => undefined} />;
}

describe("the hours editor", () => {
  it("accepts hours that run past midnight and says they end the next day", async () => {
    let draft: OperatingCalendarEntryDraft | null = null;
    await render(<Harness onDraft={entry => { draft = entry; }} />);
    // Opening hours by default; the meaning is chosen per site.
    const meaning = host.querySelector<HTMLSelectElement>('select[aria-label="What the hours mean"]')!;
    expect(meaning.value).toBe("opening");
    expect(host.textContent).toContain("For hours past midnight, set an end earlier than the start");

    // A Monday office day, then its end moved to 07:00: it now runs overnight into Tuesday morning.
    expect(addHours()).toHaveLength(7);
    await click(addHours()[0]!);
    const to = () => host.querySelector<HTMLInputElement>('input[aria-label="Operating to"]')!;
    expect(to().value).toBe("18:00");
    expect(host.textContent).not.toContain("next day");
    await setInput(to(), "07:00");
    expect(host.textContent).toContain("next day");
    await setInput(host.querySelector<HTMLInputElement>('input[aria-label="Operating from"]')!, "19:00");
    expect(calendarPublishEntries([draft!])[0]!.weekly.monday).toEqual([{ from: "19:00", to: "07:00" }]);

    // Lights-on hours: a day without hours has the lights off, and new hours start as a night.
    await setInput(meaning, "lights_on");
    expect(host.textContent).toContain("Use outside these hours counts as lights on in the daytime.");
    expect(host.textContent).toContain("Lights off");
    await click(addHours()[1]!);
    const tuesday = host.querySelectorAll<HTMLInputElement>('input[aria-label="Operating to"]')[1]!;
    expect(tuesday.value).toBe("07:00");
    expect(calendarPublishEntries([draft!])[0]).toMatchObject({ hoursMeaning: "lights_on", weekly: { monday: [{ from: "19:00", to: "07:00" }], tuesday: [{ from: "19:00", to: "07:00" }] } });

    // The same time twice is still no hours at all.
    await setInput(tuesday, "19:00");
    expect(() => calendarPublishEntries([draft!])).toThrowError("starts and ends at the same time");
  });
});

describe("the hours view", () => {
  const nights = [{ from: "19:00", to: "07:00" }];
  const revision = { version_id: "cal-1", project_id: "estate", timezone: "Asia/Singapore", published_by: "u", published_at: "2026-09-01T00:00:00Z",
    entries: [{ id: "e1", owner: { kind: "project" }, effective_from: "2026-07-01", hours_meaning: "lights_on",
      weekly: { monday: nights, tuesday: nights, wednesday: nights, thursday: nights, friday: nights, saturday: nights, sunday: [] } }],
  } as unknown as EnergyOperatingCalendarRevisionDto;

  it("shows a night as one stretch ending the next morning", async () => {
    await render(<OperatingHoursView revision={revision} status="published" ownerName={() => "Estate"} onViewCalendar={() => undefined} timezone="Asia/Singapore" />);
    expect(host.textContent).toContain("Lights-on hours: lighting that should run at night.");
    const times = Array.from(host.querySelectorAll('[role="row"]')).map(row => row.querySelector('[role="cell"]:last-child')?.textContent);
    expect(times[0]).toBe("19:00 → 07:00 next day12 h");
    expect(times[6]).toBe("Lights off");
    expect(host.textContent).toContain("72 h");
  });

  it("is worded in Chinese and Malay", async () => {
    await render(<OperatingHoursView revision={revision} status="published" ownerName={() => "Estate"} onViewCalendar={() => undefined} timezone="Asia/Singapore" />, "zh-Hans");
    expect(host.textContent).toContain("19:00 → 次日 07:00");
    expect(host.textContent).toContain("不亮灯");
    await act(async () => root.unmount()); host.remove();
    await render(<OperatingHoursView revision={revision} status="published" ownerName={() => "Estate"} onViewCalendar={() => undefined} timezone="Asia/Singapore" />, "ms");
    expect(host.textContent).toContain("19:00 → 07:00 hari berikutnya");
    expect(host.textContent).toContain("Lampu padam");
  });
});
