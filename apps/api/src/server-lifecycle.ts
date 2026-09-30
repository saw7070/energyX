import type { Server } from "node:http";

export const bindGracefulServerLifecycle = (input: {
  server: Server;
  closeResources: () => Promise<void>;
}): (() => Promise<void>) => {
  let resourcesClosed: Promise<void> | undefined;
  const closeResourcesOnce = (): Promise<void> => {
    resourcesClosed ??= input.closeResources();
    return resourcesClosed;
  };

  input.server.once("close", () => {
    void closeResourcesOnce();
  });

  return async () => {
    if (input.server.listening) {
      await new Promise<void>((resolve, reject) => {
        input.server.close((error) => error ? reject(error) : resolve());
      });
    }
    await closeResourcesOnce();
  };
};
