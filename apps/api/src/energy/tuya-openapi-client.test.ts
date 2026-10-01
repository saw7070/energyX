import { describe, expect, it, vi } from "vitest";

import {
  canonicalTuyaUrl,
  createTuyaOpenApiClient,
  signTuyaRequest,
} from "./tuya-openapi-client.js";

describe("Tuya OpenAPI Source Adapter", () => {
  it("canonicalizes and signs the exact path and sorted query", () => {
    const url = canonicalTuyaUrl("/v2.0/test", { z: "2", a: "1" });
    expect(url).toBe("/v2.0/test?a=1&z=2");
    expect(canonicalTuyaUrl("/v2.0/test", { codes: "cur_power,total_forward_energy" }))
      .toBe("/v2.0/test?codes=cur_power,total_forward_energy");
    expect(signTuyaRequest({
      accessId: "client",
      accessSecret: "secret",
      accessToken: "token",
      timestamp: "1710000000000",
      nonce: "nonce",
      method: "GET",
      url,
    })).toBe("81C272336EA4A038D21C79CC3B812ABC1E1F2A0C116156D44781F4D358F8E591");
  });

  it("gets one token, validates the thing model, and follows report-log pagination without leaking credentials", async () => {
    const requested: Array<{ url: string; headers: Headers }> = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requested.push({ url, headers: new Headers(init?.headers) });
      if (url.includes("/v1.0/token")) {
        return json({ success: true, result: { access_token: "short-lived-token", expire_time: 7_200 } });
      }
      if (url.includes("/model")) {
        return json({
          success: true,
          result: {
            model: JSON.stringify({ services: [{ properties: [
              { code: "total_forward_energy", name: "Cumulative energy", typeSpec: { type: "value", scale: 2, unit: "kw.h" } },
              { code: "cur_power", name: "Power", typeSpec: { type: "value", scale: 3, unit: "kW" } },
            ] }] }),
          },
        });
      }
      if (url.includes("last_row_key=next-page")) {
        return json({ success: true, result: {
          logs: [{ code: "total_forward_energy", event_time: 1_710_000_900_000, value: 83046 }],
          has_more: false,
        } });
      }
      return json({ success: true, result: {
        logs: [
          { code: "total_forward_energy", event_time: 1_710_000_000_000, value: 83036 },
          { code: "cur_power", event_time: 1_710_000_000_000, value: 332 },
        ],
        has_more: true,
        last_row_key: "next-page",
      } });
    }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({
      accessId: "client-id",
      accessSecret: "never-persist-this-secret",
      fetch: fetchMock,
      now: () => 1_710_001_000_000,
      nonce: () => "fixed-nonce",
      sleep: async () => undefined,
    });

    const artifact = await client.syncEnergyReadings({
      startTime: 1_710_000_000_000,
      endTime: 1_710_001_000_000,
      devices: [{ deviceId: "exampledevice001", sourceLabel: "Panel A Total" }],
    });

    expect(requested.filter((item) => item.url.includes("/v1.0/token"))).toHaveLength(1);
    expect(requested.some((item) => item.url.includes(
      "codes=cur_power%2Ctotal_forward_energy&end_time=1710001000000&size=99&start_time=1710000000000",
    ))).toBe(true);
    const firstReportRequest = requested.find((item) => item.url.includes("/report-logs?")
      && !item.url.includes("last_row_key="))!;
    expect(firstReportRequest.headers.get("sign")).toBe(signTuyaRequest({
      accessId: "client-id",
      accessSecret: "never-persist-this-secret",
      accessToken: "short-lived-token",
      timestamp: "1710001000000",
      nonce: "fixed-nonce",
      method: "GET",
      url: "/v2.0/cloud/thing/exampledevice001/report-logs?codes=cur_power,total_forward_energy&end_time=1710001000000&size=99&start_time=1710000000000",
    }));
    expect(requested.slice(1).every((item) => item.headers.get("access_token") === "short-lived-token")).toBe(true);
    expect(artifact.devices[0]).toMatchObject({
      sourceLabel: "Panel A Total",
      properties: {
        totalForwardEnergy: { scale: 2, unit: "kw.h" },
        currentPower: { scale: 3, unit: "kW" },
      },
      logs: [
        { code: "cur_power", value: 332 },
        { code: "total_forward_energy", value: 83036 },
        { code: "total_forward_energy", value: 83046 },
      ],
    });
    const persisted = JSON.stringify(artifact);
    expect(persisted).not.toContain("exampledevice001");
    expect(persisted).not.toContain("never-persist-this-secret");
    expect(persisted).not.toContain("short-lived-token");
    expect(persisted).not.toContain("fixed-nonce");
  });

  it("retries 429 and 5xx responses before succeeding", async () => {
    let tokenAttempts = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/token")) {
        tokenAttempts += 1;
        if (tokenAttempts === 1) return json({}, 429);
        if (tokenAttempts === 2) return json({}, 503);
        return json({ success: true, result: { access_token: "token", expire_time: 7_200 } });
      }
      if (url.includes("/model")) {
        return json({ success: true, result: { model: JSON.stringify({ properties: [
          { code: "total_forward_energy", typeSpec: { scale: 2, unit: "kw.h" } },
          { code: "cur_power", typeSpec: { scale: 3, unit: "kW" } },
        ] }) } });
      }
      return json({ success: true, result: { logs: [], has_more: false } });
    }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({
      accessId: "client-id",
      accessSecret: "secret",
      fetch: fetchMock,
      sleep: async () => undefined,
    });

    await expect(client.syncEnergyReadings({
      startTime: 1_710_000_000_000,
      endTime: 1_710_001_000_000,
      devices: [{ deviceId: "exampledevice001", sourceLabel: "Meter 01" }],
    })).resolves.toMatchObject({ request: { deviceCount: 1 } });
    expect(tokenAttempts).toBe(3);
  });

  it("refreshes an expired access token once and retries the failed business request", async () => {
    let tokenRequests = 0;
    let reportRequests = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/token")) {
        tokenRequests += 1;
        return json({
          success: true,
          result: { access_token: `token-${tokenRequests}`, expire_time: 7_200 },
        });
      }
      if (url.includes("/model")) {
        return json({ success: true, result: { model: JSON.stringify({ properties: [
          { code: "total_forward_energy", typeSpec: { scale: 2, unit: "kw.h" } },
          { code: "cur_power", typeSpec: { scale: 3, unit: "kW" } },
        ] }) } });
      }
      reportRequests += 1;
      if (reportRequests === 1) {
        expect(new Headers(init?.headers).get("access_token")).toBe("token-1");
        return json({ success: false, code: "1010", msg: "token invalid" });
      }
      expect(new Headers(init?.headers).get("access_token")).toBe("token-2");
      return json({ success: true, result: { logs: [], has_more: false } });
    }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({
      accessId: "client-id",
      accessSecret: "secret",
      fetch: fetchMock,
      sleep: async () => undefined,
    });

    await expect(client.syncEnergyReadings({
      startTime: 1_710_000_000_000,
      endTime: 1_710_001_000_000,
      devices: [{ deviceId: "exampledevice001", sourceLabel: "Meter 01" }],
    })).resolves.toMatchObject({ request: { deviceCount: 1 } });
    expect(tokenRequests).toBe(2);
    expect(reportRequests).toBe(2);
  });

  it("keeps Tuya's own explanation in the error, so a refusal is not just a number", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/token")) return json({ success: true, result: { access_token: "token-1", expire_time: 7_200 } });
      // What a project with an IP allowlist actually returns.
      return json({ success: false, code: "1114", msg: "your ip(203.0.113.9) don't have access to this API" });
    }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({ accessId: "client-id", accessSecret: "secret", fetch: fetchMock, sleep: async () => undefined });

    // One token, no spaces: every layer that keeps the first word of an error keeps the whole reason.
    await expect(client.syncEnergyReadings({
      startTime: 1_710_000_000_000,
      endTime: 1_710_001_000_000,
      devices: [{ deviceId: "exampledevice001", sourceLabel: "Meter 01" }],
    })).rejects.toThrow("ENERGYIQ_TUYA_API_ERROR:1114:your_ip(203.0.113.9)_don't_have_access_to_this_API");
  });

  it("coalesces concurrent token refreshes across multiple device requests", async () => {
    let tokenRequests = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/token")) {
        tokenRequests += 1;
        return json({
          success: true,
          result: { access_token: `token-${tokenRequests}`, expire_time: 7_200 },
        });
      }
      const accessToken = new Headers(init?.headers).get("access_token");
      if (accessToken === "token-1") {
        return json({ success: false, code: "1010", msg: "token invalid" });
      }
      if (url.includes("/model")) {
        return json({ success: true, result: { model: JSON.stringify({ properties: [
          { code: "total_forward_energy", typeSpec: { scale: 2, unit: "kw.h" } },
          { code: "cur_power", typeSpec: { scale: 3, unit: "kW" } },
        ] }) } });
      }
      return json({ success: true, result: { logs: [], has_more: false } });
    }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({
      accessId: "client-id",
      accessSecret: "secret",
      fetch: fetchMock,
      sleep: async () => undefined,
    });

    await expect(client.syncEnergyReadings({
      startTime: 1_710_000_000_000,
      endTime: 1_710_001_000_000,
      devices: [
        { deviceId: "exampledevice001", sourceLabel: "Meter 01" },
        { deviceId: "exampledevice002", sourceLabel: "Meter 02" },
      ],
    })).resolves.toMatchObject({ request: { deviceCount: 2 } });
    expect(tokenRequests).toBe(2);
  });

  it("aborts and drains sibling device requests after the first device fails", async () => {
    let abortedRequests = 0;
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/token")) {
        return json({ success: true, result: { access_token: "token", expire_time: 7_200 } });
      }
      if (url.includes("exampledevice001/model")) {
        return json({ success: false, code: "provider-failure", msg: "failed" });
      }
      return await new Promise<Response>((resolve, reject) => {
        const timeout = setTimeout(() => resolve(json({ success: true, result: url.includes("/model")
          ? { model: JSON.stringify({ properties: [
            { code: "total_forward_energy", typeSpec: { scale: 2, unit: "kw.h" } },
            { code: "cur_power", typeSpec: { scale: 3, unit: "kW" } },
          ] }) }
          : { logs: [], has_more: false } })), 100);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timeout);
          abortedRequests += 1;
          reject(new DOMException("aborted", "AbortError"));
        }, { once: true });
      });
    }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({
      accessId: "client-id",
      accessSecret: "secret",
      fetch: fetchMock,
      sleep: async () => undefined,
    });

    await expect(client.syncEnergyReadings({
      startTime: 1_710_000_000_000,
      endTime: 1_710_001_000_000,
      devices: Array.from({ length: 6 }, (_, index) => ({
        deviceId: `exampledevice${String(index + 1).padStart(3, "0")}`,
        sourceLabel: `Meter ${index + 1}`,
      })),
    })).rejects.toThrow("ENERGYIQ_TUYA_API_ERROR:provider-failure");
    expect(abortedRequests).toBeGreaterThan(0);
    expect(requestedUrls.some((url) => url.includes("exampledevice005"))).toBe(false);
    expect(requestedUrls.some((url) => url.includes("exampledevice006"))).toBe(false);
  });

  it("fails closed when Tuya pagination repeats the same cursor", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/token")) {
        return json({ success: true, result: { access_token: "token", expire_time: 7_200 } });
      }
      if (url.includes("/model")) {
        return json({ success: true, result: { model: JSON.stringify({ properties: [
          { code: "total_forward_energy", typeSpec: { scale: 2, unit: "kw.h" } },
          { code: "cur_power", typeSpec: { scale: 3, unit: "kW" } },
        ] }) } });
      }
      return json({ success: true, result: {
        logs: [],
        has_more: true,
        last_row_key: "stalled-cursor",
      } });
    }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({
      accessId: "client-id",
      accessSecret: "secret",
      fetch: fetchMock,
      sleep: async () => undefined,
    });

    await expect(client.syncEnergyReadings({
      startTime: 1_710_000_000_000,
      endTime: 1_710_001_000_000,
      devices: [{ deviceId: "exampledevice001", sourceLabel: "Meter 01" }],
    })).rejects.toThrow("ENERGYIQ_TUYA_PAGINATION_STALLED");
  });

  it("recovers a request timeout with a bounded retry", async () => {
    let tokens = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("/token")) {
        tokens += 1;
        if (tokens === 1) return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
        return json({ success: true, result: { access_token: "token", expire_time: 7200 } });
      }
      if (String(input).includes("/model")) return json({ success: true, result: { model: JSON.stringify({ properties: [
        { code: "total_forward_energy", typeSpec: { scale: 2, unit: "kw.h" } },
        { code: "cur_power", typeSpec: { scale: 3, unit: "kW" } },
      ] }) } });
      return json({ success: true, result: { logs: [], has_more: false } });
    }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({ accessId: "id", accessSecret: "secret", fetch: fetchMock, requestTimeoutMs: 5, sleep: async () => undefined });
    await expect(client.syncEnergyReadings({ startTime: 1_710_000_000_000, endTime: 1_710_001_000_000, devices: [{ deviceId: "exampledevice001", sourceLabel: "Meter" }] })).resolves.toMatchObject({ devices: [{ sourceLabel: "Meter", logs: [] }] });
    expect(tokens).toBe(2);
  });

  it("does not retry when the caller stops during retry backoff", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async () => { throw new TypeError("network unavailable"); }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({ accessId: "id", accessSecret: "secret", fetch: fetchMock, sleep: async () => { controller.abort(); } });
    await expect(client.syncEnergyReadings({ startTime: 1_710_000_000_000, endTime: 1_710_001_000_000, signal: controller.signal, devices: [{ deviceId: "exampledevice001", sourceLabel: "Meter" }] })).rejects.toThrow("ENERGYIQ_TUYA_REQUEST_ABORTED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("aborts a hung request at the bounded timeout without retrying forever", async () => {
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({
      accessId: "client-id",
      accessSecret: "secret",
      fetch: fetchMock,
      requestTimeoutMs: 5,
      sleep: async () => undefined,
    });

    await expect(client.syncEnergyReadings({
      startTime: 1_710_000_000_000,
      endTime: 1_710_001_000_000,
      devices: [{ deviceId: "exampledevice001", sourceLabel: "Meter 01" }],
    })).rejects.toThrow("ENERGYIQ_TUYA_REQUEST_TIMEOUT");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the same timeout active while a successful response body is still streaming", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => ({
      ok: true,
      status: 200,
      body: null,
      json: () => new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      }),
    }) as unknown as Response) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({
      accessId: "client-id",
      accessSecret: "secret",
      fetch: fetchMock,
      requestTimeoutMs: 5,
      sleep: async () => undefined,
    });

    await expect(client.syncEnergyReadings({
      startTime: 1_710_000_000_000,
      endTime: 1_710_001_000_000,
      devices: [{ deviceId: "exampledevice001", sourceLabel: "Meter 01" }],
    })).rejects.toThrow("ENERGYIQ_TUYA_REQUEST_TIMEOUT");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("lists the project's devices page by page and keeps their LAN keys on the server", async () => {
    const page = (from: number, count: number) => Array.from({ length: count }, (_, index) => ({
      id: `listdevice${String(from + index).padStart(4, "0")}`,
      name: `Device ${from + index}`,
      customName: index === 0 ? `Panel ${from + index}` : "",
      productName: "Energy meter",
      category: "zndb",
      isOnline: index % 2 === 0,
      localKey: "never-leaves-the-server",
    }));
    const requested: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/token")) return json({ success: true, result: { access_token: "token-1", expire_time: 7_200 } });
      requested.push(url);
      return json({ success: true, result: url.includes("last_id=listdevice0019") ? page(20, 3) : page(0, 20) });
    }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({ accessId: "client-id", accessSecret: "secret", fetch: fetchMock, sleep: async () => undefined });

    const devices = await client.listDevices();

    expect(devices).toHaveLength(23);
    expect(devices[0]).toEqual({ id: "listdevice0000", name: "Panel 0", productName: "Energy meter", category: "zndb", online: true });
    expect(devices[1]).toMatchObject({ name: "Device 1", online: false });
    expect(JSON.stringify(devices)).not.toContain("never-leaves-the-server");
    expect(requested).toHaveLength(2);
    expect(requested[0]).toContain("/v2.0/cloud/thing/device?page_size=20");
  });

  it("falls back to the linked app account's devices when the project list is refused", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/token")) return json({ success: true, result: { access_token: "token-1", expire_time: 7_200 } });
      if (url.includes("/v2.0/cloud/thing/device")) return json({ success: false, code: "28841105", msg: "No permissions" });
      return json({ success: true, result: { devices: [{ id: "appdevice0001", name: "Incoming", product_name: "Meter", online: true }], has_more: false } });
    }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({ accessId: "client-id", accessSecret: "secret", fetch: fetchMock, sleep: async () => undefined });

    expect(await client.listDevices()).toEqual([{ id: "appdevice0001", name: "Incoming", productName: "Meter", online: true }]);
  });

  it("says when a device does not report cumulative energy", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/token")) return json({ success: true, result: { access_token: "token-1", expire_time: 7_200 } });
      return json({ success: true, result: { model: JSON.stringify({ properties: [{ code: "switch_1" }] }) } });
    }) as unknown as typeof fetch;
    const client = createTuyaOpenApiClient({ accessId: "client-id", accessSecret: "secret", fetch: fetchMock, sleep: async () => undefined });

    expect(await client.checkEnergyDevice("plainswitch001")).toEqual({
      ok: false,
      reason: "ENERGYIQ_TUYA_PROPERTY_REQUIRED:total_forward_energy",
    });
  });
});

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});
