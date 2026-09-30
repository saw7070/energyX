import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acceptAnalysisPackage, validateAnalysisPackage, writeAnalysisContract } from "./analysis-package.js";

let root: string;
const evidence = () => ({id:"e1",period:{from:"2026-06-15",toExclusive:"2026-06-29"},metric:"School break average",value:238,unit:"kWh/day",sampleCount:9,coverage:0.99,calculationPath:"evidence/calc.py",dataPath:"evidence/facts.json",valueKey:"mean",unitKey:"unit",limitations:"Small cohort; calendar association is not causality."});
const finding = (id = "f1") => ({id,subjectIds:["meter-1"],claim:"Break nights used more electricity",certainty:"observed",evidenceIds:["e1"],explanation:"Operating reason unknown",openQuestions:["Did equipment schedules change?"]});
const data = () => ({schemaVersion:1,runId:"run",workspaceId:"w",projectId:"p",evidence:[evidence()],findings:[finding()]});
const save = (value: unknown) => writeFileSync(join(root,"outputs/analysis-findings.json"),JSON.stringify(value));
beforeEach(() => {
  root=mkdtempSync(join(tmpdir(),"analysis-package-"));
  mkdirSync(join(root,"inputs"));mkdirSync(join(root,"outputs/evidence"),{recursive:true});
  writeFileSync(join(root,"inputs/manifest.json"),JSON.stringify({runId:"run",workspaceId:"w",projectId:"p",timezone:"Asia/Singapore",analysisPeriod:{from:"2026-04-21",toExclusive:"2026-08-21"},meterAttachments:[{meterPointId:"meter-1"}],dataSnapshotId:"snapshot",skills:[{version:"0.8.0"}]}));
  writeAnalysisContract(join(root,"inputs"));
  writeFileSync(join(root,"outputs/analysis-brief.md"),"Full school phase analysis, not a shortlist.");
  writeFileSync(join(root,"outputs/report.html"),"<html><body>School break comparison</body></html>");
  writeFileSync(join(root,"outputs/evidence/calc.py"),"# Reproducible calculation supplied by worker");
  writeFileSync(join(root,"outputs/evidence/facts.json"),JSON.stringify({mean:238,unit:"kWh/day"}));save(data());
});
afterEach(()=>rmSync(root,{recursive:true,force:true}));
it("keeps useful findings without actions and more than six findings, with an immutable report-linked receipt",()=>{
  save({...data(),findings:Array.from({length:9},(_,i)=>finding(`f${i}`))});
  expect(validateAnalysisPackage(root)?.findings).toHaveLength(9);
  acceptAnalysisPackage(root);const old=readFileSync(join(root,"accepted-analysis.json"),"utf8");
  acceptAnalysisPackage(root);expect(readFileSync(join(root,"accepted-analysis.json"),"utf8")).toBe(old);
  writeFileSync(join(root,"outputs/report.html"),"changed report");
  expect(()=>acceptAnalysisPackage(root)).toThrow("REPORT_ANALYSIS_ACCEPTED_VERSION_CHANGED");
});
it("rejects mismatched project identity, foreign meters and dangling references",()=>{
  save({...data(),projectId:"other"});expect(()=>validateAnalysisPackage(root)).toThrow("IDENTITY_MISMATCH");
  save({...data(),findings:[{...finding(),subjectIds:["other-meter"]}]});expect(()=>validateAnalysisPackage(root)).toThrow("SUBJECT_INVALID");
  save({...data(),findings:[{...finding(),evidenceIds:["missing"]}]});expect(()=>validateAnalysisPackage(root)).toThrow("REFERENCE_INVALID");
});
it("rejects changed source values, units, windows and invented confirmation",()=>{
  save({...data(),evidence:[{...evidence(),value:999}]});expect(()=>validateAnalysisPackage(root)).toThrow("METRIC_MISMATCH");
  save({...data(),evidence:[{...evidence(),unit:"SGD"}]});expect(()=>validateAnalysisPackage(root)).toThrow("METRIC_MISMATCH");
  save({...data(),evidence:[{...evidence(),period:{from:"2026-04-01",toExclusive:"2026-06-29"}}]});expect(()=>validateAnalysisPackage(root)).toThrow("WINDOW_INVALID");
  save({...data(),findings:[{...finding(),certainty:"confirmed"}]});expect(()=>validateAnalysisPackage(root)).toThrow("CONFIRMATION_SOURCE_REQUIRED");
});
it("rejects traversal and symlinked artifact directories",()=>{
  save({...data(),evidence:[{...evidence(),dataPath:"evidence/../../inputs/manifest.json"}]});expect(()=>validateAnalysisPackage(root)).toThrow("PATH_INVALID");
  symlinkSync(join(root,"inputs"),join(root,"outputs/evidence/linked"),"junction");
  save({...data(),evidence:[{...evidence(),dataPath:"evidence/linked/manifest.json"}]});expect(()=>validateAnalysisPackage(root)).toThrow("PATH_INVALID");
});
it("pins the input manifest and leaves legacy reports untouched",()=>{
  writeFileSync(join(root,"inputs/manifest.json"),"{}");expect(()=>validateAnalysisPackage(root)).toThrow("INPUT_CHANGED");
  rmSync(join(root,"inputs/analysis-contract.json"));expect(validateAnalysisPackage(root)).toBeUndefined();
});
it("reports a stable analysis error for malformed or missing required artifacts",()=>{
  writeFileSync(join(root,"outputs/analysis-findings.json"),"not json");
  expect(()=>validateAnalysisPackage(root)).toThrow("REPORT_ANALYSIS_INVALID");
  rmSync(join(root,"outputs/analysis-findings.json"));
  expect(()=>validateAnalysisPackage(root)).toThrow("REPORT_ANALYSIS_INVALID");
});
