import { LocalDataGateway } from "@datafoundry/data-gateway";
import { LocalFileAssetService } from "@datafoundry/files";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { prewarmPublishedProjectOverviewProjections } from "./project-analysis-resolver.js";

describe("Published Project Overview prewarm", () => {
  it("rejects a non-admin caller before enumerating another customer Workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "published-overview-prewarm-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "project-member",
        email: "project-member@example.com",
        display_name: "Project Member",
        dev_token: "project-member-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "default",
        user_id: "project-member",
        role: "member",
      });
      metadata.energyIq.upsertUserRole({ user_id: "project-member", role: "user" });
      metadata.energyIq.upsertProjectAccess({
        project_id: "ngee-ann-polytechnic",
        user_id: "project-member",
        role: "viewer",
      });

      await expect(prewarmPublishedProjectOverviewProjections({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "project-member" }),
        workspaceId: "default",
        databasePath: join(root, "energy.duckdb"),
      })).rejects.toThrow("ENERGYIQ_ADMIN_REQUIRED");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks every configured published Project only in the explicitly selected Workspace", async () => {
    const root = mkdtempSync(join(tmpdir(), "published-overview-prewarm-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.workspaces.upsert({
        id: "unconfigured-customer",
        owner_user_id: "dev-user",
        name: "Unconfigured Customer",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "unconfigured-published-project",
        workspace_id: "unconfigured-customer",
        name: "Unconfigured Published Project",
        status: "published",
      });
      const preschool = metadata.energyIq.getProject("preschool-demo");
      metadata.energyIq.upsertProject({ ...preschool, workspace_id: "default" });
      const runSqlReadonly = vi.spyOn(gateway, "runSqlReadonly");
      const ngee = metadata.energyIq.getProject("ngee-ann-polytechnic");
      metadata.energyIq.beginProjectDataPublication({
        project_id: ngee.id,
        expected_previous_snapshot_id: ngee.data_snapshot_id,
      });
      const outcomes = await prewarmPublishedProjectOverviewProjections({
        metadataStore: metadata,
        dataGateway: gateway,
        fileAssetService: files,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        databasePath: join(root, "energy.duckdb"),
      });

      expect(outcomes).toEqual([
        {
          workspaceId: "default",
          projectId: "ngee-ann-polytechnic",
          status: "not_ready",
        },
        {
          workspaceId: "default",
          projectId: "preschool-demo",
          status: "not_ready",
        },
      ]);
      expect(outcomes).not.toContainEqual(expect.objectContaining({
        projectId: "unconfigured-published-project",
      }));
      expect(outcomes).not.toContainEqual(expect.objectContaining({
        projectId: "tuya-office",
      }));
      expect(runSqlReadonly).not.toHaveBeenCalled();
      expect(metadata.energyIq.findProjectDataPublication(ngee.id)).toBeUndefined();
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
