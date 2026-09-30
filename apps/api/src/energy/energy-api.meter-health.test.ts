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

const ask = async (metadata: ReturnType<typeof createMetadataStore>, userId: string, projectId = "ngee-ann-polytechnic") => {
  const stream = new PassThrough();
  Object.assign(stream, { method: "GET", headers: {} });
  stream.end();
  return handleEnergyApiRequest(stream as unknown as IncomingMessage, ["projects", projectId, "meter-health"], {
    metadataStore: metadata, dataGateway: new LocalDataGateway(metadata), userId, workspaceId: NGEE_ANN_WORKSPACE_ID,
  } as unknown as Required<ConfigApiContext>);
};

it("reports meter health to anyone who can read the project, and says nothing when no data is published", async () => {
  const root = mkdtempSync(join(tmpdir(), "energy-meter-health-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    // A project whose readings were never published answers with an empty result rather than an error:
    // the page asking has nothing to warn about yet.
    const response = await ask(metadata, "dev-user");
    expect(response.status).toBe(200);
    const body = response.body as { success: boolean; data: { meters: unknown[]; summary: { total: number } } };
    expect(body.success).toBe(true);
    expect(body.data.meters).toEqual([]);
    expect(body.data.summary.total).toBe(0);
  } finally { metadata.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

it("refuses a caller with no access to the project", async () => {
  const root = mkdtempSync(join(tmpdir(), "energy-meter-health-denied-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    metadata.users.createPasswordUser({ id: "outsider", email: "outsider@example.test" });
    const response = await ask(metadata, "outsider");
    expect(response.status).toBe(403);
  } finally { metadata.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
