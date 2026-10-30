import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

/**
 * Outbound HTTPS for addresses an Organisation admin typed in (their identity provider's discovery, keys and token
 * endpoints). Such a URL must never let someone reach the server's own network, so every request:
 *
 * - is https only, with no user name or password in the URL;
 * - resolves the host name once and refuses it if any address is private, loopback, link-local, multicast or
 *   otherwise not on the public internet (cloud metadata at 169.254.169.254 included);
 * - connects to exactly the address that was checked (the check runs inside the socket's own DNS lookup, so a second
 *   lookup cannot be steered somewhere else);
 * - never follows redirects, gives up after a timeout, and stops reading after a size limit.
 */
export type OutboundHttpRequest = {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
};

export type OutboundHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type OutboundHttpClient = (request: OutboundHttpRequest) => Promise<OutboundHttpResponse>;

export type OutboundRefusalReason = "insecure_url" | "private_address" | "timeout" | "too_large" | "network";

export class OutboundRequestError extends Error {
  constructor(readonly reason: OutboundRefusalReason, message: string) {
    super(message);
    this.name = "OutboundRequestError";
  }
}

export type HostResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 1024 * 1024;

const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv4");
}
// IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are matched against the IPv4 rules above by BlockList itself.
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64],
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, "ipv6");
}

/** True only for an address on the public internet. Anything unparseable counts as not public. */
export const isPublicAddress = (address: string): boolean => {
  const bare = address.replace(/^\[|\]$/gu, "").split("%")[0] ?? "";
  const family = isIP(bare);
  if (family === 4) return !NON_PUBLIC.check(bare, "ipv4");
  if (family === 6) return !NON_PUBLIC.check(bare, "ipv6");
  return false;
};

/** Parses the URL and refuses anything but a plain https address (an IP literal must itself be public). */
export const assertSafeHttpsUrl = (raw: string): URL => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new OutboundRequestError("insecure_url", "The address is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new OutboundRequestError("insecure_url", "Only https addresses are allowed.");
  }
  if (url.username || url.password) {
    throw new OutboundRequestError("insecure_url", "The address must not contain a user name or password.");
  }
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new OutboundRequestError("private_address", "The address points at this server's own network.");
  }
  if (isIP(host) && !isPublicAddress(host)) {
    throw new OutboundRequestError("private_address", "The address points at a private or reserved network.");
  }
  return url;
};

const systemResolver: HostResolver = (hostname) => new Promise((resolve, reject) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) reject(error);
    else resolve(addresses);
  });
});

/**
 * The socket's DNS lookup: resolve once, refuse the whole host if any answer is not public, and hand the socket
 * only the addresses that were checked.
 */
export const guardedLookup = (resolver: HostResolver) => (
  hostname: string,
  options: LookupOptions,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
): void => {
  resolver(hostname).then((addresses) => {
    const wanted = options.family === 4 || options.family === 6
      ? addresses.filter((entry) => entry.family === options.family)
      : addresses;
    if (wanted.length === 0) {
      callback(Object.assign(new Error(`No address found for ${hostname}.`), { code: "ENOTFOUND" }), "", 0);
      return;
    }
    if (!addresses.every((entry) => isPublicAddress(entry.address))) {
      callback(new OutboundRequestError("private_address", "The address points at a private or reserved network."), "", 0);
      return;
    }
    if (options.all) {
      callback(null, wanted.map((entry) => ({ address: entry.address, family: entry.family })));
      return;
    }
    callback(null, wanted[0]!.address, wanted[0]!.family);
  }, (error: unknown) => {
    callback(error instanceof Error ? error : new Error(String(error)), "", 0);
  });
};

export const createGuardedHttpClient = (options: {
  resolver?: HostResolver;
  timeoutMs?: number;
  maxBytes?: number;
} = {}): OutboundHttpClient => {
  const resolver = options.resolver ?? systemResolver;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lookup = guardedLookup(resolver);
  return (input) => new Promise<OutboundHttpResponse>((resolve, reject) => {
    let url: URL;
    try {
      url = assertSafeHttpsUrl(input.url);
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    const finish = (error: Error | undefined, value?: OutboundHttpResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const request = httpsRequest(url, {
      method: input.method ?? "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "EnergyX-SSO/1.0",
        ...(input.body !== undefined ? { "Content-Length": String(Buffer.byteLength(input.body)) } : {}),
        ...input.headers
      },
      lookup,
      timeout: timeoutMs
    }, (response) => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy();
          finish(new OutboundRequestError("too_large", "The response was too large."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (typeof value === "string") headers[name.toLowerCase()] = value;
          else if (Array.isArray(value)) headers[name.toLowerCase()] = value.join(", ");
        }
        finish(undefined, { status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString("utf8") });
      });
      response.on("error", (error) => finish(asOutboundError(error)));
    });
    const timer = setTimeout(() => {
      request.destroy();
      finish(new OutboundRequestError("timeout", "The identity provider took too long to answer."));
    }, timeoutMs);
    request.on("timeout", () => {
      request.destroy();
      finish(new OutboundRequestError("timeout", "The identity provider took too long to answer."));
    });
    request.on("error", (error) => finish(asOutboundError(error)));
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
};

const asOutboundError = (error: unknown): OutboundRequestError => {
  if (error instanceof OutboundRequestError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new OutboundRequestError("network", `The identity provider could not be reached (${message}).`);
};
