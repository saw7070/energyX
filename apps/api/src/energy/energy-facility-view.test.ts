import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap, NGEE_ANN_WORKSPACE_ID, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { readEnergyFacilityView } from "./energy-facility-view.js";

const withStore = (run: (metadata: ReturnType<typeof createMetadataStore>) => void) => {
  const root = mkdtempSync(join(tmpdir(), "energy-facility-view-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    run(metadata);
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

const addViewer = (metadata: ReturnType<typeof createMetadataStore>, workspaceId: string) => {
  const viewer = metadata.users.createPasswordUser({ id: "viewer", email: "viewer@x.test" });
  metadata.workspaceMemberships.upsert({ workspace_id: workspaceId, user_id: viewer.id, role: "member" });
  return viewer;
};

describe("readEnergyFacilityView", () => {
  it("gives a viewer the published Facility, including hours and rate, without creating or reading a draft", () => {
    withStore((metadata) => {
      const viewer = addViewer(metadata, NGEE_ANN_WORKSPACE_ID);
      const project = metadata.energyIq.listProjectsByWorkspace(NGEE_ANN_WORKSPACE_ID).find((item) => item.status === "published")!;
      const draftsBefore = metadata.db.prepare("SELECT COUNT(*) AS n FROM energyiq_project_setup_drafts").get() as { n: number };

      const view = readEnergyFacilityView(metadata, viewer.id, NGEE_ANN_WORKSPACE_ID, project.id);

      expect(view.setup.draft.revision).toBe(0);
      expect(view.setup.project.has_unpublished_changes).toBe(false);
      expect(view.setup.validation).toEqual({ blocking: false, issues: [] });
      expect(view.setup.draft.document.nodes?.length).toBeGreaterThan(0);
      expect(view.policies!.hasUnpublishedChanges).toBe(false);
      expect(view.policies!.pending).toEqual({
        tariff_schedule_version: view.policies!.published.tariff_schedule_version,
        business_calendar_version: view.policies!.published.business_calendar_version
      });
      const draftsAfter = metadata.db.prepare("SELECT COUNT(*) AS n FROM energyiq_project_setup_drafts").get() as { n: number };
      expect(draftsAfter.n).toBe(draftsBefore.n);
    });
  });

  it("shows only the live rate and calendar, not other saved revisions", () => {
    withStore((metadata) => {
      const viewer = addViewer(metadata, NGEE_ANN_WORKSPACE_ID);
      const project = metadata.energyIq.listProjectsByWorkspace(NGEE_ANN_WORKSPACE_ID).find((item) => item.status === "published")!;
      const view = readEnergyFacilityView(metadata, viewer.id, NGEE_ANN_WORKSPACE_ID, project.id);
      const { tariff_schedule_version: tariff, business_calendar_version: calendar } = view.policies!.published;
      expect(view.policies!.tariffRevisions.every((item) => item.version_id === tariff)).toBe(true);
      expect(view.policies!.operatingCalendarRevisions.every((item) => item.version_id === calendar)).toBe(true);
    });
  });

  it("refuses someone who is not a member of the project's Organisation", () => {
    withStore((metadata) => {
      const viewer = addViewer(metadata, PRESCHOOL_WORKSPACE_ID);
      const project = metadata.energyIq.listProjectsByWorkspace(NGEE_ANN_WORKSPACE_ID).find((item) => item.status === "published")!;
      expect(() => readEnergyFacilityView(metadata, viewer.id, NGEE_ANN_WORKSPACE_ID, project.id)).toThrow("ENERGYIQ_PROJECT_FORBIDDEN");
      expect(() => readEnergyFacilityView(metadata, viewer.id, PRESCHOOL_WORKSPACE_ID, project.id)).toThrow("ENERGYIQ_PROJECT_FORBIDDEN");
    });
  });
});
