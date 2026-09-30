import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { afterEach, expect, it } from "vitest";
import { handleConfigApiRequest, type ConfigApiContext } from "./config-api.js";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "report-skill-guard-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  cleanup.push(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });
  metadata.users.upsertDevUser({ id: "u", email: "u@example.test", display_name: "u", dev_token: "u" });
  const context = { metadataStore: metadata, userId: "u", workspaceId: "w" } as ConfigApiContext;
  const call = (method: string, path: string, body: unknown = {}) => {
    const request = Readable.from([JSON.stringify(body)]) as IncomingMessage;
    request.method = method; request.headers = {"content-type":"application/json"};
    return handleConfigApiRequest(request, `/api/v1/${path}`, context);
  };
  const key = { id: "method", workspace_id: "w", user_id: "u", kind: "skill" as const };
  return { metadata, call, key, context };
}
it.each(["reportProjectId", "reportSkillVersions"])("rejects client-controlled %s on generic create and patch", async key => {
  const { call, metadata } = fixture();
  for (const payload of [{ [key]: "forged" }, { payload: { [key]: "forged" } }]) {
    expect((await call("POST", "skills", { id: "forged", name: "Forged", ...payload }))?.status).toBe(403);
  }
  expect(metadata.configResources.list({workspace_id:"w",user_id:"u",kind:"skill"})).toEqual([]);
  expect((await call("POST", "skills", {id:"regular",name:"Regular",scope:"user"}))?.status).toBe(201);
  expect((await call("PATCH", "skills/regular", { [key]: null }))?.status).toBe(403);
  expect((await call("PATCH", "skills/regular", {name:"Updated"}))?.status).toBe(200);
});
it("protects existing report versions from generic patch, replace, duplicate create, bulk toggle and deletion", async () => {
  const { call, metadata, key } = fixture();
  const original = metadata.configResources.upsert({...key,name:"Method",payload:{reportProjectId:"p",reportSkillVersions:[{version:"1",content:"Original"}],scope:"user"}});
  for (const [method,path,body] of [
    ["PATCH","skills/method",{name:"Overwrite"}],
    ["POST","skills/method/replace",{}],
    ["POST","skills",{id:"method",name:"Overwrite"}],
    ["PATCH","workspace-config",{skills:[{id:"method",defaultEnabled:true}]}],
    ["DELETE","skills/method",{}],
  ] as const) {
    expect((await call(method,path,body))?.status).toBe(403);
    expect(metadata.configResources.get(key)).toEqual(original);
  }
  expect((await call("GET","skills/method"))?.status).toBe(200);
});

it("rejects reserved multipart metadata before storing an uploaded package", async () => {
  const { context, metadata } = fixture();
  const boundary="report-skill-boundary";
  const payload=[`--${boundary}`, 'Content-Disposition: form-data; name="reportProjectId"', '', 'forged-project', `--${boundary}`, 'Content-Disposition: form-data; name="file"; filename="SKILL.md"', 'Content-Type: text/markdown', '', '---\nname: test\ndescription: Test method\n---\nRead data.', `--${boundary}--`, ''].join("\r\n");
  const request=Readable.from([payload]) as IncomingMessage;request.method="POST";request.headers={"content-type":`multipart/form-data; boundary=${boundary}`};
  const response=await handleConfigApiRequest(request,"/api/v1/skills",context);
  expect(response?.status).toBe(403);
  expect(metadata.configResources.list({workspace_id:"w",user_id:"u",kind:"skill"})).toEqual([]);
});
