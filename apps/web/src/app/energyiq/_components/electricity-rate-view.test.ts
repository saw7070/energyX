import { describe, expect, it } from "vitest";
import { localDay, ratePeriod, withTax } from "./electricity-rate-view";

describe("ratePeriod", () => {
  it("shows stored instants as local days with an inclusive end", () => {
    expect(localDay("2026-06-30T16:00:00.000Z", "Asia/Singapore")).toBe("2026-07-01");
    expect(ratePeriod({ effective_from: "2026-06-30T16:00:00.000Z", effective_to: "2026-09-30T16:00:00.000Z" }, "Asia/Singapore")).toEqual({ from: "2026-07-01", to: "2026-09-30", text: "1 Jul – 30 Sept 2026" });
    expect(ratePeriod({ effective_from: "2026-06-30T16:00:00.000Z" }, "Asia/Singapore").to).toBeNull();
  });
});

describe("withTax", () => {
  it("works out the price with and without GST from the saved basis", () => {
    const exclusive = withTax({ rate_per_kwh: 0.3191, rate_basis: "tax_exclusive", tax: { name: "GST", rate_pct: 9 } });
    expect(exclusive.afterTax).toBeCloseTo(0.347819, 6);
    expect(exclusive.note).toBe("before 9% GST");
    const inclusive = withTax({ rate_per_kwh: 0.3478, rate_basis: "tax_inclusive", tax: { name: "GST", rate_pct: 9 } });
    expect(inclusive.beforeTax).toBeCloseTo(0.3191, 4);
    expect(withTax({ rate_per_kwh: 0.3 }).note).toBe("tax basis not stated");
  });
});

describe("rate wording in other languages", () => {
  it("writes the tax note and rate period in Chinese and Malay", () => {
    const entry = { rate_per_kwh: 0.3191, rate_basis: "tax_exclusive" as const, tax: { name: "GST", rate_pct: 9 } };
    expect(withTax(entry, "zh-Hans").note).toBe("未含 9% GST");
    expect(withTax({ rate_per_kwh: 0.3 }, "ms").note).toBe("asas cukai tidak dinyatakan");
    expect(ratePeriod({ effective_from: "2026-06-30T16:00:00.000Z", effective_to: "2026-09-30T16:00:00.000Z" }, "Asia/Singapore", "zh-Hans").text).toBe("2026年7月1日至9月30日");
    expect(ratePeriod({ effective_from: "2026-06-30T16:00:00.000Z" }, "Asia/Singapore", "zh-Hans").text).toBe("自2026年7月1日起");
    expect(ratePeriod({ effective_from: "2026-06-30T16:00:00.000Z" }, "Asia/Singapore").text).toBe("From 1 Jul 2026");
  });
});
