import { randomUUID } from "node:crypto";
import type { MetadataStore } from "@datafoundry/metadata";
import { z } from "zod";
import { ActionStore, type ActionScope } from "./action-store.js";
import type { ActionEvidence } from "./action-data.js";
import { localDate } from "./action-data.js";
import { assessActionReadiness } from "./action-analysis.js";
import { shiftReportDate } from "./report-calendar.js";
import {
  hasReportArtifact,
  type ReportStore,
  type ReportRun,
} from "./report-store.js";
import type { ActionFeedbackInput } from "./action-feedback.js";

export const demonstrationSchema = z
  .object({
    requestId: z.string().uuid(),
    scenarioId: z.string().uuid(),
    executionAt: z.string().datetime({ offset: true }),
    executionNotes: z.string().trim().min(10).max(2000),
    observations: z
      .array(
        z
          .object({
            date: z.string().date(),
            kwh: z.number().finite().nonnegative().max(1e8),
          })
          .strict(),
      )
      .min(3)
      .max(60),
  })
  .strict();
export class ActionDemonstrations {
  constructor(private metadata: MetadataStore) {
    metadata.db.exec(
      `CREATE TABLE IF NOT EXISTS energyiq_action_demonstrations(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, user_id TEXT NOT NULL, action_id TEXT NOT NULL, request_id TEXT NOT NULL, document TEXT NOT NULL, UNIQUE(user_id,request_id));`,
    );
  }
  list(scope: ActionScope, actionId: string) {
    return this.metadata.db
      .prepare(
        "SELECT document FROM energyiq_action_demonstrations WHERE workspace_id=? AND project_id=? AND user_id=? AND action_id=? ORDER BY rowid DESC LIMIT 20",
      )
      .all(scope.workspaceId, scope.projectId, scope.userId, actionId)
      .map(
        (r) =>
          JSON.parse(String(r.document)) as {
            id: string;
            runId: string;
            input: z.infer<typeof demonstrationSchema>;
            createdAt: string;
          },
      );
  }
  assert(scope: ActionScope, id: string, actionId: string) {
    const row = this.metadata.db
      .prepare(
        "SELECT id FROM energyiq_action_demonstrations WHERE id=? AND workspace_id=? AND project_id=? AND user_id=? AND action_id=?",
      )
      .get(id, scope.workspaceId, scope.projectId, scope.userId, actionId);
    if (!row) throw new Error("ACTION_NOT_FOUND");
  }
  example(scope: ActionScope, actionId: string) {
    const actions = new ActionStore(this.metadata.db);
    actions.get(scope, actionId);
    const baseline = actions.baseline(scope, actionId) as ActionEvidence | null;
    if (!baseline) throw new Error("ACTION_DEMO_BASELINE_REQUIRED");
    const executionDate = baseline.period.toExclusive;
    const observations = Array.from({ length: 3 }, (_, i) => {
      const date = shiftReportDate(executionDate, i + 1),
        type = `weekday-${new Date(date).getUTCDay()}`;
      const days = baseline.days.filter(
        (d) =>
          d.dayType === type &&
          !d.criticalGap &&
          d.validMinutes === d.expectedMinutes &&
          d.kwh !== null,
      );
      if (days.length < 3) throw new Error("ACTION_DEMO_BASELINE_REQUIRED");
      return {
        date,
        kwh: Number(
          ((days.reduce((s, d) => s + d.kwh!, 0) / days.length) * 0.95).toFixed(
            4,
          ),
        ),
      };
    });
    return {
      executionDate,
      observations,
      label:
        "Illustrative 5% reduction from matched baseline days. Fictional, not measured.",
    };
  }
  create(
    scope: ActionScope,
    actionId: string,
    raw: unknown,
    reports: ReportStore,
  ) {
    const input = demonstrationSchema.parse(raw),
      actions = new ActionStore(this.metadata.db),
      action = actions.get(scope, actionId);
    const existing = this.list(scope, actionId).find(
      (d) => d.input.requestId === input.requestId,
    );
    if (existing) {
      if (JSON.stringify(existing.input) !== JSON.stringify(input))
        throw new Error("ACTION_REQUEST_CONFLICT");
      return existing;
    }
    const source = reports.get(scope.projectId, action.sourceReportId);
    if (
      source.workspaceId !== scope.workspaceId ||
      source.status !== "succeeded" ||
      !hasReportArtifact(source) ||
      source.actionFeedback
    )
      throw new Error("ACTION_NOT_FOUND");
    const baseline = actions.baseline(scope, actionId) as ActionEvidence | null;
    if (!baseline || action.meterIds.length !== 1)
      throw new Error("ACTION_DEMO_BASELINE_REQUIRED");
    const scenario = actions.scenario(scope, actionId, input.scenarioId),
      executionDay = localDate(new Date(input.executionAt), baseline.timezone);
    const sorted = [...input.observations].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    if (
      baseline.period.toExclusive > executionDay ||
      sorted.some((d, i) => d.date !== shiftReportDate(executionDay, i + 1)) ||
      sorted.length !== scenario.value.inputs.days
    )
      throw new Error("ACTION_DEMO_WINDOW_INVALID");
    const id = randomUUID(),
      observation: ActionEvidence = {
        ...baseline,
        snapshotId: `demo:${id}`,
        period: {
          from: sorted[0]!.date,
          toExclusive: shiftReportDate(sorted.at(-1)!.date, 1),
        },
        capturedAt: new Date().toISOString(),
        actualLastIntervalEnd: null,
        days: sorted.map((d) => ({
          ...d,
          dayType: `weekday-${new Date(d.date).getUTCDay()}`,
          expectedMinutes: 1440,
          validMinutes: 1440,
          criticalGap: false,
        })),
      };
    const assessment = assessActionReadiness({
      baseline: baseline.days,
      observation: observation.days,
    });
    if (!assessment.ready) throw new Error("ACTION_DEMO_BASELINE_REQUIRED");
    const receipt: ActionFeedbackInput = {
      demonstrationId: id,
      actionId,
      revision: action.revision,
      stage: "demonstration",
      sourceReportId: source.id,
      title: action.title,
      execution: {
        effectiveAt: input.executionAt,
        details: `DEMONSTRATION ONLY. No real execution is asserted. ${input.executionNotes}`,
      },
      baseline,
      observation,
      assessment,
      scenarioComparison: {
        scenarioId: scenario.id,
        scenario: scenario.value,
        period: observation.period,
        status: "complete_window",
        observedDays: sorted.length,
        differenceFromEstimateKwh:
          assessment.observedDifferenceKwh - scenario.value.energyKwh,
        caveat:
          "Mock post-action readings, not measurements. Simulation is a separate assumption-based estimate. Never claim achieved savings or calibrate production from this demonstration.",
      },
    };
    this.metadata.db.exec("SAVEPOINT action_demo");
    try {
      const run = reports.enqueue({
        settings: {
          ...source.settings,
          contextNotes:
            "DEMO: use only supplied frozen evidence. Post-action values and execution are fictional.",
          fileRefIds: [],
          useProjectData: false,
          skill:
            "Generate a concise demonstration feedback report. Distinguish forecast, fictional observations and limitations.",
          skillRefs: [],
          skillUsage: [],
          skillSourceRunId: undefined,
          skillSourceSessionId: undefined,
          frequency: "off",
          comparisonPeriod: undefined,
          actorUserId: scope.userId,
        },
        actorUserId: scope.userId,
        kind: "report",
        period: observation.period,
        prompt:
          "Generate an English DEMONSTRATION feedback HTML from inputs/action-feedback.json. Put a prominent Demo / mock observations banner on every main section. Compare the simulation expectation with the separately supplied fictional post-action observations, not with real execution. Use exact computed values. Explain what would be learned if such readings were observed, and what would need validation; never claim actual savings or completed site action. End with a short provisional learning, explicitly ineligible for production calibration.",
        actionFeedback: receipt,
        scheduleKey: `action-demo:${scope.userId}:${input.requestId}`,
      });
      const value = {
        id,
        runId: run.id,
        input,
        createdAt: new Date().toISOString(),
      };
      this.metadata.db
        .prepare(
          "INSERT INTO energyiq_action_demonstrations VALUES (?,?,?,?,?,?,?)",
        )
        .run(
          id,
          scope.workspaceId,
          scope.projectId,
          scope.userId,
          actionId,
          input.requestId,
          JSON.stringify(value),
        );
      this.metadata.db.exec("RELEASE action_demo");
      return value;
    } catch (error) {
      this.metadata.db.exec("ROLLBACK TO action_demo; RELEASE action_demo");
      throw error;
    }
  }
}

/** Reproducible experience note derived from a completed feedback's immutable evidence. */
export function actionExperience(run: ReportRun): string | null {
  const e = run.actionFeedback;
  if (run.status !== "succeeded" || !e || !e.assessment.ready) return null;
  const a = e.assessment;
  const difference = e.scenarioComparison?.differenceFromEstimateKwh;
  const execution = e.execution.details.replace(/\n/g, "\n> ");
  const comparison =
    difference === undefined
      ? ""
      : `The ${e.demonstrationId ? "mock" : "observed"} difference was ${Math.abs(difference).toFixed(4)} kWh ${difference >= 0 ? "above" : "below"} the scenario estimate. Review assumed removable power, operating hours and other changes before considering a revised estimate.\n\n`;
  const trace = `## Execution context\n\n> ${execution}\n\n`;
  return `# ${e.demonstrationId ? "Demonstration learning — not production evidence" : "Action observation record"}\n\n${e.title}\n\n- Observation: ${e.observation.period.from} to ${shiftReportDate(e.observation.period.toExclusive, -1)} (inclusive)\n- Comparable baseline expectation: ${a.expectedKwh.toFixed(4)} kWh\n- ${e.demonstrationId ? "Mock" : "Observed"} use: ${a.actualKwh.toFixed(4)} kWh\n- Difference: ${a.observedDifferenceKwh.toFixed(4)} kWh\n\n${e.scenarioComparison ? `Scenario estimate: ${e.scenarioComparison.scenario.energyKwh.toFixed(4)} kWh.\n\n` : ""}${trace}## Learning\n\n${comparison}${e.demonstrationId ? "This example explains the feedback workflow. Do not use fictional outcomes to update real project assumptions or claim savings." : "Recheck the operating conditions and other simultaneous changes before using this observation to revise future assumptions. An observed difference is not causal savings."}\n\nNo shared Skill or simulation parameter was automatically changed.\n\n<!-- Source feedback: ${run.id} -->\n`;
}
