import { createHash, createHmac, randomUUID } from "node:crypto";

const TUYA_ENERGY_CODE = "total_forward_energy" as const;
const TUYA_POWER_CODE = "cur_power" as const;
const TUYA_LOG_CODES = [TUYA_POWER_CODE, TUYA_ENERGY_CODE] as const;
const EMPTY_BODY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const TUYA_REPORT_LOG_ARTIFACT_VERSION = "energyiq-tuya-report-log-artifact-v1" as const;
export const TUYA_SINGAPORE_ENDPOINT = "https://openapi-sg.iotbing.com" as const;

export type TuyaDeviceBinding = {
  deviceId: string;
  sourceLabel: string;
};

export type TuyaReportLog = {
  code: string;
  eventTime: number;
  value: unknown;
};

export type TuyaPropertyEvidence = {
  code: typeof TUYA_ENERGY_CODE | typeof TUYA_POWER_CODE;
  name?: string;
  type?: string;
  scale: number;
  unit: string;
};

export type TuyaReportLogArtifact = {
  schemaVersion: typeof TUYA_REPORT_LOG_ARTIFACT_VERSION;
  provider: "tuya";
  region: "sg";
  endpoint: typeof TUYA_SINGAPORE_ENDPOINT;
  createdAt: string;
  request: {
    startTime: number;
    endTime: number;
    codes: typeof TUYA_LOG_CODES;
    deviceCount: number;
  };
  devices: Array<{
    sourceLabel: string;
    properties: {
      totalForwardEnergy: TuyaPropertyEvidence;
      currentPower: TuyaPropertyEvidence;
    };
    logs: TuyaReportLog[];
  }>;
};

export type TuyaEnergySyncInput = {
  startTime: number;
  endTime: number;
  devices: TuyaDeviceBinding[];
  signal?: AbortSignal;
};

export type TuyaOpenApiClient = {
  syncEnergyReadings(input: TuyaEnergySyncInput): Promise<TuyaReportLogArtifact>;
};

type TuyaClientOptions = {
  accessId: string;
  accessSecret: string;
  endpoint?: string;
  fetch?: typeof fetch;
  now?: () => number;
  nonce?: () => string;
  sleep?: (milliseconds: number) => Promise<void>;
  requestTimeoutMs?: number;
};

type TuyaEnvelope = {
  success?: boolean;
  result?: unknown;
  code?: unknown;
  msg?: unknown;
};

type TuyaToken = {
  value: string;
  expiresAt: number;
};

class TuyaOpenApiError extends Error {
  constructor(
    message: string,
    readonly tuyaCode?: string,
  ) {
    super(message);
  }
}

export const createTuyaOpenApiClientFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): TuyaOpenApiClient => {
  const accessId = env.ENERGYIQ_TUYA_ACCESS_ID?.trim();
  const accessSecret = env.ENERGYIQ_TUYA_ACCESS_SECRET?.trim();
  if (!accessId) throw new Error("ENERGYIQ_TUYA_ACCESS_ID_REQUIRED");
  if (!accessSecret) throw new Error("ENERGYIQ_TUYA_ACCESS_SECRET_REQUIRED");
  const endpoint = env.ENERGYIQ_TUYA_ENDPOINT?.trim();
  if (endpoint && endpoint !== TUYA_SINGAPORE_ENDPOINT) {
    throw new Error("ENERGYIQ_TUYA_ENDPOINT_INVALID");
  }
  return createTuyaOpenApiClient({
    accessId,
    accessSecret,
    ...(endpoint ? { endpoint } : {}),
  });
};

export const createTuyaOpenApiClient = (options: TuyaClientOptions): TuyaOpenApiClient => {
  const endpoint = (options.endpoint ?? TUYA_SINGAPORE_ENDPOINT).replace(/\/$/u, "");
  if (endpoint !== TUYA_SINGAPORE_ENDPOINT) throw new Error("ENERGYIQ_TUYA_ENDPOINT_INVALID");
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const nonce = options.nonce ?? randomUUID;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0 || requestTimeoutMs > 120_000) {
    throw new Error("ENERGYIQ_TUYA_REQUEST_TIMEOUT_INVALID");
  }
  let token: TuyaToken | undefined;
  let tokenRequest: Promise<string> | undefined;

  const signedGet = async (
    path: string,
    query: Record<string, string>,
    accessToken?: string,
    signal?: AbortSignal,
  ): Promise<TuyaEnvelope> => {
    const signedUrl = canonicalTuyaUrl(path, query);
    const requestUrl = encodedTuyaUrl(path, query);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (signal?.aborted) throw new Error("ENERGYIQ_TUYA_REQUEST_ABORTED");
      const timestamp = String(now());
      const requestNonce = nonce();
      const sign = signTuyaRequest({
        accessId: options.accessId,
        accessSecret: options.accessSecret,
        ...(accessToken ? { accessToken } : {}),
        timestamp,
        nonce: requestNonce,
        method: "GET",
        url: signedUrl,
      });
      try {
        const response = await fetchEnvelopeWithTimeout(fetchImpl, `${endpoint}${requestUrl}`, {
          method: "GET",
          headers: {
            client_id: options.accessId,
            sign,
            sign_method: "HMAC-SHA256",
            t: timestamp,
            nonce: requestNonce,
            ...(accessToken ? { access_token: accessToken } : {}),
          },
        }, requestTimeoutMs, signal);
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await sleep(100 * (2 ** attempt));
          continue;
        }
        if (!response.ok) {
          throw new TuyaOpenApiError(`ENERGYIQ_TUYA_HTTP_ERROR:${response.status}`);
        }
        const envelope = response.envelope;
        if (!envelope) throw new Error("ENERGYIQ_TUYA_RESPONSE_INVALID");
        if (envelope.success !== true) {
          const code = displayUnknown(envelope.code);
          // Tuya explains the refusal in `msg` ("No permissions", "token invalid"…). Without it an
          // administrator only sees a number, so carry it through, trimmed and free of any payload.
          const detail = displayUnknown(envelope.msg).replace(/[^\x20-\x7e]/g, " ").trim().replace(/\s+/g, "_").slice(0, 120);
          throw new TuyaOpenApiError(`ENERGYIQ_TUYA_API_ERROR:${code || "unknown"}${detail ? `:${detail}` : ""}`, code);
        }
        return envelope;
      } catch (error) {
        lastError = error;
        if (
          error instanceof TuyaOpenApiError
          || (error instanceof Error && error.message === "ENERGYIQ_TUYA_REQUEST_ABORTED")
          || attempt >= 2
        ) throw error;
        await sleep(100 * (2 ** attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("ENERGYIQ_TUYA_REQUEST_FAILED");
  };

  const acquireToken = async (
    force = false,
    signal?: AbortSignal,
    rejectedToken?: string,
  ): Promise<string> => {
    if (token && token.expiresAt - now() > 60_000 && (!force || token.value !== rejectedToken)) {
      return token.value;
    }
    if (tokenRequest) return tokenRequest;
    const currentRequest = (async () => {
      const envelope = await signedGet("/v1.0/token", { grant_type: "1" }, undefined, signal);
      const result = requireRecord(envelope.result, "ENERGYIQ_TUYA_TOKEN_INVALID");
      const value = requireString(result.access_token, "ENERGYIQ_TUYA_TOKEN_INVALID");
      const expireSeconds = requirePositiveNumber(result.expire_time, "ENERGYIQ_TUYA_TOKEN_INVALID");
      token = { value, expiresAt: now() + expireSeconds * 1_000 };
      return value;
    })();
    tokenRequest = currentRequest;
    try {
      return await currentRequest;
    } finally {
      if (tokenRequest === currentRequest) tokenRequest = undefined;
    }
  };

  const businessGet = async (
    path: string,
    query: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    let rejectedToken: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const accessToken = await acquireToken(attempt > 0, signal, rejectedToken);
      try {
        return (await signedGet(path, query, accessToken, signal)).result;
      } catch (error) {
        if (attempt === 0 && error instanceof TuyaOpenApiError && isTokenError(error)) {
          if (token?.value === accessToken) token = undefined;
          rejectedToken = accessToken;
          continue;
        }
        throw error;
      }
    }
    throw new Error("ENERGYIQ_TUYA_TOKEN_REFRESH_FAILED");
  };

  const readPropertyEvidence = async (deviceId: string, signal?: AbortSignal): Promise<{
    totalForwardEnergy: TuyaPropertyEvidence;
    currentPower: TuyaPropertyEvidence;
  }> => {
    const result = requireRecord(
      await businessGet(`/v2.0/cloud/thing/${encodeURIComponent(deviceId)}/model`, {}, signal),
      "ENERGYIQ_TUYA_MODEL_INVALID",
    );
    const modelText = requireString(result.model, "ENERGYIQ_TUYA_MODEL_INVALID");
    let model: unknown;
    try {
      model = JSON.parse(modelText) as unknown;
    } catch {
      throw new Error("ENERGYIQ_TUYA_MODEL_INVALID");
    }
    const totalForwardEnergy = findPropertyEvidence(model, TUYA_ENERGY_CODE);
    const currentPower = findPropertyEvidence(model, TUYA_POWER_CODE);
    assertExpectedUnit(totalForwardEnergy, ["kw.h", "kwh"]);
    assertExpectedUnit(currentPower, ["kw"]);
    return { totalForwardEnergy, currentPower };
  };

  const readReportLogs = async (
    deviceId: string,
    input: TuyaEnergySyncInput,
    signal?: AbortSignal,
  ): Promise<TuyaReportLog[]> => {
    const logs: TuyaReportLog[] = [];
    let lastRowKey: string | undefined;
    const seenRowKeys = new Set<string>();
    for (let page = 0; page < 1_000; page += 1) {
      const result = requireRecord(await businessGet(
        `/v2.0/cloud/thing/${encodeURIComponent(deviceId)}/report-logs`,
        {
          codes: TUYA_LOG_CODES.join(","),
          end_time: String(input.endTime),
          ...(lastRowKey ? { last_row_key: lastRowKey } : {}),
          size: "99",
          start_time: String(input.startTime),
        },
        signal,
      ), "ENERGYIQ_TUYA_REPORT_LOGS_INVALID");
      const pageLogs = Array.isArray(result.logs) ? result.logs : [];
      for (const value of pageLogs) logs.push(parseReportLog(value));
      if (result.has_more !== true) return logs;
      const nextRowKey = requireString(result.last_row_key, "ENERGYIQ_TUYA_REPORT_LOGS_INVALID");
      if (seenRowKeys.has(nextRowKey)) throw new Error("ENERGYIQ_TUYA_PAGINATION_STALLED");
      seenRowKeys.add(nextRowKey);
      lastRowKey = nextRowKey;
    }
    throw new Error("ENERGYIQ_TUYA_PAGINATION_LIMIT");
  };

  return {
    async syncEnergyReadings(input) {
      validateSyncInput(input);
      const controller = new AbortController();
      const abortFromCaller = (): void => controller.abort();
      input.signal?.addEventListener("abort", abortFromCaller, { once: true });
      if (input.signal?.aborted) controller.abort();
      let devices: TuyaReportLogArtifact["devices"];
      try {
        devices = await mapWithConcurrency(input.devices, 4, async (binding) => {
          try {
            const [properties, logs] = await Promise.all([
              readPropertyEvidence(binding.deviceId, controller.signal),
              readReportLogs(binding.deviceId, input, controller.signal),
            ]);
            return {
              sourceLabel: binding.sourceLabel,
              properties,
              logs: logs.sort((left, right) => left.eventTime - right.eventTime || left.code.localeCompare(right.code)),
            };
          } catch (error) {
            controller.abort();
            throw error;
          }
        });
      } finally {
        input.signal?.removeEventListener("abort", abortFromCaller);
      }
      return {
        schemaVersion: TUYA_REPORT_LOG_ARTIFACT_VERSION,
        provider: "tuya",
        region: "sg",
        endpoint: TUYA_SINGAPORE_ENDPOINT,
        createdAt: new Date(now()).toISOString(),
        request: {
          startTime: input.startTime,
          endTime: input.endTime,
          codes: TUYA_LOG_CODES,
          deviceCount: input.devices.length,
        },
        devices,
      };
    },
  };
};

export const canonicalTuyaUrl = (path: string, query: Record<string, string>): string => {
  const entries = Object.entries(query).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return path;
  return `${path}?${entries.map(([key, value]) => `${key}=${value}`).join("&")}`;
};

const encodedTuyaUrl = (path: string, query: Record<string, string>): string => {
  const entries = Object.entries(query).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return path;
  return `${path}?${entries.map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`).join("&")}`;
};

const rfc3986 = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
  `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export const signTuyaRequest = (input: {
  accessId: string;
  accessSecret: string;
  accessToken?: string;
  timestamp: string;
  nonce: string;
  method: "GET";
  url: string;
}): string => {
  const contentSha256 = createHash("sha256").update("").digest("hex");
  if (contentSha256 !== EMPTY_BODY_SHA256) throw new Error("ENERGYIQ_TUYA_SHA256_INVARIANT_FAILED");
  const stringToSign = `${input.method}\n${contentSha256}\n\n${input.url}`;
  const source = `${input.accessId}${input.accessToken ?? ""}${input.timestamp}${input.nonce}${stringToSign}`;
  return createHmac("sha256", input.accessSecret).update(source).digest("hex").toUpperCase();
};

const parseReportLog = (value: unknown): TuyaReportLog => {
  const record = requireRecord(value, "ENERGYIQ_TUYA_REPORT_LOGS_INVALID");
  const code = requireString(record.code, "ENERGYIQ_TUYA_REPORT_LOGS_INVALID");
  const eventTime = requirePositiveNumber(record.event_time, "ENERGYIQ_TUYA_REPORT_LOGS_INVALID");
  return { code, eventTime, value: record.value };
};

const findPropertyEvidence = (
  model: unknown,
  code: typeof TUYA_ENERGY_CODE | typeof TUYA_POWER_CODE,
): TuyaPropertyEvidence => {
  const match = findObjectByCode(model, code);
  if (!match) throw new Error(`ENERGYIQ_TUYA_PROPERTY_REQUIRED:${code}`);
  const typeSpec = isRecord(match.typeSpec) ? match.typeSpec : isRecord(match.type_spec) ? match.type_spec : match;
  const scale = requireNonNegativeInteger(typeSpec.scale, `ENERGYIQ_TUYA_PROPERTY_SCALE_INVALID:${code}`);
  const unit = requireString(typeSpec.unit, `ENERGYIQ_TUYA_PROPERTY_UNIT_INVALID:${code}`);
  return {
    code,
    ...(typeof match.name === "string" && match.name.trim() ? { name: match.name.trim() } : {}),
    ...(typeof typeSpec.type === "string" && typeSpec.type.trim() ? { type: typeSpec.type.trim() } : {}),
    scale,
    unit,
  };
};

const findObjectByCode = (value: unknown, code: string): Record<string, unknown> | undefined => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findObjectByCode(item, code);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (value.code === code) return value;
  for (const child of Object.values(value)) {
    const found = findObjectByCode(child, code);
    if (found) return found;
  }
  return undefined;
};

const assertExpectedUnit = (property: TuyaPropertyEvidence, allowed: string[]): void => {
  if (!allowed.includes(property.unit.trim().toLocaleLowerCase())) {
    throw new Error(`ENERGYIQ_TUYA_PROPERTY_UNIT_INVALID:${property.code}:${property.unit}`);
  }
};

const validateSyncInput = (input: TuyaEnergySyncInput): void => {
  if (!Number.isSafeInteger(input.startTime) || !Number.isSafeInteger(input.endTime)
    || input.startTime <= 0 || input.endTime <= input.startTime) {
    throw new Error("ENERGYIQ_TUYA_TIME_WINDOW_INVALID");
  }
  if (input.devices.length === 0 || input.devices.length > 100) {
    throw new Error("ENERGYIQ_TUYA_DEVICES_INVALID");
  }
  const deviceIds = new Set<string>();
  const labels = new Set<string>();
  for (const binding of input.devices) {
    if (!/^[A-Za-z0-9]{8,64}$/u.test(binding.deviceId)) throw new Error("ENERGYIQ_TUYA_DEVICE_ID_INVALID");
    if (!binding.sourceLabel.trim()) throw new Error("ENERGYIQ_TUYA_SOURCE_LABEL_REQUIRED");
    if (deviceIds.has(binding.deviceId) || labels.has(binding.sourceLabel.trim())) {
      throw new Error("ENERGYIQ_TUYA_DEVICE_BINDING_DUPLICATE");
    }
    deviceIds.add(binding.deviceId);
    labels.add(binding.sourceLabel.trim());
  }
};

const isTokenError = (error: TuyaOpenApiError): boolean => {
  const code = error.tuyaCode?.toLocaleLowerCase() ?? "";
  const message = error.message.toLocaleLowerCase();
  return code === "1010" || code === "1011" || code.includes("token") || message.includes("token");
};

const fetchEnvelopeWithTimeout = async (
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<{ status: number; ok: boolean; envelope?: TuyaEnvelope }> => {
  if (externalSignal?.aborted) throw new Error("ENERGYIQ_TUYA_REQUEST_ABORTED");
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = (): void => controller.abort();
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: response.status, ok: false };
    }
    return {
      status: response.status,
      ok: true,
      envelope: await response.json() as TuyaEnvelope,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timedOut ? "ENERGYIQ_TUYA_REQUEST_TIMEOUT" : "ENERGYIQ_TUYA_REQUEST_ABORTED");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
};

const mapWithConcurrency = async <T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let firstError: unknown;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length && firstError === undefined) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(values[index]!);
      } catch (error) {
        firstError ??= error;
      }
    }
  });
  await Promise.allSettled(workers);
  if (firstError !== undefined) throw firstError;
  return results;
};

const requireRecord = (value: unknown, code: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(code);
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireString = (value: unknown, code: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
};

const requirePositiveNumber = (value: unknown, code: string): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
};

const requireNonNegativeInteger = (value: unknown, code: string): number => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 12) throw new Error(code);
  return parsed;
};

const displayUnknown = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";
