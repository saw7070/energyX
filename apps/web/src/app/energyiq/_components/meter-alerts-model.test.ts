import { describe, expect, it } from "vitest";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { meterAlertEntries, type MeterAlertDto } from "./meter-alerts-model";
import { notificationMessages } from "./notification-messages";

const gateway: MeterAlertDto = {
  key: "meter-offline:a:20261116T1830", readKey: "meter-offline:a:20261116T1830:back", kind: "meter_offline", status: "resolved",
  openedAt: "2026-11-17T19:00:00.000Z", resolvedAt: "2026-11-17T19:00:00.000Z",
  details: {
    location: "Block 264F", since: "2026-11-16T10:30:00.000Z", back: "2026-11-16T23:00:00.000Z", filledLateKwh: 9.8,
    meters: ["264F L2-L17", "264F L1", "264F lift lobby", "264F stairs"].map((name) => ({ id: name, name, since: "2026-11-16T10:30:00.000Z" })),
  },
};
const fan: MeterAlertDto = {
  key: "never-used:b:20261113T2300", readKey: "never-used:b:20261113T2300", kind: "never_used", status: "open", openedAt: "2026-11-14T19:00:00.000Z",
  details: { meterName: "Pavilion DL & fan", start: "2026-11-13T15:00:00.000Z", hours: 1, totalKwh: 0.3, ongoing: true },
};
const emergency: MeterAlertDto = {
  key: "usage-pattern:c:20261118T1500", readKey: "usage-pattern:c:20261118T1500", kind: "usage_pattern", status: "resolved", openedAt: "2026-11-18T19:00:00.000Z", resolvedAt: "2026-11-18T19:00:00.000Z",
  details: { meterName: "Emergency lights", direction: "zero", at: "2026-11-18T07:00:00.000Z", start: "2026-11-18T07:00:00.000Z", end: "2026-11-18T08:00:00.000Z", hours: 1, kwh: 0, usualKwh: 0.1, ongoing: false },
};
const more: MeterAlertDto = { key: "usage-pattern-more:20261119", readKey: "usage-pattern-more:20261119", kind: "usage_pattern_more", status: "open", openedAt: "2026-11-18T19:00:00.000Z", details: { date: "2026-11-19", count: 2, names: ["Meter 6", "Meter 7"] } };

const entries = (locale: EnergyIqLocale) => meterAlertEntries([gateway, fan, emergency, more], { t: translatorFor(notificationMessages, locale), locale, projectId: "sktc" });

describe("Meter alerts in the bell", () => {
  it("words each alert in plain English", () => {
    const [back, used, drop, rest] = entries("en");
    expect(back).toMatchObject({
      key: gateway.readKey, readKey: gateway.readKey, tone: "info", kind: "meter-offline", at: gateway.resolvedAt, quietMeterIds: [],
      title: "4 meters in Block 264F stopped sending at 6:30 pm — likely their gateway",
      detail: "Back since 17 Nov, 7:00 am; readings sent late were filled in.",
      href: "/energyiq/project-configuration?projectId=sktc&tab=availability",
    });
    expect(used).toMatchObject({ tone: "warning", kind: "never-used", title: "Pavilion DL & fan used 0.30 kWh at 11 pm — it should never use power", detail: "On Fri, 13 Nov. Someone may be using it without leave. Still using power at the latest reading." });
    expect(drop).toMatchObject({ kind: "pattern", title: "Emergency lights dropped to 0 at 3 pm (usually 0.10 kW)", detail: "Wed, 18 Nov, for one hour. Back to usual from 4 pm." });
    expect(rest).toMatchObject({ tone: "info", kind: "pattern", title: "Unusual use on 2 more meters today", detail: "Meter 6, Meter 7. Each one is on the Analysis page." });
  });

  it("says the same in Chinese and Malay", () => {
    const zh = entries("zh-Hans");
    expect(zh[0]!.title).toBe("Block 264F 的 4 个电表于 下午6:30 停止发送读数，可能是网关的问题");
    expect(zh[0]!.detail).toMatch(/^自 .+ 起已恢复；离线期间迟到的读数已补上。$/);
    expect(zh[1]!.title).toMatch(/^Pavilion DL & fan 于 .+ 用了 0\.30 kWh，它本应完全不用电$/);
    expect(zh[2]!.title).toMatch(/^Emergency lights 于 .+ 降到 0（平常 0\.10 kW）$/);
    expect(zh[3]!.title).toBe("今天另有 2 个电表用电异常");
    const ms = entries("ms");
    expect(ms[0]!.title).toMatch(/^4 meter di Block 264F berhenti menghantar pada .+ — mungkin gateway mereka$/);
    expect(ms[1]!.title).toMatch(/^Pavilion DL & fan menggunakan 0\.30 kWh pada .+ — ia sepatutnya tidak menggunakan kuasa langsung$/);
    expect(ms[2]!.title).toMatch(/^Emergency lights turun ke 0 pada .+ \(biasanya 0\.10 kW\)$/);
    expect(ms[3]!.title).toBe("Penggunaan luar biasa pada 2 meter lagi hari ini");
  });

  it("lists an open stopped-sending alert's meters so they are not shown again as stopped, and skips what it cannot read", () => {
    const open: MeterAlertDto = { ...gateway, readKey: gateway.key, status: "open", details: { ...gateway.details, back: undefined } };
    const [entry] = meterAlertEntries([open, { ...fan, details: {} as Record<string, unknown>, kind: "meter_offline" }], { t: translatorFor(notificationMessages, "en"), locale: "en", projectId: "sktc" });
    expect(entry!.quietMeterIds).toEqual(["264F L2-L17", "264F L1", "264F lift lobby", "264F stairs"]);
    expect(entry!.detail).toBe("264F L2-L17, 264F L1, 264F lift lobby, 264F stairs. Check that their gateway still has power and is online.");
    expect(meterAlertEntries([{ ...fan, details: {} as Record<string, unknown>, kind: "meter_offline" }], { t: translatorFor(notificationMessages, "en"), locale: "en", projectId: "sktc" })).toEqual([]);
  });
});
