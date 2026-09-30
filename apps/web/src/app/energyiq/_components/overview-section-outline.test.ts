/** @vitest-environment happy-dom */

import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readRenderedOverviewSections, useOverviewSectionOutline } from "./overview-section-outline";

const NO_FALLBACK_SECTIONS = [] as const;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, "", "/energyiq/overview");
});

afterEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  document.body.replaceChildren();
});

describe("readRenderedOverviewSections", () => {
  it("uses the rendered DOM order and section-owned labels as the only outline truth", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <section id="second" data-overview-section data-overview-navigation-label="Second">
        <h2 id="second-heading">Second heading</h2>
        <section id="second-detail" data-overview-module data-overview-navigation-label="Supporting detail">
          <h3 id="second-detail-heading">Supporting detail</h3>
        </section>
      </section>
      <section id="first" data-overview-section aria-labelledby="first-heading">
        <h2 id="first-heading">First in the rendered report</h2>
      </section>
      <section id="second" data-overview-section data-overview-navigation-label="Duplicate"></section>
      <section data-overview-section data-overview-navigation-label="Missing identity"></section>
    `;
    document.body.append(root);

    expect(readRenderedOverviewSections(root)).toEqual([
      { id: "second", label: "Second", number: "1", depth: 0 },
      { id: "second-detail", label: "Supporting detail", number: "1.1", depth: 1 },
      { id: "first", label: "First in the rendered report", number: "2", depth: 0 },
    ]);
    expect(root.querySelector("#second-heading")?.getAttribute("data-overview-heading-number")).toBe("1");
    expect(root.querySelector("#second-detail-heading")?.getAttribute("data-overview-heading-number")).toBe("1.1");
    expect(root.querySelector("#first-heading")?.getAttribute("data-overview-heading-number")).toBe("2");
    root.remove();
  });

  it("discovers a late rendered Section and keeps hash, focus and navigation together", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => {
      root.render(React.createElement(OutlineHarness, { showSecond: false }));
    });
    expect(Array.from(host.querySelectorAll("button"), (button) => button.textContent)).toEqual(["1 First"]);

    await act(async () => {
      root.render(React.createElement(OutlineHarness, { showSecond: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(Array.from(host.querySelectorAll("button"), (button) => button.textContent)).toEqual(["1 First", "2 Second"]);

    await act(async () => host.querySelectorAll("button")[1]?.click());
    expect(window.location.hash).toBe("#second");
    expect(document.activeElement?.id).toBe("second");

    await act(async () => root.unmount());
    host.remove();
  });
});

function OutlineHarness({ showSecond }: { showSecond: boolean }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const outline = useOverviewSectionOutline({
    rootRef: contentRef,
    fallbackSections: NO_FALLBACK_SECTIONS,
    identityKey: "test-overview",
  });

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "div",
      { ref: contentRef },
      React.createElement("section", {
        id: "first",
        "data-overview-section": "true",
        "data-overview-navigation-label": "First",
        tabIndex: -1,
      }),
      showSecond ? React.createElement("section", {
        id: "second",
        "data-overview-section": "true",
        "data-overview-navigation-label": "Second",
        tabIndex: -1,
      }) : null,
    ),
    React.createElement(
      "nav",
      null,
      ...outline.sections.map((section) => React.createElement(
        "button",
        { key: section.id, type: "button", onClick: () => outline.selectSection(section.id) },
        `${section.number} ${section.label}`,
      )),
    ),
  );
}
