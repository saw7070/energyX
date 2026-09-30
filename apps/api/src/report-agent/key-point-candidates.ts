import { z } from "zod";
import { annualBenefitScenarioSchema, annualBenefitText } from "./annual-benefit.js";
import { validateKeyPointSelection, type SelectableInsight } from "./key-point-selection.js";

const candidatesSchema = z.object({summary:z.string().trim().min(1).max(180).optional(),candidates:z.array(z.object({
  annualBenefit: annualBenefitScenarioSchema.optional(),
  question:z.string().trim().min(1).max(180).optional(),
  category: z.enum(["saving", "safety", "investigation"]).optional(),
  cause: z.string().min(1).max(180).optional(),
  card: z.object({issue:z.string().min(1).max(80),nextStep:z.string().min(1).max(100),benefit:z.string().min(1).max(130)}).strict().optional(),
  id:z.string().min(1),issue:z.string().min(1).max(120),evidence:z.string().min(1).max(300),
  evidenceFrom:z.string(),evidenceToExclusive:z.string(),action:z.string().max(4000),
  benefit:z.string().min(1).max(240),assumptions:z.string().max(500),
  existingActionId:z.string().uuid().nullable(),selected:z.boolean(),selectionReason:z.string().min(1).max(400),
  calculationFile:z.string().min(1),
}).refine(c=>!c.selected || c.action.trim().length>0,{message:"Selected candidate requires an action"})).max(20)});

/** Only actions sourced to this accepted report are supplied by the caller. */
export function selectReportKeyPoints(input:unknown,dataEndExclusive:string,insights:SelectableInsight[],
  actions:Array<{id:string;title?:string;recommendation:string;state:string}>) {
  const {candidates,summary}=candidatesSchema.parse(input);
  const active=[],featuredActionIds:string[]=[];
  for(const candidate of candidates){
    if(!candidate.selected && !candidate.action.trim()) continue;
    const matches=actions.filter(a=>candidate.existingActionId ? a.id===candidate.existingActionId : a.recommendation.trim()===candidate.action.trim());
    const action=matches.length===1?matches[0]:undefined;
    const insight=action?insights.find(i=>i.actionIds.includes(action.id)):undefined;
    if(!action || !insight || ["paused","declined","scheduled","implemented"].includes(action.state) || ["resolved","archived"].includes(insight.review.status)) {
      if(candidate.selected) throw new Error("KEY_POINT_REFERENCE_INVALID");
      continue;
    }
    active.push({...(candidate.question ? {question:candidate.question} : {}),...(candidate.category ? {category:candidate.category} : {}),...(candidate.cause ? {cause:candidate.cause} : {}),...(candidate.card ? {card:candidate.card} : {}),insightId:insight.id,actionId:action.id,insightVersion:insight.version,issue:candidate.issue,
      evidence:candidate.evidence,evidenceFrom:candidate.evidenceFrom,evidenceToExclusive:candidate.evidenceToExclusive,
      ...(candidate.annualBenefit ? {annualBenefit:candidate.annualBenefit} : {}),
      nextStep:action.title ?? candidate.action,benefit:candidate.annualBenefit ? annualBenefitText(candidate.annualBenefit) : candidate.benefit,assumptions:candidate.assumptions,reason:candidate.selectionReason});
    if(candidate.selected) featuredActionIds.push(action.id);
  }
  return validateKeyPointSelection({...(summary ? {summary} : {}),dataEndExclusive,active,featuredActionIds},insights,new Set(actions.map(a=>a.id)));
}
