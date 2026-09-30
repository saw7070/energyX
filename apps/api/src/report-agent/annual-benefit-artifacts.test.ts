import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {it,expect} from "vitest";
import {validateAnnualBenefitArtifacts} from "./annual-benefit-artifacts.js";
const annualBenefit={referenceYear:2027,energyKwh:{low:10,high:20},condition:"the schedule is approved",method:"Comparable occupied weekdays",assumptions:["Same occupancy"],calculationFile:"annual.py",resultFile:"annual.json"};
it("requires a script and matching result without executing model code",()=>{
 const dir=mkdtempSync(join(tmpdir(),"annual-benefit-"));
 try{
  const raw={candidates:[{annualBenefit}]};
  expect(()=>validateAnnualBenefitArtifacts(raw,dir)).toThrow();
  writeFileSync(join(dir,"annual.py"),"raise Exception('must not execute on API host')");
  writeFileSync(join(dir,"annual.json"),JSON.stringify({annualBenefit}));
  expect(()=>validateAnnualBenefitArtifacts(raw,dir)).not.toThrow();
  writeFileSync(join(dir,"annual.json"),JSON.stringify({annualBenefit:{...annualBenefit,energyKwh:{low:100,high:200}}}));
  expect(()=>validateAnnualBenefitArtifacts(raw,dir)).toThrow("RESULT_MISMATCH");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it("keeps existing non-annual candidates compatible",()=>{
 expect(()=>validateAnnualBenefitArtifacts({candidates:[{benefit:"Needs a site check"}]},"unused")).not.toThrow();
});
