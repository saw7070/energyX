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
      title: "4 meters in Block 264F are sending readings again",
      detail: "Stopped 16 Nov, 6:30 pm; back since 17 Nov, 7:00 am. Readings sent late were filled in.",
      href: "/energyiq/project-configuration?projectId=sktc&tab=availability",
    });
    expect(used).toMatchObject({ tone: "warning", kind: "never-used", title: "Pavilion DL & fan used 0.30 kWh at 11 pm — it should never use power", detail: "On Fri, 13 Nov. Someone may be using it without leave. Still using power at the latest reading." });
    expect(drop).toMatchObject({ kind: "pattern", title: "Emergency lights dropped to 0 at 3 pm (usually 0.10 kW)", detail: "Wed, 18 Nov, for one hour. Back to usual from 4 pm." });
    expect(rest).toMatchObject({ tone: "info", kind: "pattern", title: "Unusual use on 2 more meters today", detail: "Meter 6, Meter 7. Each one is on the Analysis page." });
  });

  it("says the same in Chinese and Malay", () => {
    const zh = entries("zh-Hans");
    expect(zh[0]!.title).toBe("Block 264F 的 4 个电表已恢复发送读数");
    expect(zh[0]!.detail).toMatch(/^.+ 停止，自 .+ 起已恢复；离线期间迟到的读数已补上。$/);
    expect(zh[1]!.title).toMatch(/^Pavilion DL & fan 于 .+ 用了 0\.30 kWh，它本应完全不用电$/);
    expect(zh[2]!.title).toMatch(/^Emergency lights 于 .+ 降到 0（平常 0\.10 kW）$/);
    expect(zh[3]!.title).toBe("今天另有 2 个电表用电异常");
    const ms = entries("ms");
    expect(ms[0]!.title).toBe("4 meter di Block 264F menghantar bacaan semula");
    expect(ms[0]!.detail).toMatch(/^Berhenti .+; kembali sejak .+\. Bacaan yang dihantar lewat telah diisi\.$/);
    expect(ms[1]!.title).toMatch(/^Pavilion DL & fan menggunakan 0\.30 kWh pada .+ — ia sepatutnya tidak menggunakan kuasa langsung$/);
    expect(ms[2]!.title).toMatch(/^Emergency lights turun ke 0 pada .+ \(biasanya 0\.10 kW\)$/);
    expect(ms[3]!.title).toBe("Penggunaan luar biasa pada 2 meter lagi hari ini");
  });

  it("never words meters that came back as stopped, and leaves out history from a site's first check", () => {
    // As SKTC's bell received them: resolved, with when they came back, and no longer quiet.
    const sktc: MeterAlertDto[] = [
      { key: "meter-offline:l1:20261116T0745", readKey: "meter-offline:l1:20261116T0745:back", kind: "meter_offline", status: "resolved", openedAt: "2026-11-18T21:24:05.208Z", resolvedAt: "2026-11-18T21:24:05.208Z",
        details: { meters: [{ id: "l1", name: "264F L1–L6A", since: "2026-11-15T23:45:00.000Z" }], since: "2026-11-15T23:45:00.000Z", back: "2026-11-16T23:00:00.000Z", filledLateKwh: 0 } },
      { key: "meter-offline:gf:20261116T0730", readKey: "meter-offline:gf:20261116T0730:back", kind: "meter_offline", status: "resolved", openedAt: "2026-11-18T21:24:05.208Z", resolvedAt: "2026-11-18T21:24:05.208Z",
        details: { meters: ["GF 1", "GF 2", "GF 3"].map((name) => ({ id: name, name, since: "2026-11-15T23:30:00.000Z" })), since: "2026-11-15T23:30:00.000Z", location: "Ground floor", back: "2026-11-16T23:45:00.000Z", filledLateKwh: 1.5 } },
    ];
    const t = translatorFor(notificationMessages, "en");
    const shown = meterAlertEntries(sktc, { t, locale: "en", projectId: "sktc" });
    expect(shown.map((entry) => [entry.tone, entry.title, entry.detail, entry.quietMeterIds])).toEqual([
      ["info", "264F L1–L6A is sending readings again", "Stopped 16 Nov, 7:45 am; back since 17 Nov, 7:00 am.", []],
      ["info", "3 meters in Ground floor are sending readings again", "Stopped 16 Nov, 7:30 am; back since 17 Nov, 7:45 am. Readings sent late were filled in.", []],
    ]);
    expect(shown.some((entry) => /stopped sending/u.test(entry.title))).toBe(false);
    const noArea = { ...sktc[1]!.details, location: undefined };
    expect(meterAlertEntries([{ ...sktc[1]!, details: noArea }], { t, locale: "en", projectId: "sktc" })[0]!.title).toBe("3 meters are sending readings again");
    // Over before the site's first check, or closed without coming back: nothing to tell.
    const seeded = sktc.map((alert) => ({ ...alert, details: { ...alert.details, seeded: true } }));
    const cleared = sktc.map((alert) => ({ ...alert, details: { ...alert.details, back: undefined, cleared: true } }));
    expect(meterAlertEntries([...seeded, ...cleared], { t, locale: "en", projectId: "sktc" })).toEqual([]);
  });

  it("says an alert from live readings was seen within the hour, with the hour it is about, in every language", () => {
    // Pavilion 1 used nothing 2–3 pm on 18 Nov; the booster pump drew 6.5 kW 10–11 pm, then back to usual from 11 pm.
    const pavilion: MeterAlertDto = {
      key: "usage-pattern:p1:20261118T1400", readKey: "usage-pattern:p1:20261118T1400", kind: "usage_pattern", status: "open", openedAt: "2026-11-18T08:20:00.000Z",
      details: { meterName: "Pavilion 1", direction: "zero", at: "2026-11-18T06:00:00.000Z", start: "2026-11-18T06:00:00.000Z", end: "2026-11-18T07:00:00.000Z", hours: 1, kwh: 0, usualKwh: 0.4, ongoing: true, live: true, inferred: true },
    };
    const pump: MeterAlertDto = {
      key: "usage-pattern:pump:20261118T2200", readKey: "usage-pattern:pump:20261118T2200", kind: "usage_pattern", status: "resolved", openedAt: "2026-11-18T15:15:00.000Z", resolvedAt: "2026-11-18T16:15:00.000Z",
      details: { meterName: "Booster pump", direction: "high", at: "2026-11-18T14:00:00.000Z", start: "2026-11-18T14:00:00.000Z", end: "2026-11-18T15:00:00.000Z", hours: 1, kwh: 6.5, usualKwh: 4, ongoing: false, live: true },
    };
    const fanLive: MeterAlertDto = { ...fan, details: { ...fan.details, live: true } };
    const show = (locale: EnergyIqLocale) => meterAlertEntries([pavilion, pump, fanLive], { t: translatorFor(notificationMessages, locale), locale, projectId: "sktc" });
    const [zero, spike, used] = show("en");
    expect(zero).toMatchObject({ tone: "warning", kind: "pattern", title: "Pavilion 1 used nothing 2–3 pm (usually 0.40 kW)", detail: "Seen within the hour from live readings, Wed, 18 Nov. Usual is that hour's typical use over the last three weeks." });
    expect(spike).toMatchObject({ title: "Booster pump used 6.5 kW 10–11 pm, usually about 4.0 kW", detail: "Seen within the hour from live readings, Wed, 18 Nov. Back to usual from 11 pm." });
    expect(used!.detail).toBe("On Fri, 13 Nov. Someone may be using it without leave. Still using power at the latest reading. Seen within the hour from live readings.");
    expect(meterAlertEntries([{ ...pavilion, details: { ...pavilion.details, end: "2026-11-18T09:00:00.000Z", hours: 3 } }], { t: translatorFor(notificationMessages, "en"), locale: "en", projectId: "sktc" })[0])
      .toMatchObject({ title: "Pavilion 1 used nothing 2–5 pm (usually 0.40 kW)", detail: "Seen within the hour from live readings, Wed, 18 Nov: 3 hours in a row." });
    const zh = show("zh-Hans");
    expect(zh[0]!.title).toBe("Pavilion 1 在 下午2时至3时 完全没有用电（平常 0.40 kW）");
    expect(zh[0]!.detail).toMatch(/^由实时读数在一小时内发现，.+。“平常”指过去三周同一小时的典型用电。$/);
    expect(zh[1]!.detail).toMatch(/^由实时读数在一小时内发现，.+。从 .+ 起恢复正常。$/);
    expect(zh[2]!.detail).toMatch(/由实时读数在一小时内发现。$/);
    const ms = show("ms");
    expect(ms[0]!.title).toBe("Pavilion 1 tidak menggunakan kuasa langsung pada 2–3 PTG (biasanya 0.40 kW)");
    expect(ms[1]!.title).toBe("Booster pump menggunakan 6.5 kW pada 10–11 PTG, biasanya kira-kira 4.0 kW");
    expect(ms[2]!.detail).toMatch(/Dikesan dalam masa sejam daripada bacaan langsung\.$/);
  });

  it("names the whole site in an alert about the site's total, in every language", () => {
    const whole: MeterAlertDto = {
      key: "usage-pattern:site:20261118T2200", readKey: "usage-pattern:site:20261118T2200", kind: "usage_pattern", status: "open", openedAt: "2026-11-18T15:15:00.000Z",
      details: { meterId: "site", meterName: "SKTC", scope: "site", direction: "high", at: "2026-11-18T14:00:00.000Z", start: "2026-11-18T14:00:00.000Z", end: "2026-11-18T15:00:00.000Z", hours: 1, kwh: 6, usualKwh: 4, ongoing: true, live: true },
    };
    const low: MeterAlertDto = { ...whole, details: { ...whole.details, direction: "low", kwh: 2 } };
    const show = (locale: EnergyIqLocale) => meterAlertEntries([whole, low], { t: translatorFor(notificationMessages, locale), locale, projectId: "sktc" });
    const [high, drop] = show("en");
    expect(high).toMatchObject({ tone: "warning", kind: "pattern", title: "SKTC used 6.0 kW at 10–11 pm (usually 4.0 kW)", detail: "Seen within the hour from live readings, Wed, 18 Nov. Usual is that hour's typical use over the last three weeks." });
    expect(drop!.title).toBe("SKTC used only 2.0 kW at 10–11 pm (usually 4.0 kW)");
    expect(show("zh-Hans").map((entry) => entry.title)).toEqual([expect.stringMatching(/^SKTC 在 .+ 用电 6\.0 kW（平常 4\.0 kW）$/), expect.stringMatching(/^SKTC 在 .+ 只用电 2\.0 kW（平常 4\.0 kW）$/)]);
    expect(show("ms").map((entry) => entry.title)).toEqual(["SKTC menggunakan 6.0 kW pada 10–11 PTG (biasanya 4.0 kW)", "SKTC hanya menggunakan 2.0 kW pada 10–11 PTG (biasanya 4.0 kW)"]);
  });

  it("lists an open stopped-sending alert's meters so they are not shown again as stopped, and skips what it cannot read", () => {
    const open: MeterAlertDto = { ...gateway, readKey: gateway.key, status: "open", details: { ...gateway.details, back: undefined } };
    const [entry] = meterAlertEntries([open, { ...fan, details: {} as Record<string, unknown>, kind: "meter_offline" }], { t: translatorFor(notificationMessages, "en"), locale: "en", projectId: "sktc" });
    expect(entry!.quietMeterIds).toEqual(["264F L2-L17", "264F L1", "264F lift lobby", "264F stairs"]);
    expect(entry!.detail).toBe("264F L2-L17, 264F L1, 264F lift lobby, 264F stairs. Check that their gateway still has power and is online.");
    expect(meterAlertEntries([{ ...fan, details: {} as Record<string, unknown>, kind: "meter_offline" }], { t: translatorFor(notificationMessages, "en"), locale: "en", projectId: "sktc" })).toEqual([]);
  });
});
