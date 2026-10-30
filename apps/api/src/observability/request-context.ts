import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * What the API knows about the request it is serving, available to anything that logs while serving it, including
 * work it starts in the background. The user and workspace are filled in once authentication has resolved them.
 */
export type RequestContext = {
  requestId: string;
  userId?: string;
  workspaceId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(context: RequestContext, fn: () => T): T => storage.run(context, fn);

export const currentRequestContext = (): RequestContext | undefined => storage.getStore();

/** Record who is making the current request, for the access log and anything logged after authentication. */
export const setRequestActor = (userId: string, workspaceId?: string): void => {
  const context = storage.getStore();
  if (!context) return;
  context.userId = userId;
  if (workspaceId) context.workspaceId = workspaceId;
};

/**
 * Accepted request IDs: the 32 hex characters nginx's $request_id produces, UUIDs, ULIDs and similar short tokens. A
 * caller's ID is kept only when it matches, so nothing a client sends can break a log line or smuggle text into it.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,64}$/u;

export const isSafeRequestId = (value: string | undefined): value is string =>
  typeof value === "string" && SAFE_REQUEST_ID.test(value);

/** The caller's X-Request-Id when it is a short safe token, otherwise a new one. */
export const resolveRequestId = (header: string | string[] | undefined): string => {
  const value = Array.isArray(header) ? header[0] : header;
  return isSafeRequestId(value) ? value : randomUUID();
};
