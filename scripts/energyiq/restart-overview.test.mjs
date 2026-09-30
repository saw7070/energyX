import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "restart-overview.ps1");

const writeFixtureFile = (path, content = "") => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
};

const createStorageFixture = (storageRoot) => {
  writeFixtureFile(join(storageRoot, "metadata", "workbench.sqlite"));
  writeFixtureFile(join(storageRoot, "energy", "workspace-a", "energy.duckdb"));
};

const createIntegrationFixture = ({ storageRootValue, extraEnv = [] }) => {
  const parent = mkdtempSync(join(tmpdir(), "energyiq-restart-overview-"));
  const integrationRoot = join(parent, "energyiq-datafoundry-integration");
  const storageRoot = join(parent, "authorised-storage");
  mkdirSync(integrationRoot, { recursive: true });
  execFileSync("git", ["init", "--quiet", integrationRoot], { stdio: "ignore" });
  writeFixtureFile(join(integrationRoot, "apps", "api", "dist", "index.js"));
  writeFixtureFile(join(integrationRoot, "node_modules", "next", "dist", "bin", "next"));
  writeFixtureFile(join(integrationRoot, "apps", "web", ".next", "BUILD_ID"), "test-build");
  createStorageFixture(storageRoot);
  const envFile = join(integrationRoot, ".env");
  writeFixtureFile(envFile, [
    "SECRET_MASTER_KEY=test-only-secret",
    ...(storageRootValue === undefined ? [] : [`STORAGE_ROOT_DIR=${storageRootValue === "<absolute>" ? storageRoot : storageRootValue}`]),
    ...extraEnv,
    "",
  ].join("\n"));
  return { parent, integrationRoot, storageRoot, envFile };
};

const runPreflight = (fixture, extraArguments = []) => {
  const command = [
    `& '${scriptPath.replaceAll("'", "''")}'`,
    `-IntegrationRoot '${fixture.integrationRoot.replaceAll("'", "''")}'`,
    `-EnvFile '${fixture.envFile.replaceAll("'", "''")}'`,
    "-ApiPort 49151",
    "-WebPort 49152",
    "-PreflightOnly",
    ...extraArguments,
    "| ConvertTo-Json -Compress",
  ].join(" ");
  const child = spawnSync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", command,
  ], { encoding: "utf8" });
  if (child.status !== 0) {
    const error = new Error(`PowerShell exited ${child.status}`);
    error.stderr = child.stderr;
    throw error;
  }
  return JSON.parse(child.stdout.trim());
};

const allocatePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close((error) => {
      if (error) reject(error);
      else resolvePort(address.port);
    });
  });
});

const stopProcessTree = (pid) => {
  if (!pid) return;
  try {
    execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {}
};

const runPowerShellUntilExit = (arguments_) => new Promise((resolveOutput, reject) => {
  const child = spawn("powershell.exe", arguments_, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("exit", (code) => {
    if (code === 0) resolveOutput(stdout.trim());
    else reject(new Error(`PowerShell exited ${code}: ${stderr}`));
  });
});

test("restart preflight preserves an approved absolute shared storage root", () => {
  const fixture = createIntegrationFixture({ storageRootValue: "<absolute>" });
  try {
    const result = runPreflight(fixture);
    assert.equal(result.storageRoot, fixture.storageRoot);
    assert.equal(result.preflightOnly, true);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("restart preflight refuses a relative storage root", () => {
  const fixture = createIntegrationFixture({ storageRootValue: "storage" });
  try {
    assert.throws(
      () => runPreflight(fixture),
      (error) => String(error.stderr).includes("STORAGE_ROOT_DIR must be an explicit absolute path"),
    );
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("restart preflight refuses the Integration-local storage tree", () => {
  const fixture = createIntegrationFixture({ storageRootValue: "<absolute>" });
  const localStorage = join(fixture.integrationRoot, "storage");
  createStorageFixture(localStorage);
  writeFileSync(
    fixture.envFile,
    `SECRET_MASTER_KEY=test-only-secret\nSTORAGE_ROOT_DIR=${localStorage}\n`,
    "utf8",
  );
  try {
    assert.throws(
      () => runPreflight(fixture),
      (error) => String(error.stderr).includes("Refusing the Integration-local storage tree"),
    );
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("restart preflight derives only the checked sibling shared storage root", () => {
  const fixture = createIntegrationFixture({ storageRootValue: undefined });
  const siblingStorage = join(fixture.parent, "energyiq-datafoundry", "storage");
  createStorageFixture(siblingStorage);
  try {
    const result = runPreflight(fixture);
    assert.equal(result.storageRoot, siblingStorage);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

test("restart passes the exact approved storage root to the API child", async () => {
  const capturePath = join(tmpdir(), `energyiq-storage-root-capture-${process.pid}-${Date.now()}.txt`);
  const fixture = createIntegrationFixture({
    storageRootValue: "<absolute>",
    extraEnv: [`STORAGE_ROOT_CAPTURE=${capturePath}`],
  });
  const apiPort = await allocatePort();
  const webPort = await allocatePort();
  const apiEntry = join(fixture.integrationRoot, "apps", "api", "dist", "index.js");
  const nextEntry = join(fixture.integrationRoot, "node_modules", "next", "dist", "bin", "next");
  writeFixtureFile(apiEntry, `
const http = require("node:http");
const fs = require("node:fs");
fs.writeFileSync(process.env.STORAGE_ROOT_CAPTURE, process.env.STORAGE_ROOT_DIR ?? "<missing>");
http.createServer((request, response) => {
  response.statusCode = request.url === "/healthz" || request.url === "/ready" ? 200 : 404;
  response.end("ok");
}).listen(Number(process.env.API_PORT), "127.0.0.1");
`);
  writeFixtureFile(nextEntry, `
const http = require("node:http");
const portIndex = process.argv.indexOf("-p");
const port = Number(process.argv[portIndex + 1]);
http.createServer((_request, response) => {
  response.statusCode = 200;
  response.end("ok");
}).listen(port, "127.0.0.1");
`);

  let result;
  try {
    const command = [
      `& '${scriptPath.replaceAll("'", "''")}'`,
      `-IntegrationRoot '${fixture.integrationRoot.replaceAll("'", "''")}'`,
      `-EnvFile '${fixture.envFile.replaceAll("'", "''")}'`,
      `-ApiPort ${apiPort}`,
      `-WebPort ${webPort}`,
      "-ProbeAttempts 20",
      "-ProbeDelayMilliseconds 100",
      "| ConvertTo-Json -Compress",
    ].join(" ");
    const output = await runPowerShellUntilExit([
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-Command", command,
    ]);
    result = JSON.parse(output);
    const completion = Array.isArray(result) ? result.at(-1) : result;
    assert.equal(readFileSync(capturePath, "utf8"), fixture.storageRoot);
    assert.equal(completion.apiReady, true);
    assert.equal(completion.webReady, true);
  } finally {
    const completion = Array.isArray(result) ? result.at(-1) : result;
    stopProcessTree(completion?.webPid);
    stopProcessTree(completion?.apiPid);
    rmSync(capturePath, { force: true });
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});
