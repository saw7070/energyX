import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap, NGEE_ANN_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";

const PROJECT_ID = "ngee-ann-polytechnic";

type SetupDocument = {
  project: { name: string; timezone: string; overview_cadence?: "monthly" | "weekly" };
};

describe("Project setup Overview cadence", () => {
  it("keeps an administrator's Overview cadence choice across a save and reload", async () => {
    await withProject(async ({ metadata, context }) => {
      const before = await getSetup(context);
      expect(before.draft.document.project.overview_cadence).toBeUndefined();

      const saved = await saveDraft(context, {
        expectedRevision: before.draft.revision,
        document: {
          ...before.draft.document,
          project: { ...before.draft.document.project, overview_cadence: "weekly" },
        },
      });
      expect(saved.draft.document.project.overview_cadence).toBe("weekly");

      const reloaded = await getSetup(context);
      expect(reloaded.draft.document.project.overview_cadence).toBe("weekly");
      // The choice lives on the stored document, not only in the response.
      expect(metadata.energyIq.projectSetup
        .getDraft({ project_id: PROJECT_ID, user_id: "dev-user" })
        .document.project.overview_cadence).toBe("weekly");
      expect(reloaded.draft.document.project.name).toBe(before.draft.document.project.name);
      expect(reloaded.draft.document.project.timezone).toBe(before.draft.document.project.timezone);
    });
  });

  it("stores an explicit monthly choice and lets it be changed back", async () => {
    await withProject(async ({ context }) => {
      const before = await getSetup(context);
      const saved = await saveDraft(context, {
        expectedRevision: before.draft.revision,
        document: {
          ...before.draft.document,
          project: { ...before.draft.document.project, overview_cadence: "monthly" },
        },
      });
      expect(saved.draft.document.project.overview_cadence).toBe("monthly");

      const backToWeekly = await saveDraft(context, {
        expectedRevision: saved.draft.revision,
        document: {
          ...saved.draft.document,
          project: { ...saved.draft.document.project, overview_cadence: "weekly" },
        },
      });
      expect(backToWeekly.draft.document.project.overview_cadence).toBe("weekly");
    });
  });

  it("leaves an existing project without a cadence untouched when it saves anything else", async () => {
    await withProject(async ({ context }) => {
      const before = await getSetup(context);
      const saved = await saveDraft(context, {
        expectedRevision: before.draft.revision,
        document: before.draft.document,
      });
      expect(saved.draft.document.project).not.toHaveProperty("overview_cadence");
    });
  });

  it("rejects a cadence the Overview cannot show", async () => {
    await withProject(async ({ context }) => {
      const before = await getSetup(context);
      await expect(saveDraft(context, {
        expectedRevision: before.draft.revision,
        document: {
          ...before.draft.document,
          project: { ...before.draft.document.project, overview_cadence: "daily" },
        },
      })).rejects.toThrow("ENERGYIQ_PROJECT_OVERVIEW_CADENCE_INVALID");
    });
  });
});

type TestContext = Required<ConfigApiContext>;

const withProject = async (
  run: (input: { metadata: ReturnType<typeof createMetadataStore>; context: TestContext }) => Promise<void>,
): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "energy-api-overview-cadence-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const gateway = new LocalDataGateway(metadata);
  try {
    ensureEnergyIqBootstrap(metadata);
    await run({
      metadata,
      context: {
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        workspaceId: NGEE_ANN_WORKSPACE_ID,
      } as unknown as TestContext,
    });
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

const getSetup = async (context: TestContext): Promise<{
  draft: { revision: number; document: SetupDocument };
}> => {
  const response = await handleEnergyApiRequest(
    request("GET"),
    ["projects", PROJECT_ID, "setup"],
    context,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body as { data: { draft: { revision: number; document: SetupDocument } } }).data;
};

const saveDraft = async (
  context: TestContext,
  body: { expectedRevision: number; document: unknown },
): Promise<{ draft: { revision: number; document: SetupDocument } }> => {
  const response = await handleEnergyApiRequest(
    request("PUT", body),
    ["projects", PROJECT_ID, "setup", "draft"],
    context,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body as { data: { draft: { revision: number; document: SetupDocument } } }).data;
};

const request = (method: "GET" | "PUT", body?: unknown): IncomingMessage => {
  const stream = new PassThrough();
  Object.assign(stream, {
    method,
    headers: method === "GET" ? {} : { "content-type": "application/json" },
  });
  stream.end(body === undefined ? undefined : JSON.stringify(body));
  return stream as unknown as IncomingMessage;
};
