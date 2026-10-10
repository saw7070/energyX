import { describe, expect, it } from "vitest";
import { COUNTRY_DEFAULTS, publicHolidaysFor, usualOpeningDays } from "./site-region";

const dates = (holidays: Array<{ date: string }>) => holidays.map(holiday => holiday.date);

describe("site region defaults", () => {
  it("starts Singapore sites on SP Group's regulated tariff before GST, and Malaysian sites on TNB without SST", () => {
    expect(COUNTRY_DEFAULTS.SG).toMatchObject({ timezone: "Asia/Singapore", currency: "SGD", tax: { name: "GST", pct: 9, basis: "tax_exclusive" } });
    expect(COUNTRY_DEFAULTS.SG.tariffs[0]).toMatchObject({ rate: 0.2859 });
    expect(COUNTRY_DEFAULTS.MY).toMatchObject({ timezone: "Asia/Kuala_Lumpur", currency: "MYR", tax: null });
    const tou = COUNTRY_DEFAULTS.MY.tariffs.find(tariff => tariff.id === "my-tnb-lv-tou")!;
    // Energy, capacity, network and the September 2026 fuel adjustment, in ringgit.
    expect(tou.rate).toBe(0.5175);
    expect(tou.peak).toEqual({ rate: 0.5584, days: ["monday", "tuesday", "wednesday", "thursday", "friday"], from: "14:00", to: "22:00" });
    expect(COUNTRY_DEFAULTS.MY.tariffs.find(tariff => tariff.id === "my-tnb-lv-general")!.rate).toBe(0.5435);
  });

  it("gives Singapore its gazetted holidays with the days in lieu", () => {
    const holidays = publicHolidaysFor("SG");
    expect(dates(holidays)).toContain("2026-11-09");
    expect(holidays.find(holiday => holiday.date === "2026-03-21")).toMatchObject({ provisional: true });
  });

  it("gives each Malaysian state its own holidays and a replacement for each one that falls on the rest day", () => {
    const kualaLumpur = publicHolidaysFor("MY", "KUL");
    // Thaipusam and Federal Territory Day both fall on Sunday 1 February 2026: two replacement days.
    expect(dates(kualaLumpur)).toEqual(expect.arrayContaining(["2026-02-01", "2026-02-02", "2026-02-03"]));
    // Wesak on Sunday 31 May moves past the King's birthday on Monday 1 June.
    expect(dates(kualaLumpur)).toEqual(expect.arrayContaining(["2026-05-31", "2026-06-01", "2026-06-02"]));
    const selangor = publicHolidaysFor("MY", "SGR");
    expect(dates(selangor)).toContain("2026-12-11");
    expect(dates(selangor)).not.toContain("2026-02-03");
    expect(dates(publicHolidaysFor("MY", "SWK"))).not.toContain("2026-11-08");
    expect(dates(publicHolidaysFor("MY", "JHR"))).not.toContain("2026-01-01");
    expect(publicHolidaysFor("MY")).toEqual([]);
  });

  it("opens Sunday to Thursday where the weekend is Friday and Saturday", () => {
    expect(usualOpeningDays("MY", "KTN")).toEqual(["sunday", "monday", "tuesday", "wednesday", "thursday"]);
    expect(usualOpeningDays("MY", "SGR")).toEqual(["monday", "tuesday", "wednesday", "thursday", "friday"]);
  });
});
