import type { LookupAddress } from "node:dns";
import { describe, expect, it } from "vitest";

import { normaliseIssuer, OidcClient } from "./oidc.js";
import { assertSafeHttpsUrl, createGuardedHttpClient, guardedLookup, isPublicAddress, OutboundRequestError } from "./safe-http.js";

const refusal = (promise: Promise<unknown>) => promise.then(
  () => "allowed",
  (error: unknown) => (error instanceof OutboundRequestError ? error.reason : `other: ${String(error)}`)
);

describe("Outbound requests to identity providers (SSRF guard)", () => {
  it("treats only public internet addresses as public", () => {
    for (const address of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1",
      "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
      "64:ff9b::a00:1", "ff02::1", "[::1]", "not-an-ip"
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
    for (const address of ["8.8.8.8", "20.190.128.1", "142.250.72.14", "2606:4700:4700::1111", "2001:4860:4860::8888"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("allows only plain https addresses", () => {
    expect(() => assertSafeHttpsUrl("http://login.example.com/")).toThrow(/https/u);
    expect(() => assertSafeHttpsUrl("https://user:pass@login.example.com/")).toThrow(/user name or password/u);
    expect(() => assertSafeHttpsUrl("https://localhost/")).toThrow(/own network/u);
    expect(() => assertSafeHttpsUrl("https://127.0.0.1/")).toThrow(/private/u);
    expect(() => assertSafeHttpsUrl("https://[::1]:8443/")).toThrow(/private/u);
    expect(() => assertSafeHttpsUrl("https://169.254.169.254/latest/meta-data")).toThrow(/private/u);
    expect(() => assertSafeHttpsUrl("file:///etc/passwd")).toThrow(/https/u);
    expect(assertSafeHttpsUrl("https://login.microsoftonline.com/tenant/v2.0").hostname).toBe("login.microsoftonline.com");
  });

  it("refuses a host name that resolves to a private, loopback or link-local address, before connecting", async () => {
    const answers: Record<string, Array<{ address: string; family: number }>> = {
      "loopback.example.test": [{ address: "127.0.0.1", family: 4 }],
      "metadata.example.test": [{ address: "169.254.169.254", family: 4 }],
      "internal.example.test": [{ address: "10.0.0.8", family: 4 }],
      "v6-loopback.example.test": [{ address: "::1", family: 6 }],
      // One public answer does not excuse a private one: the socket could be steered to either.
      "mixed.example.test": [{ address: "93.184.216.34", family: 4 }, { address: "192.168.0.10", family: 4 }]
    };
    const resolved: string[] = [];
    const client = createGuardedHttpClient({
      resolver: async (hostname) => {
        resolved.push(hostname);
        return answers[hostname] ?? [];
      },
      timeoutMs: 2_000
    });
    for (const host of Object.keys(answers)) {
      expect(await refusal(client({ url: `https://${host}/.well-known/openid-configuration` })), host).toBe("private_address");
    }
    expect(resolved).toEqual(Object.keys(answers));
    expect(await refusal(client({ url: "https://10.0.0.1/token", method: "POST", body: "x" }))).toBe("private_address");
    expect(await refusal(client({ url: "http://login.example.test/" }))).toBe("insecure_url");
  });

  it("hands the socket only the addresses it checked", async () => {
    const lookup = guardedLookup(async () => [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1::1", family: 6 }]);
    const all = await new Promise<LookupAddress[]>((resolve, reject) => {
      lookup("idp.example.test", { all: true }, (error, addresses) => (error ? reject(error) : resolve(addresses as LookupAddress[])));
    });
    expect(all.map((entry) => entry.address)).toEqual(["93.184.216.34", "2606:2800:220:1::1"]);
    const single = await new Promise<string>((resolve, reject) => {
      lookup("idp.example.test", { family: 6 }, (error, address) => (error ? reject(error) : resolve(address as string)));
    });
    expect(single).toBe("2606:2800:220:1::1");
  });

  it("never lets an issuer or its discovery document point the server at its own network", async () => {
    expect(() => normaliseIssuer("http://idp.example.test")).toThrow();
    expect(() => normaliseIssuer("https://127.0.0.1/realms/x")).toThrow();
    expect(() => normaliseIssuer("https://idp.example.test/x?tenant=1")).toThrow();
    expect(normaliseIssuer(" https://idp.example.test/realms/acme/ ")).toBe("https://idp.example.test/realms/acme");

    const oidc = new OidcClient(async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        issuer: "https://idp.example.test",
        authorization_endpoint: "https://idp.example.test/authorize",
        token_endpoint: "https://169.254.169.254/latest/meta-data",
        jwks_uri: "https://idp.example.test/keys"
      })
    }));
    await expect(oidc.discover("https://idp.example.test")).rejects.toThrow(/token_endpoint is not a public https address/u);
  });
});
