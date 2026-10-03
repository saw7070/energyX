import { describe, expect, it } from "vitest";

import { suggestMeterCategory } from "./meter-category-suggestion";

describe("suggestMeterCategory", () => {
  it.each([
    ["A18P · Coffee machine, Warmer machine", "kitchen"],
    ["B11P · TV, Signboard, Emergency Light", "light"],
    ["B2R · Balcony light, Toilet Light ×3, Staircase light", "light"],
    ["B3B · Study Desk Plug ×8, Cuckoo, Freezer, Fryer", "kitchen"],
    ["B4B · IP Camera, Work Desk ×2, Printer", "it"],
    ["B5B · Router, Modem, Server, IP Camera ×5, POE Switch", "it"],
    ["B6B · Power Plug ×6", "plug"],
    ["B8P · Microwave, Bingsu Machine, Ice Blander", "kitchen"],
    ["B9P · Waffle machine, Eggette machine", "kitchen"],
  ])("sorts the Elite IOT circuit %s as %s", (text, expected) => {
    expect(suggestMeterCategory(text)).toBe(expected);
  });

  it("returns null when nothing is recognised", () => {
    expect(suggestMeterCategory("Incoming 3Phase")).toBeNull();
    expect(suggestMeterCategory("")).toBeNull();
    expect(suggestMeterCategory("B4B · Work Desk ×2")).toBeNull();
  });

  it("counts each item once, whatever its quantity", () => {
    expect(suggestMeterCategory("Desk Plug ×20, Fridge")).toBe("kitchen");
    expect(suggestMeterCategory("Desk Plug ×20, Spare socket, Fridge")).toBe("plug");
  });

  it("breaks ties in the order kitchen, IT, air-con, lighting, plugs", () => {
    expect(suggestMeterCategory("Router, Kettle")).toBe("kitchen");
    expect(suggestMeterCategory("Aircon, Router")).toBe("it");
    expect(suggestMeterCategory("Ceiling light, FCU")).toBe("aircon");
    expect(suggestMeterCategory("Socket, Lamp")).toBe("light");
  });

  it("matches whole words regardless of case, and splits on semicolons and 'and'", () => {
    expect(suggestMeterCategory("OFFICE LIGHTS; Downlight")).toBe("light");
    expect(suggestMeterCategory("Microwave x1 and Ice Blender x1")).toBe("kitchen");
    // "Office" contains "ice" and "Cups" contains "ups": only whole words count.
    expect(suggestMeterCategory("Office")).toBeNull();
    expect(suggestMeterCategory("Cups")).toBeNull();
  });

  it("treats LED displays and TVs as IT, but LED lights as lighting", () => {
    expect(suggestMeterCategory("LED display")).toBe("it");
    expect(suggestMeterCategory("LED Panel, LED Wall")).toBe("it");
    expect(suggestMeterCategory("TV")).toBe("it");
    expect(suggestMeterCategory("LED strip")).toBe("light");
  });

  it("reads air-con in its usual spellings", () => {
    for (const text of ["Aircon 1", "Air con", "Air-Con", "A/C unit", "Aircond", "AHU-1", "Split unit"]) {
      expect(suggestMeterCategory(text), text).toBe("aircon");
    }
  });

  it("tells a fridge chiller from a chiller plant", () => {
    expect(suggestMeterCategory("Display chiller")).toBe("kitchen");
    expect(suggestMeterCategory("Chiller plant")).toBe("aircon");
  });

  it("names the thing itself, not where it is", () => {
    expect(suggestMeterCategory("Kitchen light")).toBe("light");
    expect(suggestMeterCategory("Pantry socket")).toBe("plug");
    expect(suggestMeterCategory("Water dispenser")).toBe("kitchen");
    expect(suggestMeterCategory("Air fryer")).toBe("kitchen");
  });
});
