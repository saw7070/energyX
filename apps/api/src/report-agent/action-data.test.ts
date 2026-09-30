import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({context:vi.fn(),route:vi.fn(),ensure:vi.fn(),read:vi.fn()}));
vi.mock("../energy/energy-project-capabilities.js",()=>({resolveEnergyProjectCapabilities:()=>({readExplorer:true})}));
vi.mock("../energy/energy-query-context.js",()=>({resolveEnergyQueryContext:mocks.context,resolveEnergyPublishedMeterRoute:mocks.route}));
vi.mock("@datafoundry/data-gateway",()=>({ensureEnergyScopedDataSource:mocks.ensure,readEnergyScopedActionIntervals:mocks.read}));
import {readActionEvidence,readActionGroupEvidence} from "./action-data.js";
import type {MetadataStore} from "@datafoundry/metadata";
let project:{data_snapshot_id:string;hierarchy_revision_id:string;timezone:string};
const metadata={users:{getById:()=>({id:"u"})},energyIq:{getProject:()=>project}} as unknown as MetadataStore;
const scope={userId:"u",workspaceId:"w",projectId:"p"};
beforeEach(()=>{vi.resetAllMocks();project={data_snapshot_id:"s",hierarchy_revision_id:"h",timezone:"Asia/Singapore"};mocks.context.mockImplementation(({request})=>{if(request.scopeId?.startsWith("meter:"))throw new Error("NOT_A_HIERARCHY_SCOPE");return {scopeId:"root",dataSnapshotId:"s",hierarchyRevisionId:"h",meterMappingRevisionId:"m"};});mocks.route.mockReturnValue({attachments:[{meterPointId:"led",scopeId:"db3"},{meterPointId:"other",scopeId:"db1"}]});mocks.ensure.mockResolvedValue({viewName:"scoped"});const start=Date.parse("2026-09-01T00:00:00+08:00");mocks.read.mockResolvedValue(Array.from({length:96},(_,i)=>({meterId:"led",startMs:start+i*900000,endMs:start+(i+1)*900000,kwh:0.25,quality:"ok"})));});
it("resolves the authorized project before narrowing evidence to one meter, without treating a meter as a hierarchy node",async()=>{const r=await readActionEvidence(metadata,scope,"led",{from:"2026-09-01",toExclusive:"2026-09-02"});expect(r.days[0]).toMatchObject({kwh:24,expectedMinutes:1440,validMinutes:1440,criticalGap:false});expect(mocks.ensure.mock.calls[0]?.[0].context.meterAttachments).toEqual([{meterPointId:"led",scopeId:"db3"}]);});
it("rejects a meter outside the published project route",async()=>{await expect(readActionEvidence(metadata,scope,"foreign",{from:"2026-09-01",toExclusive:"2026-09-02"})).rejects.toThrow("ACTION_METER_INVALID");expect(mocks.read).not.toHaveBeenCalled();});
it("does not freeze evidence if publication changed during the read",async()=>{mocks.read.mockImplementation(async()=>{project.data_snapshot_id="new";return [];});await expect(readActionEvidence(metadata,scope,"led",{from:"2026-09-01",toExclusive:"2026-09-02"})).rejects.toThrow("ACTION_DATA_CHANGED");});

it("aggregates distinct circuits only when all have complete matching days",async()=>{
 const period={from:"2026-09-01",toExclusive:"2026-09-02"};
 const base=await readActionEvidence(metadata,scope,"led",period);
 const read=vi.fn(async(_m:MetadataStore,_s:typeof scope,id:string)=>({...base,meterId:id}));
 const result=await readActionGroupEvidence(metadata,scope,["led","other","led"],period,read);
 expect(read).toHaveBeenCalledTimes(2);expect(result.days[0]?.kwh).toBe(48);expect(result.components).toHaveLength(2);
 read.mockImplementation(async(_m,_s,id)=>({...base,meterId:id,days:id==="other"?[]:base.days}));
 const missing=await readActionGroupEvidence(metadata,scope,["led","other"],period,read);
 expect(missing.days[0]).toMatchObject({kwh:null,criticalGap:true,validMinutes:0});
});
it("rejects grouped evidence crossing snapshot revisions",async()=>{
 const period={from:"2026-09-01",toExclusive:"2026-09-02"};
 const base=await readActionEvidence(metadata,scope,"led",period);
 await expect(readActionGroupEvidence(metadata,scope,["led","other"],period,async(_m,_s,id)=>({...base,meterId:id,snapshotId:id}))).rejects.toThrow("ACTION_DATA_CHANGED");
});
