import type { IncomingMessage, ServerResponse } from "node:http";

import { SCIM_LIST_SCHEMA, ScimError, type ScimService } from "./scim-service.js";

/**
 * `/api/v1/scim/v2/*`. Authenticated only by the Organisation's provisioning key in the Authorization header: no
 * session cookie or CSRF token is read here, and no other route accepts a provisioning key.
 */
const SCIM_PREFIX = "/api/v1/scim/v2";
const SCIM_CONTENT_TYPE = "application/scim+json; charset=utf-8";
const MAX_BODY_BYTES = 1024 * 1024;

export const handleScimRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  service: ScimService,
  publicBaseUrl: string
): Promise<void> => {
  const segments = url.pathname.slice(SCIM_PREFIX.length).split("/").filter(Boolean).map(decodeURIComponent);
  const method = request.method ?? "GET";
  try {
    const authorization = request.headers.authorization;
    const caller = service.authenticate(Array.isArray(authorization) ? authorization[0] : authorization, `${publicBaseUrl}${SCIM_PREFIX}`);
    const [resource, id, ...rest] = segments;
    if (rest.length > 0) throw notFound();

    if (resource === "ServiceProviderConfig" && !id && method === "GET") {
      return send(response, 200, service.serviceProviderConfig(caller));
    }
    if (resource === "ResourceTypes" && method === "GET") {
      const types = service.resourceTypes(caller);
      if (!id) return send(response, 200, listOf(types));
      const type = types.find((candidate) => candidate.id === id);
      if (!type) throw notFound();
      return send(response, 200, type);
    }
    if (resource === "Schemas" && method === "GET") {
      const schemas = service.schemas(caller);
      if (!id) return send(response, 200, listOf(schemas));
      const schema = schemas.find((candidate) => candidate.id === id);
      if (!schema) throw notFound();
      return send(response, 200, schema);
    }
    if (resource === "Users") {
      if (!id && method === "GET") {
        return send(response, 200, service.listUsers(caller, {
          filter: url.searchParams.get("filter"),
          startIndex: url.searchParams.get("startIndex"),
          count: url.searchParams.get("count")
        }));
      }
      if (!id && method === "POST") {
        const created = service.createUser(caller, await readBody(request));
        const location = (created.meta as { location?: string } | undefined)?.location;
        return send(response, 201, created, location ? { Location: location } : {});
      }
      if (id && method === "GET") return send(response, 200, service.getUser(caller, id));
      if (id && method === "PUT") return send(response, 200, service.replaceUser(caller, id, await readBody(request)));
      if (id && method === "PATCH") return send(response, 200, service.patchUser(caller, id, await readBody(request)));
      if (id && method === "DELETE") {
        service.deleteUser(caller, id);
        response.writeHead(204, { "Cache-Control": "no-store" });
        response.end();
        return;
      }
      throw new ScimError(405, undefined, "That method is not supported here.");
    }
    throw notFound();
  } catch (error) {
    if (error instanceof ScimError) {
      return send(response, error.status, error.toBody(), error.status === 401 ? { "WWW-Authenticate": "Bearer" } : {});
    }
    console.warn("[scim] request failed", error instanceof Error ? error.message : error);
    return send(response, 500, new ScimError(500, undefined, "The request could not be completed.").toBody());
  }
};

const notFound = () => new ScimError(404, undefined, "Resource not found.");

const listOf = (resources: Record<string, unknown>[]) => ({
  schemas: [SCIM_LIST_SCHEMA],
  totalResults: resources.length,
  startIndex: 1,
  itemsPerPage: resources.length,
  Resources: resources
});

const send = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  response.writeHead(status, { "Content-Type": SCIM_CONTENT_TYPE, "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(body));
};

const readBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new ScimError(413, undefined, "The request is too large.");
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ScimError(400, "invalidSyntax", "The request body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ScimError(400, "invalidSyntax", "The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
};
