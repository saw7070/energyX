import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createEnergyIqSourceManifest, createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import {
  ensureEnergyIqBootstrap,
  NGEE_ANN_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";

describe("Energy import materialization guard", () => {
  it("returns 409 without reading the workbook or mutating the batch when saved Mapping is incomplete", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-materialization-guard-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    let workbookReadCount = 0;
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const sourceSha256 = ["a".repeat(64), "b".repeat(64)];
      for (const [index, label] of ["Meter A", "Meter B"].entries()) {
        metadata.energyIq.createImportBatch({
          id: `batch-${index + 1}`,
          workspace_id: NGEE_ANN_WORKSPACE_ID,
          project_id: projectId,
          source_kind: "excel",
          source_sha256: sourceSha256[index]!,
          filename: `batch-${index + 1}.xlsx`,
          status: "inspected",
          inspection: { sourceLabels: [{ label, rowCount: 10 }] },
          created_by: "dev-user",
        });
      }

      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: projectId,
        user_id: "dev-user",
      });
      metadata.energyIq.projectSetup.saveDraft({
        project_id: projectId,
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: {
          ...draft.document,
          source_manifest: createEnergyIqSourceManifest(sourceSha256, true),
          meter_mapping: {
            schema_version: 2,
            source_kind: "excel",
            confirmed: true,
            rows: [{
              id: "mapping-meter-a",
              source_label: "Meter A",
              scope_id: "level-6",
              display_name: "Meter A",
              resource: "electricity",
              category: "load",
              coverage: "whole",
              meter_role: "total",
              aggregation_usage: "official",
            }],
          },
        },
      });
      const batchesBefore = [
        metadata.energyIq.getImportBatch("batch-1"),
        metadata.energyIq.getImportBatch("batch-2"),
      ];

      const response = await handleEnergyApiRequest(
        request("POST"),
        ["projects", projectId, "imports", "batch-1", "materialize"],
        {
          metadataStore: metadata,
          dataGateway: gateway,
          fileAssetService: {
            readRef: () => {
              workbookReadCount += 1;
              throw new Error("WORKBOOK_MUST_NOT_BE_READ");
            },
          },
          userId: "dev-user",
          workspaceId: NGEE_ANN_WORKSPACE_ID,
        } as unknown as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: {
            code: "CONFLICT",
            message: "ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:SOURCE_LABEL_UNMAPPED",
          },
        },
      });
      expect(workbookReadCount).toBe(0);
      expect([
        metadata.energyIq.getImportBatch("batch-1"),
        metadata.energyIq.getImportBatch("batch-2"),
      ]).toEqual(batchesBefore);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it.each([
    ["row", "ENERGYIQ_METER_RESOURCE_INVALID:0"],
    ["route", "ENERGYIQ_OFFICIAL_ROUTE_RESOURCE_INVALID:0"],
  ] as const)("rejects an unsupported Mapping %s resource instead of coercing it", async (target, message) => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-mapping-resource-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: projectId,
        user_id: "dev-user",
      });
      const hierarchyRevisionId = metadata.energyIq.getProject(projectId).hierarchy_revision_id;
      const publishedDocument = JSON.parse(metadata.energyIq.projectSetup
        .listHierarchyRevisions(projectId)
        .find((revision) => revision.id === hierarchyRevisionId)!.snapshot_json) as typeof draft.document;
      const mapping = publishedDocument.meter_mapping!;
      const document = {
        ...publishedDocument,
        meter_mapping: {
          ...mapping,
          rows: mapping.rows.map((row, index) => index === 0 && target === "row"
            ? { ...row, resource: "gas" }
            : row),
          official_aggregation_routes: (mapping.official_aggregation_routes ?? []).map((route, index) =>
            index === 0 && target === "route" ? { ...route, resource: "gas" } : route),
        },
      };

      const response = await handleEnergyApiRequest(
        request("PUT", { expectedRevision: draft.revision, document }),
        ["projects", projectId, "setup", "draft"],
        {
          metadataStore: metadata,
          dataGateway: gateway,
          userId: "dev-user",
          workspaceId: NGEE_ANN_WORKSPACE_ID,
        } as unknown as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 400,
        body: { success: false, error: { code: "BAD_REQUEST", message } },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const request = (method: "POST" | "PUT", body?: unknown): IncomingMessage => {
  const stream = new PassThrough();
  Object.assign(stream, {
    method,
    headers: { "content-type": "application/json" },
  });
  stream.end(body === undefined ? undefined : JSON.stringify(body));
  return stream as unknown as IncomingMessage;
};
