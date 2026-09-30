import { LocalDataGateway } from "@datafoundry/data-gateway";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { selectEnergyCurrentOverviewPeriod } from "./energy-analysis.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import {
  createOverviewAiArtifactIdentity,
  createPreschoolAdditionalAiInsightArtifactIdentity,
  resolvePinnedOverviewAiArtifactReadIdentity,
} from "./overview-ai-artifact.js";
import { projectOverviewAiGenerationBinding } from "./project-overview-ai-adapter.js";

const { materializeEnergyProjectManifestMock, publishEnergyProjectManifestAtomicallyMock } = vi.hoisted(() => ({
  materializeEnergyProjectManifestMock: vi.fn(),
  publishEnergyProjectManifestAtomicallyMock: vi.fn(),
}));

vi.mock("./energy-project-materialization.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./energy-project-materialization.js")>(),
  materializeEnergyProjectManifest: materializeEnergyProjectManifestMock,
  publishEnergyProjectManifestAtomically: publishEnergyProjectManifestAtomicallyMock,
}));

publishEnergyProjectManifestAtomicallyMock.mockImplementation(async (input) => {
  const materialized = await materializeEnergyProjectManifestMock(input.materialization);
  await input.publishProjection(materialized, async () => undefined);
  return materialized;
});

describe("Overview AI Artifact API", () => {
  it("reads HTML Slot artifacts without Provider or mutation and generates only on explicit POST", async () => {
    const harness = await createHarness();
    try {
      const read = vi.fn().mockResolvedValue({ artifactKind: "preschool-html-ai-slot-read-model", status: "missing", slots: {} });
      const execute = vi.fn().mockResolvedValue({ artifactKind: "preschool-html-ai-slot-read-model", status: "available", slots: {} });
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const workflow = { read, execute, resolveCurrentIdentity };
      const context = { ...harness.context, preschoolHtmlAiSlotWorkflow: workflow } as unknown as Required<ConfigApiContext>;
      const path = ["projects", harness.project.id, "overview-ai-artifact", "html-slots"];
      const changesBeforeRead = totalChanges(harness.metadata);
      const response = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact/html-slots?scopeId=preschool-project`),
        path,
        context,
      );
      expect(response.status).toBe(200);
      expect(read).toHaveBeenCalledOnce();
      expect(execute).not.toHaveBeenCalled();
      expect(totalChanges(harness.metadata)).toBe(changesBeforeRead);

      const generated = await handleEnergyApiRequest(
        jsonPost({}),
        [...path, "ensure"],
        context,
      );
      expect(generated.status).toBe(200);
      expect(execute).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith({ identity: harness.identity, user: expect.objectContaining({ id: "dev-user" }) });

      const targeted = await handleEnergyApiRequest(
        jsonPost({}, `/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact/html-slots?slotId=executive-summary`),
        [...path, "ensure"],
        context,
      );
      expect(targeted.status).toBe(200);
      expect(execute).toHaveBeenLastCalledWith({
        identity: harness.identity,
        user: expect.objectContaining({ id: "dev-user" }),
        slotId: "executive-summary",
      });

      const retry = await handleEnergyApiRequest(
        jsonPost({}, `/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact/html-slots/retry`),
        [...path, "retry"],
        context,
      );
      expect(retry.status).toBe(400);
      expect(execute).toHaveBeenCalledTimes(2);
    } finally {
      harness.close();
    }
  });

  it("keeps Additional reads side-effect free and allows only admins to regenerate", async () => {
    const harness = await createHarness();
    try {
      const read = vi.fn().mockResolvedValue(aggregateResultFor(harness.identity));
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const additionalIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({
        baseIdentity: harness.identity,
      });
      const queued = harness.metadata.energyIq.overviewAiArtifacts.queue({
        identity: additionalIdentity,
        triggeredBy: "dev-user",
      });
      const executeAdditional = vi.fn().mockResolvedValue(queued);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { read, resolveCurrentIdentity },
        additionalAiInsightsWorkflow: { execute: executeAdditional },
      } as unknown as Required<ConfigApiContext>;
      const memberContext = { ...context, userId: "second-user" };
      const path = ["projects", harness.project.id, "overview-ai-artifact"];

      const restored = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact`),
        path,
        memberContext,
      );
      expect(restored.status).toBe(200);
      expect(read).toHaveBeenCalledOnce();
      expect(executeAdditional).not.toHaveBeenCalled();

      const forbidden = await handleEnergyApiRequest(
        jsonPost({}),
        [...path, "additional", "regenerate"],
        memberContext,
      );
      expect(forbidden).toMatchObject({
        status: 403,
        body: { success: false, error: { code: "FORBIDDEN", message: "ENERGYIQ_ADMIN_REQUIRED" } },
      });
      expect(executeAdditional).not.toHaveBeenCalled();

      const regenerated = await handleEnergyApiRequest(
        jsonPost({}),
        [...path, "additional", "regenerate"],
        context,
      );
      expect(regenerated).toMatchObject({
        status: 200,
        body: { success: true, data: { status: "queued", dataSnapshotId: additionalIdentity.dataSnapshotId } },
      });
      expect(executeAdditional).toHaveBeenCalledOnce();
      expect(executeAdditional).toHaveBeenCalledWith({
        baseIdentity: harness.identity,
        user: expect.objectContaining({ id: "dev-user" }),
      });
    } finally {
      harness.close();
    }
  });

  it("accepts the current published Snapshot and Release while delivery configuration has moved on", async () => {
    const harness = await createHarness();
    try {
      const project = harness.metadata.energyIq.upsertProject({
        id: harness.project.id,
        workspace_id: harness.project.workspace_id,
        name: harness.project.name,
        status: harness.project.status,
        timezone: harness.project.timezone,
        hierarchy_revision_id: harness.project.hierarchy_revision_id,
        meter_formula_revision_id: harness.project.meter_formula_revision_id,
        data_snapshot_id: harness.project.data_snapshot_id,
        metric_version: harness.project.metric_version,
        business_calendar_version: harness.project.business_calendar_version,
        tariff_schedule_version: harness.project.tariff_schedule_version,
        delivery_stage: "configured",
        root_scope_id: harness.project.root_scope_id,
        has_unpublished_changes: true,
      });
      expect(project.delivery_stage).toBe("configured");
      const identity = resolvePinnedOverviewAiArtifactReadIdentity({
        metadataStore: harness.metadata,
        projectId: project.id,
        scopeId: project.root_scope_id,
        user: harness.metadata.users.getById({ user_id: "dev-user" }),
        pin: {
          from: "2026-05-01",
          to: "2026-05-31",
          dataSnapshotId: project.data_snapshot_id,
          projectReleaseId: harness.identity.projectReleaseId,
        },
      });

      expect(identity).toMatchObject({
        dataSnapshotId: project.data_snapshot_id,
        projectReleaseId: harness.identity.projectReleaseId,
        analysisPeriodFrom: "2026-04-30T16:00:00.000Z",
        analysisPeriodTo: "2026-05-31T16:00:00.000Z",
      });
    } finally {
      harness.close();
    }
  });

  it("returns the aggregate read model read-only and forwards only a validated Section retry target", async () => {
    const harness = await createHarness();
    try {
      const aggregate = aggregateResultFor(harness.identity);
      const read = vi.fn().mockResolvedValue(aggregate);
      const execute = vi.fn().mockResolvedValue(aggregate);
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;
      const path = ["projects", harness.project.id, "overview-ai-artifact"];

      const restored = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact?scopeId=${harness.project.root_scope_id}`),
        path,
        context,
      );
      expect(restored).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: {
          success: true,
          data: {
            status: "available",
            result: {
              artifactKind: "preschool-overview-ai-read-model",
              sections: {
                "centre-benchmark": { status: "available" },
                "standby-wastage": { status: "unavailable" },
              },
              executive: { status: "unavailable" },
            },
          },
        },
      });
      expect(execute).not.toHaveBeenCalled();

      await handleEnergyApiRequest(jsonPost({ targetId: "standby-wastage" }), [...path, "retry"], context);
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({
        retry: true,
        retryTarget: "standby-wastage",
      }));
    } finally {
      harness.close();
    }
  });

  it("returns missing instead of falling back to a legacy autonomous artifact when aggregate read is supported", async () => {
    const harness = await createHarness();
    try {
      const store = harness.metadata.energyIq.overviewAiArtifacts;
      store.queue({ identity: harness.identity, triggeredBy: "dev-user" });
      store.claim({ identity: harness.identity, workerId: "legacy-worker", leaseMs: 60_000 });
      store.complete({
        identity: harness.identity,
        workerId: "legacy-worker",
        sessionId: "legacy-session",
        runId: "legacy-run",
        resultJson: JSON.stringify(resultFor(harness.identity, "legacy-run")),
      });
      const read = vi.fn().mockResolvedValue(null);
      const execute = vi.fn();
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;
      const response = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact?scopeId=${harness.project.root_scope_id}`),
        ["projects", harness.project.id, "overview-ai-artifact"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: { status: "missing" } },
      });
      expect(read).toHaveBeenCalledOnce();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("keeps GET read-only for members while admin POST ensure and retry execute server-owned work", async () => {
    const harness = await createHarness();
    try {
      const execute = vi.fn(async ({ identity, user, retry }) => {
        const store = harness.metadata.energyIq.overviewAiArtifacts;
        const current = store.find(identity) ?? store.queue({ identity, triggeredBy: user.id });
        if (current.status === "available") return current;
        const workerId = retry ? "server-retry" : "server-first";
        const claim = store.claim({ identity, workerId, leaseMs: 60_000 });
        if (!claim.claimed) return claim.artifact;
        return store.complete({
          identity,
          workerId,
          sessionId: "server-session",
          runId: retry ? "server-editor-retry" : "server-editor-first",
          resultJson: JSON.stringify(resultFor(identity, retry ? "server-editor-retry" : "server-editor-first")),
        });
      });
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = { ...harness.context, overviewAiWorkflow: { execute, resolveCurrentIdentity } } as unknown as Required<ConfigApiContext>;
      const secondContext = { ...context, userId: "second-user" };
      const path = ["projects", harness.project.id, "overview-ai-artifact"];

      const before = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact?scopeId=${harness.project.root_scope_id}`),
        path,
        context,
      );
      expect(before).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: { status: "missing" } },
      });
      expect(execute).not.toHaveBeenCalled();

      const started = await handleEnergyApiRequest(jsonPost({}), [...path, "ensure"], context);
      expect(started).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            status: "available",
            dataSnapshotId: harness.identity.dataSnapshotId,
            projectReleaseId: harness.identity.projectReleaseId,
            attemptCount: 1,
            result: { runId: "server-editor-first" },
          },
        },
      });
      expect((started.body as { data: Record<string, unknown> }).data).not.toHaveProperty("leaseToken");
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({
        identity: harness.identity,
        user: expect.objectContaining({ id: "dev-user" }),
        retry: false,
      }));

      const restored = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact?scopeId=${harness.project.root_scope_id}`),
        path,
        secondContext,
      );
      expect(restored).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: started.body,
      });
      expect(execute).toHaveBeenCalledTimes(1);

      const retry = await handleEnergyApiRequest(jsonPost({}), [...path, "retry"], context);
      expect(retry).toEqual(started);
      expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ retry: true }));
      expect(resolveCurrentIdentity).toHaveBeenCalledTimes(4);
    } finally {
      harness.close();
    }
  });

  it("forbids workspace members from starting or retrying Overview AI generation", async () => {
    const harness = await createHarness();
    try {
      const execute = vi.fn();
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        userId: "second-user",
        overviewAiWorkflow: { execute, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;
      const path = ["projects", harness.project.id, "overview-ai-artifact"];

      for (const action of ["ensure", "retry"] as const) {
        const response = await handleEnergyApiRequest(jsonPost({}), [...path, action], context);
        expect(response).toMatchObject({
          status: 403,
          body: {
            success: false,
            error: { code: "FORBIDDEN", message: "ENERGYIQ_ADMIN_REQUIRED" },
          },
        });
      }
      expect(execute).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("runs the current Preschool v4 closure exactly once after materializing a new Snapshot", async () => {
    const harness = await createHarness();
    try {
      const user = harness.metadata.users.getById({ user_id: "dev-user" });
      const identity = { ...harness.identity, dataSnapshotId: "snapshot-after-materialize" };
      const prewarmIdentity = { ...identity, metricRevisionIds: [], ruleRevisionIds: [] };
      const readModel = aggregateResultFor(identity);
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(identity);
      const execute = vi.fn().mockResolvedValue(readModel);
      const htmlIdentity = {
        ...identity,
        modelProfileId: "html-slot-model",
        modelProfileRevision: 1,
        outputContractRevision: "html-slot-output@1",
        validatorRevision: "html-slot-validator@1",
      };
      const htmlSlotPin = {
        from: "2026-05-01",
        to: "2026-05-31",
        dataSnapshotId: identity.dataSnapshotId,
        projectReleaseId: identity.projectReleaseId,
      };
      const publishedSnapshot = { marker: "snapshot-after-materialize" } as never;
      const resolvePublishedHtmlIdentity = vi.fn().mockReturnValue(htmlIdentity);
      const executeHtml = vi.fn(() => new Promise<never>(() => undefined));
      const batch = harness.metadata.energyIq.createImportBatch({
        id: "batch-for-v4-closure",
        workspace_id: harness.project.workspace_id,
        project_id: harness.project.id,
        source_kind: "excel",
        source_sha256: "a".repeat(64),
        filename: "preschool.xlsx",
        status: "inspected",
        inspection: { sourceLabels: [] },
        created_by: user.id,
      });
      const draft = harness.metadata.energyIq.projectSetup.getDraft({
        project_id: harness.project.id,
        user_id: user.id,
      });
      materializeEnergyProjectManifestMock.mockResolvedValueOnce({
        batch,
        snapshot: {
          id: "snapshot-after-materialize",
          workspace_id: harness.project.workspace_id,
          project_id: harness.project.id,
          manifest_json: "{}",
          audit_json: "{}",
          created_at: "2026-08-13T00:00:00.000Z",
        },
        document: draft.document,
        duplicate: false,
      });
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, resolveCurrentIdentity },
        preschoolHtmlAiSlotWorkflow: {
          resolvePublishedIdentity: resolvePublishedHtmlIdentity,
          execute: executeHtml,
        },
      } as unknown as Required<ConfigApiContext>;
      const materializeOverview = vi.fn().mockResolvedValue({
        changed: true,
        resolution: { status: "ready" },
        contextPackage: {
          projectionRef: "overview-projection:materialized",
          identity: htmlSlotPin,
          snapshot: publishedSnapshot,
          evidenceRefs: ["evidence:materialized"],
        },
      });
      const prewarmAnalysis = vi.fn().mockResolvedValue({
        status: "materialized",
        contextPackage: { projectionRef: "analysis-context:materialized", identity: prewarmIdentity },
      });

      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", harness.project.id, "imports", batch.id, "materialize"],
        context,
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          materializeCurrentOverviewProjection: materializeOverview as never,
          prewarmAnalysisContextPackage: prewarmAnalysis as never,
        },
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            dataSnapshot: { id: "snapshot-after-materialize" },
            overviewProjection: { changed: true, evidenceRefs: ["evidence:materialized"] },
            analysisContextPrewarm: {
              status: "materialized",
              projectionRef: "analysis-context:materialized",
              identity,
            },
            overviewAi: {
              status: "available",
              dataSnapshotId: identity.dataSnapshotId,
              projectReleaseId: identity.projectReleaseId,
              result: { artifactKind: "preschool-overview-ai-read-model" },
            },
          },
        },
      });
      expect(materializeEnergyProjectManifestMock).toHaveBeenCalledTimes(1);
      expect(materializeOverview).toHaveBeenCalledTimes(1);
      expect(materializeOverview.mock.invocationCallOrder[0]).toBeLessThan(
        prewarmAnalysis.mock.invocationCallOrder[0]!,
      );
      expect(prewarmAnalysis.mock.invocationCallOrder[0]).toBeLessThan(
        resolveCurrentIdentity.mock.invocationCallOrder[0]!,
      );
      expect(prewarmAnalysis).toHaveBeenCalledOnce();
      expect(resolveCurrentIdentity).toHaveBeenCalledTimes(1);
      expect(resolveCurrentIdentity).toHaveBeenCalledWith({
        projectId: harness.project.id,
        scopeId: harness.project.root_scope_id,
        user,
      });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith({ identity, user, retry: false });
      await vi.waitFor(() => expect(executeHtml).toHaveBeenCalledTimes(1));
      expect(resolvePublishedHtmlIdentity).toHaveBeenCalledWith({ snapshot: publishedSnapshot });
      expect(executeHtml).toHaveBeenCalledWith({ identity: htmlIdentity, user, snapshot: publishedSnapshot });
    } finally {
      harness.close();
    }
  });

  it("keeps a successful Snapshot import when Preschool AI identity resolution fails", async () => {
    const harness = await createHarness();
    const aiError = new Error("identity unavailable");
    const htmlAiError = new Error("html identity unavailable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const user = harness.metadata.users.getById({ user_id: "dev-user" });
      const resolveCurrentIdentity = vi.fn().mockRejectedValue(aiError);
      const execute = vi.fn();
      const resolvePublishedHtmlIdentity = vi.fn(() => { throw htmlAiError; });
      const executeHtml = vi.fn();
      const htmlSlotPin = {
        from: "2026-05-01",
        to: "2026-05-31",
        dataSnapshotId: "snapshot-with-failed-ai-identity",
        projectReleaseId: harness.identity.projectReleaseId,
      };
      const publishedSnapshot = { marker: "snapshot-with-failed-ai-identity" } as never;
      const batch = harness.metadata.energyIq.createImportBatch({
        id: "batch-with-failed-ai-identity",
        workspace_id: harness.project.workspace_id,
        project_id: harness.project.id,
        source_kind: "excel",
        source_sha256: "b".repeat(64),
        filename: "preschool-ai-failure.xlsx",
        status: "inspected",
        inspection: { sourceLabels: [] },
        created_by: user.id,
      });
      const draft = harness.metadata.energyIq.projectSetup.getDraft({
        project_id: harness.project.id,
        user_id: user.id,
      });
      materializeEnergyProjectManifestMock.mockResolvedValueOnce({
        batch,
        snapshot: {
          id: "snapshot-with-failed-ai-identity",
          workspace_id: harness.project.workspace_id,
          project_id: harness.project.id,
          manifest_json: "{}",
          audit_json: "{}",
          created_at: "2026-08-13T00:00:00.000Z",
        },
        document: draft.document,
        duplicate: false,
      });
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, resolveCurrentIdentity },
        preschoolHtmlAiSlotWorkflow: {
          resolvePublishedIdentity: resolvePublishedHtmlIdentity,
          execute: executeHtml,
        },
      } as unknown as Required<ConfigApiContext>;
      const materializeOverview = vi.fn().mockResolvedValue({
        changed: true,
        resolution: { status: "ready" },
        contextPackage: {
          projectionRef: "overview-projection:import-survived-ai-failure",
          identity: htmlSlotPin,
          snapshot: publishedSnapshot,
          evidenceRefs: ["evidence:import-survived-ai-failure"],
        },
      });
      const prewarmAnalysis = vi.fn().mockResolvedValue({
        status: "not_ready",
        reason: "ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE",
      });

      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", harness.project.id, "imports", batch.id, "materialize"],
        context,
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          materializeCurrentOverviewProjection: materializeOverview as never,
          prewarmAnalysisContextPackage: prewarmAnalysis as never,
        },
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            dataSnapshot: { id: "snapshot-with-failed-ai-identity" },
            overviewProjection: { changed: true, evidenceRefs: ["evidence:import-survived-ai-failure"] },
          },
        },
      });
      expect((response.body as { data: Record<string, unknown> }).data).not.toHaveProperty("overviewAi");
      expect(execute).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        "[energyiq] failed to generate Preschool Overview AI after materialization",
        aiError,
      );
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
        "[energyiq] failed to generate Preschool HTML AI Slots after materialization",
        htmlAiError,
      ));
      expect(resolvePublishedHtmlIdentity).toHaveBeenCalledWith({ snapshot: publishedSnapshot });
      expect(executeHtml).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      harness.close();
    }
  });

  it("runs the current Preschool v4 closure exactly once after publishing a new Release", async () => {
    const harness = await createHarness();
    try {
      const user = harness.metadata.users.getById({ user_id: "dev-user" });
      const identity = { ...harness.identity, projectReleaseId: "release-after-publish" };
      const prewarmIdentity = { ...identity, metricRevisionIds: [], ruleRevisionIds: [] };
      const readModel = aggregateResultFor(identity);
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(identity);
      const execute = vi.fn().mockResolvedValue(readModel);
      const htmlIdentity = {
        ...identity,
        modelProfileId: "html-slot-model",
        modelProfileRevision: 1,
        outputContractRevision: "html-slot-output@1",
        validatorRevision: "html-slot-validator@1",
      };
      const htmlSlotPin = {
        from: "2026-05-01",
        to: "2026-05-31",
        dataSnapshotId: identity.dataSnapshotId,
        projectReleaseId: identity.projectReleaseId,
      };
      const publishedSnapshot = { marker: "release-after-publish" } as never;
      const resolvePublishedHtmlIdentity = vi.fn().mockReturnValue(htmlIdentity);
      const executeHtml = vi.fn(() => new Promise<never>(() => undefined));
      const initialDraft = harness.metadata.energyIq.projectSetup.getDraft({
        project_id: harness.project.id,
        user_id: user.id,
      });
      const { meter_mapping: _mapping, source_manifest: _manifest, ...document } = initialDraft.document;
      const draft = harness.metadata.energyIq.projectSetup.saveDraft({
        project_id: harness.project.id,
        expected_revision: initialDraft.revision,
        user_id: user.id,
        document,
      });
      const templateDraft = harness.metadata.energyIq.templates.getProjectDraft({
        project_id: harness.project.id,
        tier_definition_ids: draft.document.tiers.map((tier) => tier.id),
      });
      const metricConfig = harness.metadata.energyIq.metrics.getProjectConfig(harness.project.id);
      const ruleConfig = harness.metadata.energyIq.rules.getProjectConfig(harness.project.id);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, resolveCurrentIdentity },
        preschoolHtmlAiSlotWorkflow: {
          resolvePublishedIdentity: resolvePublishedHtmlIdentity,
          execute: executeHtml,
        },
      } as unknown as Required<ConfigApiContext>;
      const materializeOverview = vi.fn().mockResolvedValue({
        changed: true,
        resolution: { status: "ready" },
        contextPackage: { identity: htmlSlotPin, snapshot: publishedSnapshot, evidenceRefs: ["evidence:published"] },
      });
      const prewarmAnalysis = vi.fn().mockResolvedValue({
        status: "materialized",
        contextPackage: { projectionRef: "analysis-context:published", identity: prewarmIdentity },
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          expectedRevision: draft.revision,
          expectedTemplateDraftRevision: templateDraft.revision,
          expectedMetricConfigRevision: metricConfig.revision,
          expectedRuleConfigRevision: ruleConfig.revision,
        }),
        ["projects", harness.project.id, "setup", "publish"],
        context,
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          materializeCurrentOverviewProjection: materializeOverview as never,
          prewarmAnalysisContextPackage: prewarmAnalysis as never,
        },
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            project: { id: harness.project.id, status: "published" },
            overviewProjection: { changed: true, evidenceRefs: ["evidence:published"] },
            analysisContextPrewarm: {
              status: "materialized",
              projectionRef: "analysis-context:published",
              identity,
            },
            overviewAi: {
              status: "available",
              dataSnapshotId: identity.dataSnapshotId,
              projectReleaseId: identity.projectReleaseId,
              result: { artifactKind: "preschool-overview-ai-read-model" },
            },
          },
        },
      });
      expect(resolveCurrentIdentity).toHaveBeenCalledTimes(1);
      expect(materializeOverview).toHaveBeenCalledTimes(1);
      expect(materializeOverview.mock.invocationCallOrder[0]).toBeLessThan(
        prewarmAnalysis.mock.invocationCallOrder[0]!,
      );
      expect(prewarmAnalysis.mock.invocationCallOrder[0]).toBeLessThan(
        resolveCurrentIdentity.mock.invocationCallOrder[0]!,
      );
      expect(prewarmAnalysis).toHaveBeenCalledOnce();
      expect(resolveCurrentIdentity).toHaveBeenCalledWith({
        projectId: harness.project.id,
        scopeId: harness.project.root_scope_id,
        user,
      });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith({ identity, user, retry: false });
      await vi.waitFor(() => expect(executeHtml).toHaveBeenCalledTimes(1));
      expect(resolvePublishedHtmlIdentity).toHaveBeenCalledWith({ snapshot: publishedSnapshot });
      expect(executeHtml).toHaveBeenCalledWith({ identity: htmlIdentity, user, snapshot: publishedSnapshot });
    } finally {
      harness.close();
    }
  });

  it("keeps a successful Release publish when Preschool AI execution fails", async () => {
    const harness = await createHarness();
    const aiError = new Error("provider unavailable");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const user = harness.metadata.users.getById({ user_id: "dev-user" });
      const identity = { ...harness.identity, projectReleaseId: "release-with-failed-ai" };
      const htmlSlotPin = {
        from: "2026-05-01",
        to: "2026-05-31",
        dataSnapshotId: identity.dataSnapshotId,
        projectReleaseId: identity.projectReleaseId,
      };
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(identity);
      const execute = vi.fn().mockRejectedValue(aiError);
      const initialDraft = harness.metadata.energyIq.projectSetup.getDraft({
        project_id: harness.project.id,
        user_id: user.id,
      });
      const { meter_mapping: _mapping, source_manifest: _manifest, ...document } = initialDraft.document;
      const draft = harness.metadata.energyIq.projectSetup.saveDraft({
        project_id: harness.project.id,
        expected_revision: initialDraft.revision,
        user_id: user.id,
        document,
      });
      const templateDraft = harness.metadata.energyIq.templates.getProjectDraft({
        project_id: harness.project.id,
        tier_definition_ids: draft.document.tiers.map((tier) => tier.id),
      });
      const metricConfig = harness.metadata.energyIq.metrics.getProjectConfig(harness.project.id);
      const ruleConfig = harness.metadata.energyIq.rules.getProjectConfig(harness.project.id);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;
      const materializeOverview = vi.fn().mockResolvedValue({
        changed: true,
        resolution: { status: "ready" },
        contextPackage: { identity: htmlSlotPin, evidenceRefs: ["evidence:publish-survived-ai-failure"] },
      });
      const prewarmAnalysis = vi.fn().mockResolvedValue({
        status: "not_ready",
        reason: "ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE",
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          expectedRevision: draft.revision,
          expectedTemplateDraftRevision: templateDraft.revision,
          expectedMetricConfigRevision: metricConfig.revision,
          expectedRuleConfigRevision: ruleConfig.revision,
        }),
        ["projects", harness.project.id, "setup", "publish"],
        context,
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          materializeCurrentOverviewProjection: materializeOverview as never,
          prewarmAnalysisContextPackage: prewarmAnalysis as never,
        },
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            project: { id: harness.project.id, status: "published" },
            overviewProjection: { changed: true, evidenceRefs: ["evidence:publish-survived-ai-failure"] },
          },
        },
      });
      expect((response.body as { data: Record<string, unknown> }).data).not.toHaveProperty("overviewAi");
      expect(warn).toHaveBeenCalledWith(
        "[energyiq] failed to generate Preschool Overview AI after Project publish",
        aiError,
      );
    } finally {
      warn.mockRestore();
      harness.close();
    }
  });

  it("forbids members from using materialize or publish as an implicit generation path", async () => {
    const harness = await createHarness();
    try {
      materializeEnergyProjectManifestMock.mockClear();
      const execute = vi.fn();
      const resolveCurrentIdentity = vi.fn();
      const context = {
        ...harness.context,
        userId: "second-user",
        overviewAiWorkflow: { execute, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;

      const materialize = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", harness.project.id, "imports", "batch-member", "materialize"],
        context,
      );
      const publish = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", harness.project.id, "setup", "publish"],
        context,
      );

      for (const response of [materialize, publish]) {
        expect(response).toMatchObject({
          status: 403,
          body: {
            success: false,
            error: { code: "FORBIDDEN", message: "ENERGYIQ_ADMIN_REQUIRED" },
          },
        });
      }
      expect(materializeEnergyProjectManifestMock).not.toHaveBeenCalled();
      expect(resolveCurrentIdentity).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("resolves the Artifact against the exact Overview period, Snapshot, and Release pin", async () => {
    const harness = await createHarness();
    try {
      const execute = vi.fn(async () => { throw new Error("not expected"); });
      const resolveCurrentIdentity = vi.fn(async () => { throw new Error("analysis resolver must not run for an exact read pin"); });
      const resolveReadIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, resolveCurrentIdentity, resolveReadIdentity },
      } as unknown as Required<ConfigApiContext>;
      const path = ["projects", harness.project.id, "overview-ai-artifact"];

      await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-ai-artifact?scopeId=${harness.project.root_scope_id}&from=2026-05-01&to=2026-05-31&dataSnapshotId=snapshot-may&projectReleaseId=release-may`),
        path,
        context,
      );

      expect(resolveReadIdentity).toHaveBeenCalledWith(expect.objectContaining({
        projectId: harness.project.id,
        scopeId: harness.project.root_scope_id,
        pin: {
          from: "2026-05-01",
          to: "2026-05-31",
          dataSnapshotId: "snapshot-may",
          projectReleaseId: "release-may",
        },
      }));
      expect(resolveCurrentIdentity).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("returns 403 for deprecated claim/complete/fail payloads and revalidates exact identity", async () => {
    const harness = await createHarness();
    try {
      const execute = vi.fn(async () => { throw new Error("not expected"); });
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = { ...harness.context, overviewAiWorkflow: { execute, resolveCurrentIdentity } } as unknown as Required<ConfigApiContext>;
      const path = ["projects", harness.project.id, "overview-ai-artifact"];
      for (const action of ["claim", "complete", "fail"]) {
        const response = await handleEnergyApiRequest(
          jsonPost({ leaseToken: "browser-lease", result: { findings: [] }, errorCode: "CLIENT_FAILED" }),
          [...path, action],
          context,
        );
        expect(response).toMatchObject({
          status: 403,
          body: { success: false, error: { code: "FORBIDDEN", message: "Overview AI Artifact browser orchestration is forbidden." } },
        });
      }
      expect(execute).not.toHaveBeenCalled();
      expect(resolveCurrentIdentity).toHaveBeenCalledTimes(3);
    } finally {
      harness.close();
    }
  });

  it("reads project Overview and Layer 1–3 readiness without starting Provider work", async () => {
    const harness = await createHarness();
    try {
      const read = vi.fn().mockResolvedValue(explainableAggregateResultFor(harness.identity));
      const execute = vi.fn();
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-admin-state`),
        ["projects", harness.project.id, "overview-admin-state"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: {
          success: true,
          data: {
            projectId: "preschool-demo",
            customerOverview: { status: "ready" },
            capabilities: {
              keyFindings: true,
              sectionAnalysis: [
                "centre-benchmark",
                "standby-wastage",
                "operating-behaviour",
                "planning-outlook",
              ],
              additionalInsights: true,
            },
            analysis: {
              supported: true,
              items: expect.arrayContaining([
                expect.objectContaining({ id: "key-findings", status: "needs-attention" }),
                expect.objectContaining({ id: "section:centre-benchmark", status: "ready" }),
                expect.objectContaining({ id: "section:operating-behaviour", status: "not-generated" }),
                expect.objectContaining({ id: "additional-insights", status: "ready" }),
              ]),
            },
            explainability: {
              status: "available",
              declared: {
                skills: [expect.objectContaining({
                  id: "energyiq-open-discovery",
                  revision: "1.0.0",
                  availability: "declared-available",
                })],
                methods: [expect.objectContaining({
                  resourceId: "builtin:energyiq-open-discovery",
                  scope: "builtin",
                  lifecycle: "published",
                  availability: "declared-available",
                })],
                tools: expect.arrayContaining([
                  expect.objectContaining({ id: "energy.evidence.read", availability: "declared-available" }),
                  expect.objectContaining({ id: "energy.metrics.compare", availability: "declared-available" }),
                ]),
              },
              currentArtifact: {
                artifactId: "additional-current",
                readOnly: true,
                historical: false,
                loadedMethods: [expect.objectContaining({
                  resourceId: "builtin:energyiq-open-discovery",
                  usage: "actually-loaded",
                })],
                findings: [expect.objectContaining({
                  id: "additional-finding-1",
                  evidenceSignal: "Portfolio demand stayed concentrated in two Centres.",
                  aiAngle: "This may be a repeatable scheduling pattern worth testing.",
                  origin: "ai-discovery",
                  attributedMethods: [expect.objectContaining({
                    resourceId: "builtin:energyiq-open-discovery",
                    usage: "finding-attributed",
                  })],
                  successfulTools: [expect.objectContaining({
                    auditId: "audit-evidence-success",
                    toolName: "energy.evidence.read",
                    usage: "tool-succeeded",
                  })],
                })],
              },
            },
            allowedActions: ["generate-missing"],
            recommendedNextAction: { action: "generate-missing" },
          },
        },
      });
      expect(resolveCurrentIdentity).toHaveBeenCalledOnce();
      expect(read).toHaveBeenCalledOnce();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("keeps the saved Artifact trace available when the declared governance catalog is locally unavailable", async () => {
    const harness = await createHarness();
    const catalogRead = vi.spyOn(
      harness.metadata.energyIq.insightMethodGovernance,
      "listPublishedWorkspaceMethodResources",
    ).mockImplementation(() => {
      throw new Error("GOVERNANCE_CATALOG_UNAVAILABLE");
    });
    try {
      const read = vi.fn().mockResolvedValue(explainableAggregateResultFor(harness.identity));
      const execute = vi.fn();
      const context = {
        ...harness.context,
        overviewAiWorkflow: {
          execute,
          read,
          resolveCurrentIdentity: vi.fn().mockResolvedValue(harness.identity),
        },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-admin-state`),
        ["projects", harness.project.id, "overview-admin-state"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: { explainability: {
          status: "available",
          declared: {
            status: "partially-unavailable",
            skills: [expect.objectContaining({ id: "energyiq-open-discovery" })],
            methods: [expect.objectContaining({ resourceId: "builtin:energyiq-open-discovery" })],
            tools: expect.arrayContaining([expect.objectContaining({ id: "energy.evidence.read" })]),
          },
          currentArtifact: {
            status: "available",
            artifactId: "additional-current",
            findings: [expect.objectContaining({ id: "additional-finding-1", status: "available" })],
          },
        } } },
      });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      catalogRead.mockRestore();
      harness.close();
    }
  });

  it("does not report the customer Overview as ready when current deterministic facts cannot resolve", async () => {
    const harness = await createHarness();
    try {
      const read = vi.fn();
      const execute = vi.fn();
      const resolveCurrentIdentity = vi.fn().mockRejectedValue(new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE"));
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-admin-state`),
        ["projects", harness.project.id, "overview-admin-state"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            customerOverview: { status: "needs-attention", url: null },
            analysis: { status: "needs-attention" },
            allowedActions: [],
          },
        },
      });
      expect(read).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("derives Ngee Ann Admin readiness from the same exact Project adapter without generation", async () => {
    const harness = await createHarness();
    try {
      const ngeeAnnProject = harness.metadata.energyIq.getProject("ngee-ann-polytechnic");
      const identity = {
        ...harness.identity,
        workspaceId: ngeeAnnProject.workspace_id,
        projectId: ngeeAnnProject.id,
        scopeId: ngeeAnnProject.root_scope_id,
        rendererKey: "ngee-ann-overview",
        dataSnapshotId: "ngee-snapshot-current",
        projectReleaseId: "ngee-release-current",
      };
      const resolveIdentity = vi.fn().mockResolvedValue(identity);
      const readExact = vi.fn().mockResolvedValue({
        contract: "energyiq-project-overview-ai-read-model@1",
        rendererKey: "ngee-ann-overview",
        binding: {
          workspaceId: identity.workspaceId,
          projectId: identity.projectId,
          scopeId: identity.scopeId,
          dataSnapshotId: identity.dataSnapshotId,
          projectReleaseId: identity.projectReleaseId,
          analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
          modelProfileId: identity.modelProfileId,
          modelProfileRevision: identity.modelProfileRevision,
          generation: projectOverviewAiGenerationBinding(identity),
        },
        keyFindings: { status: "unavailable", reason: "Key Findings has not been generated." },
        sections: {
          "trend-and-demand": { status: "unavailable", reason: "Not generated." },
          "time-behaviour": { status: "unavailable", reason: "Not generated." },
          "circuit-concentration": { status: "unavailable", reason: "Not generated." },
          "decision-priorities": { status: "unavailable", reason: "Not generated." },
        },
        additionalInsights: { status: "unavailable", reason: "Not generated." },
      });
      const generateMissing = vi.fn();
      const context = {
        ...harness.context,
        workspaceId: ngeeAnnProject.workspace_id,
        projectOverviewAiAdapters: [{
          rendererKey: "ngee-ann-overview",
          projectId: "ngee-ann-polytechnic",
          keyFindings: true,
          sections: [
            { id: "trend-and-demand", label: "Trend and demand" },
            { id: "time-behaviour", label: "Time behaviour" },
            { id: "circuit-concentration", label: "Circuit concentration" },
            { id: "decision-priorities", label: "Decision priorities" },
          ],
          additionalInsights: true,
          resolveIdentity,
          readExact,
          generateMissing,
        }],
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        getRequest("/api/v1/energy/projects/ngee-ann-polytechnic/overview-admin-state"),
        ["projects", "ngee-ann-polytechnic", "overview-admin-state"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            projectId: "ngee-ann-polytechnic",
            customerOverview: { status: "ready" },
            capabilities: {
              keyFindings: true,
              sectionAnalysis: [
                "trend-and-demand",
                "time-behaviour",
                "circuit-concentration",
                "decision-priorities",
              ],
              additionalInsights: true,
            },
            analysis: {
              supported: true,
              totalCount: 6,
              items: expect.arrayContaining([
                expect.objectContaining({ id: "section:trend-and-demand", status: "not-generated" }),
                expect.objectContaining({ id: "section:decision-priorities", status: "not-generated" }),
              ]),
            },
            allowedActions: ["generate-missing"],
            recommendedNextAction: { action: "generate-missing" },
          },
        },
      });
      expect(resolveIdentity).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "ngee-ann-polytechnic",
        request: { kind: "current" },
      }));
      expect(readExact).toHaveBeenCalledWith({ identity, user: expect.objectContaining({ id: "dev-user" }) });
      expect(generateMissing).not.toHaveBeenCalled();

    } finally {
      harness.close();
    }
  });

  it("passes the exact failed Ngee Ann unit to the Project adapter retry", async () => {
    const harness = await createHarness();
    try {
      const ngeeAnnProject = harness.metadata.energyIq.getProject("ngee-ann-polytechnic");
      const identity = {
        ...harness.identity,
        workspaceId: ngeeAnnProject.workspace_id,
        projectId: ngeeAnnProject.id,
        scopeId: ngeeAnnProject.root_scope_id,
        rendererKey: "ngee-ann-overview",
        dataSnapshotId: "ngee-snapshot-current",
        projectReleaseId: "ngee-release-current",
      };
      const available = (id: string) => ({ status: "available" as const, artifactId: id, result: {} });
      const binding = {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        dataSnapshotId: identity.dataSnapshotId,
        projectReleaseId: identity.projectReleaseId,
        analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
        modelProfileId: identity.modelProfileId,
        modelProfileRevision: identity.modelProfileRevision,
        generation: projectOverviewAiGenerationBinding(identity),
      };
      const failedModel = {
        contract: "energyiq-project-overview-ai-read-model@1" as const,
        rendererKey: "ngee-ann-overview" as const,
        binding,
        keyFindings: {
          status: "failed" as const,
          artifactId: "artifact:executive:failed",
          reason: "ENERGYIQ_NGEE_ANN_EXECUTIVE_RESULT_INVALID",
        },
        sections: {
          "trend-and-demand": available("artifact:trend"),
          "time-behaviour": available("artifact:time"),
          "circuit-concentration": available("artifact:circuit"),
          "decision-priorities": available("artifact:decision"),
        },
        additionalInsights: available("artifact:additional"),
      };
      const readyModel = {
        ...failedModel,
        keyFindings: available("artifact:executive:ready"),
      };
      const resolveIdentity = vi.fn().mockResolvedValue(identity);
      const readExact = vi.fn()
        .mockResolvedValueOnce(failedModel)
        .mockResolvedValue(readyModel);
      const generateMissing = vi.fn().mockResolvedValue(readyModel);
      const context = {
        ...harness.context,
        workspaceId: ngeeAnnProject.workspace_id,
        projectOverviewAiAdapters: [{
          rendererKey: "ngee-ann-overview",
          projectId: "ngee-ann-polytechnic",
          keyFindings: true,
          sections: [
            { id: "trend-and-demand", label: "Trend and demand" },
            { id: "time-behaviour", label: "Time behaviour" },
            { id: "circuit-concentration", label: "Circuit concentration" },
            { id: "decision-priorities", label: "Decision priorities" },
          ],
          additionalInsights: true,
          resolveIdentity,
          readExact,
          generateMissing,
        }],
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", "ngee-ann-polytechnic", "overview-admin-state", "actions", "generate-missing"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: { analysis: { status: "ready" }, allowedActions: [] } },
      });
      expect(generateMissing).toHaveBeenCalledOnce();
      expect(generateMissing).toHaveBeenCalledWith({
        identity,
        user: expect.objectContaining({ id: "dev-user" }),
        retryTarget: "executive-synthesis",
      });
    } finally {
      harness.close();
    }
  });

  it("treats a cross-Snapshot exact-read result as an integrity failure, not a historical result", async () => {
    const harness = await createHarness();
    try {
      const stale = aggregateResultFor(harness.identity);
      stale.binding.dataSnapshotId = "snapshot-previous";
      const read = vi.fn().mockResolvedValue(stale);
      const execute = vi.fn();
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-admin-state`),
        ["projects", harness.project.id, "overview-admin-state"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            analysis: {
              status: "needs-attention",
              items: expect.arrayContaining([
                expect.objectContaining({ id: "key-findings", status: "needs-attention" }),
                expect.objectContaining({ id: "additional-insights", status: "needs-attention" }),
              ]),
            },
            allowedActions: [],
          },
        },
      });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("reports Last generated from successful current artifacts, not a later failed artifact", async () => {
    const harness = await createHarness();
    try {
      const current = aggregateResultFor(harness.identity);
      Object.assign(current.sections["centre-benchmark"], { completedAt: "2026-08-15T01:00:00.000Z" });
      Object.assign(current.sections["standby-wastage"], { completedAt: "2026-08-15T03:00:00.000Z" });
      const read = vi.fn().mockResolvedValue(current);
      const execute = vi.fn();
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-admin-state`),
        ["projects", harness.project.id, "overview-admin-state"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: { analysis: { lastGeneratedAt: "2026-08-15T01:00:00.000Z" } },
        },
      });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("rejects ordinary users before reading Admin readiness", async () => {
    const harness = await createHarness();
    try {
      const read = vi.fn();
      const execute = vi.fn();
      const resolveCurrentIdentity = vi.fn();
      const context = {
        ...harness.context,
        userId: "second-user",
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/${harness.project.id}/overview-admin-state`),
        ["projects", harness.project.id, "overview-admin-state"],
        context,
      );

      expect(response).toMatchObject({
        status: 403,
        body: { success: false, error: { code: "FORBIDDEN", message: "ENERGYIQ_ADMIN_REQUIRED" } },
      });
      expect(resolveCurrentIdentity).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("rejects an admin Project action when the Project is outside the selected Workspace", async () => {
    const harness = await createHarness();
    try {
      const read = vi.fn();
      const execute = vi.fn();
      const resolveCurrentIdentity = vi.fn();
      const context = {
        ...harness.context,
        workspaceId: "default",
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", harness.project.id, "overview-admin-state", "actions", "generate-missing"],
        context,
      );

      expect(response).toMatchObject({
        status: 403,
        body: { success: false, error: { code: "FORBIDDEN", message: "ENERGYIQ_PROJECT_FORBIDDEN" } },
      });
      expect(resolveCurrentIdentity).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("lets an authorized Tuya-style admin generate only missing current analysis", async () => {
    const harness = await createHarness();
    try {
      harness.metadata.energyIq.upsertUserRole({ user_id: "second-user", role: "admin" });
      const missing = aggregateResultFor(harness.identity);
      const ready = readyAggregateResultFor(harness.identity);
      const read = vi.fn()
        .mockResolvedValueOnce(missing)
        .mockResolvedValue(ready);
      const execute = vi.fn().mockResolvedValue(ready);
      const executeAdditional = vi.fn().mockResolvedValue({ status: "available" });
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        userId: "second-user",
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
        additionalAiInsightsWorkflow: { execute: executeAdditional },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", harness.project.id, "overview-admin-state", "actions", "generate-missing"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            projectId: "preschool-demo",
            analysis: { status: "ready", readyCount: 6, totalCount: 6 },
            allowedActions: [],
            recommendedNextAction: null,
          },
        },
      });
      expect(execute).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith({
        identity: harness.identity,
        user: expect.objectContaining({ id: "second-user" }),
        retry: false,
      });
      expect(executeAdditional).toHaveBeenCalledOnce();
      expect(executeAdditional).toHaveBeenCalledWith({
        baseIdentity: harness.identity,
        user: expect.objectContaining({ id: "second-user" }),
      });
    } finally {
      harness.close();
    }
  });

  it("lets an admin retry only the failed current Section without rerunning ready siblings", async () => {
    const harness = await createHarness();
    try {
      const ready = readyAggregateResultFor(harness.identity);
      const failed = {
        ...ready,
        sections: {
          ...ready.sections,
          "centre-benchmark": {
            status: "unavailable" as const,
            artifactId: "section-centre-benchmark-failed",
            reason: "STRUCTURED_OUTPUT_SCHEMA_VALIDATION_FAILED",
          },
        },
      };
      const read = vi.fn()
        .mockResolvedValueOnce(failed)
        .mockResolvedValue(ready);
      const execute = vi.fn().mockResolvedValue(ready);
      const executeAdditional = vi.fn();
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
        additionalAiInsightsWorkflow: { execute: executeAdditional },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", harness.project.id, "overview-admin-state", "actions", "generate-missing"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: { analysis: { status: "ready" }, allowedActions: [] } },
      });
      expect(execute).toHaveBeenCalledOnce();
      expect(execute).toHaveBeenCalledWith({
        identity: harness.identity,
        user: expect.objectContaining({ id: "dev-user" }),
        retry: true,
        retryTarget: "centre-benchmark",
      });
      expect(executeAdditional).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("restores an exact pinned Ngee Ann Layer 1–3 read model through the Project adapter without generation", async () => {
    const harness = await createHarness();
    try {
      const ngeeAnnProject = harness.metadata.energyIq.getProject("ngee-ann-polytechnic");
      const pin = {
        from: "2026-05-20",
        to: "2026-06-16",
        dataSnapshotId: "ngee-snapshot-current",
        projectReleaseId: "ngee-release-current",
      };
      const identity = {
        ...harness.identity,
        workspaceId: ngeeAnnProject.workspace_id,
        projectId: ngeeAnnProject.id,
        scopeId: ngeeAnnProject.root_scope_id,
        rendererKey: "ngee-ann-overview",
        dataSnapshotId: pin.dataSnapshotId,
        projectReleaseId: pin.projectReleaseId,
        analysisPeriodFrom: "2026-05-19T16:00:00.000Z",
        analysisPeriodTo: "2026-06-16T16:00:00.000Z",
      };
      const readModel = {
        contract: "energyiq-project-overview-ai-read-model@1",
        rendererKey: "ngee-ann-overview",
        binding: {
          workspaceId: identity.workspaceId,
          projectId: identity.projectId,
          scopeId: identity.scopeId,
          dataSnapshotId: identity.dataSnapshotId,
          projectReleaseId: identity.projectReleaseId,
          analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
          modelProfileId: identity.modelProfileId,
          modelProfileRevision: identity.modelProfileRevision,
          generation: projectOverviewAiGenerationBinding(identity),
        },
        keyFindings: { status: "unavailable", reason: "Key Findings has not been generated." },
        sections: {
          "trend-and-demand": { status: "unavailable", reason: "Not generated." },
          "time-behaviour": { status: "unavailable", reason: "Not generated." },
          "circuit-concentration": { status: "unavailable", reason: "Not generated." },
          "decision-priorities": { status: "unavailable", reason: "Not generated." },
        },
        additionalInsights: { status: "unavailable", reason: "Not generated." },
      };
      const resolveIdentity = vi.fn().mockResolvedValue(identity);
      const readExact = vi.fn().mockResolvedValue(readModel);
      const generateMissing = vi.fn();
      const context = {
        ...harness.context,
        workspaceId: ngeeAnnProject.workspace_id,
        overviewAiWorkflow: {
          resolveReadIdentity: vi.fn(() => { throw new Error("PRESCHOOL_PATH_MUST_NOT_RUN"); }),
          resolveCurrentIdentity: vi.fn(() => { throw new Error("PRESCHOOL_PATH_MUST_NOT_RUN"); }),
          read: vi.fn(),
          execute: vi.fn(),
        },
        projectOverviewAiAdapters: [{
          rendererKey: "ngee-ann-overview",
          projectId: "ngee-ann-polytechnic",
          keyFindings: true,
          sections: [
            { id: "trend-and-demand", label: "Trend and demand" },
            { id: "time-behaviour", label: "Time behaviour" },
            { id: "circuit-concentration", label: "Circuit concentration" },
            { id: "decision-priorities", label: "Decision priorities" },
          ],
          additionalInsights: true,
          resolveIdentity,
          readExact,
          generateMissing,
        }],
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/ngee-ann-polytechnic/overview-ai-artifact?scopeId=${encodeURIComponent(ngeeAnnProject.root_scope_id)}&from=${pin.from}&to=${pin.to}&dataSnapshotId=${pin.dataSnapshotId}&projectReleaseId=${pin.projectReleaseId}`),
        ["projects", "ngee-ann-polytechnic", "overview-ai-artifact"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: {
          success: true,
          data: {
            contract: "energyiq-project-overview-ai-read-model@1",
            rendererKey: "ngee-ann-overview",
            binding: {
              dataSnapshotId: pin.dataSnapshotId,
              projectReleaseId: pin.projectReleaseId,
            },
            sections: {
              "trend-and-demand": { status: "unavailable" },
              "time-behaviour": { status: "unavailable" },
              "circuit-concentration": { status: "unavailable" },
              "decision-priorities": { status: "unavailable" },
            },
          },
        },
      });
      expect(JSON.stringify(response)).not.toMatch(/centre-benchmark|standby-wastage|operating-behaviour|planning-outlook/u);
      expect(resolveIdentity).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "ngee-ann-polytechnic",
        scopeId: ngeeAnnProject.root_scope_id,
        request: { kind: "pinned", pin },
      }));
      expect(readExact).toHaveBeenCalledWith({ identity, user: expect.objectContaining({ id: "dev-user" }) });
      expect(generateMissing).not.toHaveBeenCalled();

      readExact.mockResolvedValueOnce({
        ...readModel,
        binding: {
          ...readModel.binding,
          generation: {
            ...readModel.binding.generation,
            workflowRevision: "stale-workflow-v0",
          },
        },
      });
      await expect(handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/ngee-ann-polytechnic/overview-ai-artifact?scopeId=${encodeURIComponent(ngeeAnnProject.root_scope_id)}&from=${pin.from}&to=${pin.to}&dataSnapshotId=${pin.dataSnapshotId}&projectReleaseId=${pin.projectReleaseId}`),
        ["projects", "ngee-ann-polytechnic", "overview-ai-artifact"],
        context,
      )).resolves.toMatchObject({
        status: 500,
        body: { success: false, error: { message: "ENERGYIQ_PROJECT_OVERVIEW_AI_READ_MODEL_IDENTITY_MISMATCH" } },
      });

      resolveIdentity.mockResolvedValueOnce({ ...identity, projectId: "preschool-demo" });
      await expect(handleEnergyApiRequest(
        getRequest(`/api/v1/energy/projects/ngee-ann-polytechnic/overview-ai-artifact?scopeId=${encodeURIComponent(ngeeAnnProject.root_scope_id)}&from=${pin.from}&to=${pin.to}&dataSnapshotId=${pin.dataSnapshotId}&projectReleaseId=${pin.projectReleaseId}`),
        ["projects", "ngee-ann-polytechnic", "overview-ai-artifact"],
        context,
      )).resolves.toMatchObject({
        status: 500,
        body: { success: false, error: { message: "ENERGYIQ_PROJECT_OVERVIEW_AI_IDENTITY_MISMATCH" } },
      });

      generateMissing.mockResolvedValueOnce({
        ...readModel,
        binding: { ...readModel.binding, workspaceId: "other-workspace" },
      });
      await expect(handleEnergyApiRequest(
        jsonPost({}),
        ["projects", "ngee-ann-polytechnic", "overview-ai-artifact", "ensure"],
        context,
      )).resolves.toMatchObject({
        status: 500,
        body: { success: false, error: { message: "ENERGYIQ_PROJECT_OVERVIEW_AI_READ_MODEL_IDENTITY_MISMATCH" } },
      });
    } finally {
      harness.close();
    }
  });

  it("lets an admin retry failed Additional Insights without rerunning ready core analysis", async () => {
    const harness = await createHarness();
    try {
      const ready = readyAggregateResultFor(harness.identity);
      const failedAdditional = {
        ...ready,
        additional: {
          status: "unavailable" as const,
          artifactId: "additional-current-failed",
          reason: "PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID",
        },
      };
      const read = vi.fn()
        .mockResolvedValueOnce(failedAdditional)
        .mockResolvedValue(ready);
      const execute = vi.fn();
      const executeAdditional = vi.fn().mockResolvedValue({ status: "available" });
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
        additionalAiInsightsWorkflow: { execute: executeAdditional },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", harness.project.id, "overview-admin-state", "actions", "generate-missing"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: { analysis: { status: "ready" }, allowedActions: [] } },
      });
      expect(execute).not.toHaveBeenCalled();
      expect(executeAdditional).toHaveBeenCalledOnce();
      expect(executeAdditional).toHaveBeenCalledWith({
        baseIdentity: harness.identity,
        user: expect.objectContaining({ id: "dev-user" }),
      });
    } finally {
      harness.close();
    }
  });

  it("does not start Provider work when every current analysis result is already ready", async () => {
    const harness = await createHarness();
    try {
      const ready = readyAggregateResultFor(harness.identity);
      const read = vi.fn().mockResolvedValue(ready);
      const execute = vi.fn();
      const executeAdditional = vi.fn();
      const resolveCurrentIdentity = vi.fn().mockResolvedValue(harness.identity);
      const context = {
        ...harness.context,
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
        additionalAiInsightsWorkflow: { execute: executeAdditional },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", harness.project.id, "overview-admin-state", "actions", "generate-missing"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: { analysis: { status: "ready" }, allowedActions: [] } },
      });
      expect(execute).not.toHaveBeenCalled();
      expect(executeAdditional).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("forbids ordinary users from Generate missing analysis", async () => {
    const harness = await createHarness();
    try {
      const read = vi.fn();
      const execute = vi.fn();
      const executeAdditional = vi.fn();
      const resolveCurrentIdentity = vi.fn();
      const context = {
        ...harness.context,
        userId: "second-user",
        overviewAiWorkflow: { execute, read, resolveCurrentIdentity },
        additionalAiInsightsWorkflow: { execute: executeAdditional },
      } as unknown as Required<ConfigApiContext>;

      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", harness.project.id, "overview-admin-state", "actions", "generate-missing"],
        context,
      );

      expect(response).toMatchObject({
        status: 403,
        body: { success: false, error: { code: "FORBIDDEN", message: "ENERGYIQ_ADMIN_REQUIRED" } },
      });
      expect(resolveCurrentIdentity).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(executeAdditional).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });
});

async function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "energy-api-overview-artifact-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const gateway = new LocalDataGateway(metadata);
  ensureEnergyIqBootstrap(metadata);
  metadata.configResources.upsert({
    id: "profile-test",
    workspace_id: "default",
    user_id: "dev-user",
    kind: "model-profile",
    name: "Test profile",
    payload: { provider: "openai-compatible", modelName: "model-test" },
    default_enabled: true,
    status: "connected",
  });
  metadata.workspaceDefaultModelProfiles.set({
    workspace_id: "default",
    profile_id: "profile-test",
    profile_owner_user_id: "dev-user",
    configured_by_user_id: "dev-user",
  });
  metadata.users.upsertDevUser({ id: "second-user", email: "second-user@example.test", display_name: "Second User", dev_token: "second-user-token" });
  metadata.workspaceMemberships.upsert({ workspace_id: PRESCHOOL_WORKSPACE_ID, user_id: "second-user", role: "member" });
  const project = metadata.energyIq.getProject("preschool-demo");
  const identity = createOverviewAiArtifactIdentity({
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: project.id,
    scopeId: project.root_scope_id,
    dataSnapshotId: project.data_snapshot_id,
    projectReleaseId: "legacy-profile:preschool-demo:2",
    analysisPeriodFrom: "2026-04-30T16:00:00.000Z",
    analysisPeriodTo: "2026-05-31T16:00:00.000Z",
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    modelProfileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
    modelProfileRevision: 1,
  });
  return {
    metadata,
    gateway,
    project,
    identity,
    context: {
      metadataStore: metadata,
      dataGateway: gateway,
      userId: "dev-user",
      workspaceId: PRESCHOOL_WORKSPACE_ID,
    },
    close: () => {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

function explainableAggregateResultFor(identity: ReturnType<typeof createOverviewAiArtifactIdentity>) {
  const current = aggregateResultFor(identity);
  const coreMethod = {
    skillId: "energyiq-open-discovery",
    semanticVersion: "1.0.0",
    resourceId: "builtin:energyiq-open-discovery",
    resourceRevision: 1,
    contentSha256: "5af7fdc13e241bf92a4b14268aa1382996c2af31d920d9dc8644bb2efec87d59",
    scope: "builtin" as const,
    workspaceId: identity.workspaceId,
    userId: "energyiq-system",
    role: "core-method" as const,
  };
  return {
    ...current,
    additional: {
      status: "available" as const,
      artifactId: "additional-current",
      result: {
        artifactKind: "autonomous-insights" as const,
        status: "available" as const,
        providerProfileId: identity.modelProfileId,
        runId: "run-additional-current",
        contract: { id: "energyiq-additional-ai-insights" as const, revision: "energyiq-additional-ai-insights-v2" },
        binding: current.binding,
        methodExecution: {
          methodSetId: "preschool-additional-insights-current",
          methodSetRevision: "v1",
          methodSetFingerprint: `sha256:${"a".repeat(64)}`,
          loadedMethods: [coreMethod],
        },
        capability: {
          revision: "scoped-read-only-v1",
          mode: "scoped-read-only" as const,
          allowedTools: [
            "energy.evidence.read",
            "energy.metrics.compare",
            "energy.timeseries.analyze",
            "energy.snapshot-history.read",
            "energy.project-knowledge.read",
          ],
          usedTools: ["energy.evidence.read", "energy.metrics.compare"],
        },
        toolAudits: [{
          auditId: "audit-evidence-success",
          toolCallId: "tool-call-success",
          toolName: "energy.evidence.read",
          status: "succeeded" as const,
          evidenceRefs: ["fact:portfolio-demand"],
        }, {
          auditId: "audit-compare-rejected",
          toolCallId: "tool-call-rejected",
          toolName: "energy.metrics.compare",
          status: "rejected" as const,
          evidenceRefs: [],
          errorCode: "TOOL_INPUT_REJECTED",
        }],
        evidenceLineage: {
          catalogContract: "analysis-context-evidence@1" as const,
          sourceId: `project-analysis-snapshot:${identity.projectId}:${identity.dataSnapshotId}`,
          pins: {
            workspaceId: identity.workspaceId,
            projectId: identity.projectId,
            scopeId: identity.scopeId,
            dataSnapshotId: identity.dataSnapshotId,
            dataCutoff: identity.analysisPeriodTo,
            projectReleaseId: identity.projectReleaseId,
            metricVersion: "metric-v1",
          },
          facts: [{
            id: "fact:portfolio-demand",
            status: "confirmed" as const,
            evidenceRefs: ["query:portfolio-demand"],
          }],
        },
        publication: {
          policyId: "energyiq-additional-ai-insights" as const,
          policyRevision: "additional-insights-v2",
          discoveredCount: 1,
          acceptedCount: 1,
          rejectedCount: 0,
          publishedCount: 1,
          sourceOrderCandidateIds: ["additional-finding-1"],
          acceptedCandidateIds: ["additional-finding-1"],
          rejectedCandidateIds: [],
          publishedCandidateIds: ["additional-finding-1"],
          suppressedCandidateIds: [],
        },
        findings: [{
          id: "additional-finding-1",
          title: "Test a repeatable scheduling pattern",
          text: "**Evidence signal:** Portfolio demand stayed concentrated in two Centres.\n\n**AI angle:** This may be a repeatable scheduling pattern worth testing.",
          epistemicStatus: "inferred" as const,
          origin: { kind: "ai-discovery" as const, coreMethod, directionMethods: [] as const },
          evidenceRefs: ["fact:portfolio-demand"],
          toolAuditIds: ["audit-evidence-success", "audit-compare-rejected"],
          deepDiveQuestion: "Does this concentration repeat on comparable days?",
        }],
      },
    },
  };
}

function aggregateResultFor(identity: ReturnType<typeof createOverviewAiArtifactIdentity>) {
  const binding = {
    workspaceId: identity.workspaceId,
    projectId: "preschool-demo" as const,
    scopeId: identity.scopeId,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
    modelProfileId: identity.modelProfileId,
    modelProfileRevision: identity.modelProfileRevision,
  };
  return {
    artifactKind: "preschool-overview-ai-read-model" as const,
    status: "available" as const,
    binding,
    sections: {
      "centre-benchmark": {
        status: "available" as const,
        artifactId: "section-benchmark",
        result: {
          artifactKind: "section-interpretation" as const,
          status: "available" as const,
          providerProfileId: identity.modelProfileId,
          runId: "run-benchmark",
          binding,
          sectionId: "centre-benchmark" as const,
          summary: "Benchmark evidence supports a focused review.",
          keyPoints: [],
        },
      },
      "standby-wastage": { status: "unavailable" as const, artifactId: "section-standby", reason: "SECTION_FAILED" },
      "operating-behaviour": { status: "unavailable" as const, reason: "Not generated." },
      "planning-outlook": { status: "unavailable" as const, reason: "Not generated." },
    },
    executive: { status: "unavailable" as const, artifactId: "executive", reason: "SYNTHESIS_FAILED" },
  };
}

function readyAggregateResultFor(identity: ReturnType<typeof createOverviewAiArtifactIdentity>) {
  const current = aggregateResultFor(identity);
  const available = (sectionId: keyof typeof current.sections) => ({
    status: "available" as const,
    artifactId: `section-${sectionId}`,
    result: {
      artifactKind: "section-interpretation" as const,
      status: "available" as const,
      providerProfileId: identity.modelProfileId,
      runId: `run-${sectionId}`,
      binding: current.binding,
      sectionId,
      summary: "Current evidence is available.",
      keyPoints: [],
    },
  });
  return {
    ...current,
    sections: {
      "centre-benchmark": available("centre-benchmark"),
      "standby-wastage": available("standby-wastage"),
      "operating-behaviour": available("operating-behaviour"),
      "planning-outlook": available("planning-outlook"),
    },
    executive: {
      status: "available" as const,
      artifactId: "executive-current",
      result: {
        artifactKind: "executive-synthesis" as const,
        status: "available" as const,
        providerProfileId: identity.modelProfileId,
        runId: "run-executive",
        binding: current.binding,
        sourceSectionArtifactIds: [],
        keyFindings: [],
      },
    },
    additional: {
      status: "available" as const,
      artifactId: "additional-current",
      result: { status: "available" as const },
    },
  };
}

function resultFor(identity: ReturnType<typeof createOverviewAiArtifactIdentity>, runId: string) {
  const binding = {
    projectId: identity.projectId,
    scopeId: identity.scopeId,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    dataCutoff: identity.analysisPeriodTo,
    analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
    outputContractRevision: identity.outputContractRevision,
  };
  return {
    status: "available",
    providerProfileId: identity.modelProfileId,
    runId,
    packId: identity.analysisPackId,
    packRevision: identity.analysisPackRevision,
    contract: { id: "preschool-ai-accepted-artifact", revision: identity.outputContractRevision },
    binding,
    workflow: {
      id: "preschool-two-stage",
      revision: identity.workflowRevision,
      methodSkill: { id: identity.methodSkillId, revision: identity.methodSkillRevision },
      stages: {
        investigator: { runId: `${runId}-investigator`, promptRevision: identity.investigatorPromptRevision },
        editor: { runId, promptRevision: identity.editorPromptRevision },
      },
    },
    findings: [],
  };
}

function jsonPost(body: unknown, url = "/api/v1/energy/projects/preschool-demo/overview-ai-artifact"): IncomingMessage {
  const request = new PassThrough();
  Object.assign(request, { method: "POST", headers: { "content-type": "application/json" }, url });
  request.end(JSON.stringify(body));
  return request as unknown as IncomingMessage;
}

function getRequest(url: string): IncomingMessage {
  const request = new PassThrough();
  Object.assign(request, { method: "GET", headers: {}, url });
  request.end();
  return request as unknown as IncomingMessage;
}

function totalChanges(metadataStore: ReturnType<typeof createMetadataStore>): number {
  const row = metadataStore.db.prepare("SELECT total_changes() AS value").get();
  return typeof row === "object" && row !== null && typeof row.value === "number" ? row.value : -1;
}
