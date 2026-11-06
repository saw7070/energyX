import { describe, expect, it } from "vitest";

import { parseLiveDeviceList } from "./live-device-list";

describe("device list for starting a site from Tuya", () => {
  it("reads cells copied from Excel with a header, in any column order", () => {
    const text = [
      "Block\tDevice ID\tDevice Name\tWhat it powers",
      "264E\tbf0123456789abcdef01\t264E Lighting L1\tCorridor lights",
      "",
      "264F\tbf0123456789abcdef02\t264F Lighting L1\t",
    ].join("\r\n");
    expect(parseLiveDeviceList(text)).toEqual([
      { line: 2, name: "264E Lighting L1", deviceId: "bf0123456789abcdef01", area: "264E", equipment: "Corridor lights" },
      { line: 4, name: "264F Lighting L1", deviceId: "bf0123456789abcdef02", area: "264F" },
    ]);
  });

  it("reads a CSV without a header as name, device ID, area, what it powers", () => {
    const text = [
      "264E Lighting L1, bf0123456789abcdef01, 264E, Corridor lights, Lift lobby",
      "\"Pump room, B1\";eb9876543210fedcba99",
    ].join("\n");
    expect(parseLiveDeviceList(text)).toEqual([
      { line: 1, name: "264E Lighting L1", deviceId: "bf0123456789abcdef01", area: "264E", equipment: "Corridor lights, Lift lobby" },
      { line: 2, name: "Pump room, B1", deviceId: "eb9876543210fedcba99" },
    ]);
  });

  it("reads a list that starts with the device ID, and a meter simply named Meter", () => {
    expect(parseLiveDeviceList("bf0123456789abcdef01\t264E Lighting L1\nMeter\tbf0123456789abcdef02")).toEqual([
      { line: 1, name: "264E Lighting L1", deviceId: "bf0123456789abcdef01" },
      { line: 2, name: "Meter", deviceId: "bf0123456789abcdef02" },
    ]);
  });

  it("keeps incomplete lines so the check can point them out", () => {
    expect(parseLiveDeviceList("Name,ID\n264E Lighting L1,\n,bf0123456789abcdef01")).toEqual([
      { line: 2, name: "264E Lighting L1", deviceId: "" },
      { line: 3, name: "", deviceId: "bf0123456789abcdef01" },
    ]);
    expect(parseLiveDeviceList("\uFEFF\n  \n\t\t\n")).toEqual([]);
  });
});
