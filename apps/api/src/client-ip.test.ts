import { describe, expect, it } from "vitest";
import { clientIpAddress } from "./client-ip.js";

const request = (remoteAddress: string | undefined, forwardedFor?: string) => ({
  headers: forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor },
  socket: { remoteAddress },
}) as Parameters<typeof clientIpAddress>[0];

describe("clientIpAddress", () => {
  it("takes the address nginx appended, not one the client wrote", () => {
    expect(clientIpAddress(request("127.0.0.1", "1.2.3.4, 203.0.113.9"), {})).toBe("203.0.113.9");
    expect(clientIpAddress(request("::ffff:127.0.0.1", "203.0.113.9"), {})).toBe("203.0.113.9");
  });

  it("ignores the header when the connection does not come from our own proxy", () => {
    expect(clientIpAddress(request("198.51.100.7", "1.2.3.4"), {})).toBe("198.51.100.7");
  });

  it("follows the configured number of trusted proxies", () => {
    expect(clientIpAddress(request("10.0.0.5", "1.2.3.4, 203.0.113.9, 10.0.0.2"), { ENERGYX_TRUSTED_PROXY_HOPS: "2" })).toBe("203.0.113.9");
    expect(clientIpAddress(request("10.0.0.5", "203.0.113.9"), { ENERGYX_TRUSTED_PROXY_HOPS: "0" })).toBe("10.0.0.5");
  });

  it("drops entries that are not IP addresses", () => {
    expect(clientIpAddress(request("127.0.0.1", "not-an-ip"), {})).toBe("127.0.0.1");
    expect(clientIpAddress(request(undefined), {})).toBeUndefined();
  });
});
