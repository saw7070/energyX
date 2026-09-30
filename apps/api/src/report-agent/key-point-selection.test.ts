import { expect, it } from "vitest";
import { validateKeyPointSelection } from "./key-point-selection.js";

const insightId = "10000000-0000-4000-8000-000000000001";
const actionId = "20000000-0000-4000-8000-000000000001";
const version = "a".repeat(64);
const insight = { id: insightId, version, actionIds: [actionId], review: {status: "open"} };
const row = { insightId, actionId, insightVersion: version, issue: "Display runs overnight",
  evidence: "Measured overnight use", evidenceFrom: "2026-09-01", evidenceToExclusive: "2026-09-08",
  nextStep: "Confirm required display hours", benefit: "Potential savings pending site confirmation",
  assumptions: "Switchability is unconfirmed", reason: "A specific operating decision" };
const selection = {dataEndExclusive: "2026-09-08", active: [row], featuredActionIds: [actionId]};
it("retains a prior source only when the insight actually cites that report",()=>{
 const sourceReportId="30000000-0000-4000-8000-000000000001";
 const input={...selection,active:[{...row,sourceReportId}]};
 expect(validateKeyPointSelection(input,[{...insight,sources:[{reportId:sourceReportId}]}],new Set([actionId])).active[0]?.sourceReportId).toBe(sourceReportId);
 expect(()=>validateKeyPointSelection(input,[insight],new Set([actionId]))).toThrow("REFERENCE_INVALID");
});
const validate = (value: unknown, records = [insight], actions = new Set([actionId])) => validateKeyPointSelection(value, records, actions);
it("retains dated evidence and allows fewer than three points without rewriting business records", () => {
  expect(validate(selection)).toEqual(selection);
  expect(insight).toEqual({id: insightId, version, actionIds: [actionId], review: {status: "open"}});
  expect(validate({...selection, active: [], featuredActionIds: []}).active).toEqual([]);
});
it("rejects inaccessible, unbound and stale references", () => {
  expect(() => validate(selection, [], new Set())).toThrow("REFERENCE_INVALID");
  expect(() => validate(selection, [insight], new Set())).toThrow("REFERENCE_INVALID");
  expect(() => validate(selection, [{...insight, actionIds: []}])).toThrow("REFERENCE_INVALID");
  expect(() => validate(selection, [{...insight, version: "b".repeat(64)}])).toThrow("VERSION_CHANGED");
});
it("enforces one-to-one active selection while preserving legacy record shape", () => {
  expect(() => validate({...selection, active: [row,row]})).toThrow("DUPLICATE");
  expect(() => validate({...selection, featuredActionIds: [actionId,actionId]})).toThrow("DUPLICATE");
  expect(() => validate({...selection, active: []})).toThrow("REFERENCE_INVALID");
  expect(() => validate({...selection, active: Array(7).fill(row)})).toThrow();
  expect(() => validate({...selection, featuredActionIds: Array(4).fill(actionId)})).toThrow();
});
it("rejects resolved findings and fabricated or out-of-range dates", () => {
  expect(() => validate(selection, [{...insight, review: {status: "resolved"}}])).toThrow("INACTIVE");
  expect(() => validate({...selection, active: [{...row,evidenceFrom:"2026-02-30"}]})).toThrow();
  expect(() => validate({...selection, dataEndExclusive:"2026-09-07"})).toThrow("WINDOW_INVALID");
  expect(() => validate({...selection, active: [{...row,evidenceFrom:row.evidenceToExclusive}]})).toThrow("WINDOW_INVALID");
});
