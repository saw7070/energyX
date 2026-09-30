import {
  LocalDataGateway,
} from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import {
  ensureEnergyIqBootstrap,
  NGEE_ANN_DAILY_ANOMALY_RULE_REVISION_ID,
  NGEE_ANN_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";

describe("Energy Project Release readiness", () => {
  it("rejects a Ngee Ann publication that omits the required daily anomaly Rule Revision", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-release-readiness-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const initialRelease = metadata.energyIq.templates
        .getLatestProjectRevision("ngee-ann-polytechnic");
      expect(initialRelease).not.toBeNull();
      const current = metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic");
      const withoutDailyAnomaly = metadata.energyIq.rules.saveProjectConfig({
        project_id: "ngee-ann-polytechnic",
        expected_revision: current.revision,
        selected_rule_revision_ids: current.selected_rule_revision_ids.filter(
          (id) => id !== NGEE_ANN_DAILY_ANOMALY_RULE_REVISION_ID,
        ),
        updated_by: "dev-user",
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          expectedRevision: 0,
          expectedTemplateDraftRevision: 0,
          expectedMetricConfigRevision: 0,
          expectedRuleConfigRevision: withoutDailyAnomaly.revision,
        }),
        ["projects", "ngee-ann-polytechnic", "setup", "publish"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: NGEE_ANN_WORKSPACE_ID,
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: {
            code: "CONFLICT",
            message: `ENERGYIQ_OVERVIEW_RULE_REQUIRED:${NGEE_ANN_DAILY_ANOMALY_RULE_REVISION_ID}`,
          },
        },
      });
      expect(metadata.energyIq.templates.getLatestProjectRevision("ngee-ann-polytechnic"))
        .toEqual(initialRelease);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  });

  it("applies saved changes without the caller supplying revisions, running the same release checks as publish", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-release-apply-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const initialRelease = metadata.energyIq.templates.getLatestProjectRevision("ngee-ann-polytechnic");
      const current = metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic");
      metadata.energyIq.rules.saveProjectConfig({
        project_id: "ngee-ann-polytechnic",
        expected_revision: current.revision,
        selected_rule_revision_ids: current.selected_rule_revision_ids.filter((id) => id !== NGEE_ANN_DAILY_ANOMALY_RULE_REVISION_ID),
        updated_by: "dev-user",
      });
      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", "ngee-ann-polytechnic", "setup", "apply"],
        { metadataStore: metadata, dataGateway: new LocalDataGateway(metadata), userId: "dev-user", workspaceId: NGEE_ANN_WORKSPACE_ID } as Required<ConfigApiContext>,
      );
      expect(response).toMatchObject({ status: 409, body: { success: false, error: { message: `ENERGYIQ_OVERVIEW_RULE_REQUIRED:${NGEE_ANN_DAILY_ANOMALY_RULE_REVISION_ID}` } } });
      expect(metadata.energyIq.templates.getLatestProjectRevision("ngee-ann-polytechnic")).toEqual(initialRelease);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  });

  it("rejects a Ngee Ann publication when the pending Calendar does not cover the anomaly lookback", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-release-calendar-readiness-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const initialRelease = metadata.energyIq.templates
        .getLatestProjectRevision("ngee-ann-polytechnic");
      expect(initialRelease).not.toBeNull();
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "ngee-ann-calendar-too-short",
        project_id: "ngee-ann-polytechnic",
        entries: [{
          id: "ngee-ann-calendar-too-short-project",
          owner: { kind: "project" },
          effective_from: "2026-04-21",
          weekly: operatingWeek(),
        }],
        published_by: "dev-user",
        activate: true,
      });
      const ruleConfig = metadata.energyIq.rules.getProjectConfig("ngee-ann-polytechnic");

      const response = await handleEnergyApiRequest(
        jsonPost({
          expectedRevision: 0,
          expectedTemplateDraftRevision: 0,
          expectedMetricConfigRevision: 0,
          expectedRuleConfigRevision: ruleConfig.revision,
        }),
        ["projects", "ngee-ann-polytechnic", "setup", "publish"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: NGEE_ANN_WORKSPACE_ID,
        } as Required<ConfigApiContext>,
        {
          selectCurrentOverviewPeriod: async () => ({
            periodBasis: "calendar_month_to_date",
            periodDays: 16,
            cutoffLocalDate: "2026-06-16",
            intervalMinutes: 15,
            period: {
              localFrom: "2026-06-01",
              localToExclusive: "2026-06-17",
              from: "2026-05-31T16:00:00.000Z",
              to: "2026-06-16T16:00:00.000Z",
            },
          }),
        },
      );

      expect(response).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: {
            code: "CONFLICT",
            message: "ENERGYIQ_OVERVIEW_CALENDAR_LOOKBACK_REQUIRED:2026-04-02:ngee-ann-calendar-too-short",
          },
        },
      });
      expect(metadata.energyIq.templates.getLatestProjectRevision("ngee-ann-polytechnic"))
        .toEqual(initialRelease);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  });
});

const operatingWeek = () => ({
  monday: [{ from: "08:00", to: "18:00" }],
  tuesday: [{ from: "08:00", to: "18:00" }],
  wednesday: [{ from: "08:00", to: "18:00" }],
  thursday: [{ from: "08:00", to: "18:00" }],
  friday: [{ from: "08:00", to: "18:00" }],
  saturday: [],
  sunday: [],
});

const removeTemporaryFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && (error.code === "EPERM" || error.code === "EBUSY")
    ) return;
    throw error;
  }
};

const jsonPost = (body: unknown): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  request.end(JSON.stringify(body));
  return request as unknown as IncomingMessage;
};
