import { LocalDataGateway } from "@datafoundry/data-gateway";
import { reportTimeBasisFromContext } from "@datafoundry/contracts";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import {
  ensureEnergyIqBootstrap,
  PRESCHOOL_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";
import {
  createOverviewAiArtifactIdentity,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
  createPreschoolOverviewAiValueArtifactIdentity,
} from "./overview-ai-artifact.js";
import { materializePreschoolGoldenFixture } from "./preschool-golden.fixture.js";
import {
  composePreschoolOverviewAiReadModel,
  composePreschoolOverviewAiReadModelV3,
} from "./preschool-overview-ai-read-model.js";
import { preschoolOverviewAiBindingFromIdentity } from "./preschool-overview-ai-contracts.js";

describe("saved analysis decision-quality boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects low-coverage creation and rerun before either result is persisted", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-saved-analysis-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      vi.stubEnv("ENERGYIQ_DUCKDB_PATH", databasePath);
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const templateRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({ metadataStore: metadata, projectId: project.id, hierarchyRevisionId: project.hierarchy_revision_id, scopeId: project.root_scope_id, resource: "electricity" }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-04T00:00:00.000Z",
      });
      const query = {
        projectId: project.id,
        scopeId: "project",
        resource: "electricity",
        period: "Custom",
        from: "2026-05-01",
        to: "2026-05-31",
      } as const;
      const previous = metadata.energyIq.savedAnalyses.create({
        id: "saved-analysis-low-coverage-seed",
        series_id: "saved-analysis-low-coverage-series",
        project_id: project.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        scope_id: "preschool-project",
        scope_name: "Preschool Portfolio",
        resource: "electricity",
        title: "Seed only",
        query_json: JSON.stringify(query),
        analysis_json: JSON.stringify({ dataHealth: { coveragePct: 3.2258 } }),
        template_revision_id: templateRevision.revision_id,
        data_snapshot_id: project.data_snapshot_id,
        created_by: "dev-user",
      });
      const context = {
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      } as Required<ConfigApiContext>;

      const creation = await handleEnergyApiRequest(
        jsonPost(query),
        ["projects", project.id, "saved-analyses"],
        context,
      );
      const rerun = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "saved-analyses", previous.id, "rerun"],
        context,
      );

      for (const response of [creation, rerun]) {
        expect(response).toMatchObject({
          status: 400,
          body: {
            success: false,
            error: {
              code: "BAD_REQUEST",
              message: "ENERGYIQ_DECISION_COVERAGE_REQUIRED",
            },
          },
        });
      }
      expect(metadata.energyIq.savedAnalyses.listProject(project.id).map((item) => item.id))
        .toEqual([previous.id]);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("creates and reruns Saved Analysis through the published Project Release", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-saved-analysis-release-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      vi.stubEnv("ENERGYIQ_DUCKDB_PATH", databasePath);
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const templateRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({ metadataStore: metadata, projectId: project.id, hierarchyRevisionId: project.hierarchy_revision_id, scopeId: project.root_scope_id, resource: "electricity" }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-04T00:00:00.000Z",
      });
      metadata.energyIq.upsertProject({
        ...project,
        hierarchy_revision_id: "unpublished-hierarchy-drift",
        meter_formula_revision_id: "unpublished-meter-formula-drift",
        metric_version: "unpublished-metric-drift",
        business_calendar_version: "unpublished-calendar-drift",
        tariff_schedule_version: "unpublished-tariff-drift",
      });
      const query = {
        projectId: project.id,
        scopeId: "project",
        resource: "electricity",
        period: "Custom",
        from: "2026-05-01",
        to: "2026-05-01",
        viewState: {
          grain: "day",
          comparison: "selected",
          category: "load",
        },
        aiArtifact: {
          contract: "energyiq-saved-ai-result@1",
          rendererKey: "preschool-overview",
          snapshotId: project.data_snapshot_id,
          projectReleaseId: templateRevision.revision_id,
          result: {
            status: "available",
            providerProfileId: "profile-test",
            runId: "saved-analysis-ai-editor-run-v1",
            packId: "preschool-analysis-pack",
            packRevision: "v1",
            contract: { id: "preschool-ai-accepted-artifact", revision: "v13" },
            binding: {
              projectId: project.id,
              scopeId: project.root_scope_id,
              dataSnapshotId: project.data_snapshot_id,
              projectReleaseId: templateRevision.revision_id,
              dataCutoff: "2026-05-01T16:00:00.000Z",
              analysisPeriod: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-01T16:00:00.000Z" },
              outputContractRevision: "v13",
            },
            workflow: {
              id: "preschool-two-stage",
              revision: "preschool-two-stage-v2",
              methodSkill: { id: "energy-insight-investigation", revision: "1.0.0" },
              stages: {
                investigator: { runId: "saved-analysis-ai-investigator-run-v1", promptRevision: "preschool-investigator-v11" },
                editor: { runId: "saved-analysis-ai-editor-run-v1", promptRevision: "preschool-insight-editor-v5" },
              },
            },
            findings: [{
              id: "finding-v1",
              binding: {
                projectId: project.id,
                scopeId: project.root_scope_id,
                dataSnapshotId: project.data_snapshot_id,
                projectReleaseId: templateRevision.revision_id,
                dataCutoff: "2026-05-01T16:00:00.000Z",
                analysisPeriod: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-01T16:00:00.000Z" },
                outputContractRevision: "v13",
              },
              placementTargets: ["preschool.benchmark"],
              epistemicLevel: "verified",
              relationship: "supports",
              signalRefs: ["efficiency"],
              title: "Benchmark priority needs investigation",
              takeaway: "The current Snapshot supports a focused operating review.",
              action: "Review the priority Centre with its local operator.",
              expectedIfAct: "The next review will isolate the operating driver.",
              ifIgnored: "The priority condition may continue without an owner.",
              uncertainty: "The pinned evidence does not establish a cause.",
              evidence: {
                snapshotId: project.data_snapshot_id,
                period: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-01T16:00:00.000Z" },
                deterministic: [{
                  id: "benchmark:priority-centre:G",
                  kind: "benchmark",
                  label: "Priority Centre benchmark",
                  unit: "kWh",
                  values: { usageKwh: 843.0985 },
                  queryIds: ["benchmark-query"],
                  limitation: null,
                }],
                tools: [],
              },
              presentation: {
                version: "1",
                blocks: [
                  {
                    type: "metric",
                    label: "Priority score",
                    value: 843.1,
                    unit: "kWh",
                    evidenceRefs: ["benchmark:priority-centre:G"],
                  },
                  {
                    type: "metric",
                    label: "Unbound score",
                    value: 999,
                    unit: "kWh",
                    evidenceRefs: ["benchmark:not-cited"],
                  },
                  { type: "html", value: "<script>unsafe()</script>" },
                ],
              },
            }],
          },
        },
      } as const;
      metadata.sessions.create({ user_id: "dev-user", id: "saved-analysis-ai-session-v1", title: "Saved AI v1" });
      for (const runId of [
        query.aiArtifact.result.workflow.stages.investigator.runId,
        query.aiArtifact.result.workflow.stages.editor.runId,
      ]) {
        metadata.runs.create({
          id: runId,
          user_id: "dev-user",
          session_id: "saved-analysis-ai-session-v1",
          status: "running",
          user_input: `Snapshot ${project.data_snapshot_id}; Release ${templateRevision.revision_id}`,
          model_provider: "openai-compatible",
          model_name: "test-model-v1",
          request_fingerprint: "request-fingerprint-v1",
        });
        metadata.runs.updateStatus({
          user_id: "dev-user",
          run_id: runId,
          status: "completed",
        });
      }
      const context = {
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      } as Required<ConfigApiContext>;

      const creation = await handleEnergyApiRequest(
        jsonPost(query),
        ["projects", project.id, "saved-analyses"],
        context,
      );
      expect(creation.status, JSON.stringify(creation.body)).toBe(201);
      expect(creation.body).toMatchObject({
        success: true,
        data: {
          viewState: query.viewState,
          aiArtifact: {
            rendererKey: "preschool-overview",
            snapshotId: project.data_snapshot_id,
            projectReleaseId: templateRevision.revision_id,
            result: {
              runId: query.aiArtifact.result.runId,
              findings: [{
                presentation: {
                  version: "1",
                  blocks: [{
                    type: "metric",
                    label: "Priority score",
                    evidenceRefs: ["benchmark:priority-centre:G"],
                  }],
                },
              }],
            },
            runProvenance: {
              modelProvider: "openai-compatible",
              modelName: "test-model-v1",
              requestFingerprint: "request-fingerprint-v1",
              contextSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            },
          },
          snapshot: {
            renderer: { key: "preschool-overview" },
            dataSnapshot: { id: project.data_snapshot_id },
          },
        },
      });
      const comparisonCandidates = await handleEnergyApiRequest(
        getRequest(),
        ["projects", project.id, "saved-analyses", "overview-comparison-candidates"],
        context,
      );
      expect(comparisonCandidates.status, JSON.stringify(comparisonCandidates.body)).toBe(200);
      expect(comparisonCandidates.body).toMatchObject({
        success: true,
        data: {
          items: [{
            id: expect.any(String),
            dataSnapshotId: project.data_snapshot_id,
            analysis: {
              summary: {
                usageKwh: expect.any(Number),
                averageDailyUsageKwh: expect.any(Number),
                peakKw: expect.any(Number),
              },
            },
            snapshot: {
              context: {
                projectId: project.id,
                scopeId: project.root_scope_id,
                primaryPeriod: {
                  start: expect.any(String),
                  endExclusive: expect.any(String),
                },
              },
              dataSnapshot: { id: project.data_snapshot_id },
              projectRelease: { id: templateRevision.revision_id },
              renderer: { key: "preschool-overview" },
            },
            aiArtifact: {
              snapshotId: project.data_snapshot_id,
              projectReleaseId: templateRevision.revision_id,
            },
          }],
        },
      });
      const comparisonPayload = JSON.stringify(comparisonCandidates.body);
      expect(comparisonPayload).not.toContain("childScopes");
      expect(comparisonPayload).not.toContain("catalog");
      const first = metadata.energyIq.savedAnalyses.listProject(project.id)[0];
      expect(first?.template_revision_id).toBe(templateRevision.revision_id);
      const frozenAnalysisJson = first?.analysis_json;
      const frozenSnapshotJson = first?.snapshot_json;
      const frozenAiResultJson = first?.ai_result_json;
      expect(frozenAiResultJson).toContain(query.aiArtifact.result.runId);
      expect(frozenAiResultJson).not.toContain("benchmark:not-cited");
      expect(frozenAiResultJson).not.toContain("<script>");
      const firstAnalysis = JSON.parse(first?.analysis_json ?? "null") as {
        context: Record<string, unknown>;
        provenance: Record<string, unknown>;
        cost: Record<string, unknown>;
        offHours: Record<string, unknown>;
      };
      expect(firstAnalysis.context).toMatchObject({
        hierarchyRevisionId: templateRevision.hierarchy_revision_id,
        meterFormulaRevisionId: templateRevision.meter_formula_revision_id,
        businessCalendarVersion: templateRevision.business_calendar_version,
        tariffScheduleVersion: templateRevision.tariff_schedule_version,
      });
      expect(firstAnalysis.provenance).toMatchObject({
        hierarchyRevisionId: templateRevision.hierarchy_revision_id,
        meterFormulaRevisionId: templateRevision.meter_formula_revision_id,
      });
      expect(firstAnalysis.cost).toMatchObject({
        tariffScheduleVersion: templateRevision.tariff_schedule_version,
      });
      expect(firstAnalysis.offHours).toMatchObject({
        businessCalendarVersion: templateRevision.business_calendar_version,
      });

      metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "preschool-tariff-v2",
        project_id: project.id,
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "preschool-tariff-v2-flat",
          owner: { kind: "project" },
          effective_from: "2026-04-30T16:00:00.000Z",
          effective_to: "2026-05-01T16:00:00.000Z",
          currency: "SGD",
          rate_per_kwh: 0.5,
        }],
      });
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "preschool-calendar-v2",
        project_id: project.id,
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "preschool-calendar-v2-full-day",
          owner: { kind: "project" },
          effective_from: "2026-05-01",
          effective_to: "2026-05-02",
          weekly: allDays("00:00", "24:00"),
        }],
      });
      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: project.id,
        user_id: "dev-user",
      });
      const publishedV2 = metadata.energyIq.projectSetup.publishDraft({
        project_id: project.id,
        expected_revision: draft.revision,
        user_id: "dev-user",
      });
      const publishedV2Hierarchy = metadata.energyIq.projectSetup.listHierarchyRevisions(project.id)
        .find((revision) => revision.id === publishedV2.hierarchy_revision_id);
      const publishedV2Document = JSON.parse(publishedV2Hierarchy?.snapshot_json ?? "null") as {
        meter_mapping?: { schema_version?: number; confirmed?: boolean; official_aggregation_routes?: unknown[] };
      };
      expect(publishedV2Document.meter_mapping).toMatchObject({
        schema_version: 2,
        confirmed: true,
      });
      expect(publishedV2Document.meter_mapping?.official_aggregation_routes?.length).toBeGreaterThan(0);

      const rerun = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "saved-analyses", first?.id ?? "", "rerun"],
        context,
      );
      expect(rerun.status, JSON.stringify(rerun.body)).toBe(201);
      expect(rerun.body).toMatchObject({
        success: true,
        data: {
          rerunOfId: first?.id,
          viewState: query.viewState,
          snapshot: { renderer: { key: "preschool-overview" } },
        },
      });
      const records = metadata.energyIq.savedAnalyses.listProject(project.id);
      expect(records).toHaveLength(2);
      expect(records[0]).toMatchObject({
        series_id: first?.series_id,
        sequence: 2,
        rerun_of_id: first?.id,
        template_revision_id: publishedV2.template_revision_id,
      });
      expect(records.find((record) => record.id === first?.id)?.analysis_json).toBe(frozenAnalysisJson);
      expect(records.find((record) => record.id === first?.id)?.snapshot_json).toBe(frozenSnapshotJson);
      expect(records.find((record) => record.id === first?.id)?.ai_result_json).toBe(frozenAiResultJson);
      expect(records[0]?.ai_result_json).toBeUndefined();

      const comparisonCandidatesAfterRerun = await handleEnergyApiRequest(
        getRequest(),
        ["projects", project.id, "saved-analyses", "overview-comparison-candidates"],
        context,
      );
      expect(comparisonCandidatesAfterRerun.status, JSON.stringify(comparisonCandidatesAfterRerun.body)).toBe(200);
      const comparisonCandidateItems = (comparisonCandidatesAfterRerun.body as {
        data: { items: Array<{ id: string; snapshot: { reportTimeContext?: unknown } }> };
      }).data.items;
      expect(comparisonCandidateItems.find((candidate) => candidate.id === first?.id)?.snapshot.reportTimeContext)
        .toMatchObject({
          policyId: expect.any(String),
          policyRevision: expect.any(String),
          windows: expect.any(Array),
        });

      metadata.sessions.create({ user_id: "dev-user", id: "saved-analysis-ai-session-v2", title: "Saved AI v2" });
      for (const runId of ["saved-analysis-ai-section-run-v2", "saved-analysis-ai-executive-run-v2"]) {
        metadata.runs.create({
          id: runId,
          user_id: "dev-user",
          session_id: "saved-analysis-ai-session-v2",
          status: "running",
          user_input: `Snapshot ${project.data_snapshot_id}; Release ${publishedV2.template_revision_id}`,
          model_provider: "openai-compatible",
          model_name: "test-model-v2",
          request_fingerprint: "request-fingerprint-v2",
        });
        metadata.runs.updateStatus({
          user_id: "dev-user",
          run_id: runId,
          status: "completed",
        });
      }
      const bindingV2 = {
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: project.id,
        scopeId: project.root_scope_id,
        dataSnapshotId: project.data_snapshot_id,
        projectReleaseId: publishedV2.template_revision_id,
        analysisPeriod: { from: "2026-04-30T16:00:00.000Z", to: "2026-05-01T16:00:00.000Z" },
        modelProfileId: "workspace-default-model-profile",
        modelProfileRevision: 1,
      } as const;
      const aiArtifactV2 = {
        contract: "energyiq-saved-ai-result@2",
        rendererKey: "preschool-overview",
        snapshotId: project.data_snapshot_id,
        projectReleaseId: publishedV2.template_revision_id,
        result: {
          artifactKind: "preschool-overview-ai-read-model",
          status: "available",
          binding: bindingV2,
          sections: {
            "centre-benchmark": {
              status: "available",
              artifactId: "section-benchmark-v2",
              result: {
                artifactKind: "section-interpretation",
                status: "available",
                providerProfileId: bindingV2.modelProfileId,
                runId: "saved-analysis-ai-section-run-v2",
                binding: bindingV2,
                sectionId: "centre-benchmark",
                summary: "Benchmark evidence supports a focused operating review.",
                keyPoints: [{
                  kind: "next-check",
                  text: "Review schedules before assigning a cause.",
                  evidenceRefs: ["evidence:benchmark"],
                }],
              },
            },
            "standby-wastage": { status: "unavailable", reason: "Section interpretation failed." },
            "operating-behaviour": { status: "unavailable", reason: "Section interpretation was not generated." },
            "planning-outlook": { status: "unavailable", reason: "Section interpretation was not generated." },
          },
          executive: {
            status: "available",
            artifactId: "executive-v2",
            result: {
              artifactKind: "executive-synthesis",
              status: "available",
              providerProfileId: bindingV2.modelProfileId,
              runId: "saved-analysis-ai-executive-run-v2",
              binding: bindingV2,
              sourceSectionArtifactIds: ["section-benchmark-v2"],
              keyFindings: [{
                id: "executive-finding-v2",
                takeaway: "Benchmark evidence supports a focused operating review.",
                sectionIds: ["centre-benchmark"],
                evidenceRefs: ["evidence:benchmark"],
              }],
            },
          },
        },
      } as const;
      const mismatchedAttachment = await handleEnergyApiRequest(
        jsonPost({ aiArtifact: { ...aiArtifactV2, snapshotId: "different-snapshot" } }),
        ["projects", project.id, "saved-analyses", records[0]?.id ?? "", "ai-result"],
        context,
      );
      expect(mismatchedAttachment).toMatchObject({
        status: 400,
        body: { success: false, error: { message: "ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID" } },
      });
      expect(metadata.energyIq.savedAnalyses.get(records[0]?.id ?? "").ai_result_json).toBeUndefined();
      const forgedAttachment = await handleEnergyApiRequest(
        jsonPost({ aiArtifact: aiArtifactV2 }),
        ["projects", project.id, "saved-analyses", records[0]?.id ?? "", "ai-result"],
        context,
      );
      expect(forgedAttachment).toMatchObject({
        status: 400,
        body: { success: false, error: { message: "ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID" } },
      });
      expect(metadata.energyIq.savedAnalyses.get(records[0]?.id ?? "").ai_result_json).toBeUndefined();

      const frozenSnapshotV2 = JSON.parse(records[0]?.snapshot_json ?? "null") as {
        renderer: { key: string; version: string };
        reportTimeContext: Parameters<typeof reportTimeBasisFromContext>[0];
      };
      const reportTimeBasisV2 = reportTimeBasisFromContext(frozenSnapshotV2.reportTimeContext);
      const baseIdentityV2 = createOverviewAiArtifactIdentity({
        workspaceId: bindingV2.workspaceId,
        projectId: bindingV2.projectId,
        scopeId: bindingV2.scopeId,
        dataSnapshotId: bindingV2.dataSnapshotId,
        projectReleaseId: bindingV2.projectReleaseId,
        analysisPeriodFrom: bindingV2.analysisPeriod.from,
        analysisPeriodTo: bindingV2.analysisPeriod.to,
        rendererKey: frozenSnapshotV2.renderer.key,
        rendererVersion: frozenSnapshotV2.renderer.version,
        modelProfileId: bindingV2.modelProfileId,
        modelProfileRevision: bindingV2.modelProfileRevision,
        reportTimeBasis: reportTimeBasisV2,
      });
      const artifactStore = metadata.energyIq.overviewAiArtifacts;
      const sectionIdentityV2 = createPreschoolOverviewAiSectionArtifactIdentityV4({
        baseIdentity: baseIdentityV2,
        targetId: "centre-benchmark",
      });
      const sectionArtifactV2 = artifactStore.queue({ identity: sectionIdentityV2, triggeredBy: "dev-user" });
      artifactStore.claim({ identity: sectionIdentityV2, workerId: "saved-analysis-section-worker-v2", leaseMs: 60_000 });
      artifactStore.complete({
        identity: sectionIdentityV2,
        workerId: "saved-analysis-section-worker-v2",
        sessionId: "saved-analysis-ai-session-v2",
        runId: "saved-analysis-ai-section-run-v2",
        resultJson: JSON.stringify({
          artifactKind: "section-interpretation",
          status: "available",
          providerProfileId: sectionIdentityV2.modelProfileId,
          runId: "saved-analysis-ai-section-run-v2",
          contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v4" },
          binding: preschoolOverviewAiBindingFromIdentity(sectionIdentityV2),
          sectionId: "centre-benchmark",
          packRevision: "v2",
          capability: {
            revision: "scoped-read-only-v1",
            mode: "scoped-read-only",
            tools: ["compare_centres", "inspect_related_section_signals"],
          },
          toolAudits: [],
          summary: {
            text: "Benchmark evidence supports a focused operating review.",
            evidenceRefs: ["evidence:benchmark"],
          },
          insights: [],
          publication: {
            policyId: "preschool-section-publication",
            policyRevision: "v1",
            discoveredCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            publishedCount: 0,
            suppressedCandidateIds: [],
          },
        }),
      });
      const canonicalResultV2 = composePreschoolOverviewAiReadModel({
        metadataStore: metadata,
        baseIdentity: baseIdentityV2,
      });
      expect(canonicalResultV2).not.toBeNull();
      const canonicalArtifactV2 = {
        ...aiArtifactV2,
        reportTimeBasis: reportTimeBasisV2,
        result: canonicalResultV2,
      };
      const attached = await handleEnergyApiRequest(
        jsonPost({ aiArtifact: canonicalArtifactV2 }),
        ["projects", project.id, "saved-analyses", records[0]?.id ?? "", "ai-result"],
        context,
      );
      expect(attached).toMatchObject({
        status: 200,
        body: { success: true, data: { aiArtifact: { result: canonicalResultV2 } } },
      });
      const canonicalStoredAiResult = metadata.energyIq.savedAnalyses.get(records[0]?.id ?? "").ai_result_json;
      expect(canonicalStoredAiResult).toContain(sectionArtifactV2.id);

      const tamperedResultV2 = JSON.parse(JSON.stringify(canonicalResultV2)) as NonNullable<typeof canonicalResultV2>;
      const tamperedSection = tamperedResultV2.sections["centre-benchmark"];
      if (tamperedSection.status !== "available") throw new Error("canonical Section fixture missing");
      const tamperedSummary = tamperedSection.result.summary;
      if (!tamperedSummary || typeof tamperedSummary === "string") {
        throw new Error("canonical V4 Section Summary fixture missing");
      }
      tamperedSummary.text = "Browser-authored replacement summary.";
      const tamperedAttachment = await handleEnergyApiRequest(
        jsonPost({ aiArtifact: { ...canonicalArtifactV2, result: tamperedResultV2 } }),
        ["projects", project.id, "saved-analyses", records[0]?.id ?? "", "ai-result"],
        context,
      );
      expect(tamperedAttachment).toMatchObject({
        status: 400,
        body: { success: false, error: { message: "ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID" } },
      });
      expect(metadata.energyIq.savedAnalyses.get(records[0]?.id ?? "").ai_result_json).toBe(canonicalStoredAiResult);
      expect(metadata.energyIq.savedAnalyses.get(first?.id ?? "").ai_result_json).toBe(frozenAiResultJson);

      const latestAnalysis = JSON.parse(records[0]?.analysis_json ?? "null") as {
        context: Record<string, unknown>;
        cost: Record<string, unknown>;
        offHours: Record<string, unknown>;
      };
      expect(latestAnalysis.context).toMatchObject({
        tariffScheduleVersion: "preschool-tariff-v2",
        businessCalendarVersion: "preschool-calendar-v2",
      });
      expect(latestAnalysis.cost).toMatchObject({
        status: "available",
        tariffScheduleVersion: "preschool-tariff-v2",
      });
      expect(latestAnalysis.offHours).toMatchObject({
        status: "available",
        operatingKwh: expect.any(Number),
        standbyKwh: 0,
        businessCalendarVersion: "preschool-calendar-v2",
      });
      expect(latestAnalysis.cost).not.toEqual(firstAnalysis.cost);
      expect(latestAnalysis.offHours).not.toEqual(firstAnalysis.offHours);

      metadata.energyIq.upsertProject({
        ...metadata.energyIq.getProject(project.id),
        data_snapshot_id: "missing-current-snapshot",
      });
      const unavailableRerun = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "saved-analyses", first?.id ?? "", "rerun"],
        context,
      );
      expect(unavailableRerun).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: { code: "CONFLICT", message: "ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE" },
        },
      });
      expect(metadata.energyIq.savedAnalyses.listProject(project.id)).toHaveLength(2);
      expect(metadata.energyIq.savedAnalyses.get(first?.id ?? "").analysis_json).toBe(frozenAnalysisJson);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("restores frozen v3 exactly and rejects canonical Saved @2 attachment from another Workspace without a Provider run", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-saved-ai-versioned-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const otherWorkspaceId = "saved-ai-other-workspace";
      metadata.workspaces.upsert({
        id: otherWorkspaceId,
        owner_user_id: "dev-user",
        name: "Other customer workspace",
        kind: "customer",
      });
      metadata.workspaceMemberships.upsertOwner({ workspace_id: otherWorkspaceId, user_id: "dev-user" });
      const project = metadata.energyIq.getProject("preschool-demo");
      const templateRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({
          metadataStore: metadata,
          projectId: project.id,
          hierarchyRevisionId: project.hierarchy_revision_id,
          scopeId: project.root_scope_id,
          resource: "electricity",
        }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-13T00:00:00.000Z",
      });
      const period = { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" };
      const snapshot = {
        context: {
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          projectId: project.id,
          scopeId: project.root_scope_id,
          resource: "electricity",
          dataSnapshotId: project.data_snapshot_id,
          primaryPeriod: { start: period.from, endExclusive: period.to },
        },
        projectRelease: { id: templateRevision.revision_id, templateRevisionId: templateRevision.revision_id },
        renderer: { key: "preschool-overview", version: "1" },
        dataSnapshot: { id: project.data_snapshot_id },
        analysis: { provenance: { dataSnapshotId: project.data_snapshot_id } },
      };
      const saved = metadata.energyIq.savedAnalyses.create({
        id: "saved-analysis-versioned-ai",
        series_id: "saved-analysis-versioned-ai-series",
        project_id: project.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        scope_id: project.root_scope_id,
        scope_name: "Preschool",
        resource: "electricity",
        title: "Versioned AI",
        query_json: JSON.stringify({ projectId: project.id, scopeId: "project", resource: "electricity" }),
        analysis_json: JSON.stringify(snapshot.analysis),
        snapshot_json: JSON.stringify(snapshot),
        template_revision_id: templateRevision.revision_id,
        data_snapshot_id: project.data_snapshot_id,
        created_by: "dev-user",
      });
      metadata.sessions.create({ user_id: "dev-user", id: "saved-ai-version-session", title: "Saved AI versions" });
      for (const runId of ["saved-ai-v3-run", "saved-ai-v4-run"]) {
        metadata.runs.create({
          id: runId,
          user_id: "dev-user",
          session_id: "saved-ai-version-session",
          status: "running",
          user_input: `Snapshot ${project.data_snapshot_id}; Release ${templateRevision.revision_id}`,
          model_provider: "openai-compatible",
          model_name: "saved-ai-test-model",
          request_fingerprint: `fingerprint:${runId}`,
        });
        metadata.runs.updateStatus({ user_id: "dev-user", run_id: runId, status: "completed" });
      }
      const context = {
        metadataStore: metadata,
        dataGateway: {} as LocalDataGateway,
        userId: "dev-user",
        workspaceId: PRESCHOOL_WORKSPACE_ID,
      } as Required<ConfigApiContext>;
      const baseIdentity = createOverviewAiArtifactIdentity({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: project.id,
        scopeId: project.root_scope_id,
        dataSnapshotId: project.data_snapshot_id,
        projectReleaseId: templateRevision.revision_id,
        analysisPeriodFrom: period.from,
        analysisPeriodTo: period.to,
        rendererKey: "preschool-overview",
        rendererVersion: "1",
        modelProfileId: "workspace-default-model-profile",
        modelProfileRevision: 1,
      });
      const artifactStore = metadata.energyIq.overviewAiArtifacts;
      const sectionIdentityV3 = {
        ...baseIdentity,
        artifactKind: "section-interpretation",
        targetId: "centre-benchmark",
        outputContractRevision: "preschool-section-interpretation-v3",
        validatorRevision: "preschool-section-interpreter-validator-v12",
        workflowRevision: "preschool-section-interpreter-v14",
        investigatorPromptRevision: "preschool-section-interpreter-prompt-v14",
        editorPromptRevision: "not-applicable-v1",
        methodSkillId: "none",
        methodSkillRevision: "not-applicable-v1",
      } as const;
      const sectionV3 = artifactStore.queue({ identity: sectionIdentityV3, triggeredBy: "dev-user" });
      artifactStore.claim({ identity: sectionIdentityV3, workerId: "saved-ai-v3-worker", leaseMs: 60_000 });
      artifactStore.complete({
        identity: sectionIdentityV3,
        workerId: "saved-ai-v3-worker",
        sessionId: "saved-ai-version-session",
        runId: "saved-ai-v3-run",
        resultJson: JSON.stringify({
          artifactKind: "section-interpretation",
          status: "available",
          providerProfileId: sectionIdentityV3.modelProfileId,
          runId: "saved-ai-v3-run",
          contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v3" },
          binding: preschoolOverviewAiBindingFromIdentity(sectionIdentityV3),
          sectionId: "centre-benchmark",
          summary: "Frozen v3 summary.",
          keyPoints: [{ kind: "finding", text: "Frozen v3 finding.", evidenceRefs: ["evidence:v3"] }],
        }),
      });
      const canonicalV3 = composePreschoolOverviewAiReadModelV3({ metadataStore: metadata, baseIdentity });
      expect(canonicalV3?.sections["centre-benchmark"]).toMatchObject({ artifactId: sectionV3.id, status: "available" });
      const runCountBeforeAttachments = metadata.runs.listByStatuses({ statuses: ["completed"] }).length;
      const attachV3 = await handleEnergyApiRequest(
        jsonPost({ aiArtifact: {
          contract: "energyiq-saved-ai-result@2",
          rendererKey: "preschool-overview",
          snapshotId: project.data_snapshot_id,
          projectReleaseId: templateRevision.revision_id,
          result: canonicalV3,
        } }),
        ["projects", project.id, "saved-analyses", saved.id, "ai-result"],
        context,
      );
      expect(attachV3).toMatchObject({ status: 200, body: { success: true } });
      expect(metadata.runs.listByStatuses({ statuses: ["completed"] })).toHaveLength(runCountBeforeAttachments);
      const savedV4 = metadata.energyIq.savedAnalyses.create({
        id: "saved-analysis-versioned-ai-v4",
        series_id: "saved-analysis-versioned-ai-v4-series",
        project_id: project.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        scope_id: project.root_scope_id,
        scope_name: "Preschool",
        resource: "electricity",
        title: "Versioned AI v4",
        query_json: JSON.stringify({ projectId: project.id, scopeId: "project", resource: "electricity" }),
        analysis_json: JSON.stringify(snapshot.analysis),
        snapshot_json: JSON.stringify(snapshot),
        template_revision_id: templateRevision.revision_id,
        data_snapshot_id: project.data_snapshot_id,
        created_by: "dev-user",
      });

      const sectionIdentityV4 = createPreschoolOverviewAiSectionArtifactIdentityV4({
        baseIdentity,
        targetId: "centre-benchmark",
      });
      const sectionV4 = artifactStore.queue({ identity: sectionIdentityV4, triggeredBy: "dev-user" });
      artifactStore.claim({ identity: sectionIdentityV4, workerId: "saved-ai-v4-worker", leaseMs: 60_000 });
      artifactStore.complete({
        identity: sectionIdentityV4,
        workerId: "saved-ai-v4-worker",
        sessionId: "saved-ai-version-session",
        runId: "saved-ai-v4-run",
        resultJson: JSON.stringify({
          artifactKind: "section-interpretation",
          status: "available",
          providerProfileId: sectionIdentityV4.modelProfileId,
          runId: "saved-ai-v4-run",
          contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v4" },
          binding: preschoolOverviewAiBindingFromIdentity(sectionIdentityV4),
          sectionId: "centre-benchmark",
          packRevision: "v2",
          capability: {
            revision: "scoped-read-only-v1",
            mode: "scoped-read-only",
            tools: ["compare_centres", "inspect_related_section_signals"],
          },
          toolAudits: [],
          summary: { text: "Canonical v4 summary.", evidenceRefs: ["evidence:v4"] },
          insights: [],
          publication: {
            policyId: "preschool-section-publication",
            policyRevision: "v1",
            discoveredCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            publishedCount: 0,
            suppressedCandidateIds: [],
          },
        }),
      });
      const canonicalV4 = composePreschoolOverviewAiReadModel({ metadataStore: metadata, baseIdentity });
      expect(canonicalV4?.sections["centre-benchmark"]).toMatchObject({ artifactId: sectionV4.id, status: "available" });
      const artifactV4 = {
        contract: "energyiq-saved-ai-result@2",
        rendererKey: "preschool-overview",
        snapshotId: project.data_snapshot_id,
        projectReleaseId: templateRevision.revision_id,
        result: canonicalV4,
      } as const;
      const otherWorkspaceBaseIdentity = { ...baseIdentity, workspaceId: otherWorkspaceId };
      const otherWorkspaceSectionIdentity = { ...sectionIdentityV4, workspaceId: otherWorkspaceId };
      const otherWorkspaceSection = artifactStore.queue({
        identity: otherWorkspaceSectionIdentity,
        triggeredBy: "dev-user",
      });
      artifactStore.claim({
        identity: otherWorkspaceSectionIdentity,
        workerId: "saved-ai-other-workspace-worker",
        leaseMs: 60_000,
      });
      artifactStore.complete({
        identity: otherWorkspaceSectionIdentity,
        workerId: "saved-ai-other-workspace-worker",
        sessionId: "saved-ai-version-session",
        runId: "saved-ai-v4-run",
        resultJson: JSON.stringify({
          artifactKind: "section-interpretation",
          status: "available",
          providerProfileId: otherWorkspaceSectionIdentity.modelProfileId,
          runId: "saved-ai-v4-run",
          contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v4" },
          binding: preschoolOverviewAiBindingFromIdentity(otherWorkspaceSectionIdentity),
          sectionId: "centre-benchmark",
          packRevision: "v2",
          capability: {
            revision: "scoped-read-only-v1",
            mode: "scoped-read-only",
            tools: ["compare_centres", "inspect_related_section_signals"],
          },
          toolAudits: [],
          summary: { text: "Canonical summary from another Workspace.", evidenceRefs: ["evidence:v4"] },
          insights: [],
          publication: {
            policyId: "preschool-section-publication",
            policyRevision: "v1",
            discoveredCount: 0,
            acceptedCount: 0,
            rejectedCount: 0,
            publishedCount: 0,
            suppressedCandidateIds: [],
          },
        }),
      });
      const otherWorkspaceCanonical = composePreschoolOverviewAiReadModel({
        metadataStore: metadata,
        baseIdentity: otherWorkspaceBaseIdentity,
      });
      expect(otherWorkspaceCanonical?.sections["centre-benchmark"]).toMatchObject({
        artifactId: otherWorkspaceSection.id,
        status: "available",
      });
      expect(await handleEnergyApiRequest(
        jsonPost({ aiArtifact: { ...artifactV4, result: otherWorkspaceCanonical } }),
        ["projects", project.id, "saved-analyses", savedV4.id, "ai-result"],
        context,
      )).toMatchObject({
        status: 400,
        body: { success: false, error: { message: "ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID" } },
      });
      expect(metadata.runs.listByStatuses({ statuses: ["completed"] })).toHaveLength(runCountBeforeAttachments);
      const attachV4 = await handleEnergyApiRequest(
        jsonPost({ aiArtifact: artifactV4 }),
        ["projects", project.id, "saved-analyses", savedV4.id, "ai-result"],
        context,
      );
      expect(attachV4).toMatchObject({ status: 200, body: { success: true } });
      const tamperedV4 = JSON.parse(JSON.stringify(canonicalV4)) as NonNullable<typeof canonicalV4>;
      const tamperedSection = tamperedV4.sections["centre-benchmark"];
      if (tamperedSection.status !== "available") throw new Error("canonical v4 Section fixture missing");
      (tamperedSection.result.summary as unknown as { text: string }).text = "Browser-authored replacement.";
      expect(await handleEnergyApiRequest(
        jsonPost({ aiArtifact: { ...artifactV4, result: tamperedV4 } }),
        ["projects", project.id, "saved-analyses", savedV4.id, "ai-result"],
        context,
      )).toMatchObject({
        status: 400,
        body: { success: false, error: { message: "ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID" } },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("returns frozen metadata evidence without replacing it from the current Project release", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-saved-metadata-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const templateRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({ metadataStore: metadata, projectId: project.id, hierarchyRevisionId: project.hierarchy_revision_id, scopeId: project.root_scope_id, resource: "electricity" }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-04T00:00:00.000Z",
      });
      const query = {
        projectId: project.id,
        scopeId: "preschool-centre-a",
        resource: "electricity",
        period: "Custom",
        from: "2026-05-01",
        to: "2026-05-31",
      } as const;
      const frozenAnalysis = {
        context: {
          projectId: project.id,
          scopeId: "preschool-centre-a",
          scopeName: "Centre A",
          timezone: "Asia/Singapore",
          from: "2026-04-30T16:00:00.000Z",
          to: "2026-05-31T16:00:00.000Z",
        },
        metadata: {
          status: "provisional",
          hierarchyRevisionId: project.hierarchy_revision_id,
          selectedScope: {
            scopeId: "preschool-centre-a",
            status: "provisional",
            area: { status: "provisional", value: 743 },
            evidence: [{
              scopeId: "preschool-centre-a",
              dimension: "area",
              value: 743,
              status: "provisional",
              hierarchyRevisionId: project.hierarchy_revision_id,
              metadataRevisionId: `${project.hierarchy_revision_id}:preschool-centre-a`,
            }],
          },
        },
      };
      const record = metadata.energyIq.savedAnalyses.create({
        id: "saved-analysis-frozen-metadata",
        series_id: "saved-analysis-frozen-metadata-series",
        project_id: project.id,
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        scope_id: "preschool-centre-a",
        scope_name: "Centre A",
        resource: "electricity",
        title: "Frozen Centre A metadata",
        query_json: JSON.stringify(query),
        analysis_json: JSON.stringify(frozenAnalysis),
        template_revision_id: templateRevision.revision_id,
        data_snapshot_id: project.data_snapshot_id,
        created_by: "dev-user",
      });

      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: project.id,
        user_id: "dev-user",
      });
      const savedDraft = metadata.energyIq.projectSetup.saveDraft({
        project_id: project.id,
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: {
          ...draft.document,
          nodes: draft.document.nodes.map((node) => node.id === "preschool-centre-a"
            ? { ...node, area_sqm: 999, metadata_status: "confirmed" }
            : node),
        },
      });
      const currentRelease = metadata.energyIq.projectSetup.publishDraft({
        project_id: project.id,
        expected_revision: savedDraft.revision,
        user_id: "dev-user",
      });
      expect(metadata.energyIq.scopeMetadata.resolveForPeriod({
        projectId: project.id,
        scopeId: "preschool-centre-a",
        hierarchyRevisionId: currentRelease.hierarchy_revision_id,
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-05-31T16:00:00.000Z",
        },
      }).area).toMatchObject({
        status: "missing",
        reason: "ambiguous-effective-revisions",
        value: null,
        evidence: [{ value: 743 }, { value: 999 }],
      });

      const response = await handleEnergyApiRequest(
        getRequest(),
        ["projects", project.id, "saved-analyses", record.id],
        {
          metadataStore: metadata,
          dataGateway: gateway,
          userId: "dev-user",
          workspaceId: PRESCHOOL_WORKSPACE_ID,
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            analysis: {
              metadata: {
                status: "provisional",
                hierarchyRevisionId: project.hierarchy_revision_id,
                selectedScope: {
                  area: { status: "provisional", value: 743 },
                  evidence: [{
                    dimension: "area",
                    value: 743,
                    metadataRevisionId: `${project.hierarchy_revision_id}:preschool-centre-a`,
                  }],
                },
              },
            },
          },
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const allDays = (from: string, to: string) => ({
  monday: [{ from, to }],
  tuesday: [{ from, to }],
  wednesday: [{ from, to }],
  thursday: [{ from, to }],
  friday: [{ from, to }],
  saturday: [{ from, to }],
  sunday: [{ from, to }],
});

const jsonPost = (body: unknown): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  request.end(JSON.stringify(body));
  return request as unknown as IncomingMessage;
};

const getRequest = (): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, { method: "GET", headers: {} });
  request.end();
  return request as unknown as IncomingMessage;
};

const removeTemporaryFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && (error.code === "EPERM" || error.code === "EBUSY")
    ) {
      return;
    }
    throw error;
  }
};
