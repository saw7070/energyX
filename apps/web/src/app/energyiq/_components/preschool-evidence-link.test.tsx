/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PreschoolEvidenceLink } from "./preschool-evidence-link";

describe("PreschoolEvidenceLink", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens and focuses the collapsed Evidence region in one click", async () => {
    await act(async () => {
      root.render(
        <>
          <PreschoolEvidenceLink label="Benchmark recipes" />
          <details id="preschool-evidence" tabIndex={-1}>
            <summary>Snapshot &amp; evidence</summary>
            <p>Authoritative evidence</p>
          </details>
        </>,
      );
    });

    const link = container.querySelector<HTMLAnchorElement>('a[href="#preschool-evidence"]');
    const evidence = container.querySelector<HTMLDetailsElement>("#preschool-evidence");
    if (!link || !evidence) throw new Error("Expected the Evidence trigger and region");
    expect(evidence.open).toBe(false);

    await act(async () => link.click());

    expect(evidence.open).toBe(true);
    expect(document.activeElement).toBe(evidence);
  });
});
