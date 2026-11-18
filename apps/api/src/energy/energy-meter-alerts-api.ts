import type { IncomingMessage } from "node:http";
import { createSuccessResult } from "@datafoundry/contracts";
import type { UserRecord } from "@datafoundry/metadata";

import type { ConfigApiContext, ConfigApiResponse } from "../routes/types.js";
import { MeterAlertStore, MAX_HARDWARE_EMAILS } from "./energy-meter-alert-store.js";
import { resolveEnergyProjectCapabilities } from "./energy-project-capabilities.js";

/**
 * A site's meter-alert settings:
 *   GET projects/:id/meter-alerts/settings   whether unusual hourly use alerts are on, and the extra addresses that get
 *                                             the stopped-sending alerts ("Send meter alerts to")
 *   PUT projects/:id/meter-alerts/settings   change them: the switch with the other site alerts (people allowed to change
 *                                             hours and rates), the addresses on Live connection (people allowed to
 *                                             change the live connection)
 * Returns undefined for any other path.
 */
const NO_STORE = { "Cache-Control": "private, no-store" };

export const handleMeterAlertsApi = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>,
  user: UserRecord,
  helpers: { readJsonBody: (request: IncomingMessage) => Promise<unknown> },
): Promise<ConfigApiResponse | undefined> => {
  if (segments.length !== 4 || segments[3] !== "settings") return undefined;
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "PUT") return undefined;
  const projectId = decodeURIComponent(segments[1] ?? "");
  const metadataStore = context.metadataStore;
  const project = metadataStore.energyIq.getProject(projectId);
  if (project.workspace_id !== context.workspaceId) throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  const capabilities = resolveEnergyProjectCapabilities({ metadataStore, userId: user.id, workspaceId: context.workspaceId, projectId });
  if (!capabilities.readProjectInformation) throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  const canEditPattern = capabilities.editHoursRate;
  const canEditRecipients = capabilities.manageLiveConnection;
  const store = new MeterAlertStore(metadataStore.db);
  if (method === "PUT") {
    const raw = await helpers.readJsonBody(request);
    const body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    if (body.patternAlerts !== undefined && !canEditPattern) throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
    if (body.hardwareEmails !== undefined && !canEditRecipients) throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
    store.setSettings(projectId, {
      ...(body.patternAlerts !== undefined ? { patternAlerts: body.patternAlerts } : {}),
      ...(body.hardwareEmails !== undefined ? { hardwareEmails: body.hardwareEmails } : {}),
    }, user.id);
  }
  const settings = store.getSettings(projectId);
  return {
    status: 200,
    headers: NO_STORE,
    body: createSuccessResult({
      projectId,
      patternAlerts: settings.patternAlerts,
      // The extra addresses are only shown to the people who may change them.
      hardwareEmails: canEditRecipients ? settings.hardwareEmails : [],
      maxHardwareEmails: MAX_HARDWARE_EMAILS,
      canEditPattern,
      canEditRecipients,
    }),
  };
};
