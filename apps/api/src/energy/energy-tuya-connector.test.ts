import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { resolveEnergyTuyaProjectConnector } from "./energy-tuya-connector.js";
import {
  TUYA_OFFICE_PROJECT_ID,
  TUYA_OFFICE_WORKSPACE_ID,
} from "./tuya-office-project.js";

describe("Energy Tuya Project Connector", () => {
  it("binds protected device ids to exact published Meter Points without trusting browser labels", () => {
    withMetadata((metadata) => {
      const project = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(project.id)
        .find((candidate) => candidate.id === project.hierarchy_revision_id)!;
      const document = JSON.parse(revision.snapshot_json) as {
        meter_mapping?: { rows?: Array<{ id: string; source_label: string }> };
      };
      const rows = document.meter_mapping?.rows ?? [];
      const bindings = Object.fromEntries(rows.map((row, index) => [
        row.id,
        `exampledevice${String(index + 1).padStart(3, "0")}`,
      ]));

      const connector = resolveEnergyTuyaProjectConnector({
        metadataStore: metadata,
        projectId: TUYA_OFFICE_PROJECT_ID,
        env: {
          ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID: TUYA_OFFICE_PROJECT_ID,
          ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID: TUYA_OFFICE_WORKSPACE_ID,
          ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON: JSON.stringify(bindings),
        },
      });

      expect(connector.projectId).toBe(TUYA_OFFICE_PROJECT_ID);
      expect(connector.workspaceId).toBe(TUYA_OFFICE_WORKSPACE_ID);
      expect(connector.hierarchyRevisionId).toBe(revision.id);
      expect(connector.hierarchySequence).toBe(revision.sequence);
      expect(connector.connectorFingerprint).toMatch(/^[a-f0-9]{64}$/u);
      expect(connector.devices).toHaveLength(rows.length);
      expect(connector.devices[0]).toEqual({
        deviceId: "exampledevice001",
        sourceLabel: rows[0]?.source_label,
      });
      expect(connector.meterPoints[0]).toEqual({
        meterPointId: rows[0]?.id,
        sourceLabel: rows[0]?.source_label,
      });
    });
  });

  it("fails closed for another Project, missing Meter Points, and unknown bindings", () => {
    withMetadata((metadata) => {
      const common = {
        metadataStore: metadata,
        env: {
          ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID: TUYA_OFFICE_PROJECT_ID,
          ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID: TUYA_OFFICE_WORKSPACE_ID,
          ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON: JSON.stringify({
            "unknown-meter": "exampledevice001",
          }),
        },
      };
      expect(() => resolveEnergyTuyaProjectConnector({
        ...common,
        projectId: "ngee-ann-polytechnic",
      })).toThrow("ENERGYIQ_TUYA_PROJECT_UNSUPPORTED");
      expect(() => resolveEnergyTuyaProjectConnector({
        ...common,
        projectId: TUYA_OFFICE_PROJECT_ID,
      })).toThrow("ENERGYIQ_TUYA_DEVICE_BINDINGS_MISMATCH");
      expect(() => resolveEnergyTuyaProjectConnector({
        metadataStore: metadata,
        projectId: TUYA_OFFICE_PROJECT_ID,
        env: {},
      })).toThrow("ENERGYIQ_TUYA_CONNECTOR_NOT_CONFIGURED");
    });
  });
});

const withMetadata = (run: (metadata: ReturnType<typeof createMetadataStore>) => void): void => {
  const root = mkdtempSync(join(tmpdir(), "energy-tuya-connector-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    run(metadata);
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
