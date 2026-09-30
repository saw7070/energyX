/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProjectSpatialPreview } from "../_components/project-spatial-preview";
it("shows a readable map and enlargement while retaining other notes and hiding raw geometry", async () => {
  vi.stubGlobal("React", React); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const notes = 'Other project notes\n```json\n' + JSON.stringify({schemaVersion:1,projectId:"p",provenance:{file:"reference.html",status:"reference-derived"},layout:{viewBox:[0,0,800,500],zones:[{id:"A",referenceBoard:"DB1",rect:[10,10,300,300]}],rooms:[{name:"Office",zone:"A",rect:[20,60,200,150]}]}}) + '\n```';
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    await act(async () => root.render(<ProjectSpatialPreview notes={notes} projectId="p" />));
    expect(host.textContent).toContain("Other project notes"); expect(host.textContent).toContain("DB1");
    expect(host.textContent).not.toContain('"schemaVersion"'); expect(host.querySelector('svg[role="img"]')?.getAttribute("aria-label")).toContain("Floor layout"); expect(host.textContent).toContain("Distribution boards");
    const dialog = host.querySelector("dialog")!; const open = vi.fn(); dialog.showModal = open;
    await act(async () => host.querySelector("button")!.click()); expect(open).toHaveBeenCalledOnce();
    await act(async () => root.render(<ProjectSpatialPreview notes="Another project's notes" projectId="school" />));
    expect(host.querySelector('svg[role="img"]')).toBeNull(); expect(host.textContent).toContain("Another project's notes");
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
});
