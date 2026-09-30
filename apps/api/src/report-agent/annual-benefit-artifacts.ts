import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { annualBenefitScenarioSchema } from "./annual-benefit.js";

/** Never execute model-generated code on the API host. Its execution belongs in the sandbox. */
export function validateAnnualBenefitArtifacts(raw: unknown, outputs: string): void {
  const candidates=(raw as {candidates?:unknown[]}|null)?.candidates;
  if(!Array.isArray(candidates))return; // Main candidate validator reports malformed documents.
  for(const item of candidates){
    const value=(item as {annualBenefit?:unknown}|null)?.annualBenefit;
    if(value===undefined)continue;
    const scenario=annualBenefitScenarioSchema.parse(value);
    for(const name of [scenario.calculationFile,scenario.resultFile]){
      const stat=lstatSync(join(outputs,name));
      if(stat.isSymbolicLink()||!stat.isFile()||stat.size===0||stat.size>1024*1024)
        throw new Error("ANNUAL_BENEFIT_ARTIFACT_INVALID");
    }
    const result=JSON.parse(readFileSync(join(outputs,scenario.resultFile),"utf8"));
    const saved=annualBenefitScenarioSchema.parse(result.annualBenefit);
    if(JSON.stringify(saved)!==JSON.stringify(scenario))throw new Error("ANNUAL_BENEFIT_RESULT_MISMATCH");
  }
}
