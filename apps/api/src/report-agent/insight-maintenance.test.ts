import { expect, it } from "vitest";
import { insightMaintenanceContext } from "./insight-maintenance.js";

it("separates follow-up from suggestions without inventing resolution or execution", () => {
  const actions=[{id:"a",state:"proposed"},{id:"b",state:"implemented"},{id:"c",state:"scheduled"},{id:"d",state:"paused"}];
  const before=JSON.stringify(actions);
  const result=insightMaintenanceContext(actions,null,"2026-09-20");
  expect(result.entries.map(e=>[e.group,e.needsRevalidation])).toEqual([["considering",true],["following_up",false],["following_up",false],["history",false]]);
  expect(JSON.stringify(actions)).toBe(before);
});
