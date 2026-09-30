const DEFAULT_API_TARGET = "http://127.0.0.1:8787";

/** Headers that tell intermediaries (nginx, CDNs, Next compress) not to buffer SSE. */
export const STREAMING_PROXY_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
} as const;

function readProxyTarget(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed.replace(/\/$/u, "");
    }
  }
  return DEFAULT_API_TARGET;
}

export function getApiProxyTarget(): string {
  return readProxyTarget(
    process.env.API_PROXY_TARGET,
    process.env.NEXT_PUBLIC_CONFIG_API_URL,
    process.env.NEXT_PUBLIC_AGENT_RUNTIME_URL?.replace(/\/api\/copilotkit\/?$/u, ""),
  );
}

export function isStreamingProxyPath(pathname: string): boolean {
  return pathname === "/api/copilotkit" || pathname.startsWith("/api/copilotkit/");
}

export function isStreamingContentType(contentType: string | null): boolean {
  return Boolean(contentType?.toLowerCase().includes("text/event-stream"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function visibleStructuredText(content: unknown[]): string {
  const parts: string[] = [];

  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    }
  }

  return parts.join("");
}

function containsUserAttachment(content: unknown[]): boolean {
  const attachmentTypes = new Set(["image", "audio", "video", "document", "binary"]);
  return content.some(
    (part) => isRecord(part) && typeof part.type === "string" && attachmentTypes.has(part.type),
  );
}

function normalizeMessageContainer(
  container: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!Array.isArray(container.messages)) return undefined;

  let changed = false;
  const messages = container.messages.map((message) => {
    if (!isRecord(message) || !Array.isArray(message.content)) {
      return message;
    }
    // Preserve actual user attachments, but reduce text-only arrays produced
    // by newer CopilotKit clients for the older Runtime's string contract.
    if (message.role === "user" && containsUserAttachment(message.content)) return message;
    changed = true;
    return { ...message, content: visibleStructuredText(message.content) };
  });

  return changed ? { ...container, messages } : undefined;
}

function normalizeCopilotKitRequestBody(body: ArrayBuffer, contentType: string | null): BodyInit {
  if (!contentType?.toLowerCase().includes("application/json") || body.byteLength === 0) {
    return body;
  }

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(body));
    if (!isRecord(parsed)) return body;

    const direct = normalizeMessageContainer(parsed);
    if (direct) return JSON.stringify(direct);

    // CopilotKit's single-route transport wraps RunAgentInput inside `body`.
    if (!isRecord(parsed.body)) return body;
    const nested = normalizeMessageContainer(parsed.body);
    return nested ? JSON.stringify({ ...parsed, body: nested }) : body;
  } catch {
    return body;
  }
}

/**
 * Apply hop-by-hop cleanup and SSE anti-buffering headers on a proxied response.
 * Keeps `upstream.body` as a ReadableStream — never buffer the response body.
 */
export function buildProxyResponseHeaders(
  upstreamHeaders: Headers,
  pathname: string,
): Headers {
  const responseHeaders = new Headers(upstreamHeaders);
  // Recompute length/encoding for this hop; forwarding upstream values breaks streaming.
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  if (
    isStreamingProxyPath(pathname) ||
    isStreamingContentType(responseHeaders.get("content-type"))
  ) {
    for (const [key, value] of Object.entries(STREAMING_PROXY_HEADERS)) {
      responseHeaders.set(key, value);
    }
  }

  return responseHeaders;
}

export async function proxyToApi(request: Request, pathname: string): Promise<Response> {
  const incoming = new URL(request.url);
  const targetUrl = `${getApiProxyTarget()}${pathname}${incoming.search}`;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    // Do not cache proxied API traffic (especially AG-UI event streams).
    cache: "no-store",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    // Agent run bodies are small JSON; buffering the request is fine.
    // Response body must remain a stream (see buildProxyResponseHeaders).
    const body = await request.arrayBuffer();
    init.body = isStreamingProxyPath(pathname)
      ? normalizeCopilotKitRequestBody(body, request.headers.get("content-type"))
      : body;
  }

  const upstream = await fetch(targetUrl, init);
  const responseHeaders = buildProxyResponseHeaders(upstream.headers, pathname);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}
