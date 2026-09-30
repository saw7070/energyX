import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, it } from "vitest";
import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap, NGEE_ANN_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { buildTuyaOfficeSetup } from "./tuya-office-project.js";

it("preserves optional presentation through the setup HTTP boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "energy-presentation-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    const projectId = "ngee-ann-polytechnic";
    const draft = metadata.energyIq.projectSetup.getDraft({ project_id: projectId, user_id: "dev-user" });
    const document = structuredClone(draft.document);
    const presentation = {device_name:"Office TV", circuit_name:"L1P17", group:"AV / TV"};
    document.meter_mapping!.rows[0]!.presentation = presentation;
    document.meter_mapping!.virtual_meters = [{id:"test-virtual",display_name:"Other",scope_id:document.meter_mapping!.rows[0]!.scope_id,resource:"electricity",category:"load",terms:[{mapping_row_id:document.meter_mapping!.rows[0]!.id,coefficient:1}],presentation:{circuit_name:"Other",group:"Other consumption"}}];
    const stream = new PassThrough();
    Object.assign(stream,{method:"PUT",headers:{}});
    stream.end(JSON.stringify({expectedRevision:draft.revision,document}));
    const response = await handleEnergyApiRequest(stream as unknown as IncomingMessage,["projects",projectId,"setup","draft"],{
      metadataStore:metadata,dataGateway:new LocalDataGateway(metadata),userId:"dev-user",workspaceId:NGEE_ANN_WORKSPACE_ID,
    } as unknown as Required<ConfigApiContext>);
    expect(response.status).toBe(200);
    const saved = metadata.energyIq.projectSetup.getDraft({project_id:projectId,user_id:"dev-user"});
    expect(saved.document.meter_mapping!.rows[0]!.presentation).toEqual(presentation);
    expect(saved.document.meter_mapping!.virtual_meters![0]!.presentation?.group).toBe("Other consumption");
  } finally {metadata.close();rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

it("groups all Tuya meters and keeps DB2 Other strictly within the Power boundary", () => {
  const mapping = buildTuyaOfficeSetup().meter_mapping!;
  expect(mapping.rows).toHaveLength(20);
  expect(mapping.rows.every(row => row.presentation?.group)).toBe(true);
  expect(mapping.virtual_meters).toHaveLength(3);
  expect(mapping.virtual_meters!.every(row => row.presentation?.group)).toBe(true);
  const other = mapping.virtual_meters!.find(row => row.id === "tuya-office-db2-other-load")!;
  expect(other.terms).toEqual([
    {mapping_row_id:"panel-b-total",coefficient:1},
    ...["03","04","05","06","07","08","09","10"].map(id=>({mapping_row_id:`panel-b-meter-${id}`,coefficient:-1})),
  ]);
  expect(mapping.rows.find(row => row.id === "panel-b-meter-09")?.presentation).toEqual({device_name:"Showroom Blind",circuit_name:"L2P11",group:"Blind"});
  expect(mapping.rows.find(row => row.id === "panel-b-meter-10")?.presentation).toEqual({device_name:"Showroom Blind",circuit_name:"L2P8",group:"Blind"});
});
