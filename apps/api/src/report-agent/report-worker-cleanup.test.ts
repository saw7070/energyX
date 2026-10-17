import { describe, expect, it } from "vitest";
import { removeOrphanedReportWorkers } from "./pi-report-harness.js";

describe("leftover advisor workers", () => {
  const docker = (listed: string, failRemove = new Set<string>()) => {
    const removed: string[] = [];
    const exec = async (args: string[]) => {
      if (args[0] === "ps") return { stdout: listed };
      if (args[0] === "rm") { if (failRemove.has(args[2]!)) throw new Error("busy"); removed.push(args[2]!); }
      return { stdout: "" };
    };
    return { exec, removed };
  };

  it("removes only workers whose run this API knows and has settled", async () => {
    const settled = new Set(["done-1", "interrupted-2"]);
    const { exec, removed } = docker("energyiq-report-done-1\nenergyiq-report-running-3\nenergyiq-report-interrupted-2\nenergyiq-report-unknown-4\nother-container\n");
    const result = await removeOrphanedReportWorkers(id => settled.has(id), exec);
    expect(result).toEqual(["energyiq-report-done-1", "energyiq-report-interrupted-2"]);
    expect(removed).toEqual(result);
  });

  it("treats Docker being unavailable or a failed removal as nothing to do", async () => {
    expect(await removeOrphanedReportWorkers(() => true, async () => { throw new Error("no docker"); })).toEqual([]);
    const { exec } = docker("energyiq-report-a\nenergyiq-report-b\n", new Set(["energyiq-report-a"]));
    expect(await removeOrphanedReportWorkers(() => true, exec)).toEqual(["energyiq-report-b"]);
  });
});
