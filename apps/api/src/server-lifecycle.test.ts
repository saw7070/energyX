import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { bindGracefulServerLifecycle } from "./server-lifecycle.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.listening
    ? new Promise<void>((resolve) => server.close(() => resolve()))
    : Promise.resolve()));
});

describe("graceful server lifecycle", () => {
  it("waits for process resources to drain after the HTTP listener closes", async () => {
    const server = createServer((_request, response) => response.end("ok"));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    let release!: () => void;
    const drained = new Promise<void>((resolve) => { release = resolve; });
    const closeResources = vi.fn(() => drained);
    const closeGracefully = bindGracefulServerLifecycle({ server, closeResources });

    let settled = false;
    const closing = closeGracefully().then(() => { settled = true; });
    await vi.waitFor(() => expect(closeResources).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    release();
    await closing;
    expect(settled).toBe(true);
    expect(closeResources).toHaveBeenCalledTimes(1);
  });
});
