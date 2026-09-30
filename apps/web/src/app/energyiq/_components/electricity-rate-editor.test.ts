import { describe, expect, it } from "vitest";
import type { EnergyTariffScheduleRevisionDto } from "../../../lib/config-api";
import { nextRateDraft, rateDraftsFromRevision, rateEntriesForSave, zonedMidnight, type RateDraft } from "./electricity-rate-editor";

const TZ = "Asia/Singapore";
const revision: EnergyTariffScheduleRevisionDto = {
  version_id: "tariff-1", project_id: "tuya", published_by: "dev-user", published_at: "2026-07-01T00:00:00Z",
  entries: [{ id: "entry-1", owner: { kind: "project" }, effective_from: "2026-06-30T16:00:00.000Z", effective_to: "2026-09-30T16:00:00.000Z", currency: "SGD", rate_per_kwh: 0.3191, rate_basis: "tax_exclusive", tax: { name: "GST", rate_pct: 9 } }],
};
const draft = (patch: Partial<RateDraft>): RateDraft => ({ key: "k", owner: "project", from: "2026-10-01", to: "", currency: "SGD", rate: "0.3", basis: "tax_exclusive", taxName: "GST", taxPct: "9", ...patch });

describe("zonedMidnight", () => {
  it("writes local midnight with the zone's offset", () => {
    expect(zonedMidnight("2026-10-01", TZ)).toBe("2026-10-01T00:00:00+08:00");
    expect(zonedMidnight("2026-07-01", "Europe/London")).toBe("2026-07-01T00:00:00+01:00");
    expect(zonedMidnight("2026-01-15", "America/New_York")).toBe("2026-01-15T00:00:00-05:00");
  });
});

describe("rate drafts", () => {
  it("reads stored instants back as the days printed on the bill, end day included", () => {
    expect(rateDraftsFromRevision(revision, TZ)).toEqual([{ key: "entry-1", owner: "project", from: "2026-07-01", to: "2026-09-30", currency: "SGD", rate: "0.3191", basis: "tax_exclusive", taxName: "GST", taxPct: "9" }]);
  });
  it("starts the next period the day after the last one ends and keeps its tax", () => {
    const next = nextRateDraft(rateDraftsFromRevision(revision, TZ), "new");
    expect(next).toMatchObject({ from: "2026-10-01", to: "", rate: "", basis: "tax_exclusive", taxPct: "9", owner: "project" });
  });
  it("saves the same instants it was loaded from", () => {
    const [entry] = rateEntriesForSave(rateDraftsFromRevision(revision, TZ), TZ);
    expect(Date.parse(entry!.effectiveFrom)).toBe(Date.parse("2026-06-30T16:00:00.000Z"));
    expect(Date.parse(entry!.effectiveTo!)).toBe(Date.parse("2026-09-30T16:00:00.000Z"));
    expect(entry).toMatchObject({ owner: { kind: "project" }, currency: "SGD", ratePerKwh: 0.3191, rateBasis: "tax_exclusive", tax: { name: "GST", ratePct: 9 } });
  });
  it("leaves tax out when the bill does not say", () => {
    expect(rateEntriesForSave([draft({ basis: "" })], TZ)[0]).not.toHaveProperty("tax");
  });
});

describe("rateEntriesForSave checks", () => {
  it("explains missing or wrong details in plain words", () => {
    expect(() => rateEntriesForSave([draft({ from: "" })], TZ)).toThrow("Rate period 1 needs a start date.");
    expect(() => rateEntriesForSave([draft({ to: "2026-09-01" })], TZ)).toThrow("Rate period 1 ends before it starts.");
    expect(() => rateEntriesForSave([draft({ rate: "0" })], TZ)).toThrow("Rate period 1 needs a price per kWh above 0.");
    expect(() => rateEntriesForSave([draft({ taxPct: "" })], TZ)).toThrow("Rate period 1 needs a GST rate between 0 and 100%.");
  });
  it("catches periods that overlap in the same area", () => {
    const first = draft({ key: "a", from: "2026-07-01", to: "2026-10-01" });
    expect(() => rateEntriesForSave([first, draft({ key: "b", from: "2026-10-01" })], TZ)).toThrow("Rate periods 1 and 2 overlap. Each day can only have one rate.");
    expect(() => rateEntriesForSave([draft({ key: "a", from: "2026-07-01" }), draft({ key: "b", from: "2026-10-01" })], TZ)).toThrow("Rate period 1 has no end date, so it runs into period 2. Set its end date to Wed, 30 Sept 2026.");
    expect(rateEntriesForSave([draft({ key: "a", from: "2026-07-01" }), draft({ key: "b", from: "2026-08-01", owner: "level-2" })], TZ)[1]!.owner).toEqual({ kind: "scope", scopeId: "level-2" });
  });
});

describe("rateEntriesForSave checks in other languages", () => {
  it("explains problems in Chinese and Malay as whole sentences", () => {
    expect(() => rateEntriesForSave([draft({ from: "" })], TZ, "zh-Hans")).toThrow("电价时段 1 需要填写开始日期。");
    expect(() => rateEntriesForSave([draft({ taxPct: "" })], TZ, "zh-Hans")).toThrow("电价时段 1 需要填写 0 到 100% 之间的GST税率。");
    expect(() => rateEntriesForSave([draft({ taxPct: "", taxName: "" })], TZ, "zh-Hans")).toThrow("电价时段 1 需要填写 0 到 100% 之间的税率。");
    expect(() => rateEntriesForSave([draft({ key: "a", from: "2026-07-01" }), draft({ key: "b", from: "2026-10-01" })], TZ, "zh-Hans")).toThrow("电价时段 1 没有结束日期，因此与时段 2 重叠。请将其结束日期设为2026年9月30日周三。");
    expect(() => rateEntriesForSave([draft({ taxPct: "", taxName: "" })], TZ, "ms")).toThrow("Tempoh kadar 1 memerlukan kadar cukai antara 0 hingga 100%.");
    expect(() => rateEntriesForSave([draft({ key: "a", from: "2026-07-01", to: "2026-10-01" }), draft({ key: "b", from: "2026-10-01" })], TZ, "ms")).toThrow("Tempoh kadar 1 dan 2 bertindih. Setiap hari hanya boleh ada satu kadar.");
  });
});
