import { expect, it } from "vitest";
import { idleThroughLastDay } from "./analysis-data";

const meter = (meterPointId: string, lastReadingAt: string, extra: { idleWhenQuiet?: boolean; notInUse?: string } = {}) =>
  ({ meterPointId, name: meterPointId, sourceLabel: meterPointId, status: "usable" as const, lastReadingAt, ...extra });

it("treats a meter as idle through the readings' last day only when it is quiet, idle and sent nothing after that day", () => {
  const meters = [
    meter("lobby", "2026-11-13T01:00:00.000Z"),
    // Quiet for days and online, using nothing: idle.
    meter("fan", "2026-11-06T13:45:00.000Z", { idleWhenQuiet: true }),
    // Quiet but offline: stopped, not idle.
    meter("linkway", "2026-11-05T10:15:00.000Z"),
    // Marked not in use: handled on its own, never listed here.
    meter("spare", "2026-11-04T10:00:00.000Z", { idleWhenQuiet: true, notInUse: "reason:spare" }),
    // Idle now, but it sent a reading after the readings' last day, so it was not quiet through those days.
    meter("pump", "2026-11-12T20:00:00.000Z", { idleWhenQuiet: true }),
  ];
  expect(idleThroughLastDay(meters, "2026-11-12", "Asia/Singapore")).toEqual(["fan"]);
  expect(idleThroughLastDay(meters, undefined, "Asia/Singapore")).toEqual([]);
  expect(idleThroughLastDay([], "2026-11-12", "Asia/Singapore")).toEqual([]);
});
