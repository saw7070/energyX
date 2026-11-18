import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { expect, it } from "vitest";
import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { changeEventFor } from "./energy-change-audit.js";

it("serves report feedback at /api/v1/energy/report-feedback/:projectId, outside the admin routes", async () => {
  const root = mkdtempSync(join(tmpdir(), "energy-api-report-feedback-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    metadata.users.createPasswordUser({ id: "reader", email: "reader@example.test" });
    metadata.workspaceMemberships.upsert({ workspace_id: "default", user_id: "reader", role: "member" });
    const request = Readable.from([]) as IncomingMessage;
    request.method = "GET";
    request.url = "/api/v1/energy/report-feedback/ngee-ann-polytechnic";
    const response = await handleEnergyApiRequest(request, ["report-feedback", "ngee-ann-polytechnic"],
      { metadataStore: metadata, userId: "reader", workspaceId: "default" } as Required<ConfigApiContext>);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, data: { canGive: true, canManage: false, feedback: [], memory: [], followUps: [], dismissedChecks: [] } });
    // Applying records its own detailed audit event, so the generic change hook adds no second one.
    expect(changeEventFor(["report-feedback", "ngee-ann-polytechnic", "suggestions", "s", "apply"], "POST")).toBeNull();
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true });
  }
});
