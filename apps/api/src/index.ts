import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadApiConfig } from "./config.js";
import { installProcessErrorHandlers } from "./observability/error-reporting.js";
import { configureLogger, logger } from "./observability/logger.js";
import { opsAlerts } from "./observability/ops-alerts.js";
import { closeServerGracefully, createServer } from "./server.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: resolve(repoRoot, ".env") });
// Log settings, the alert webhook and process error handling read the environment `.env` just completed.
configureLogger();
installProcessErrorHandlers();
if (!opsAlerts().enabled) logger.info("operator alerts are off: ENERGYX_OPS_ALERT_WEBHOOK_URL is not set", { component: "startup" });

const config = loadApiConfig();
const server = await createServer();
let shutdownStarted = false;

const shutdown = async (signal: "SIGINT" | "SIGTERM"): Promise<void> => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  logger.info(`Received ${signal}; draining server resources.`, { component: "shutdown", signal });
  try {
    await closeServerGracefully(server);
  } catch (error) {
    logger.error("graceful shutdown failed", { component: "shutdown", err: error });
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
  logger.info(`Agent runtime server listening at http://${config.host}:${config.port}`, { component: "startup", host: config.host, port: config.port });
} catch (error) {
  logger.error("server failed to listen", { component: "startup", err: error });
  await closeServerGracefully(server);
  process.exitCode = 1;
}
