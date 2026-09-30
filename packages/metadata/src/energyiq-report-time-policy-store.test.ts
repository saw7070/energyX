import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("EnergyIqReportTimePolicyStore", () => {
  it("publishes and restores an immutable Project-owned policy revision", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-report-time-policy-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      seedProject(metadata);
      const policy = metadata.energyIq.reportTimePolicies.publish({
        project_id: "project-time-policy",
        policy: {
          policyId: "operations-policy",
          revision: "1",
          windows: [{
            windowId: "recent-28d",
            role: "recent_operations",
            label: "Recent 28 complete days",
            strategy: { kind: "rolling_complete_days", days: 28 },
          }],
        },
        published_by: "dev-user",
        published_at: "2026-08-19T00:00:00.000Z",
      });

      expect(policy.revision_id).toBe("operations-policy@1");
      expect(metadata.energyIq.reportTimePolicies.get("project-time-policy", "operations-policy@1")).toEqual(policy);
      expect(metadata.energyIq.reportTimePolicies.getLatest("project-time-policy")).toEqual(policy);
      expect(() => metadata.energyIq.reportTimePolicies.publish({
        project_id: "project-time-policy",
        policy: { ...policy.policy, windows: [] },
        published_by: "dev-user",
        published_at: "2026-08-19T00:01:00.000Z",
      })).toThrow(/ENERGYIQ_REPORT_TIME_POLICY/);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const seedProject = (metadata: ReturnType<typeof createMetadataStore>): void => {
  metadata.workspaces.upsert({
    id: "workspace-time-policy",
    owner_user_id: "dev-user",
    name: "Time Policy Workspace",
    kind: "customer",
  });
  metadata.energyIq.projectSetup.bootstrapPublished({
    project: {
      id: "project-time-policy",
      workspace_id: "workspace-time-policy",
      name: "Time Policy Project",
      hierarchy_revision_id: "project-time-policy-hierarchy-v1",
      meter_formula_revision_id: "project-time-policy-meter-formula-v1",
      data_snapshot_id: "snapshot-time-policy",
      root_scope_id: "project-time-policy-root",
    },
    document: {
      project: { name: "Time Policy Project", timezone: "Asia/Singapore" },
      source_manifest: { id: "manifest-time-policy", source_sha256: ["a".repeat(64)], confirmed: true },
      tier_structure_locked: true,
      tiers: [{ id: "project-time-policy-tier", ordinal: 1, alias: "Area" }],
      nodes: [{
        id: "project-time-policy-area",
        tier_definition_id: "project-time-policy-tier",
        name: "Area One",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
    },
    published_by: "dev-user",
  });
};
