import {expect,it} from "vitest";
import {annualBenefitScenarioSchema,annualBenefitText} from "./annual-benefit.js";
const scenario={referenceYear:2027,energyKwh:{low:480,high:720},money:{currency:"SGD",range:{low:144,high:216},tariffSource:"Published tariff assumed unchanged",taxBasis:"inclusive" as const},condition:"the approved schedule is followed",method:"Matched teaching days excluding holidays",assumptions:["No equipment change"],calculationFile:"annual.py",resultFile:"annual.json"};
it("preserves the Agent method and computed result without extrapolating",()=>{expect(annualBenefitScenarioSchema.parse(scenario).method).toBe(scenario.method);expect(annualBenefitText(scenario)).toContain("SGD 144–216/year if");});
it("allows energy-only estimates and valid zeros",()=>{const {money,...s}=scenario;expect(annualBenefitText({...s,energyKwh:{low:0,high:0}})).toContain("0 kWh/year");});
it("rejects reversed ranges, missing assumptions and unsafe paths",()=>{for(const s of [{...scenario,energyKwh:{low:2,high:1}},{...scenario,assumptions:[]},{...scenario,calculationFile:"../annual.py"},{...scenario,resultFile:"C:/secret.json"}])expect(()=>annualBenefitScenarioSchema.parse(s)).toThrow();});
it("keeps tax basis and conditional language",()=>{expect(annualBenefitText({...scenario,money:{...scenario.money,taxBasis:"exclusive"}})).toContain("(before tax)");});
it("does not turn one exact scenario into an invented uncertainty range",()=>{
 const text=annualBenefitText({...scenario,money:{...scenario.money,range:{low:575.937,high:575.937}}});
 expect(text).toContain("about SGD 576/year");expect(text).not.toContain("575–576");
});
