import { expect,it } from "vitest";
import { actionLocalInstant } from "./action-local-time";
it("interprets the project time rather than the user's computer timezone",()=>{expect(actionLocalInstant("2026-09-14T19:00","Asia/Singapore")).toBe("2026-09-14T11:00:00.000Z");});
it("rejects nonexistent dates and DST ambiguous/nonexistent times",()=>{for(const [value,zone] of [["2026-02-30T19:00","Asia/Singapore"],["2026-11-01T01:30","America/New_York"],["2026-03-08T02:30","America/New_York"]])expect(()=>actionLocalInstant(value!,zone!)).toThrow();});
