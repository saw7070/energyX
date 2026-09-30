/**
 * Reads a device list (code → what it powers) from a photo or screenshot of a table, using an
 * image-capable model on the configured OpenAI-compatible provider (DashScope by default).
 */
export type ExtractedDevice = { code: string; description: string };

const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DEVICES = 500;

const PROMPT = [
  "This image shows a list of electrical circuits or meters and the equipment each one powers.",
  "Transcribe every row exactly as written. Do not guess, merge or invent rows.",
  "Return only JSON of the form {\"devices\":[{\"code\":\"A18P\",\"description\":\"Coffee machine x1, Warmer machine x1\"}]}.",
  "code is the circuit/meter identifier column; description is the equipment text for that row, verbatim.",
  "Skip the header row. If the image contains no such table, return {\"devices\":[]}.",
].join(" ");

export const extractDeviceListFromImage = async (input: {
  content: Buffer;
  mimeType: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): Promise<ExtractedDevice[]> => {
  const env = input.env ?? process.env;
  const mimeType = input.mimeType.toLowerCase().split(";")[0]!.trim();
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) throw new Error("ENERGYIQ_DEVICE_LIST_IMAGE_TYPE_UNSUPPORTED");
  if (input.content.length === 0 || input.content.length > MAX_IMAGE_BYTES) throw new Error("ENERGYIQ_DEVICE_LIST_IMAGE_SIZE_INVALID");
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) throw new Error("ENERGYIQ_DEVICE_LIST_VISION_UNAVAILABLE");
  const baseUrl = (env.LLM_BASE_URL?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/+$/u, "");
  const model = env.ENERGYIQ_VISION_MODEL?.trim() || "qwen-vl-max";

  const response = await (input.fetchImpl ?? fetch)(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${input.content.toString("base64")}` } },
          { type: "text", text: PROMPT },
        ],
      }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`ENERGYIQ_DEVICE_LIST_VISION_FAILED:${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
  const raw = body.choices?.[0]?.message?.content;
  const text = typeof raw === "string"
    ? raw
    : Array.isArray(raw) ? raw.map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : "")).join("") : "";
  return parseDeviceListJson(text);
};

/** Parses the model's JSON answer defensively: code fences, stray prose and bad rows are tolerated. */
export const parseDeviceListJson = (text: string): ExtractedDevice[] => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("ENERGYIQ_DEVICE_LIST_VISION_UNREADABLE");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("ENERGYIQ_DEVICE_LIST_VISION_UNREADABLE");
  }
  const devices = (parsed as { devices?: unknown }).devices;
  if (!Array.isArray(devices)) throw new Error("ENERGYIQ_DEVICE_LIST_VISION_UNREADABLE");
  const seen = new Set<string>();
  const result: ExtractedDevice[] = [];
  for (const item of devices) {
    if (!item || typeof item !== "object") continue;
    const code = String((item as { code?: unknown }).code ?? "").replace(/\s+/gu, " ").trim().slice(0, 80);
    const description = String((item as { description?: unknown }).description ?? "").replace(/\s+/gu, " ").trim().slice(0, 500);
    if (!code || !description || seen.has(code.toLocaleLowerCase())) continue;
    seen.add(code.toLocaleLowerCase());
    result.push({ code, description });
    if (result.length >= MAX_DEVICES) break;
  }
  return result;
};
