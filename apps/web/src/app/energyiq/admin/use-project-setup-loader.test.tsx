/** @vitest-environment happy-dom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminSection } from "./admin-sidebar";
import { useProjectSetupLoader } from "./use-project-setup-loader";

describe("useProjectSetupLoader", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("does not reload and overwrite an unsaved draft when only the Admin section changes", async () => {
    const loadSetup = vi.fn(async () => undefined);

    await act(async () => {
      root.render(<Harness projectId="ngee-ann-polytechnic" section="data-sources" loadSetup={loadSetup} />);
    });
    expect(loadSetup).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(<Harness projectId="ngee-ann-polytechnic" section="meter-mapping" loadSetup={loadSetup} />);
    });
    expect(loadSetup).toHaveBeenCalledTimes(1);
  });
});

function Harness({
  projectId,
  section,
  loadSetup,
}: {
  projectId: string;
  section: AdminSection;
  loadSetup: (projectId: string) => Promise<void>;
}) {
  useProjectSetupLoader(projectId, loadSetup);
  return <div>{section}</div>;
}
