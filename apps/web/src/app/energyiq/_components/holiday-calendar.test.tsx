/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { configApi, type EnergyOperatingCalendarRevisionDto } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, type EnergyIqLocale } from "./energyiq-messages";
import { HolidayCalendar } from "./holiday-calendar";

const office = [{ from: "09:00", to: "18:00" }];
const school = { label: "School" };
const revision = { version_id: "cal-1", project_id: "office", timezone: "Asia/Singapore", published_by: "u", published_at: "2026-09-01T00:00:00Z",
  entries: [{ id: "e1", owner: { kind: "project" }, effective_from: "2026-07-01", effective_to: "2027-01-01",
    weekly: { monday: office, tuesday: office, wednesday: office, thursday: office, friday: office, saturday: [], sunday: [] },
    exceptions: [{ date: "2026-08-09", operating: [], label: "National Day", classification: "public_holiday" }, { date: "2026-08-10", operating: [], label: "National Day", classification: "public_holiday" }] }],
  academic_periods: [
    { id: "b", from: "2026-08-31", to: "2026-09-07", phase: "vacation", label: "Semester break", source: school },
    { id: "t", from: "2026-09-07", to: "2026-12-01", phase: "teaching", label: "Term", source: school },
  ] } as unknown as EnergyOperatingCalendarRevisionDto;

let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const setup = async (canEdit: boolean, onSaved = vi.fn(), locale?: EnergyIqLocale) => {
  vi.stubGlobal("React", React); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-22T04:00:00Z"));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const calendar = <HolidayCalendar projectId="office" timezone="Asia/Singapore" revision={revision} scopeNames={new Map()} canEdit={canEdit} onSaved={onSaved} />;
  if (locale) localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  await act(async () => root.render(locale ? <EnergyIqLocaleProvider>{calendar}</EnergyIqLocaleProvider> : calendar));
  return onSaved;
};
const button = (name: string) => Array.from(host.querySelectorAll("button")).find(item => item.textContent?.trim() === name || item.getAttribute("aria-label")?.startsWith(name))!;
const click = async (name: string, times = 1) => { for (let index = 0; index < times; index += 1) await act(async () => button(name).click()); };
const setValue = async (element: HTMLInputElement, value: string) => { await act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}); };
const form = () => host.querySelector<HTMLFormElement>('form[aria-label$="holiday"]')!;
const fill = async (name: string, category: string, until?: string) => {
  if (until) await setValue(form().querySelector<HTMLInputElement>('input[name="holiday-to"]')!, until);
  await setValue(form().querySelector<HTMLInputElement>('input[name="holiday-name"]')!, name);
  await act(async () => form().querySelector<HTMLInputElement>(`input[name="holiday-category"][value="${category}"]`)!.click());
};
const bars = (label: string) => Array.from(host.querySelectorAll<HTMLElement>('[role="grid"] [title]')).filter(item => item.textContent?.startsWith(label));
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("shows the current month with multi-day entries as one bar per week, plus a year overview, read-only for viewers", async () => {
  await setup(false);
  expect(host.querySelector('[role="grid"]')?.getAttribute("aria-label")).toBe("September 2026");
  const [semester] = bars("Semester break");
  expect(semester?.style.gridColumn).toBe("1 / span 7");
  expect(semester?.tagName).toBe("SPAN");
  expect(host.textContent).toContain("2Public holidays7School holiday days0Planned closures0Special hoursNext upNothing scheduled");
  expect(host.textContent).toContain("Operating hours cover 1 Jul 2026 – 31 Dec 2026.");
  expect(Array.from(host.querySelectorAll("aside li")).map(item => item.textContent)).toEqual([
    "Sun9National Day9 Aug 2026 – 10 Aug 2026 · Public holiday · Closed",
    "Mon31Semester break31 Aug 2026 – 6 Sept 2026 · School holiday · Normal hours",
  ]);
  expect(host.querySelector("aside button")).toBeNull();

  await click("Previous month");
  expect(bars("National Day").map(bar => bar.style.gridColumn)).toEqual(["7 / span 1", "1 / span 1"]);

  await click("Year");
  expect(host.querySelectorAll('table[aria-label$="2026"]').length).toBe(12);
  expect(host.querySelector('[aria-label="Sun, 9 Aug 2026, National Day, Public holiday"]')).not.toBeNull();
  expect(host.querySelector('[aria-label^="Tue, 1 Sept 2026"]')?.getAttribute("aria-label")).toContain("Semester break, School holiday");
});

it("requires a category, adds a closure and a half day, and saves one version that keeps the school terms", async () => {
  const publish = vi.spyOn(configApi, "publishEnergyOperatingCalendar").mockResolvedValue({} as Awaited<ReturnType<typeof configApi.publishEnergyOperatingCalendar>>);
  const onSaved = await setup(true);
  await click("Next month", 3);
  await click("Thu, 24 Dec 2026");
  expect(form().querySelector<HTMLInputElement>('input[name="holiday-from"]')!.value).toBe("2026-12-24");
  expect(form().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  await fill("Year-end break", "special_closure", "2026-12-31");
  expect(form().querySelector<HTMLInputElement>('input[name="holiday-hours"]:checked')!.value).toBe("closed");
  expect(form().querySelector('input[name="holiday-opens"]')).toBeNull();
  await act(async () => form().requestSubmit());
  expect(host.textContent).toContain("8 days changed");
  expect(bars("Year-end break").map(bar => bar.style.gridColumn)).toEqual(["4 / span 4", "1 / span 4"]);

  await click("Thu, 3 Dec 2026");
  await fill("Staff event", "special_operating_day");
  const [opens, closes] = Array.from(form().querySelectorAll<HTMLInputElement>('input[type="time"]'));
  expect([opens!.value, closes!.value]).toEqual(["09:00", "18:00"]);
  await setValue(closes!, "13:00");
  await act(async () => form().requestSubmit());

  await act(async () => { button("Fri, 11 Dec 2026").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); });
  await act(async () => { button("Mon, 14 Dec 2026").dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); });
  await act(async () => { window.dispatchEvent(new PointerEvent("pointerup")); });
  await fill("Office move week", "special_operating_day");
  expect(form().querySelector<HTMLInputElement>('input[name="holiday-hours"]:checked')!.value).toBe("custom");
  await act(async () => form().querySelector<HTMLInputElement>('input[name="holiday-hours"][value="normal"]')!.click());
  expect(form().querySelector('input[name="holiday-opens"]')).toBeNull();
  await act(async () => form().requestSubmit());
  expect(bars("Office move week").map(bar => [bar.style.gridColumn, bar.textContent])).toEqual([["5 / span 3", "Office move weekNormal hours"], ["1 / span 1", "Office move week"]]);

  await click("Save changes");
  const body = publish.mock.calls[0]![1];
  expect(body.entries[0]!.exceptions!.map(item => [item.date, item.classification, item.operating])).toEqual([
    ["2026-08-09", "public_holiday", []], ["2026-08-10", "public_holiday", []],
    ["2026-12-03", "special_operating_day", [{ from: "09:00", to: "13:00" }]],
    ["2026-12-11", "special_operating_day", [{ from: "09:00", to: "18:00" }]], ["2026-12-12", "special_operating_day", []],
    ["2026-12-13", "special_operating_day", []], ["2026-12-14", "special_operating_day", [{ from: "09:00", to: "18:00" }]],
    ...["24", "25", "26", "27", "28", "29", "30", "31"].map(day => [`2026-12-${day}`, "special_closure", []]),
  ]);
  expect(body.academicPeriods).toEqual(revision.academic_periods);
  expect(onSaved).toHaveBeenCalledWith("Holidays saved.");
});

it("saves a dragged school holiday as a school break, splitting term time instead of closing the site", async () => {
  const publish = vi.spyOn(configApi, "publishEnergyOperatingCalendar").mockResolvedValue({} as Awaited<ReturnType<typeof configApi.publishEnergyOperatingCalendar>>);
  await setup(true);
  await click("Next month", 2);
  await act(async () => { button("Mon, 2 Nov 2026").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); });
  await act(async () => { button("Fri, 6 Nov 2026").dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); });
  await act(async () => { window.dispatchEvent(new PointerEvent("pointerup")); });
  expect([form().querySelector<HTMLInputElement>('input[name="holiday-from"]')!.value, form().querySelector<HTMLInputElement>('input[name="holiday-to"]')!.value]).toEqual(["2026-11-02", "2026-11-06"]);
  await fill("November school holiday", "school_holiday");
  expect(form().querySelector('input[name="holiday-hours"]')).toBeNull();
  await act(async () => form().requestSubmit());
  expect(bars("November school holiday")[0]?.style.gridColumn).toBe("1 / span 5");

  await click("Save changes");
  const body = publish.mock.calls[0]![1];
  expect(body.entries[0]!.exceptions!.map(item => item.date)).toEqual(["2026-08-09", "2026-08-10"]);
  expect(body.academicPeriods).toEqual([
    revision.academic_periods![0],
    { ...revision.academic_periods![1], id: "t-a", to: "2026-11-02" },
    { id: "school-holiday-2026-11-02", from: "2026-11-02", to: "2026-11-07", phase: "vacation", label: "November school holiday", source: { label: "Entered in Facility" } },
    { ...revision.academic_periods![1], id: "t-b", from: "2026-11-07" },
  ]);
});

it("rejects days outside the published operating hours and edits or removes a grouped holiday", async () => {
  await setup(true);
  await click("Year");
  await click("Next year");
  await click("Fri, 1 Jan 2027");
  await fill("New Year's Day", "public_holiday");
  await act(async () => form().requestSubmit());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("No operating hours are set for Fri, 1 Jan 2027");

  await click("Previous year");
  await click("Cancel");
  await click("Edit National Day");
  expect(form().querySelector<HTMLInputElement>('input[name="holiday-to"]')!.value).toBe("2026-08-10");
  await click("Remove");
  await click("Edit Semester break");
  await click("Remove");
  expect(host.textContent).toContain("No holidays or special days in 2026.");
});

it("shows the calendar, its checks and its dates in Chinese, keeping saved holiday names as entered", async () => {
  await setup(true, vi.fn(), "zh-Hans");
  expect(host.querySelector('[role="grid"]')?.getAttribute("aria-label")).toBe("2026年9月");
  expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("2026年9月");
  expect(Array.from(host.querySelectorAll('[role="columnheader"]')).map(item => item.textContent)).toEqual(["周一", "周二", "周三", "周四", "周五", "周六", "周日"]);
  expect(host.textContent).toContain("2公共假期7学校假期天数0计划停业0特殊营业时间下一个暂无安排");
  expect(host.textContent).toContain("营业时间涵盖2026年7月1日至2026年12月31日。");
  expect(Array.from(host.querySelectorAll("aside li")).map(item => item.textContent)).toEqual([
    "周日9National Day2026年8月9日至2026年8月10日 · 公共假期 · 关闭",
    "周一31Semester break2026年8月31日至2026年9月6日 · 学校假期 · 正常营业时间",
  ]);

  await click("2026年9月24日周四");
  const dayForm = host.querySelector("form")!;
  expect(dayForm.getAttribute("aria-label")).toBe("添加假期");
  expect(dayForm.querySelector("h4")?.textContent).toBe("添加日子");
  await act(async () => dayForm.querySelector<HTMLInputElement>('input[name="holiday-category"][value="special_closure"]')!.click());
  expect(dayForm.querySelector<HTMLInputElement>('input[name="holiday-name"]')!.placeholder).toBe("例如：年终休假");
  await act(async () => dayForm.requestSubmit());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("请输入名称，例如：圣诞节。");

  await click("取消");
  await click("年");
  expect(host.querySelector('[aria-label="2026年8月9日周日，National Day，公共假期"]')).not.toBeNull();
  expect(Array.from(host.querySelectorAll("table caption")).map(item => item.textContent).slice(0, 3)).toEqual(["1月", "2月", "3月"]);
});

it("shows the calendar in Malay", async () => {
  await setup(false, vi.fn(), "ms");
  expect(host.querySelector('[role="grid"]')?.getAttribute("aria-label")).toBe("September 2026");
  expect(Array.from(host.querySelectorAll('[role="columnheader"]')).map(item => item.textContent)).toEqual(["Isn", "Sel", "Rab", "Kha", "Jum", "Sab", "Ahd"]);
  expect(host.textContent).toContain("2Cuti umum7Hari cuti sekolah0Penutupan terancang0Waktu khasSeterusnyaTiada yang dijadualkan");
  expect(host.textContent).toContain("Lihat sahaja. Minta pentadbir untuk menambah atau mengubah cuti.");
  expect(Array.from(host.querySelectorAll("aside li")).map(item => item.textContent)[0]).toBe("Ahd9National Day9 Ogo 2026 – 10 Ogo 2026 · Cuti umum · Tutup");
});
