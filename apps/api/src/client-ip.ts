import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

/**
 * The address of the person making a request, for sign-in rate limits and the audit log.
 *
 * Only proxies we run may speak for the client: X-Forwarded-For is read only when the connection itself comes from a
 * loopback or private address (nginx and the web app on the same host or network), and then only the entry added by
 * the outermost trusted proxy. Everything to the left of it was written by the client and is ignored.
 * ENERGYX_TRUSTED_PROXY_HOPS sets how many of our proxies append to the header (default 1: nginx; 0 ignores it).
 */
export const clientIpAddress = (
  request: Pick<IncomingMessage, "headers" | "socket">,
  env: Record<string, string | undefined> = process.env
): string | undefined => {
  const socketAddress = normalizeAddress(request.socket?.remoteAddress);
  const hops = trustedProxyHops(env);
  if (hops === 0 || !socketAddress || !isPrivateOrLoopback(socketAddress)) return socketAddress;
  const header = request.headers["x-forwarded-for"];
  const entries = (Array.isArray(header) ? header.join(",") : header ?? "")
    .split(",")
    .map((entry) => normalizeAddress(entry.trim()))
    .filter((entry): entry is string => Boolean(entry));
  if (entries.length === 0) return socketAddress;
  return entries[Math.max(0, entries.length - hops)] ?? socketAddress;
};

const trustedProxyHops = (env: Record<string, string | undefined>): number => {
  const parsed = Number.parseInt(env.ENERGYX_TRUSTED_PROXY_HOPS ?? "1", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 10) : 1;
};

const normalizeAddress = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const unwrapped = value.startsWith("::ffff:") && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  return isIP(unwrapped) ? unwrapped : undefined;
};

const isPrivateOrLoopback = (address: string): boolean => {
  if (isIP(address) === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const lower = address.toLowerCase();
  return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd");
};
