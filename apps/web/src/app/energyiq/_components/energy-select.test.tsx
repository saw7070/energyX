/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EnergySelect } from "./energy-select";

describe("EnergySelect", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.querySelectorAll("[role='listbox']").forEach((element) => element.remove());
    container.remove();
  });

  it("opens a styled listbox and reports a selected value", async () => {
    const onValueChange = vi.fn();
    await act(async () => {
      root.render(
        <EnergySelect
          ariaLabel="Select project"
          value="project-a"
          options={[
            { value: "project-a", label: "Project A" },
            { value: "project-b", label: "Project B" },
          ]}
          onValueChange={onValueChange}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox']");
    expect(trigger?.textContent).toContain("Project A");

    await act(async () => trigger?.click());
    const options = Array.from(document.querySelectorAll<HTMLButtonElement>("[role='option']"));
    expect(options).toHaveLength(2);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    await act(async () => options[1]?.click());
    expect(onValueChange).toHaveBeenCalledWith("project-b");
    expect(document.querySelector("[role='listbox']")).toBeNull();
  });

  it("supports keyboard navigation and Escape", async () => {
    const onValueChange = vi.fn();
    await act(async () => {
      root.render(
        <EnergySelect
          ariaLabel="Select project"
          value="project-a"
          options={[
            { value: "project-a", label: "Project A" },
            { value: "project-b", label: "Project B" },
          ]}
          onValueChange={onValueChange}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>("[role='combobox']");
    await act(async () => trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    await act(async () => trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onValueChange).toHaveBeenCalledWith("project-b");

    await act(async () => trigger?.click());
    await act(async () => trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });
  it("keeps options inside the modal that owns the trigger", async () => {
    const onValueChange = vi.fn();
    await act(async () => root.render(<dialog open><EnergySelect ariaLabel="Modal project" value="a" options={[{value:"a",label:"Project A"},{value:"b",label:"Project B"}]} onValueChange={onValueChange} /></dialog>));
    await act(async () => container.querySelector<HTMLButtonElement>('[role="combobox"]')!.click());
    expect(container.querySelector('dialog [role="listbox"]')).not.toBeNull();
    await act(async () => container.querySelectorAll<HTMLButtonElement>('[role="option"]')[1]!.click());
    expect(onValueChange).toHaveBeenCalledWith("b");
  });
});
