import { createHash } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { renderProjectSpatialSvg } from "@datafoundry/contracts";
import { SiteFloorMap } from "./site-floor-map";
import type { StoredSpatialReference } from "./floor-plan-model";
import { sktcLike } from "./floor-plan-openings-fixture";

const markup = (reference: StoredSpatialReference, devices = true) => renderToStaticMarkup(<SiteFloorMap reference={reference} devices={devices ? reference.layout.devices!.slice(0, 6).map((item, index) => ({ id: item.meterId, name: `Meter ${index + 1}`, board: "DB-E", position: item.position, ...(item.size ? { size: item.size } : {}) })) : []} />);
const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

it("draws a layout saved before doors and walls existed exactly as before, in every look", () => {
  vi.stubGlobal("React", React);
  const looks = ["drawing", "blueprint", "blocks"].map(style => { const reference = sktcLike(); reference.layout.style = style as never; return hash(markup(reference)); });
  expect(looks).toEqual(["dcd56175da9b25cb", "d4593f049837442c", "1287f51e075d34ca"]);
  expect(hash(renderProjectSpatialSvg(sktcLike()))).toBe("39e5f3f719601939");
});

const room = (layout: Record<string, unknown> = {}, style?: string) => ({ schemaVersion: 1, projectId: "estate", provenance: { file: "plan", status: "drawn" }, layout: {
  viewBox: [0, 0, 1000, 640], ...(style ? { style } : {}),
  zones: [{ id: "A", referenceBoard: "Block A", rect: [20, 20, 460, 560] }],
  rooms: [{ name: "Lift lobby", zone: "A", rect: [40, 80, 400, 200] }, { name: "Store", zone: "A", rect: [40, 320, 400, 200] }],
  ...layout,
} }) as unknown as StoredSpatialReference;
const swings = (html: string) => (html.match(/<path d="M[^"]*A[^"]*"[^>]*stroke-dasharray/g) ?? []).length;

describe("doors, windows and walls on the map", () => {
  it("keeps the automatic door for rooms without doors of their own, and draws a room's own door on the wall it is on", () => {
    vi.stubGlobal("React", React);
    const plain = markup(room(), false);
    expect(swings(plain)).toBe(2); // one automatic door per room
    const own = markup(room({ openings: [{ id: "op-1", room: "Lift lobby", wall: "e", offset: 0.5, width: 30, kind: "door" }] }), false);
    // The lobby's automatic door gives way to its own door, on the right wall (x = 440); the store keeps its automatic door.
    expect(swings(own)).toBe(2);
    expect(own).toContain('<line x1="440" y1="165" x2="440" y2="195"');
    expect(own).not.toContain('x1="53" y1="280"');
    expect(own).toContain('x1="53" y1="520"');
    // Switching a room's automatic door off leaves it with none.
    const off = markup(room({ rooms: [{ name: "Lift lobby", zone: "A", rect: [40, 80, 400, 200], autoDoor: false }, { name: "Store", zone: "A", rect: [40, 320, 400, 200] }] }), false);
    expect(swings(off)).toBe(1);
  });

  it("draws every kind of opening and line in all three looks, with swings only in the drawn looks", () => {
    vi.stubGlobal("React", React);
    const layout = {
      openings: [
        { id: "op-1", room: "Lift lobby", wall: "e", offset: 0.5, width: 30, kind: "door", swing: "out", hinge: "end" },
        { id: "op-2", room: "Lift lobby", wall: "n", offset: 0.3, width: 60, kind: "double" },
        { id: "op-3", room: "Store", wall: "w", offset: 0.5, width: 40, kind: "opening" },
        { id: "op-4", room: "Store", wall: "s", offset: 0.5, width: 80, kind: "window" },
        { id: "op-5", room: "Ghost", wall: "s", offset: 0.5, width: 80, kind: "door" },
      ],
      lines: [{ id: "ln-1", points: [[500, 600], [980, 600]], style: "road" }, { id: "ln-2", points: [[500, 40], [500, 560]], style: "wall", thickness: "l" }, { id: "ln-3", points: [[520, 40], [980, 40]], style: "fence" }, { id: "ln-4", points: [[520, 100], [980, 100]], style: "partition", thickness: "s" }],
    };
    for (const look of ["drawing", "blueprint", "blocks"]) {
      const html = markup(room(layout, look), false);
      // Doors swing (a single door and the two leaves of a double door) only in the drawn looks; colour blocks show gaps.
      expect(swings(html)).toBe(look === "blocks" ? 0 : 3);
      // The window's three thin lines along the bottom wall of the store.
      expect(html.match(/class="[^"]*planWindow/g)).toHaveLength(3);
      expect(html.match(/<polyline/g)).toHaveLength(4);
      expect(html).toContain('points="500,40 500,560"');
      expect(html).toMatch(/points="520,40 980,40"[^>]*stroke-dasharray/);
      expect(html.match(/class="[^"]*planLine(Wall|Partition|Fence|Road)/g)).toHaveLength(4);
    }
  });
});
