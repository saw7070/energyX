/**
 * The meter settings Facility saves, read by the reports. A meter ticked "Always on by design" and a meter given a
 * number of lights travel from the setup save, through publishing and the project information the readings are
 * labelled with, into the site report: the always-on meter is left out of daytime use, and energy per light uses the
 * number saved. The demo office's meters are given made-up estate names; the readings are made up too.
 */
import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { assembleAnalysisData, buildSiteReport, type AnalysisSource } from "@datafoundry/site-report";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { readEnergyProjectInformation } from "./energy-project-information.js";
import { TUYA_OFFICE_PROJECT_ID, TUYA_OFFICE_WORKSPACE_ID } from "./tuya-office-project.js";

const EMERGENCY = "panel-a-meter-03";
const CORRIDOR = "panel-a-meter-04";
const LAMP = "panel-a-meter-05";
// One week from Monday 2 Nov 2026 (SGT); lights on 19:00–07:00.
const DATES = Array.from({ length: 7 }, (_, index) => new Date(Date.parse("2026-11-02T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const night = (hour: number) => hour >= 19 || hour < 7;
const PROFILE: Record<string, (hour: number) => number> = {
  [EMERGENCY]: () => 0.1,
  [CORRIDOR]: hour => night(hour) ? 0.6 : 0,
  [LAMP]: hour => night(hour) ? 0.2 : 0,
};
const NIGHTS = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ from: "19:00", to: "07:00" }]]));

/** A week of made-up readings for the three meters, shaped as the consumption endpoint returns them. */
function readings(names: Map<string, string>): AnalysisSource {
  const ids = Object.keys(PROFILE);
  const cells = (kwh: (hour: number) => number) => DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh(hour), 60, 0] as [string, number, number, number, number]));
  const usage = (id: string) => DATES.length * Array.from({ length: 24 }, (_, hour) => PROFILE[id]!(hour)).reduce((sum, value) => sum + value, 0);
  const total = ids.reduce((sum, id) => sum + usage(id), 0);
  return {
    context: { projectName: "Maple Estate", scopeId: "project", scopeName: "Maple Estate", timezone: "Asia/Singapore", from: "2026-11-01T16:00:00.000Z", to: "2026-11-08T16:00:00.000Z" },
    summary: { usageKwh: total, peakKw: 0.9, validIntervalCount: 7 * 24 * 4 },
    explorerTrends: [
      ...ids.map(id => ({ id, expectedMinutesPerHour: 60, cells: cells(PROFILE[id]!) })),
      { id: "__scope__", expectedMinutesPerHour: 180, cells: cells(hour => ids.reduce((sum, id) => sum + PROFILE[id]!(hour), 0)).map(([date, hour, kwh]) => [date, hour, kwh, 180, 0] as [string, number, number, number, number]) },
    ],
    explorerMeters: ids.map(id => ({ id, name: names.get(id) ?? id, scopeId: "tuya-office-db1", kind: "physical" as const, category: "light", includedInOfficialTotal: true })),
    categories: [{ category: "light", usageKwh: total }],
    childScopes: [],
    circuits: ids.map(id => ({ meterNodeId: id, name: names.get(id) ?? id, category: "light", meterRole: "component", usageKwh: usage(id), includedInOfficialTotal: true })),
    cost: { status: "available", amount: total * 0.3, currency: "SGD", allocations: [{ ratePerKwh: 0.3, rateBasis: "tax_exclusive" }] },
  };
}

it("a meter ticked always on and a number of lights, saved in Facility and published, reach the site report", async () => {
  const root = mkdtempSync(join(tmpdir(), "meter-settings-report-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    const draft = metadata.energyIq.projectSetup.getDraft({ project_id: TUYA_OFFICE_PROJECT_ID, user_id: "dev-user" });
    const document = structuredClone(draft.document);
    const rename = (id: string, presentation: Record<string, string>) => {
      const row = document.meter_mapping!.rows.find(item => item.id === id)!;
      row.presentation = { ...row.presentation, ...presentation };
    };
    // What the meter form sends: the tick as "true", the number of lights as text (spaces and all).
    rename(EMERGENCY, { device_name: "Block A emergency lights", short_name: "Block A emergency lights", always_on: "true" });
    rename(CORRIDOR, { device_name: "Block A corridor lights", short_name: "Block A corridor lights", light_count: " 12 " });
    rename(LAMP, { device_name: "Driveway lamp", short_name: "Driveway lamp" });
    const stream = new PassThrough();
    Object.assign(stream, { method: "PUT", headers: {} });
    stream.end(JSON.stringify({ expectedRevision: draft.revision, document }));
    const saved = await handleEnergyApiRequest(stream as unknown as IncomingMessage, ["projects", TUYA_OFFICE_PROJECT_ID, "setup", "draft"], {
      metadataStore: metadata, dataGateway: new LocalDataGateway(metadata), userId: "dev-user", workspaceId: TUYA_OFFICE_WORKSPACE_ID,
    } as unknown as Required<ConfigApiContext>);
    expect(saved.status).toBe(200);
    const revision = metadata.energyIq.projectSetup.getDraft({ project_id: TUYA_OFFICE_PROJECT_ID, user_id: "dev-user" }).revision;
    metadata.energyIq.projectSetup.publishDraft({ project_id: TUYA_OFFICE_PROJECT_ID, expected_revision: revision, user_id: "dev-user" });

    // The project information the readings are labelled with, on the page and on the server alike.
    const information = readEnergyProjectInformation(metadata, "dev-user", TUYA_OFFICE_WORKSPACE_ID, TUYA_OFFICE_PROJECT_ID);
    const meter = (id: string) => information.meters.find(item => item.id === id)!;
    expect(meter(EMERGENCY)).toMatchObject({ name: "Block A emergency lights", alwaysOn: true });
    expect(meter(CORRIDOR)).toMatchObject({ name: "Block A corridor lights", lightCount: 12 });
    expect("alwaysOn" in meter(CORRIDOR) || "lightCount" in meter(EMERGENCY)).toBe(false);

    const names = new Map(information.meters.map(item => [item.id, item.name]));
    const data = assembleAnalysisData({
      projectId: TUYA_OFFICE_PROJECT_ID, project: readings(names), spaces: [], spaceCurrent: [], previousProject: null, spacePrevious: [], history: null, actions: [],
      // The site's calendar gives lights-on hours, as an estate's does.
      information: { ...information, name: "Maple Estate", calendar: { entries: [{ location: "Maple Estate", from: "2026-01-01", toExclusive: null, weekly: NIGHTS, hoursMeaning: "lights_on", exceptions: [] }] } },
    });
    expect(data.alwaysOnByDesign).toEqual([{ id: EMERGENCY, name: "Block A emergency lights" }]);
    expect(data.lightCounts).toEqual([{ id: CORRIDOR, name: "Block A corridor lights", count: 12 }]);

    const report = buildSiteReport(data, null, "2026-11-09T01:00:00Z");
    // The emergency lights run all day, yet the lights ran at night as planned: none of it is daytime use.
    expect(report.headlineTopic).toBe("night");
    expect(report.daytime!.items).toEqual([]);
    expect(report.daytime!.alwaysOn).toBe("Always on by design, so left out of daytime use: Block A emergency lights.");
    expect(report.keyFigures[3]!.value).toBe("0.0%");
    // 0.6 kW for the 12 lights-on hours, over the 12 lights saved: 0.6 kWh per light a day.
    expect(report.perLight!.rows).toEqual([{ kind: "meter", name: "Block A corridor lights", group: expect.any(String), lights: 12, perDay: expect.closeTo(7.2, 9), perLight: expect.closeTo(0.6, 9) }]);
    // Without the tick, the same readings count the emergency lights' daytime hours as daytime use.
    const unticked = buildSiteReport({ ...data, alwaysOnByDesign: undefined }, null, "2026-11-09T01:00:00Z");
    expect(unticked.daytime!.items).toEqual([expect.stringMatching(/^Block A emergency lights: on 7 am – 7 pm on 7 days, /)]);
    expect(unticked.keyFigures[3]!.value).not.toBe("0.0%");
  } finally { metadata.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
