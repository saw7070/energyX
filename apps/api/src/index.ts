import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "./config.js";
import { closeServerGracefully, createServer } from "./server.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: resolve(repoRoot, ".env") });

const config = loadApiConfig();
const server = await createServer();
let shutdownStarted = false;

const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(`Received ${signal}; draining server resources.`);
  try {
    await closeServerGracefully(server);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
};

process.once("SIGINT", () => { void shutdown("SIGINT"); });
process.once("SIGTERM", () => { void shutdown("SIGTERM"); });

try {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  console.log(`Agent runtime server listening at http://${config.host}:${config.port}`);
} catch (error) {
  console.error(error);
  await closeServerGracefully(server);
  process.exitCode = 1;
}
