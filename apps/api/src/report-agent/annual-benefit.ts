import { z } from "zod";
const note = z.string().trim().min(1).max(500);
const range = z.object({low:z.number().finite().nonnegative(),high:z.number().finite().nonnegative()}).strict().refine(v=>v.low<=v.high,"Invalid annual benefit range");
/** Agent-computed scenario; no universal server-side extrapolation formula. */
export const annualBenefitScenarioSchema = z.object({
 referenceYear:z.number().int().min(2000).max(2200),energyKwh:range,
 money:z.object({currency:z.string().regex(/^[A-Z]{3}$/),range,tariffSource:note,taxBasis:z.enum(["inclusive","exclusive"])}).strict().optional(),
 condition:z.string().trim().min(1).max(120),method:note,assumptions:z.array(note).min(1).max(12),
 calculationFile:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(py|js|mjs)$/),
 resultFile:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.json$/),
}).strict();
export type AnnualBenefitScenario = z.infer<typeof annualBenefitScenarioSchema>;
export const ANNUAL_BENEFIT_REVIEW = `If outputs/key-point-candidates.json contains annualBenefit, review the referenced calculation script and JSON result alongside the HTML. Check that all three use the same units, reference year, monetary range, tax basis and conditions. Check the script derives statistics from supplied readings and excludes missing windows rather than filling zeros. Reject arbitrary reduction percentages or unsupported controllability; require an explicit conditional scenario instead of a forecast when equipment use is unknown. Check that calendar and tariff assumptions are visible, totals/subcircuits and overlapping actions are not added together, and unadjusted holiday counts are not called conservative without evidence. Do not describe gross potential savings as achieved savings or net profit. Run calculations only in the sandbox; presence of a file or model-written execution log is not proof of correctness. Request correction of inconsistencies before accepting the report.`;
/** Formatting only. The model's method and evidence must still pass review. */
export function annualBenefitText(input:AnnualBenefitScenario){
 const s=annualBenefitScenarioSchema.parse(input),r=s.money?.range??s.energyKwh;
 const low=Math.floor(r.low).toLocaleString("en-SG"),high=Math.ceil(r.high).toLocaleString("en-SG");
 const exact=r.low===r.high;
 const span=exact?Math.round(r.low).toLocaleString("en-SG"):(low===high?low:`${low}–${high}`);
 const amount=s.money?`${s.money.currency} ${span}`:`${span} kWh`;
 return `Could save ${exact?"about ":""}${amount}/year if ${s.condition.replace(/^if\s+/i, "")}${s.money?.taxBasis==="exclusive"?" (before tax)":""}`;
}
export const ANNUAL_BENEFIT_INSTRUCTIONS = `Compute supported annual savings by executing your own reproducible script in the sandbox. Choose the method from measured data, intervention, calendar and equipment; never blindly multiply by 365. Optionally add annualBenefit to each candidate: {referenceYear:2027,energyKwh:{low:0,high:0},money:{currency:"SGD",range:{low:0,high:0},tariffSource:"supplied tariff and future assumptions",taxBasis:"inclusive"},condition:"short condition after if",method:"method and evidence basis",assumptions:["calendar, controllability and seasonality"],calculationFile:"annual.py",resultFile:"annual.json"}. Zeros are placeholders, not findings. Save the executed script and JSON result in outputs; result JSON contains the identical annualBenefit object, one file per candidate. Omit money without a supported tariff; omit annualBenefit entirely when unquantifiable. Explain the missing fact instead. Preserve applicable day counts, sample coverage and uncertainty in calculations. Never invent a controllability or reduction percentage (such as 50-80%) to manufacture a savings range. A reduction fraction must come from site confirmation or supported equipment evidence. Otherwise present an explicitly defined what-if schedule, or leave the benefit unquantified. Distinguish an illustrative scenario from an evidence-backed expectation. The script must recompute the supporting statistics from the supplied dataset, not merely use hard-coded summary numbers; emit the full annualBenefit object in the result JSON. School holidays do not imply offices are closed. Never combine totals with subcircuits or overlapping measures. Use the same range and conditions in the report and recommendation. These are conditional gross annual savings, not achieved savings or net profit. The server checks structure and result consistency, not the truth of physical assumptions.`;
