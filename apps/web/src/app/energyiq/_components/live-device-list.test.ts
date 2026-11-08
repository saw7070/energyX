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

  it("reads a sheet that names each block once above its meters, and puts the block in front of repeated names", () => {
    const sheet = [
      "Block Number\tMeter Name\t\tMeter Device ID\t\tMeter Tracking Location\t\tTuya App Energy Reading\t",
      "264F\t\t\t\t\t\t\t\t",
      "\tL1-L6A Blk common Area Lighting\t\ta1b2c3d4e5f6a7b8c9d0fa\t\tBlock Common Area Lighting 1\t\t3.38\tkwh per day",
      "\tCompassvale Bow Entrance Lighting\t\ta1b2c3d4e5f6a7b8c9d0fb\t\tProject Entrance Lighting\t\t4.11\tkwh per day",
      "264E\t\t\t\t\t\t\t\t",
      "\tL1-L6A Blk common Area Lighting\t\ta1b2c3d4e5f6a7b8c9d0fc\t\tBlock Common Area Lighting 1\t\t3.28\tkwh per day",
      "\t\t\t\t\t\t\t\t",
      "264B\t\t\t\t\t\t\t\t",
      "\tPlayground Lighting x 4\t\ta1b2c3d4e5f6a7b8c9d0fd\t\tCommon Area - Playground Lighting\t\t0.19\tkwh per day",
    ].join("\n");
    expect(parseLiveDeviceList(sheet)).toEqual([
      { line: 3, name: "264F L1-L6A Blk common Area Lighting", deviceId: "a1b2c3d4e5f6a7b8c9d0fa", area: "264F", equipment: "Block Common Area Lighting 1" },
      { line: 4, name: "Compassvale Bow Entrance Lighting", deviceId: "a1b2c3d4e5f6a7b8c9d0fb", area: "264F", equipment: "Project Entrance Lighting" },
      { line: 6, name: "264E L1-L6A Blk common Area Lighting", deviceId: "a1b2c3d4e5f6a7b8c9d0fc", area: "264E", equipment: "Block Common Area Lighting 1" },
      { line: 9, name: "Playground Lighting x 4", deviceId: "a1b2c3d4e5f6a7b8c9d0fd", area: "264B", equipment: "Common Area - Playground Lighting" },
    ]);
  });

  it("keeps a block given on the meter's own row, and does not take a lone name for a block without a block column", () => {
    expect(parseLiveDeviceList("Block\tName\tID\n264F\t\t\n264E\tLobby\tbf0123456789abcdef01\n\tPump\tbf0123456789abcdef02")).toEqual([
      { line: 3, name: "Lobby", deviceId: "bf0123456789abcdef01", area: "264E" },
      { line: 4, name: "Pump", deviceId: "bf0123456789abcdef02", area: "264F" },
    ]);
    expect(parseLiveDeviceList("264F\n264E Lighting L1,bf0123456789abcdef01")).toEqual([
      { line: 1, name: "264F", deviceId: "" },
      { line: 2, name: "264E Lighting L1", deviceId: "bf0123456789abcdef01" },
    ]);
  });
});
