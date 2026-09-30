import { sweepActionFeedback } from "./action-scheduler.js";
import { ReportService, registerReportService, reportPrompt } from "./report-service.js";
import { handleActionApi } from "./action-api.js";
import { handleReportLibraryApi } from "./report-library-api.js";
import type { FileAssetService } from "@datafoundry/files";
import type { ConfigApiContext } from "../routes/types.js";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { createMetadataStore } from "@datafoundry/metadata";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionStore } from "./action-store.js";
import { projectActionProgress } from "./action-progress.js";
import { ActionDemonstrations, actionExperience } from "./action-demonstration.js";
import { estimateLighting } from "./action-analysis.js";
import { ReportStore, type ReportSettings } from "./report-store.js";
import {
  checkActionFeedback,
  assertActionFeedbackCurrent,
  retryActionFeedback,
} from "./action-feedback.js";
import {
  actionDays,
  type ActionEvidence,
  type Interval,
} from "./action-data.js";
const scope = { workspaceId: "w", projectId: "p", userId: "admin" };
let metadata: ReturnType<typeof createMetadataStore>;
let root: string;
let actions: ActionStore;
let reports: ReportStore;
let id: string;
const day = (date: string, kwh: number) => ({
  date,
  dayType: `weekday-${new Date(date).getUTCDay()}`,
  expectedMinutes: 1440,
  validMinutes: 1440,
  criticalGap: false,
  kwh,
});
const baseline: ActionEvidence = {
  snapshotId: "before",
  hierarchyRevisionId: "h",
  meterMappingRevisionId: "m",
  timezone: "Asia/Singapore",
  period: { from: "2026-08-01", toExclusive: "2026-09-01" },
  meterId: "led",
  capturedAt: "2026-09-01T00:00:00Z",
  actualLastIntervalEnd: "2026-08-31T16:00:00Z",
  days: Array.from({ length: 31 }, (_, i) =>
    day(`2026-08-${String(i + 1).padStart(2, "0")}`, 24),
  ),
};
const observation: ActionEvidence = {
  ...baseline,
  snapshotId: "after",
  period: { from: "2026-09-02", toExclusive: "2026-09-05" },
  days: [day("2026-09-02", 12), day("2026-09-03", 12), day("2026-09-04", 12)],
};
beforeEach(() => {
  vi.stubEnv("ENERGYIQ_ACTIONS_PILOT_ENABLED", "true");
  root = mkdtempSync(join(tmpdir(), "action-feedback-"));
  metadata = createMetadataStore({ database_path: join(root, "db.sqlite") });
  metadata.users.createPasswordUser({
    id: "admin",
    email: "admin@test.invalid",
  });
  metadata.energyIq.upsertUserRole({ user_id: "admin", role: "admin" });
  metadata.workspaces.upsert({
    id: "w",
    name: "Workspace",
    kind: "customer",
    owner_user_id: "admin",
  });
  metadata.workspaceMemberships.upsert({
    workspace_id: "w",
    user_id: "admin",
    role: "owner",
  });
  metadata.energyIq.upsertProject({
    id: "p",
    workspace_id: "w",
    name: "Project",
    status: "published",
    timezone: "Asia/Singapore",
  });
  reports = new ReportStore(metadata.db);
  actions = new ActionStore(metadata.db);
  const settings: ReportSettings = {
    projectId: "p",
    workspaceId: "w",
    actorUserId: "admin",
    timezone: "Asia/Singapore",
    contextNotes: "",
    fileRefIds: [],
    useProjectData: true,
    skill: "Analyse evidence",
    revision: 0,
    frequency: "off",
    localHour: 3,
    scheduledPrompt: "",
  };
  const source = reports.enqueue({
    settings,
    period: baseline.period,
    actorUserId: "admin",
    prompt: "Original",
  });
  reports.claim();
  reports.finish({ ...source, status: "succeeded" });
  const a = actions.create(scope, {
    sourceReportId: source.id,
    title: "LED hours",
    recommendation: "Close earlier",
    meterIds: ["led"],
    baseline: { ...baseline.period, snapshotId: "before" },
    idempotencyKey: "a",
  });
  id = a.id;
  actions.freezeBaseline(scope, id, baseline);
  actions.record(scope, id, {
    revision: 1,
    requestId: "e",
    type: "implemented",
    effectiveAt: "2026-09-01T19:00:00+08:00",
    details: "Close at 19:00 daily",
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  metadata.close();
  rmSync(root, { recursive: true, force: true });
});
it("keeps mock observations separate from simulation, real execution and production learning",()=>{
 const demos=new ActionDemonstrations(metadata),before=actions.get(scope,id),events=actions.events(scope,id),frozen=actions.baseline(scope,id);
 const scenarioId=actions.saveScenario(scope,id,estimateLighting({reduciblePowerKw:0.8,hoursPerDay:3,days:3,assumptions:"Assume this independently metered load is removable."}));
 const input={requestId:"e5eb9ccf-d2e8-40eb-b0d8-b12367913bba",scenarioId,executionAt:"2026-09-01T19:00:00+08:00",executionNotes:"Mock timer change for a demonstration only.",observations:[{date:"2026-09-02",kwh:12},{date:"2026-09-03",kwh:12},{date:"2026-09-04",kwh:12}]};
 const demo=demos.create(scope,id,input,reports);expect(demos.create(scope,id,input,reports).id).toBe(demo.id);
 const run=reports.get("p",demo.runId);expect(run.actionFeedback).toMatchObject({demonstrationId:demo.id,assessment:{expectedKwh:72,actualKwh:36}});
 expect(reportPrompt(run)).toContain("DEMONSTRATION MODE");
 expect(reportPrompt(run)).toContain("Only the historical baseline comes from real readings");
 expect(run.actionFeedback?.scenarioComparison?.scenario.energyKwh).toBeCloseTo(7.2);
 expect(actions.get(scope,id)).toEqual(before);expect(actions.events(scope,id)).toEqual(events);expect(actions.baseline(scope,id)).toEqual(frozen);expect(actions.feedback(scope,id)).toEqual([]);
 expect(demos.list({...scope,userId:"someone-else"},id)).toEqual([]);
 expect(()=>demos.assert({...scope,workspaceId:"other"},demo.id,id)).toThrow("NOT_FOUND");
 expect(()=>demos.create(scope,id,{...input,observations:[input.observations[0],input.observations[0],input.observations[2]]},reports)).toThrow("CONFLICT");
 expect(()=>demos.create(scope,id,{...input,requestId:"b9021966-320a-4d75-bf12-7a0dfc1a8eab",executionAt:"2026-08-01T19:00:00+08:00"},reports)).toThrow("WINDOW_INVALID");
 expect(actionExperience(run)).toBeNull();reports.claim(r=>r.id===run.id);reports.finish({...run,status:"succeeded"});expect(actionExperience(reports.get("p",run.id))).toContain("not production evidence");
});
it("includes only accepted shared effect evidence in later reports and marks superseded results", async () => {
  const original = actions.get(scope, id);
  const shared = actions.create(scope, {
    sourceReportId: original.sourceReportId, title: "Shared routine", recommendation: "Review hours",
    meterIds: ["led"], baseline: original.baseline, idempotencyKey: "shared-context", visibility: "project",
  });
  actions.freezeBaseline(scope, shared.id, baseline);
  const implemented = actions.record(scope, shared.id, {revision:1,requestId:"shared-execute",type:"implemented",effectiveAt:"2026-09-01T19:00:00+08:00",details:"Changed timer"});
  await checkActionFeedback(metadata, reports, implemented, new Date("2026-09-05"), async()=>observation);
  const link = actions.feedback(scope, shared.id)[0]!;
  const run = reports.get("p", link.runId);
  expect(projectActionProgress(actions,reports,scope)).toHaveLength(1); // private fixture is excluded
  expect(projectActionProgress(actions,reports,scope)[0]?.completedAssessments).toEqual([]);
  reports.claim(candidate=>candidate.id===run.id);
  reports.finish({...run,status:"succeeded"});
  const accepted = projectActionProgress(actions,reports,scope)[0]?.completedAssessments[0];
  expect(accepted).toMatchObject({reportId:run.id,historical:false,assessment:{ready:true,expectedKwh:72,actualKwh:36,observedDifferenceKwh:36}});
  expect(accepted).not.toHaveProperty("settings");
  actions.record(scope,shared.id,{revision:2,requestId:"pause",type:"paused",effectiveAt:"2026-09-06T00:00:00+08:00",details:"Routine paused"});
  expect(projectActionProgress(actions,reports,scope)[0]?.completedAssessments[0]?.historical).toBe(true);
  metadata.db.prepare("UPDATE energyiq_report_runs SET document=? WHERE id=?").run(JSON.stringify({...run,status:"succeeded",workspaceId:"other"}),run.id);
  expect(projectActionProgress(actions,reports,scope)[0]?.completedAssessments).toEqual([]);
});
it("keeps partial observations separate from a complete adopted-scenario window", async () => {
  const original = actions.get(scope, id);
  const proposed = actions.create(scope, {
    sourceReportId: original.sourceReportId,
    title: "Scenario follow-up",
    recommendation: "Reduce display hours",
    meterIds: ["led"],
    baseline: original.baseline,
    idempotencyKey: "scenario-action",
  });
  actions.freezeBaseline(scope, proposed.id, baseline);
  const scenarioId = actions.saveScenario(
    scope,
    proposed.id,
    estimateLighting({
      reduciblePowerKw: 0.8,
      hoursPerDay: 3,
      days: 5,
      assumptions:
        "Same daily reduction across five consecutive observation days.",
    }),
  );
  const adopted = actions.adoptScenario(scope, proposed.id, {
    revision: 1,
    requestId: "adopt",
    scenarioId,
  });
  const implemented = actions.record(scope, proposed.id, {
    revision: adopted.revision,
    requestId: "execute",
    type: "implemented",
    effectiveAt: "2026-09-01T19:00:00+08:00",
    details: "Changed the timer",
  });
  const read = vi
    .fn()
    .mockResolvedValue({
      ...observation,
      days: [...observation.days, day("2026-09-05", 12), day("2026-09-06", 12)],
    });
  await checkActionFeedback(
    metadata,
    reports,
    implemented,
    new Date("2026-09-07"),
    read,
  );
  const first = reports.get(
    "p",
    actions.feedback(scope, proposed.id)[0]!.runId,
  ).actionFeedback!;
  expect(first.scenarioComparison).toMatchObject({
    status: "partial_observation",
    observedDays: 3,
  });
  expect(first.scenarioComparison).not.toHaveProperty(
    "differenceFromEstimateKwh",
  );
  const incomplete = vi
    .fn()
    .mockResolvedValue({
      ...observation,
      days: [
        day("2026-09-02", 12),
        day("2026-09-04", 12),
        day("2026-09-05", 12),
        day("2026-09-06", 12),
        day("2026-09-07", 12),
      ],
    });
  await checkActionFeedback(
    metadata,
    reports,
    implemented,
    new Date("2026-09-08"),
    incomplete,
  );
  expect(
    actions.feedback(scope, proposed.id).some((f) => f.stage === "scenario"),
  ).toBe(false);
  await checkActionFeedback(
    metadata,
    reports,
    implemented,
    new Date("2026-09-07"),
    read,
  );
  const comparison = actions
    .feedback(scope, proposed.id)
    .find((f) => f.stage === "scenario")!;
  expect(
    reports.get("p", comparison.runId).actionFeedback?.scenarioComparison,
  ).toMatchObject({
    status: "complete_window",
    observedDays: 5,
    differenceFromEstimateKwh: 48,
    period: { from: "2026-09-02", toExclusive: "2026-09-07" },
  });
  expect(() =>
    actions.adoptScenario(scope, proposed.id, {
      revision: implemented.revision,
      requestId: "rewrite",
      scenarioId,
    }),
  ).toThrow("ACTION_SCENARIO_LOCKED");
});
it.each([3, 7])(
  "does not duplicate a %i-day scenario with an equal or longer preliminary report",
  async (days) => {
    const original = actions.get(scope, id);
    const proposed = actions.create(scope, {
      sourceReportId: original.sourceReportId,
      title: "Exact-window plan",
      recommendation: "Reduce display hours",
      meterIds: ["led"],
      baseline: original.baseline,
      idempotencyKey: "exact-window",
    });
    actions.freezeBaseline(scope, proposed.id, baseline);
    const scenarioId = actions.saveScenario(
      scope,
      proposed.id,
      estimateLighting({
        reduciblePowerKw: 0.8,
        hoursPerDay: 3,
        days,
        assumptions: "Same reduction every calendar day.",
      }),
    );
    const adopted = actions.adoptScenario(scope, proposed.id, {
      revision: 1,
      requestId: "adopt",
      scenarioId,
    });
    const implemented = actions.record(scope, proposed.id, {
      revision: adopted.revision,
      requestId: "execute",
      type: "implemented",
      effectiveAt: "2026-09-01T19:00:00+08:00",
      details: "Changed timer",
    });
    const read = vi
      .fn()
      .mockResolvedValue({
        ...observation,
        days: Array.from({ length: 7 }, (_, i) =>
          day(`2026-09-${String(i + 2).padStart(2, "0")}`, 12),
        ),
      });
    for (let i = 0; i < 3; i++)
      await checkActionFeedback(
        metadata,
        reports,
        implemented,
        new Date("2026-09-09"),
        read,
      );
    const links = actions.feedback(scope, proposed.id);
    expect(links.map((f) => f.stage).sort()).toEqual(
      days === 3 ? ["scenario"] : ["initial", "scenario"],
    );
    expect(
      reports.get("p", links.find((f) => f.stage === "scenario")!.runId)
        .actionFeedback?.scenarioComparison?.status,
    ).toBe("complete_window");
  },
);
it("does not let an admin-to-editor downgrade continue a private feedback task", async () => {
  metadata.energyIq.upsertUserRole({ user_id: "admin", role: "user" });
  metadata.energyIq.upsertProjectAccess({
    project_id: "p",
    user_id: "admin",
    role: "editor",
  });
  await expect(
    checkActionFeedback(
      metadata,
      reports,
      actions.get(scope, id),
      new Date("2026-09-05"),
      vi.fn().mockResolvedValue(observation),
    ),
  ).rejects.toThrow("REPORT_ACTION_ACCESS_FORBIDDEN");
});
it("enqueues one linked same-owner Pi follow-up from real-shaped evidence and deduplicates across restarts", async () => {
  const read = vi.fn().mockResolvedValue(observation);
  await checkActionFeedback(
    metadata,
    reports,
    actions.get(scope, id),
    new Date("2026-09-05T00:00:00Z"),
    read,
  );
  const link = actions.feedback(scope, id)[0]!;
  expect(link).toMatchObject({ revision: 2, stage: "initial" });
  const run = reports.get("p", link.runId);
  expect(run.actionFeedback?.assessment).toMatchObject({
    ready: true,
    expectedKwh: 72,
    actualKwh: 36,
    observedDifferenceKwh: 36,
  });
  expect(run.parentRunId).toBeUndefined();
  expect(run.actionFeedback?.sourceReportId).toBe(
    actions.get(scope, id).sourceReportId,
  );
  expect(run.actorUserId).toBe("admin");
  expect(run.sessionId).not.toBe(
    reports.get("p", run.actionFeedback!.sourceReportId).sessionId,
  );
  expect(() =>
    reports.enqueue({
      settings: run.settings,
      period: run.period,
      actorUserId: "admin",
      prompt: "Continue",
      sessionId: run.sessionId!,
    }),
  ).toThrow("REPORT_ACTION_CONTEXT_REQUIRED");
  expect(run.settings.useProjectData).toBe(false);
  await checkActionFeedback(
    metadata,
    new ReportStore(metadata.db),
    actions.get(scope, id),
    new Date("2026-09-05T00:00:00Z"),
    read,
  );
  expect(actions.feedback(scope, id)).toHaveLength(1);
});
it("does not enqueue on incomplete data, incompatible mappings or execution overlapping baseline", async () => {
  const check = async (value: ActionEvidence) =>
    checkActionFeedback(
      metadata,
      reports,
      actions.get(scope, id),
      new Date("2026-09-05"),
      vi.fn().mockResolvedValue(value),
    );
  await check({
    ...observation,
    days: observation.days.map((d) => ({
      ...d,
      criticalGap: true,
      validMinutes: 0,
      kwh: null,
    })),
  });
  expect(actions.feedback(scope, id)).toEqual([]);
  await check({ ...observation, meterMappingRevisionId: "changed" });
  expect(actions.feedback(scope, id)).toEqual([]);
  actions.record(scope, id, {
    revision: 2,
    requestId: "correction",
    type: "implemented",
    effectiveAt: "2026-08-30T00:00:00Z",
    details: "Earlier execution",
  });
  await check(observation);
  expect(actions.feedback(scope, id)).toEqual([]);
});
it("makes paused/corrected execution invalidate in-flight feedback without deleting the original receipt", async () => {
  await checkActionFeedback(
    metadata,
    reports,
    actions.get(scope, id),
    new Date("2026-09-05"),
    vi.fn().mockResolvedValue(observation),
  );
  const run = reports.get("p", actions.feedback(scope, id)[0]!.runId);
  actions.record(scope, id, {
    revision: 2,
    requestId: "pause",
    type: "paused",
    effectiveAt: "2026-09-05T00:00:00Z",
    details: "Paused for maintenance",
  });
  expect(() =>
    assertActionFeedbackCurrent(metadata, run.actionFeedback!, scope),
  ).toThrow("EXECUTION_CHANGED");
  expect(actions.feedback(scope, id)).toHaveLength(1);
});
it("preserves a frozen baseline instead of replacing it with a newer snapshot", () => {
  actions.freezeBaseline(scope, id, { ...baseline, snapshotId: "changed" });
  expect(actions.baseline(scope, id)).toEqual(baseline);
});
it("aggregates full Singapore days but rejects gaps, duplicate intervals, bad quality and unrelated meters", () => {
  const start = Date.parse("2026-09-01T00:00:00+08:00");
  const rows: Interval[] = Array.from({ length: 96 }, (_, i) => ({
    meterId: "led",
    startMs: start + i * 900000,
    endMs: start + (i + 1) * 900000,
    kwh: 0.25,
    quality: "ok",
  }));
  const period = { from: "2026-09-01", toExclusive: "2026-09-02" };
  expect(actionDays(rows, period, "led", "Asia/Singapore")[0]).toMatchObject({
    kwh: 24,
    criticalGap: false,
  });
  for (const broken of [
    rows.slice(1),
    [...rows, rows[0]!],
    rows.map((r) => ({ ...r, quality: "gap" })),
    rows.map((r) => ({ ...r, meterId: "other" })),
  ])
    expect(
      actionDays(broken, period, "led", "Asia/Singapore")[0]?.criticalGap,
    ).toBe(true);
});

it("retries a failed stage once per request, preserves evidence, and prevents generic retry from losing private scope", async () => {
  await checkActionFeedback(
    metadata,
    reports,
    actions.get(scope, id),
    new Date("2026-09-05"),
    vi.fn().mockResolvedValue(observation),
  );
  const run = reports.get("p", actions.feedback(scope, id)[0]!.runId);
  reports.claim();
  reports.finish({ ...run, status: "failed" });
  expect(() => reports.resume("p", run.id, "admin")).toThrow(
    "REPORT_ACTION_RETRY_REQUIRED",
  );
  const retry = retryActionFeedback(metadata, reports, scope, id, run.id);
  expect(retry.actionFeedback).toEqual(run.actionFeedback);
  expect(retryActionFeedback(metadata, reports, scope, id, run.id).id).toBe(
    retry.id,
  );
  expect(actions.feedback(scope, id)[0]).toMatchObject({
    runId: retry.id,
    previousRunIds: [run.id],
  });
  expect(() =>
    retryActionFeedback(metadata, reports, scope, id, retry.id),
  ).toThrow("ACTION_RETRY_NOT_READY");
});
it("runs actual input preparation and report acceptance, links owner-only output and hides it from the shared library", async () => {
  await checkActionFeedback(
    metadata,
    reports,
    actions.get(scope, id),
    new Date("2026-09-05"),
    vi.fn().mockResolvedValue(observation),
  );
  const run = reports.get("p", actions.feedback(scope, id)[0]!.runId);
  const sourceDir = join(
    root,
    "runs",
    run.actionFeedback!.sourceReportId,
    "outputs",
  );
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    join(sourceDir, "report.html"),
    "<html><body>Original energy report</body></html>",
  );
  let invoked = false;
  const service = new ReportService({
    metadata,
    root: join(root, "runs"),
    files: {} as FileAssetService,
    harness: async ({ directory }) => {
      const receipt = JSON.parse(
        readFileSync(join(directory, "inputs", "action-feedback.json"), "utf8"),
      );
      const manifest = JSON.parse(
        readFileSync(join(directory, "inputs", "manifest.json"), "utf8"),
      );
      expect(receipt.assessment.observedDifferenceKwh).toBe(36);
      expect(manifest.dataAvailability).toBe("frozen_action_evidence");
      invoked = true;
      writeFileSync(
        join(directory, "outputs", "report.html"),
        "<html><body><h1>Action follow-up</h1><p>Observed difference: 36 kWh. Not verified causal savings.</p></body></html>",
      );
      return { answer: "Feedback ready" };
    },
  });
  registerReportService(metadata, service);
  service.start();
  try {
    await vi.waitFor(() =>
      expect(service.store.get("p", run.id).status).toBe("succeeded"),
    );
    expect(invoked).toBe(true);
    const call = async (userId: string, path: string[], library = false) => {
      const r = Readable.from([]) as IncomingMessage;
      r.method = "GET";
      r.url = "/";
      const c = {
        metadataStore: metadata,
        workspaceId: "w",
        userId,
      } as Required<ConfigApiContext>;
      return (library ? handleReportLibraryApi : handleActionApi)(r, path, c);
    };
    vi.stubEnv("ENERGYIQ_ACTIONS_PILOT_ENABLED", "true");
    expect((await call("admin", ["p", id, "feedback", run.id])).status).toBe(
      200,
    );
    expect((await call("admin", ["p", "output", run.id], true)).status).toBe(
      404,
    );
    const sourceRequest = Readable.from([]) as IncomingMessage;
    sourceRequest.method = "GET";
    sourceRequest.url = `/?reportId=${run.id}`;
    expect(
      (
        await handleActionApi(sourceRequest, ["p"], {
          metadataStore: metadata,
          workspaceId: "w",
          userId: "admin",
        } as Required<ConfigApiContext>)
      ).status,
    ).toBe(404);

    metadata.users.createPasswordUser({
      id: "other",
      email: "other@test.invalid",
    });
    metadata.energyIq.upsertUserRole({ user_id: "other", role: "admin" });
    expect((await call("other", ["p", id, "feedback", run.id])).status).toBe(
      404,
    );
    actions.record(scope, id, {
      revision: 2,
      requestId: "paused",
      type: "paused",
      effectiveAt: "2026-09-05T00:00:00Z",
      details: "No longer applied",
    });
    const historical = await call("admin", ["p", id, "feedback", run.id]);
    expect(historical.status).toBe(200);
    expect(JSON.stringify(historical.body)).toContain('"historical":true');
    expect((await call("other", ["p", id, "feedback", run.id])).status).toBe(
      404,
    );
  } finally {
    await service.stop();
  }
});

it("automatically detects new complete readings and retries failures with bounded persisted backoff", async () => {
  const read = vi.fn().mockResolvedValue({ ...observation, days: [] });
  await sweepActionFeedback(metadata, reports, new Date("2026-09-05"), read);
  expect(actions.feedback(scope, id)).toHaveLength(0);
  expect(actions.check(scope, id)).toMatchObject({ status: "waiting_data" });
  read.mockResolvedValue(observation);
  await sweepActionFeedback(metadata, reports, new Date("2026-09-05"), read);
  const first = actions.feedback(scope, id)[0]!;
  expect(first.stage).toBe("initial");
  reports.claim();
  reports.finish({
    ...reports.get("p", first.runId),
    status: "failed",
    errorCode: "REPORT_GENERATION_FAILED",
  });
  const firstEnd = Date.parse(reports.get("p", first.runId).finishedAt!);
  await sweepActionFeedback(
    metadata,
    reports,
    new Date(firstEnd + 30_000),
    read,
  );
  expect(actions.check(scope, id)).toMatchObject({ status: "retry_scheduled" });
  await sweepActionFeedback(
    metadata,
    reports,
    new Date(firstEnd + 60_001),
    read,
  );
  const retry = actions.feedback(scope, id)[0]!;
  expect(retry.previousRunIds).toEqual([first.runId]);
  await sweepActionFeedback(
    metadata,
    reports,
    new Date(firstEnd + 60_002),
    read,
  );
  expect(actions.feedback(scope, id)[0]!.runId).toBe(retry.runId);
  reports.claim();
  reports.finish({
    ...reports.get("p", retry.runId),
    status: "failed",
    errorCode: "REPORT_GENERATION_FAILED",
  });
  const retryEnd = Date.parse(reports.get("p", retry.runId).finishedAt!);
  await sweepActionFeedback(
    metadata,
    reports,
    new Date(retryEnd + 300_001),
    read,
  );
  const last = actions.feedback(scope, id)[0]!;
  expect(last.previousRunIds).toHaveLength(2);
  reports.claim();
  reports.finish({
    ...reports.get("p", last.runId),
    status: "failed",
    errorCode: "REPORT_GENERATION_FAILED",
  });
  await sweepActionFeedback(
    metadata,
    reports,
    new Date(retryEnd + 900_000),
    read,
  );
  expect(actions.check(scope, id)).toMatchObject({ status: "retry_exhausted" });
  expect(actions.feedback(scope, id)[0]!.runId).toBe(last.runId);
});
it("allows a member's bounded feedback on a shared report without granting chat or copying private author context", async () => {
  vi.stubEnv("ENERGYIQ_ACTIONS_CUSTOMER_ENABLED", "true");
  metadata.users.createPasswordUser({
    id: "member",
    email: "member@test.invalid",
  });
  metadata.workspaceMemberships.upsert({
    workspace_id: "w",
    user_id: "member",
    role: "member",
  });
  const member = { ...scope, userId: "member" };
  const original = actions.get(scope, id);
  const a = actions.create(member, {
    sourceReportId: original.sourceReportId,
    title: "Member follow-up",
    recommendation: "Switch off",
    meterIds: ["led"],
    baseline: original.baseline,
    idempotencyKey: "member",
  });
  actions.freezeBaseline(member, a.id, baseline);
  const implemented = actions.record(member, a.id, {
    revision: 1,
    requestId: "m",
    type: "implemented",
    effectiveAt: "2026-09-01T19:00:00+08:00",
    details: "Member recorded execution",
  });
  await checkActionFeedback(
    metadata,
    reports,
    implemented,
    new Date("2026-09-05"),
    vi.fn().mockResolvedValue(observation),
  );
  const run = reports.get("p", actions.feedback(member, a.id)[0]!.runId);
  expect(run.actorUserId).toBe("member");
  expect(run.parentRunId).toBeUndefined();
  expect(run.settings.fileRefIds).toEqual([]);
  expect(run.settings.skillRefs).toEqual([]);
  const service = new ReportService({
    metadata,
    files: {} as FileAssetService,
    root: join(root, "member-runs"),
    actionEvidenceReader: vi.fn().mockResolvedValue(observation),
    harness: async ({ directory, previousStateDirectory }) => {
      expect(previousStateDirectory).toBeUndefined();
      expect(
        readFileSync(join(directory, "inputs/creation-notes.json"), "utf8"),
      ).toBe("[]");
      writeFileSync(
        join(directory, "outputs/report.html"),
        "<html><body>Observed difference, not causal savings.</body></html>",
      );
      return { answer: "Feedback ready" };
    },
  });
  service.start();
  try {
    await vi.waitFor(() =>
      expect(service.store.get("p", run.id).status).toBe("succeeded"),
    );
    metadata.users.setDisabled({ user_id: "member", disabled: true });
    expect(() =>
      assertActionFeedbackCurrent(metadata, run.actionFeedback!, member),
    ).toThrow("REPORT_ACTION_ACCESS_FORBIDDEN");
  } finally {
    await service.stop();
  }
});

it("never automatically retries a cancelled report and rechecks revoked membership", async () => {
  const read = vi.fn().mockResolvedValue(observation);
  await sweepActionFeedback(metadata, reports, new Date("2026-09-05"), read);
  const runId = actions.feedback(scope, id)[0]!.runId;
  reports.cancel("p", runId);
  await sweepActionFeedback(metadata, reports, new Date("2026-09-06"), read);
  expect(actions.feedback(scope, id)[0]!.runId).toBe(runId);
  expect(reports.get("p", runId).status).toBe("cancelled");
  metadata.energyIq.upsertUserRole({ user_id: "admin", role: "user" });
  await sweepActionFeedback(metadata, reports, new Date("2026-09-07"), read);
  expect(actions.check(scope, id)).toMatchObject({ status: "check_failed" });
});
it("dispatches feedback automatically when published snapshot changes without a check endpoint call", async () => {
  let available = false;
  const read = vi.fn(async () => ({
    ...observation,
    days: available ? observation.days : [],
  }));
  const service = new ReportService({
    metadata,
    files: {} as FileAssetService,
    root: join(root, "sweep-runs"),
    actionEvidenceReader: read,
    harness: async ({ directory }) => {
      writeFileSync(
        join(directory, "outputs/report.html"),
        "<html><body>Observed change is not proof of savings.</body></html>",
      );
      return { answer: "Ready" };
    },
  });
  service.start();
  try {
    await vi.waitFor(() =>
      expect(actions.check(scope, id)).toMatchObject({
        status: "waiting_data",
      }),
    );
    available = true;
    metadata.energyIq.upsertProject({
      ...metadata.energyIq.getProject("p"),
      data_snapshot_id: "new-complete-snapshot",
    });
    await service.tick();
    await vi.waitFor(() => expect(actions.feedback(scope, id)).toHaveLength(1));
    const runId = actions.feedback(scope, id)[0]!.runId;
    await vi.waitFor(() =>
      expect(reports.get("p", runId).status).toBe("succeeded"),
    );
    await service.tick();
    expect(actions.feedback(scope, id)).toHaveLength(1);
    await sweepActionFeedback(metadata, reports, new Date(), read);
    expect(actions.check(scope, id)).toMatchObject({
      status: "waiting_data",
      comparableDays: 3,
    });
  } finally {
    await service.stop();
  }
});
