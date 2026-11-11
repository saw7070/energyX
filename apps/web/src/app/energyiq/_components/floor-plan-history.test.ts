/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { canRedo, canUndo, commitPlan, finishChange, HISTORY_LIMIT, redo, selectIn, showPlan, startHistory, undo } from "./floor-plan-history";
import { planShortcut } from "./floor-plan-keys";
import { starterPlan, type FloorPlan } from "./floor-plan-model";

const start = starterPlan(["DB1"]);
const wider = (plan: FloorPlan, by: number): FloorPlan => ({ ...plan, viewBox: [0, 0, plan.viewBox[2] + by, plan.viewBox[3]] });

describe("undo and redo", () => {
  it("goes back and forward, bringing back what was selected at each step", () => {
    const one = wider(start, 10);
    let history = commitPlan(selectIn(startHistory(start), { kind: "area", key: "area-1" }), one, { selection: { kind: "room", key: "room-1" } });
    expect(canUndo(history)).toBe(true); expect(canRedo(history)).toBe(false);
    history = undo(history);
    expect(history.present).toEqual({ plan: start, selection: { kind: "area", key: "area-1" } });
    history = redo(history);
    expect(history.present).toEqual({ plan: one, selection: { kind: "room", key: "room-1" } });
    expect(redo(history)).toBe(history);
  });
  it("forgets what could be redone as soon as a new change is made", () => {
    let history = commitPlan(startHistory(start), wider(start, 10));
    history = undo(history);
    expect(canRedo(history)).toBe(true);
    history = commitPlan(history, wider(start, 20));
    expect(canRedo(history)).toBe(false);
  });
  it("keeps the last 100 steps", () => {
    let history = startHistory(start);
    for (let step = 1; step <= HISTORY_LIMIT + 20; step += 1) history = commitPlan(history, wider(start, step));
    expect(history.past).toHaveLength(100);
    for (let step = 0; step < 200; step += 1) history = undo(history);
    expect(history.present.plan.viewBox[2]).toBe(start.viewBox[2] + 20);
    expect(history.future).toHaveLength(100);
  });
  it("makes a drag one step, however many moves it showed", () => {
    let history = startHistory(start);
    const before = history.present;
    for (let step = 1; step <= 5; step += 1) history = showPlan(history, wider(start, step));
    expect(canUndo(history)).toBe(false);
    history = finishChange(history, before);
    expect(history.past).toHaveLength(1);
    expect(undo(history).present.plan).toBe(start);
    // A press that never moved leaves no step.
    expect(canUndo(finishChange(startHistory(start), before))).toBe(false);
  });
  it("makes letters typed into one field one step", () => {
    let history = startHistory(start);
    for (const name of ["P", "Pa", "Pan"]) history = commitPlan(history, { ...history.present.plan, rooms: [{ ...start.rooms[0]!, name }] }, { merge: "name:room-1" });
    history = commitPlan(history, { ...history.present.plan, rooms: [{ ...start.rooms[0]!, name: "Pan" }], viewBox: [0, 0, 1200, 640] });
    expect(history.past).toHaveLength(2);
    expect(undo(undo(history)).present.plan).toBe(start);
  });
});

describe("keyboard shortcuts", () => {
  const key = (key: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; target: EventTarget | null }> = {}) => planShortcut({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: document.body, ...extra }, 10);
  it("reads undo, redo (both ways), delete and nudges", () => {
    expect(key("z", { metaKey: true })).toEqual({ kind: "undo" });
    expect(key("Z", { metaKey: true, shiftKey: true })).toEqual({ kind: "redo" });
    expect(key("z", { ctrlKey: true, shiftKey: true })).toEqual({ kind: "redo" });
    expect(key("y", { ctrlKey: true })).toEqual({ kind: "redo" });
    expect(key("Backspace")).toEqual({ kind: "delete" });
    expect(key("ArrowLeft", { shiftKey: true })).toEqual({ kind: "nudge", by: [-50, 0], alone: false });
    expect(key("ArrowDown", { altKey: true })).toEqual({ kind: "nudge", by: [0, 10], alone: true });
    // Copy and paste are left alone.
    expect(key("c", { metaKey: true })).toBeNull();
  });
  it("leaves keys to text boxes, lists, editable text and buttons", () => {
    const input = document.createElement("input"), select = document.createElement("select"), area = document.createElement("textarea"), button = document.createElement("button");
    const editable = document.createElement("div"); editable.setAttribute("contenteditable", "true");
    const inside = document.createElement("span"); editable.append(inside);
    for (const target of [input, select, area, button, editable, inside]) {
      expect(key("Delete", { target })).toBeNull();
      expect(key("ArrowUp", { target })).toBeNull();
      expect(key("z", { metaKey: true, target })).toBeNull();
    }
  });
});
