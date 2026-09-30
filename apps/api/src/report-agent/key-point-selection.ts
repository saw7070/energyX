import { z } from "zod";
import { annualBenefitScenarioSchema } from "./annual-benefit.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid calendar date");

/** A selection references existing business records; it never rewrites actions. */
export const keyPointSelectionSchema = z.object({
  summary: z.string().trim().min(1).max(180).optional(),
  dataEndExclusive: day,
  active: z.array(z.object({
    sourceReportId: z.string().uuid().optional(),
    annualBenefit: annualBenefitScenarioSchema.optional(),
    question: z.string().trim().min(1).max(180).optional(),
    category: z.enum(["saving", "safety", "investigation"]).optional(),
  cause: z.string().min(1).max(180).optional(),
  card: z.object({issue:z.string().min(1).max(80),nextStep:z.string().min(1).max(100),benefit:z.string().min(1).max(130)}).strict().optional(),
    insightId: z.string().uuid(),
    actionId: z.string().uuid(),
    insightVersion: z.string().length(64),
    issue: z.string().trim().min(1).max(120),
    evidence: z.string().trim().min(1).max(300),
    evidenceFrom: day,
    evidenceToExclusive: day,
    nextStep: z.string().trim().min(1).max(240),
    benefit: z.string().trim().min(1).max(240),
    assumptions: z.string().trim().max(500),
    reason: z.string().trim().min(1).max(400),
  }).strict()).max(6),
  featuredActionIds: z.array(z.string().uuid()).max(3),
}).strict();

export type KeyPointSelection = z.infer<typeof keyPointSelectionSchema>;
export type SelectableInsight = {
  id: string; version: string; actionIds: string[];
  sources?: Array<{reportId:string}>;
  review: { status: string };
};

/** Call with project-scoped insights and viewer-authorized actions only. */
export function validateKeyPointSelection(
  input: unknown,
  insights: SelectableInsight[],
  visibleActionIds: ReadonlySet<string>,
): KeyPointSelection {
  const selection = keyPointSelectionSchema.parse(input);
  const usedInsights = new Set<string>(), usedActions = new Set<string>();
  for (const item of selection.active) {
    const insight = insights.find(value => value.id === item.insightId);
    if (!insight || !visibleActionIds.has(item.actionId) || !insight.actionIds.includes(item.actionId))
      throw new Error("KEY_POINT_REFERENCE_INVALID");
    if (item.sourceReportId && !insight.sources?.some(source=>source.reportId===item.sourceReportId))
      throw new Error("KEY_POINT_REFERENCE_INVALID");
    if (insight.version !== item.insightVersion) throw new Error("KEY_POINT_VERSION_CHANGED");
    if (["resolved", "archived"].includes(insight.review.status)) throw new Error("KEY_POINT_INACTIVE");
    if (usedInsights.has(item.insightId) || usedActions.has(item.actionId)) throw new Error("KEY_POINT_DUPLICATE");
    if (item.evidenceFrom >= item.evidenceToExclusive || item.evidenceToExclusive > selection.dataEndExclusive)
      throw new Error("KEY_POINT_EVIDENCE_WINDOW_INVALID");
    usedInsights.add(item.insightId); usedActions.add(item.actionId);
  }
  if (new Set(selection.featuredActionIds).size !== selection.featuredActionIds.length)
    throw new Error("KEY_POINT_DUPLICATE");
  if (selection.featuredActionIds.some(id => !usedActions.has(id))) throw new Error("KEY_POINT_REFERENCE_INVALID");
  return selection;
}
