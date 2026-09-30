import { describe, expect, it, vi } from "vitest";

import { extractDeviceListFromImage, parseDeviceListJson } from "./energy-device-list-vision.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const env = { LLM_API_KEY: "test-key", LLM_BASE_URL: "https://llm.test/v1/" } as NodeJS.ProcessEnv;
const reply = (content: unknown) => vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }));

describe("reading a device list from an image", () => {
  it("sends the image to the vision model and returns the transcribed rows", async () => {
    const fetchImpl = reply('```json\n{"devices":[{"code":"A18P","description":"Coffee machine x1, Warmer machine x1"},{"code":"B2R","description":"Balcony light x1"}]}\n```');
    const devices = await extractDeviceListFromImage({ content: png, mimeType: "image/png", env, fetchImpl });

    expect(devices).toEqual([
      { code: "A18P", description: "Coffee machine x1, Warmer machine x1" },
      { code: "B2R", description: "Balcony light x1" },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.test/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("qwen-vl-max");
    expect(body.messages[0].content[0].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it("uses a configured vision model", async () => {
    const fetchImpl = reply('{"devices":[]}');
    await extractDeviceListFromImage({ content: png, mimeType: "image/png", env: { ...env, ENERGYIQ_VISION_MODEL: "qwen-vl-plus" }, fetchImpl });
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)).model).toBe("qwen-vl-plus");
  });

  it("rejects non-images and missing configuration before calling the model", async () => {
    const fetchImpl = reply("{}");
    await expect(extractDeviceListFromImage({ content: png, mimeType: "application/pdf", env, fetchImpl })).rejects.toThrow("ENERGYIQ_DEVICE_LIST_IMAGE_TYPE_UNSUPPORTED");
    await expect(extractDeviceListFromImage({ content: png, mimeType: "image/png", env: {}, fetchImpl })).rejects.toThrow("ENERGYIQ_DEVICE_LIST_VISION_UNAVAILABLE");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports provider failures", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
    await expect(extractDeviceListFromImage({ content: png, mimeType: "image/png", env, fetchImpl })).rejects.toThrow("ENERGYIQ_DEVICE_LIST_VISION_FAILED:403");
  });
});

describe("parsing the model answer", () => {
  it("drops incomplete and duplicate rows and tolerates surrounding prose", () => {
    expect(parseDeviceListJson('Here you go: {"devices":[{"code":"A18P","description":"Coffee"},{"code":"a18p","description":"dup"},{"code":"","description":"x"},{"code":"B2R"}]} Done.'))
      .toEqual([{ code: "A18P", description: "Coffee" }]);
  });

  it("refuses answers that are not the requested JSON", () => {
    expect(() => parseDeviceListJson("I cannot read this image.")).toThrow("ENERGYIQ_DEVICE_LIST_VISION_UNREADABLE");
  });
});
