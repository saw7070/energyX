import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { MetadataStore } from "@datafoundry/metadata";

import { clientIpAddress } from "./client-ip.js";
import { legacyConfigRequestNeedsSuperAdmin } from "./legacy-config-guard.js";

/**
 * Records every successful change to the DataFoundry configuration resources (data sources, Data Link, MCP servers,
 * model profiles, skills, knowledge bases): exactly the requests only a platform super admin may make. They are
 * platform settings, not one client's data, so the event names no Organisation and appears only in the platform
 * audit history. Failed and refused requests change nothing and are left out.
 */
export const recordLegacyConfigChange = (input: {
  metadataStore: MetadataStore;
  request: IncomingMessage;
  segments: string[];
  userId: string;
  workspaceId: string;
  status: number;
  env?: Record<string, string | undefined>;
}): void => {
  const method = (input.request.method ?? "GET").toUpperCase();
  if (input.status >= 400 || !legacyConfigRequestNeedsSuperAdmin(method, input.segments)) return;
  try {
    let email: string | undefined;
    try {
      email = input.metadataStore.users.getById({ user_id: input.userId }).email;
    } catch {
      email = undefined;
    }
    const ip = clientIpAddress(input.request, input.env);
    const userAgent = input.request.headers["user-agent"];
    let resourceId: string | undefined;
    try {
      resourceId = input.segments[1] ? decodeURIComponent(input.segments[1]) : undefined;
    } catch {
      resourceId = input.segments[1];
    }
    input.metadataStore.authAuditEvents.append({
      id: randomUUID(),
      event_type: "energyiq.platform_config_changed",
      user_id: input.userId,
      ...(email ? { email } : {}),
      ...(ip ? { ip_address: ip } : {}),
      ...(typeof userAgent === "string" ? { user_agent: userAgent.slice(0, 300) } : {}),
      metadata: {
        resource: input.segments[0],
        ...(resourceId ? { resourceId } : {}),
        action: `${method} ${input.segments.join("/")}`,
        configWorkspaceId: input.workspaceId,
      },
    });
  } catch (error) {
    // A missing audit row must never undo or fail a change that already succeeded.
    console.warn(`[audit] could not record a platform setting change: ${error instanceof Error ? error.message : "unknown"}`);
  }
};
