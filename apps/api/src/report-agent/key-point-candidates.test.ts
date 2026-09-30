import { expect, it } from "vitest";
import { selectReportKeyPoints } from "./key-point-candidates.js";
const id="10000000-0000-4000-8000-000000000001", actionId="20000000-0000-4000-8000-000000000001";
const candidate={id:"c1",issue:"Evening lighting",evidence:"Measured evening use",evidenceFrom:"2026-09-01",evidenceToExclusive:"2026-09-08",action:"Check required lighting hours",benefit:"Conditional energy reduction",assumptions:"Confirm service requirements",calculationFile:"calculate.py",existingActionId:actionId,selected:true,selectionReason:"Direct operational decision"};
const insights=[{id,version:"a".repeat(64),actionIds:[actionId],review:{status:"open"}}];
const action={id:actionId,recommendation:candidate.action,state:"proposed"};
it("publishes a supported investigation without a monetary or safety claim",()=>{
 const result=selectReportKeyPoints({candidates:[{...candidate,category:"investigation",benefit:"Find the reason for the increase; savings are not yet known."}]},"2026-09-08",insights,[action]);
 expect(result.active[0]?.category).toBe("investigation");
 expect(result.featuredActionIds).toEqual([actionId]);
});
it("persists the Agent annual scenario and formats its computed result instead of stale benefit text",()=>{
 const annualBenefit={referenceYear:2027,energyKwh:{low:480,high:720},condition:"the schedule is approved",method:"Calendar-based Python model",assumptions:["Same occupancy"],calculationFile:"annual.py",resultFile:"annual.json"};
 const r=selectReportKeyPoints({candidates:[{...candidate,annualBenefit}]},"2026-09-08",insights,[action]);
 expect(r.active[0]?.annualBenefit).toEqual(annualBenefit);
 expect(r.active[0]?.benefit).toBe("Could save 480–720 kWh/year if the schedule is approved");
});
it("keeps scheduled and implemented actions out of new recommendation slots",()=>{
  for(const state of ["scheduled","implemented"]){
    expect(()=>selectReportKeyPoints({candidates:[candidate]},"2026-09-08",insights,[{...action,state}])).toThrow("REFERENCE_INVALID");
    expect(selectReportKeyPoints({candidates:[{...candidate,selected:false}]},"2026-09-08",insights,[{...action,state}]).active).toEqual([]);
  }
});
it("resolves a candidate only to a report-sourced action and preserves its ID",()=>{
  expect(selectReportKeyPoints({candidates:[candidate]},"2026-09-08",insights,[action]).featuredActionIds).toEqual([actionId]);
  expect(()=>selectReportKeyPoints({candidates:[candidate]},"2026-09-08",insights,[])).toThrow("REFERENCE_INVALID");
});
it("does not publish selected paused actions or invent a match for paraphrased new measures",()=>{
  expect(()=>selectReportKeyPoints({candidates:[candidate]},"2026-09-08",insights,[{...action,state:"paused"}])).toThrow("REFERENCE_INVALID");
  expect(selectReportKeyPoints({candidates:[{...candidate,selected:false}]},"2026-09-08",insights,[{...action,state:"paused"}]).active).toEqual([]);
  expect(()=>selectReportKeyPoints({candidates:[{...candidate,existingActionId:null,action:"Different measure"}]},"2026-09-08",insights,[action])).toThrow("REFERENCE_INVALID");
});

it("keeps canonical long instructions for matching and uses the action title on the card",()=>{
 const full="Confirm equipment and service requirements before changing operating hours. ".repeat(5);
 const result=selectReportKeyPoints({candidates:[{...candidate,existingActionId:null,action:full}]},"2026-09-08",insights,[{...action,title:"Confirm lighting hours",recommendation:full}]);
 expect(result.active[0]?.nextStep).toBe("Confirm lighting hours");
});

it("preserves a compact card without dropping the detailed evidence",()=>{
 const card={issue:"Evening lighting is still on",nextStep:"Check the lighting schedule",benefit:"Could save S$2 over five days if switchable"};
 const r=selectReportKeyPoints({candidates:[{...candidate,card}]},"2026-09-08",insights,[action]);
 expect(r.active[0]?.card).toEqual(card);expect(r.active[0]?.evidence).toBe(candidate.evidence);
});

it("retains a bounded summary and site question with the sourced action",()=>{
 const r=selectReportKeyPoints({summary:"Check the evening lighting schedule.",candidates:[{...candidate,category:"saving",question:"Is this lighting needed after 20:00?",cause:"The schedule may extend into the evening."}]},"2026-09-08",insights,[action]);
 expect(r.summary).toBe("Check the evening lighting schedule.");expect(r.active[0]?.question).toBe("Is this lighting needed after 20:00?");
 expect(()=>selectReportKeyPoints({summary:"x".repeat(181),candidates:[]},"2026-09-08",[],[])).toThrow();
});

it("allows rejected observations without an action but never publishes them",()=>{
 const r=selectReportKeyPoints({candidates:[{...candidate,selected:false,action:"",existingActionId:null}]},"2026-09-08",insights,[action]);
 expect(r.active).toEqual([]);
 expect(()=>selectReportKeyPoints({candidates:[{...candidate,selected:true,action:""}]},"2026-09-08",insights,[action])).toThrow("requires an action");
});
