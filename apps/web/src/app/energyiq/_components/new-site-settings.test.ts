import { describe, expect, it } from "vitest";
import { calendarEntryForSave, choosePlan, chooseState, defaultSiteSettings, settingsProblem, tariffEntryForSave } from "./new-site-settings";

const label = (planId: string) => `label:${planId}`;

describe("new site settings", () => {
  it("starts a Singapore site on SP Group's price before 9% GST, Mon–Fri hours and the MOM holidays", () => {
    const settings = defaultSiteSettings("SG");
    expect(settingsProblem(settings)).toBeNull();
    expect(tariffEntryForSave(settings, label)).toEqual({
      owner: { kind: "project" },
      effectiveFrom: "2020-01-01T00:00:00+08:00",
      currency: "SGD",
      ratePerKwh: 0.2859,
      rateBasis: "tax_exclusive",
      tax: { name: "GST", ratePct: 9 },
      plan: { id: "sg-sp-regulated", label: "label:sg-sp-regulated", source: expect.stringContaining("SP Group") },
    });
    const calendar = calendarEntryForSave(settings)!;
    expect(calendar.weekly.monday).toEqual([{ from: "09:00", to: "18:00" }]);
    expect(calendar.weekly.saturday).toEqual([]);
    expect(calendar.exceptions).toContainEqual({ date: "2026-11-09", operating: [], label: "Deepavali (in lieu)", classification: "public_holiday" });
  });

  it("needs a Malaysian state, then gives its holidays and working week", () => {
    const settings = defaultSiteSettings("MY");
    expect(settingsProblem(settings)).toBe("stateRequired");
    const kelantan = chooseState(settings, "KTN");
    expect(settingsProblem(kelantan)).toBeNull();
    expect(kelantan.hours!.days).toEqual(["sunday", "monday", "tuesday", "wednesday", "thursday"]);
    expect(kelantan.holidays!.map(holiday => holiday.date)).toContain("2026-09-29");
  });

  it("saves TNB time-of-use with peak hours, holidays off-peak, no SST and the fixed charges for reference", () => {
    const settings = choosePlan(chooseState(defaultSiteSettings("MY"), "SGR"), "my-tnb-lv-tou");
    expect(tariffEntryForSave(settings, label)).toEqual({
      owner: { kind: "project" },
      effectiveFrom: "2020-01-01T00:00:00+08:00",
      currency: "MYR",
      ratePerKwh: 0.5175,
      timeOfUse: { peakRatePerKwh: 0.5584, peakWindows: [{ days: ["monday", "tuesday", "wednesday", "thursday", "friday"], from: "14:00", to: "22:00" }], holidaysOffPeak: true },
      fixedCharges: [{ label: "Retail charge", amount: 20, unit: "per_month" }],
      plan: { id: "my-tnb-lv-tou", label: "label:my-tnb-lv-tou", source: expect.stringContaining("TNB") },
    });
  });

  it("keeps what was typed for my own price, and reports what still needs fixing", () => {
    const custom = choosePlan({ ...defaultSiteSettings("SG"), price: { planId: "sg-sp-regulated", rate: "0.2500", peak: null, fixedCharges: [] } }, "custom");
    expect(custom.price).toEqual({ planId: "custom", rate: "0.2500", peak: null, fixedCharges: [] });
    expect(settingsProblem({ ...custom, price: { ...custom.price!, rate: "0" } })).toBe("priceInvalid");
    expect(settingsProblem({ ...custom, price: { ...custom.price!, peak: { rate: "0.3", days: ["monday"], from: "22:00", to: "14:00", holidaysOffPeak: true } } })).toBe("peakHoursInvalid");
    expect(settingsProblem({ ...custom, hours: { days: [], from: "09:00", to: "18:00" } })).toBe("hoursInvalid");
  });

  it("saves nothing for sections left for later", () => {
    const later = { ...defaultSiteSettings("SG"), price: null, hours: null, holidays: null };
    expect(settingsProblem(later)).toBeNull();
    expect(tariffEntryForSave(later, label)).toBeNull();
    expect(calendarEntryForSave(later)).toBeNull();
    const hoursOnly = { ...defaultSiteSettings("SG"), holidays: null };
    expect(calendarEntryForSave(hoursOnly)!.exceptions).toBeUndefined();
  });
});
