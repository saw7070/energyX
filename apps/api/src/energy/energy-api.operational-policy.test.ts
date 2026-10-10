import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import {
  ensureEnergyIqBootstrap,
  NGEE_ANN_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";

describe("EnergyIQ operational policy Admin interface", () => {
  it("publishes immutable pending Tariff and Calendar revisions without changing the current release", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-operational-policy-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const projectId = "ngee-ann-polytechnic";
      const context = {
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        workspaceId: NGEE_ANN_WORKSPACE_ID,
      } as Required<ConfigApiContext>;
      const prewarm = vi.fn().mockResolvedValue({
        status: "unchanged",
        contextPackage: {
          projectionRef: "sha256:analysis-context-ready",
          identity: {
            resolverRevision: "project-analysis-resolver@1",
            workspaceId: NGEE_ANN_WORKSPACE_ID,
            projectId,
            scopeId: "project",
            resource: "electricity",
            analysisWindow: "all-available",
            period: "Custom",
            timezone: "Asia/Singapore",
            from: "2026-06-01T00:00:00.000Z",
            to: "2026-07-01T00:00:00.000Z",
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
            reportTimePolicyRevisionId: "report-time-current",
            hierarchyRevisionId: "hierarchy-current",
            meterMappingRevisionId: "mapping-current",
            meterFormulaRevisionId: "formula-current",
            metricVersion: "metric-current",
            businessCalendarVersion: "calendar-current",
            tariffScheduleVersion: "tariff-current",
            overviewDefinitionRevisionId: "overview-current",
            rendererKey: "ngee-ann-overview",
            rendererVersion: "1",
            rendererContractVersion: "project-analysis-snapshot@1",
            recipeId: "energy-scope-analysis",
            recipeVersion: "1",
            metricRevisionIds: ["metric-current"],
            ruleRevisionIds: ["rule-current"],
            databasePath: "C:\\secret\\energy.duckdb",
          },
        },
      });
      const dependencies = {
        selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); },
        prewarmAnalysisContextPackage: prewarm as never,
      };

      const initial = await handleEnergyApiRequest(
        request("GET"),
        ["projects", projectId, "operational-policies"],
        context,
      );
      expect(initial, JSON.stringify(initial)).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            projectId,
            timezone: "Asia/Singapore",
            published: {
              tariff_schedule_version: "sg-tariff-v1",
              business_calendar_version: "sg-calendar-holiday-v2",
            },
            pending: {
              tariff_schedule_version: "sg-tariff-v1",
              business_calendar_version: "sg-calendar-holiday-v2",
            },
            tariffRevisions: [],
            operatingCalendarRevisions: [{ version_id: "sg-calendar-holiday-v2" }],
          },
        },
      });

      const tariffResponse = await handleEnergyApiRequest(
        request("POST", {
          entries: [{
            owner: { kind: "project" },
            effectiveFrom: "2026-07-01T00:00:00+08:00",
            currency: "SGD",
            ratePerKwh: 0.2972,
            rateBasis: "tax_inclusive",
            tax: { name: "GST", ratePct: 9 },
          }],
        }),
        ["projects", projectId, "operational-policies", "tariff"],
        context,
        dependencies,
      );
      expect(tariffResponse).toMatchObject({
        status: 201,
        body: {
          success: true,
          data: {
            revision: {
              project_id: projectId,
              entries: [{
                currency: "SGD",
                rate_per_kwh: 0.2972,
                rate_basis: "tax_inclusive",
                tax: { name: "GST", rate_pct: 9 },
              }],
            },
            analysisContextPrewarm: {
              status: "unchanged",
              projectionRef: "sha256:analysis-context-ready",
            },
          },
        },
      });
      const tariffVersion = requireVersionId(tariffResponse, "revision");

      const calendarResponse = await handleEnergyApiRequest(
        request("POST", {
          entries: [{
            owner: { kind: "scope", scopeId: "level-6" },
            effectiveFrom: "2026-07-01",
            weekly: {
              monday: [{ from: "08:00", to: "18:00" }],
              tuesday: [{ from: "08:00", to: "18:00" }],
              wednesday: [{ from: "08:00", to: "18:00" }],
              thursday: [{ from: "08:00", to: "18:00" }],
              friday: [{ from: "08:00", to: "18:00" }],
              saturday: [],
              sunday: [],
            },
            exceptions: [{
              date: "2026-08-10",
              operating: [],
              label: "National Day observed",
              classification: "public_holiday",
            }],
          }],
          academicPeriods: [{
            id: "semester-1-teaching",
            from: "2026-07-01",
            to: "2026-08-17",
            phase: "teaching",
            label: "Semester 1 Teaching",
            source: {
              label: "Ngee Ann Polytechnic AY2026/27 Academic Calendar",
              url: "https://www.np.edu.sg/admissions-enrolment/academic-matters/academic-calendar",
            },
          }],
        }),
        ["projects", projectId, "operational-policies", "calendar"],
        context,
        dependencies,
      );
      expect(calendarResponse).toMatchObject({
        status: 201,
        body: {
          success: true,
          data: {
            revision: {
              project_id: projectId,
              timezone: "Asia/Singapore",
              entries: [{
                owner: { kind: "scope", scope_id: "level-6" },
                exceptions: [{
                  date: "2026-08-10",
                  label: "National Day observed",
                  classification: "public_holiday",
                }],
              }],
              academic_periods: [{
                id: "semester-1-teaching",
                from: "2026-07-01",
                to: "2026-08-17",
                phase: "teaching",
                label: "Semester 1 Teaching",
                source: {
                  label: "Ngee Ann Polytechnic AY2026/27 Academic Calendar",
                  url: "https://www.np.edu.sg/admissions-enrolment/academic-matters/academic-calendar",
                },
              }],
            },
            analysisContextPrewarm: {
              status: "unchanged",
              projectionRef: "sha256:analysis-context-ready",
            },
          },
        },
      });
      const calendarVersion = requireVersionId(calendarResponse, "revision");

      const calendarWithoutAcademicBody = await handleEnergyApiRequest(
        request("POST", {
          entries: [{
            owner: { kind: "scope", scopeId: "level-6" },
            effectiveFrom: "2026-07-01",
            weekly: {
              monday: [{ from: "08:00", to: "19:00" }],
              tuesday: [{ from: "08:00", to: "19:00" }],
              wednesday: [{ from: "08:00", to: "19:00" }],
              thursday: [{ from: "08:00", to: "19:00" }],
              friday: [{ from: "08:00", to: "19:00" }],
              saturday: [],
              sunday: [],
            },
          }],
        }),
        ["projects", projectId, "operational-policies", "calendar"],
        context,
        dependencies,
      );
      expect(calendarWithoutAcademicBody).toMatchObject({
        status: 201,
        body: { success: true, data: { revision: { academic_periods: [{
          id: "semester-1-teaching",
          phase: "teaching",
        }] } } },
      });
      const preservedCalendarVersion = requireVersionId(calendarWithoutAcademicBody, "revision");

      const invalidClassificationResponse = await handleEnergyApiRequest(
        request("POST", {
          entries: [{
            owner: { kind: "project" },
            effectiveFrom: "2026-07-01",
            weekly: {
              monday: [],
              tuesday: [],
              wednesday: [],
              thursday: [],
              friday: [],
              saturday: [],
              sunday: [],
            },
            exceptions: [{
              date: "2026-08-10",
              operating: [],
              classification: "holiday-like-label",
            }],
          }],
        }),
        ["projects", projectId, "operational-policies", "calendar"],
        context,
      );
      expect(invalidClassificationResponse).toMatchObject({
        status: 400,
        body: { success: false, error: { code: "BAD_REQUEST" } },
      });

      const configuration = await handleEnergyApiRequest(
        request("GET"),
        ["projects", projectId, "operational-policies"],
        context,
      );
      expect(configuration).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            published: {
              tariff_schedule_version: "sg-tariff-v1",
              business_calendar_version: "sg-calendar-holiday-v2",
            },
            pending: {
              tariff_schedule_version: tariffVersion,
              business_calendar_version: preservedCalendarVersion,
            },
            tariffRevisions: [{ version_id: tariffVersion }],
            operatingCalendarRevisions: [
              { version_id: preservedCalendarVersion },
              { version_id: calendarVersion },
              { version_id: "sg-calendar-holiday-v2" },
            ],
            hasUnpublishedChanges: true,
          },
        },
      });
      expect(metadata.energyIq.getProject(projectId)).toMatchObject({
        tariff_schedule_version: "sg-tariff-v1",
        business_calendar_version: "sg-calendar-v1",
      });
      expect(prewarm).toHaveBeenCalledTimes(3);
      expect(prewarm).toHaveBeenNthCalledWith(1, expect.objectContaining({ projectId }));
      expect(prewarm).toHaveBeenNthCalledWith(2, expect.objectContaining({ projectId }));
      expect(prewarm).toHaveBeenNthCalledWith(3, expect.objectContaining({ projectId }));
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("returns a controlled validation error for overlapping effective windows", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-operational-policy-invalid-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        request("POST", {
          entries: [
            {
              owner: { kind: "project" },
              effectiveFrom: "2026-07-01T00:00:00+08:00",
              effectiveTo: "2026-08-01T00:00:00+08:00",
              currency: "SGD",
              ratePerKwh: 0.28,
            },
            {
              owner: { kind: "project" },
              effectiveFrom: "2026-07-15T00:00:00+08:00",
              currency: "SGD",
              ratePerKwh: 0.3,
            },
          ],
        }),
        ["projects", "ngee-ann-polytechnic", "operational-policies", "tariff"],
        {
          metadataStore: metadata,
          dataGateway: gateway,
          userId: "dev-user",
          workspaceId: NGEE_ANN_WORKSPACE_ID,
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 400,
        body: {
          success: false,
          error: {
            code: "BAD_REQUEST",
          },
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("Creating a project where the site is", () => {
  it("records the country and state, keeps peak pricing on its first rate, and refuses an unknown country before creating anything", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-project-region-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        userId: "dev-user",
        workspaceId: NGEE_ANN_WORKSPACE_ID,
      } as Required<ConfigApiContext>;
      const before = metadata.energyIq.listProjectsByWorkspace(NGEE_ANN_WORKSPACE_ID).length;
      const refused = await handleEnergyApiRequest(request("POST", { name: "Somewhere", region: { country: "TH" } }), ["projects"], context);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(metadata.energyIq.listProjectsByWorkspace(NGEE_ANN_WORKSPACE_ID)).toHaveLength(before);

      const created = await handleEnergyApiRequest(
        request("POST", { name: "KL office", timezone: "Asia/Kuala_Lumpur", region: { country: "MY", state: "kul" } }),
        ["projects"],
        context,
      );
      expect(created.status).toBe(201);
      const project = (created.body as { data: { project: { id: string; region?: unknown; timezone: string } } }).data.project;
      expect(project).toMatchObject({ timezone: "Asia/Kuala_Lumpur", region: { country: "MY", state: "KUL" } });

      const rate = await handleEnergyApiRequest(
        request("POST", {
          entries: [{
            owner: { kind: "project" },
            effectiveFrom: "2020-01-01T00:00:00+08:00",
            currency: "MYR",
            ratePerKwh: 0.5175,
            timeOfUse: { peakRatePerKwh: 0.5584, peakWindows: [{ days: ["monday", "tuesday", "wednesday", "thursday", "friday"], from: "14:00", to: "22:00" }], holidaysOffPeak: true },
            fixedCharges: [{ label: "Retail charge", amount: 20, unit: "per_month" }],
            plan: { id: "my-tnb-lv-tou", label: "TNB Low voltage – Time of Use" },
          }],
        }),
        ["projects", project.id, "operational-policies", "tariff"],
        context,
        { selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); }, prewarmAnalysisContextPackage: vi.fn().mockResolvedValue({ status: "not_ready" }) as never },
      );
      expect(rate.status).toBe(201);
      const hours = await handleEnergyApiRequest(
        request("POST", {
          entries: [{
            owner: { kind: "project" },
            effectiveFrom: "2020-01-01",
            weekly: { monday: [{ from: "09:00", to: "18:00" }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
            exceptions: [{ date: "2026-08-31", operating: [], label: "National Day", classification: "public_holiday" }],
          }],
        }),
        ["projects", project.id, "operational-policies", "calendar"],
        context,
        { selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); }, prewarmAnalysisContextPackage: vi.fn().mockResolvedValue({ status: "not_ready" }) as never },
      );
      expect(hours.status).toBe(201);
      const revision = (rate.body as { data: { revision: { entries: Array<Record<string, unknown>> } } }).data.revision;
      expect(revision.entries[0]).toMatchObject({
        currency: "MYR",
        rate_per_kwh: 0.5175,
        time_of_use: { peak_rate_per_kwh: 0.5584, holidays_off_peak: true },
        fixed_charges: [{ label: "Retail charge", amount: 20, unit: "per_month" }],
        plan: { id: "my-tnb-lv-tou" },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const request = (method: "GET" | "POST", body?: unknown): IncomingMessage => {
  const stream = new PassThrough();
  Object.assign(stream, {
    method,
    headers: { "content-type": "application/json" },
  });
  stream.end(body === undefined ? undefined : JSON.stringify(body));
  return stream as unknown as IncomingMessage;
};

const requireVersionId = (
  response: Awaited<ReturnType<typeof handleEnergyApiRequest>>,
  key: string,
): string => {
  const body = response.body as { data?: Record<string, unknown> };
  const record = body.data?.[key] as { version_id?: unknown } | undefined;
  expect(typeof record?.version_id).toBe("string");
  return String(record?.version_id);
};

it("selects an Agent-saved revision for publication without changing the published tariff", async () => {
  const root = mkdtempSync(join(tmpdir(), "policy-select-"));
  const metadata = createMetadataStore({ database_path: join(root,"metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    const projectId="ngee-ann-polytechnic";
    const context={metadataStore:metadata,userId:"dev-user",workspaceId:NGEE_ANN_WORKSPACE_ID} as Required<ConfigApiContext>;
    const before=metadata.energyIq.getProject(projectId);
    const active=metadata.energyIq.operationalPolicy.getActivePolicyVersions(projectId);
    metadata.energyIq.operationalPolicy.publishTariffSchedule({version_id:"agent-tariff",project_id:projectId,published_by:"dev-user",activate:false,entries:[{id:"new",owner:{kind:"project"},effective_from:"2026-01-01",currency:"SGD",rate_per_kwh:0.3}]});
    const response=await handleEnergyApiRequest(request("POST",{kind:"tariff",version:"agent-tariff",expectedVersion:active.tariff_schedule_version??before.tariff_schedule_version??null}),["projects",projectId,"operational-policies","select"],context);
    expect(response.status).toBe(200);
    expect(metadata.energyIq.operationalPolicy.getActivePolicyVersions(projectId).tariff_schedule_version).toBe("agent-tariff");
    expect(metadata.energyIq.getProject(projectId).tariff_schedule_version).toBe(before.tariff_schedule_version);
    await expect(handleEnergyApiRequest(request("POST",{kind:"tariff",version:"agent-tariff",expectedVersion:"stale"}),["projects",projectId,"operational-policies","select"],context)).resolves.toMatchObject({ status: 409, body: { success: false } });
  } finally {metadata.close();rmSync(root,{recursive:true,force:true});}
});
