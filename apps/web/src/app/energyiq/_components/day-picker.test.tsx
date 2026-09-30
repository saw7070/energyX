/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { calendarWeeks, DayPicker, describePickerDay } from "./day-picker";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal("React", React);

describe("calendarWeeks", () => {
  it("lays the period out in Monday-to-Sunday weeks with blanks outside it", () => {
    const weeks = calendarWeeks(["2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14"]);
    expect(weeks).toEqual([
      [null, null, "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"],
      ["2026-09-14", null, null, null, null, null, null],
    ]);
  });
});

describe("DayPicker", () => {
  const days = [
    { date: "2026-08-09", dayType: "weekend" as const, complete: true, totalKwh: 40 },
    { date: "2026-08-10", dayType: "public_holiday" as const, holidayName: "National Day observed", complete: true, totalKwh: 42 },
    { date: "2026-08-11", dayType: "weekday" as const, complete: false, totalKwh: 80.4 },
  ];
  it("describes each day in words", () => {
    expect(describePickerDay(days[1]!)).toBe("Mon 10 Aug 2026, National Day observed, 42 kWh");
    expect(describePickerDay(days[2]!)).toBe("Tue 11 Aug 2026, some readings missing, 80 kWh");
  });
  it("opens a calendar and picks a day", () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<DayPicker days={days} value="2026-08-11" onChange={onChange} />));
    const trigger = host.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")!;
    expect(trigger.textContent).toContain("Tue 11 Aug 2026");
    act(() => trigger.click());
    expect(host.querySelector("[role=dialog]")).not.toBeNull();
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label^="Mon 10 Aug"]')!.click());
    expect(onChange).toHaveBeenCalledWith("2026-08-10");
    expect(host.querySelector("[role=dialog]")).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});
