/** @vitest-environment happy-dom */
import React, { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configApi, type EnergyOperatingCalendarRevisionDto, type EnergyOperationalPolicyConfigurationDto, type EnergyProjectSetupDto, type EnergyTariffScheduleRevisionDto } from "../../../lib/config-api";
import { OperationalPolicySettings } from "../admin/operational-policy-settings";
import { ElectricityRateEditor } from "./electricity-rate-editor";
import { ElectricityRateView } from "./electricity-rate-view";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY, translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { operatingHoursMessages } from "./operating-policy-messages";

// Wording is edited in the messages file; these tests check it reaches the page, not its exact text.
const zh = translatorFor(operatingHoursMessages, "zh-Hans");
import { OperatingCalendarEditor } from "./operating-calendar-editor";
import { OperatingHoursView } from "./operating-hours-view";

const office = [{ from: "09:00", to: "18:00" }];
const calendar = { version_id: "cal-1", project_id: "office", timezone: "Asia/Singapore", published_by: "u", published_at: "2026-09-01T00:00:00Z",
  entries: [{ id: "e1", owner: { kind: "project" }, effective_from: "2026-07-01", effective_to: "2027-01-01",
    weekly: { monday: office, tuesday: office, wednesday: office, thursday: office, friday: office, saturday: [], sunday: [] },
    exceptions: [{ date: "2026-12-25", operating: [], label: "Christmas Day", classification: "public_holiday" }] }],
  academic_periods: [{ id: "b", from: "2026-09-07", to: "2026-09-28", phase: "term_break", label: "Term 3 break", source: { label: "School" } }],
} as unknown as EnergyOperatingCalendarRevisionDto;
const tariff: EnergyTariffScheduleRevisionDto = { version_id: "tariff-1", project_id: "office", published_by: "u", published_at: "2026-07-01T00:00:00Z",
  entries: [{ id: "rate-1", owner: { kind: "project" }, effective_from: "2026-06-30T16:00:00.000Z", effective_to: "2026-09-30T16:00:00.000Z", currency: "SGD", rate_per_kwh: 0.3191, rate_basis: "tax_exclusive", tax: { name: "GST", rate_pct: 9 } }] };
const owner = () => "Office";

let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
async function render(node: ReactNode, locale: EnergyIqLocale) {
  vi.stubGlobal("React", React); (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-22T04:00:00Z"));
  localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
}
const texts = (selector: string) => Array.from(host.querySelectorAll(selector)).map(item => item.textContent);
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Facility policy pages in other languages", () => {
  it("shows the operating hours in Chinese", async () => {
    await render(<OperatingHoursView revision={calendar} status="draft" ownerName={owner} onViewCalendar={() => undefined} timezone="Asia/Singapore" />, "zh-Hans");
    expect(host.textContent).toContain(zh("status.draft"));
    expect(texts('[role="rowheader"]')).toEqual(["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"]);
    expect(texts("strong").slice(0, 3)).toEqual(["周一至周五", "45 小时", "2026年7月1日至12月31日"]);
    expect(host.textContent).toContain("每周 5 天 · Office");
    expect(host.textContent).toContain("每个开放日约 9 小时");
    expect(host.querySelector('[role="table"]')?.getAttribute("aria-label")).toBe("每周营业时间");
    expect(host.textContent).toContain("Christmas Day公共假期 · 关闭");
    expect(host.textContent).toContain("Term 3 break学期间短假 · 当前");
  });

  it("shows the operating hours in Malay", async () => {
    await render(<OperatingHoursView revision={calendar} status="published" ownerName={owner} onViewCalendar={() => undefined} timezone="Asia/Singapore" />, "ms");
    expect(host.textContent).toContain("Diterbitkan");
    expect(texts("strong").slice(0, 3)).toEqual(["Isn–Jum", "45 jam", "1 Jul – 31 Dis 2026"]);
    expect(host.textContent).toContain("5 hari seminggu · Office");
    expect(host.textContent).toContain("Christmas DayCuti umum · tutup");
  });

  it("shows the electricity rate and its editor in Chinese", async () => {
    await render(<ElectricityRateView revision={tariff} status="published" ownerName={owner} timezone="Asia/Singapore" onAddNext={() => undefined} />, "zh-Hans");
    expect(host.textContent).toContain("当前电价S$0.3191 /kWh未含 9% GST · 含 GST 为 S$0.3478/kWh");
    expect(host.textContent).toContain("生效期间2026年7月1日至9月30日8 天后结束");
    expect(host.textContent).toContain("1,000 kWh ≈ S$319.10");
    expect(host.textContent).toContain("2026年9月30日周三之后尚未设定电价。");
    expect(host.querySelector('section[aria-label="电价时段"]')).not.toBeNull();
    await act(async () => root.render(<EnergyIqLocaleProvider><ElectricityRateEditor projectId="office" revision={tariff} timezone="Asia/Singapore" scopeOptions={[]} addNext onSaved={() => undefined} onCancel={() => undefined} /></EnergyIqLocaleProvider>));
    expect(texts("legend")).toEqual(["电价时段 1当前", "电价时段 2即将生效"]);
    expect(texts("option").slice(0, 3)).toEqual(["未含 GST", "已含 GST", "电费单上未注明"]);
    expect(host.textContent).toContain("含 9% GST 为 S$0.3478/kWh · 1,000 kWh ≈ S$319.10");
    await act(async () => Array.from(host.querySelectorAll("button")).find(button => button.textContent === "保存电价")!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("电价时段 2 需要填写大于 0 的每 kWh 价格。");
  });

  it("shows the admin tariff and calendar settings in Malay", async () => {
    const policies = { projectId: "office", timezone: "Asia/Singapore", published: { tariff_schedule_version: "tariff-1", business_calendar_version: "cal-1" }, pending: { tariff_schedule_version: "tariff-1", business_calendar_version: "cal-1" },
      tariffRevisions: [tariff], operatingCalendarRevisions: [calendar], hasUnpublishedChanges: false } as unknown as EnergyOperationalPolicyConfigurationDto;
    vi.spyOn(configApi, "getEnergyOperationalPolicies").mockResolvedValue(policies);
    const setup = { project: { name: "Office", root_scope_id: "root" }, published: { nodes: [] } } as unknown as EnergyProjectSetupDto;
    await render(<OperationalPolicySettings projectId="office" setup={setup} onChanged={async () => undefined} />, "ms");
    expect(host.textContent).toContain("Dasar operasi");
    expect(host.textContent).toContain("Sepadan dengan Keluaran yang diterbitkan");
    expect(host.textContent).toContain("Tempoh kadar 1");
    expect(host.textContent).toContain("1 semakan yang tidak boleh diubah");
    expect(texts("button")).toContain("Terbitkan semakan Tarif");
    expect(host.querySelector('select[aria-label="Asas cukai kadar tarif"]')).not.toBeNull();
  });

  it("edits operating hours in Chinese, including the shared weekly editor", async () => {
    await render(<OperatingCalendarEditor projectId="office" revision={calendar} scopeOptions={[{ value: "project", label: "Office · 项目默认" }]} onSaved={() => undefined} onCancel={() => undefined} />, "zh-Hans");
    expect(host.textContent).toContain(zh("editor.intro"));
    expect(host.textContent).toContain("日历时段 1");
    expect(host.textContent).toContain("星期六关闭添加时间");
    expect(host.querySelector('select[aria-label="日历例外类型"]')).not.toBeNull();
    expect(texts("button").slice(-2)).toEqual(["取消", "保存更改"]);
  });
});
