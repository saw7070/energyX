import type { MetadataStore } from "@datafoundry/metadata";
import { resolveEnergyIqUserRole } from "./energy/energy-user-role.js";

/**
 * The DataFoundry configuration resources (data sources, Data Link, MCP servers, model profiles, skills and
 * knowledge bases) can point the server at local files, internal hosts and local commands. EnergyX customers never
 * manage them, so only a platform super admin may create, change, test or delete one. Anyone signed in may still
 * read their own.
 */
const LEGACY_CONFIG_ROOTS = new Set([
  "datagraph",
  "datalink",
  "datasources",
  "knowledge-bases",
  "mcp-servers",
  "model-profiles",
  "skills"
]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const legacyConfigRequestNeedsSuperAdmin = (
  method: string | undefined,
  segments: readonly string[]
): boolean => {
  const root = segments[0] ?? "";
  if (!LEGACY_CONFIG_ROOTS.has(root)) return false;
  if (READ_METHODS.has((method ?? "GET").toUpperCase())) return false;
  // Ranking which skills fit a question only reads them.
  if (root === "skills" && segments[1] === "select" && segments.length === 2) return false;
  return true;
};

export const assertLegacyConfigRequestAllowed = (input: {
  metadataStore: MetadataStore;
  userId: string;
  method: string | undefined;
  segments: readonly string[];
  env?: Record<string, string | undefined>;
}): void => {
  if (!legacyConfigRequestNeedsSuperAdmin(input.method, input.segments)) return;
  let user;
  try {
    user = input.metadataStore.users.getById({ user_id: input.userId });
  } catch {
    throw new Error("FORBIDDEN:Only a platform administrator can change this setting.");
  }
  if (user.disabled_at || resolveEnergyIqUserRole(input.metadataStore, user, input.env) !== "admin") {
    throw new Error("FORBIDDEN:Only a platform administrator can change this setting.");
  }
};

/**
 * MCP servers that run a local command start a process on the API host. They are only for local development: the
 * server must be in dev sign-in mode, or an operator must opt in with ENERGYX_ALLOW_STDIO_MCP=true.
 */
export const stdioMcpAllowed = (env: Record<string, string | undefined> = process.env): boolean => {
  if (env.ENERGYX_ALLOW_STDIO_MCP === "true") return true;
  if (env.ENERGYX_ALLOW_STDIO_MCP === "false") return false;
  const authMode = env.DATAFOUNDRY_AUTH_MODE ?? (env.NODE_ENV === "production" ? "password" : "dev");
  return authMode === "dev";
};

export const assertStdioMcpAllowed = (env: Record<string, string | undefined> = process.env): void => {
  if (!stdioMcpAllowed(env)) {
    throw new Error("MCP_STDIO_FORBIDDEN:MCP servers that run a local command are turned off on this server.");
  }
};
