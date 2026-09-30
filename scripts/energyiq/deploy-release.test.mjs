import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  createReleaseArtifact,
  extractVerifiedReleaseArtifact,
  verifyReleaseArtifact,
} from "./build-release-artifact.mjs";
import { deployEnergyIqRelease } from "./deploy-release.mjs";

const RELEASE_SHA = "1234567890abcdef1234567890abcdef12345678";
const OTHER_SHA = "fedcba0987654321fedcba0987654321fedcba09";
const PREVIOUS_SHA = "abcdef1234567890abcdef1234567890abcdef12";
const NODE_VERSION = "v22.19.0";
const BUILT_AT = "2026-08-20T00:00:00.000Z";
const METADATA_SCHEMA_REVISION = "0038_energyiq_overview_definition_renderer";
const BACKUP_RELEASE_PAYLOAD = new Map([
  ["scripts/energyiq/backup-shared-storage.sh", "#!/usr/bin/env bash\nset -euo pipefail\n"],
  ["scripts/energyiq/shared-storage-backup-preflight.mjs", "export const preflight = true;\n"],
  ["scripts/energyiq/verify-shared-storage-backup.mjs", "export const verifier = true;\n"],
  ["deploy/systemd/energyiq-shared-storage-backup.service", "[Unit]\nDescription=Backup fixture\n"],
  ["deploy/systemd/energyiq-shared-storage-backup.timer", "[Timer]\nOnCalendar=*-*-* 02:15:00\n"],
]);

const sha256 = (body) => createHash("sha256").update(body).digest("hex");

test("the release CLI executes through both physical and symlinked entry paths", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "energyiq-deploy-cli-entry-"));
  const physicalEntry = path.join(import.meta.dirname, "deploy-release.mjs");
  const symlinkedDirectory = path.join(temporaryRoot, "current");
  const symlinkedEntry = path.join(symlinkedDirectory, "deploy-release.mjs");
  try {
    await symlink(import.meta.dirname, symlinkedDirectory, process.platform === "win32" ? "junction" : "dir");
    for (const entry of [physicalEntry, symlinkedEntry]) {
      const result = spawnSync(process.execPath, [entry], { encoding: "utf8" });
      assert.notEqual(result.status, 0, `${entry} silently returned success`);
      assert.match(result.stderr, /releaseSha must be a lowercase 40-character Git SHA/u);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("importing the release module remains side-effect free", () => {
  const entryUrl = pathToFileURL(path.join(import.meta.dirname, "deploy-release.mjs")).href;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(entryUrl)})`],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

const writeFixtureFile = async (root, relativePath, body) => {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
};

const createArtifactFixture = async (root) => {
  const sourceDir = path.join(root, "source");
  const outputDir = path.join(root, "incoming");
  const requiredServerFiles = {
    version: 1,
    config: {
      outputFileTracingRoot: sourceDir,
      configFileName: "next.config.mjs",
    },
    appDir: path.join(sourceDir, "apps", "web"),
    relativeAppDir: path.join("apps", "web"),
    files: [
      ".next/routes-manifest.json",
      ".next/server/pages-manifest.json",
      ".next/BUILD_ID",
      ".next/required-server-files.json",
    ],
  };
  const packageLockBody = "{\n  \"lockfileVersion\": 3\n}\n";

  const rootPackageJsonBody = JSON.stringify({
    name: "datafoundry",
    private: true,
    type: "module",
    workspaces: ["apps/*", "packages/*"],
    scripts: {
      "start:api": "npm --prefix apps/api run start",
      "start:web": "npm --prefix apps/web run start",
      postinstall: "npm run build",
      prepare: "npm run build",
    },
  }, null, 2) + "\n";
  await writeFixtureFile(sourceDir, "package.json", rootPackageJsonBody);
  await writeFixtureFile(sourceDir, "package-lock.json", packageLockBody);
  await writeFixtureFile(sourceDir, "scripts/energyiq/build-release-artifact.mjs", "export const buildTool = true;\n");
  await writeFixtureFile(sourceDir, "scripts/energyiq/deploy-release.mjs", "export const deployTool = true;\n");
  for (const [releasePath, body] of BACKUP_RELEASE_PAYLOAD) {
    await writeFixtureFile(sourceDir, releasePath, body);
  }
  await writeFixtureFile(sourceDir, "apps/api/package.json", JSON.stringify({
    name: "@datafoundry/api",
    private: true,
    type: "module",
    main: "dist/index.js",
    scripts: { start: "node dist/index.js" },
    dependencies: { "@datafoundry/contracts": "0.2.0" },
  }, null, 2) + "\n");
  await writeFixtureFile(sourceDir, "apps/api/dist/index.js", "console.log('api fixture');\n");
  await writeFixtureFile(sourceDir, "apps/web/package.json", JSON.stringify({
    name: "@datafoundry/web",
    private: true,
    scripts: { start: "next start" },
    dependencies: { "@datafoundry/contracts": "0.2.0", next: "15.5.19" },
  }, null, 2) + "\n");
  await writeFixtureFile(sourceDir, "apps/web/next.config.mjs", "export default { compress: false };\n");
  await writeFixtureFile(sourceDir, "apps/web/.next/BUILD_ID", `${RELEASE_SHA}\n`);
  await writeFixtureFile(
    sourceDir,
    "apps/web/.next/required-server-files.json",
    JSON.stringify(requiredServerFiles, null, 2) + "\n",
  );
  await writeFixtureFile(sourceDir, "apps/web/.next/routes-manifest.json", "{}\n");
  await writeFixtureFile(sourceDir, "apps/web/.next/server/pages-manifest.json", "{}\n");
  await writeFixtureFile(sourceDir, "apps/web/.next/static/chunks/app.js", "console.log('web fixture');\n");
  await writeFixtureFile(sourceDir, "apps/web/public/logo.svg", "<svg/>\n");
  await writeFixtureFile(sourceDir, "packages/contracts/package.json", JSON.stringify({
    name: "@datafoundry/contracts",
    private: true,
    type: "module",
    main: "dist/index.js",
  }, null, 2) + "\n");
  await writeFixtureFile(sourceDir, "packages/contracts/dist/index.js", "export const contract = true;\n");
  await writeFixtureFile(sourceDir, "packages/skills/builtin/data-analysis/SKILL.md", "# Data analysis\n");
  await writeFixtureFile(
    sourceDir,
    "packages/skills/builtin/energy-insight-investigation/SKILL.md",
    "# Energy insight\n",
  );

  const artifact = await createReleaseArtifact({
    sourceDir,
    outputDir,
    gitSha: RELEASE_SHA,
    builtAt: BUILT_AT,
    nodeVersion: NODE_VERSION,
    metadataSchemaRevision: METADATA_SCHEMA_REVISION,
  });
  return { ...artifact, rootPackageJsonBody };
};

const createDeployFixture = async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "energyiq-prebuilt-deploy-"));
  const appRoot = path.join(root, "app");
  const releasesRoot = path.join(appRoot, "releases");
  const previousRelease = path.join(releasesRoot, PREVIOUS_SHA);
  const backupPath = path.join(root, "backups", "metadata-before-release.tar.zst");
  const nodeExecPath = path.join(root, "runtime", process.platform === "win32" ? "node.exe" : "node");
  const npmCliPath = path.join(root, "runtime", "node_modules", "npm", "bin", "npm-cli.js");
  await mkdir(previousRelease, { recursive: true });
  await writeFile(path.join(previousRelease, "previous.txt"), "previous-release", "utf8");
  await symlink(previousRelease, path.join(appRoot, "current"), process.platform === "win32" ? "junction" : "dir");
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, "independent-backup", "utf8");
  await writeFixtureFile(root, path.relative(root, nodeExecPath).replaceAll("\\", "/"), "fixture node\n");
  await writeFixtureFile(root, path.relative(root, npmCliPath).replaceAll("\\", "/"), "fixture npm cli\n");
  const artifact = await createArtifactFixture(root);
  t.after(() => rm(root, { recursive: true, force: true }));

  return {
    root,
    appRoot,
    releasesRoot,
    previousRelease,
    backupPath,
    nodeExecPath,
    npmCliPath,
    artifact,
    input: {
      appRoot,
      artifactPath: artifact.artifactPath,
      manifestPath: artifact.manifestPath,
      checksumPath: artifact.checksumPath,
      releaseSha: RELEASE_SHA,
      metadataBackupPath: backupPath,
      dependencyInstall: "transitional-npm-ci",
      apiService: "energyiq-api",
      webService: "energyiq-web",
      smokeUrls: ["http://api/healthz", "http://web/login", "http://web/overview"],
    },
  };
};

const commandRecorder = (commands, onRun) => async (command, args, options = {}) => {
  commands.push({ command, args, cwd: options.cwd });
  await onRun?.(command, args, options);
  return { stdout: "", stderr: "" };
};

const updateArtifactSidecars = async (artifact, archive) => {
  const manifest = JSON.parse(await readFile(artifact.manifestPath, "utf8"));
  manifest.artifactSha256 = sha256(archive);
  await writeFile(artifact.artifactPath, archive);
  await writeFile(artifact.manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await writeFile(
    artifact.checksumPath,
    `${manifest.artifactSha256}  ${path.basename(artifact.artifactPath)}\n`,
  );
};

const assertCurrentIs = async (fixture, expected) => {
  assert.equal(await realpath(path.join(fixture.appRoot, "current")), await realpath(expected));
};

test("verifies and extracts a prebuilt release, installs dependencies explicitly, and never builds", async (t) => {
  const fixture = await createDeployFixture(t);
  const commands = [];
  const smokeChecks = [];
  const events = [];

  const result = await deployEnergyIqRelease(fixture.input, {
    nodeVersion: NODE_VERSION,
    nodeExecPath: fixture.nodeExecPath,
    verifyArtifact: async (input) => {
      events.push("verify");
      return verifyReleaseArtifact(input);
    },
    extractArtifact: async (verified, outputDir) => {
      events.push("extract");
      return extractVerifiedReleaseArtifact(verified, outputDir);
    },
    run: commandRecorder(commands, async (command, args, options) => {
      if (command === fixture.nodeExecPath && args[0] === fixture.npmCliPath) {
        const installManifest = JSON.parse(await readFile(path.join(options.cwd, "package.json"), "utf8"));
        assert.equal(installManifest.scripts.postinstall, undefined);
        assert.equal(installManifest.scripts.prepare, undefined);
      }
    }),
    checkHttp: async (url) => {
      events.push("smoke");
      smokeChecks.push(url);
    },
  });

  const finalRelease = path.join(fixture.releasesRoot, RELEASE_SHA);
  assert.equal((await stat(finalRelease)).isDirectory(), true);
  assert.equal((await stat(finalRelease)).isSymbolicLink(), false);
  assert.equal(await readFile(path.join(finalRelease, ".release-sha"), "utf8"), `${RELEASE_SHA}\n`);
  assert.equal(await readFile(path.join(finalRelease, "RELEASE_SHA"), "utf8"), `${RELEASE_SHA}\n`);
  assert.equal((await stat(path.join(finalRelease, "scripts", "energyiq", "deploy-release.mjs"))).isFile(), true);
  assert.equal(JSON.parse(await readFile(path.join(finalRelease, "release-manifest.json"), "utf8")).gitSha, RELEASE_SHA);
  assert.equal(await readFile(path.join(finalRelease, "package.json"), "utf8"), fixture.artifact.rootPackageJsonBody);
  assert.equal(await readFile(path.join(fixture.previousRelease, "previous.txt"), "utf8"), "previous-release");
  await assertCurrentIs(fixture, finalRelease);
  assert.equal(await lstat(path.join(fixture.appRoot, ".deploy.lock")).then(() => true, () => false), false);

  const stagingDir = path.join(fixture.releasesRoot, `.staging-${RELEASE_SHA}`);
  assert.deepEqual(commands[0], {
    command: fixture.nodeExecPath,
    args: [fixture.npmCliPath, "ci", "--omit=dev"],
    cwd: stagingDir,
  });
  assert.equal(commands[0].args.includes("--ignore-scripts"), false);
  assert.equal(commands[1].command, fixture.nodeExecPath);
  assert.equal(commands[1].args[0], "-e");
  assert.match(commands[1].args[1], /require\(["']duckdb["']\)/);
  assert.match(commands[1].args[1], /require\(["']sharp["']\)/);
  assert.equal(commands[1].cwd, stagingDir);
  assert.deepEqual(commands[2], {
    command: "systemctl",
    args: ["restart", "energyiq-api", "energyiq-web"],
    cwd: undefined,
  });
  assert.equal(commands.some(({ command }) => command === "npm"), false);
  assert.equal(commands.some(({ args }) => args.includes("build") || args.includes("build:web")), false);
  assert.deepEqual(events.slice(0, 5), ["verify", "smoke", "smoke", "smoke", "extract"]);
  assert.deepEqual(smokeChecks, [...fixture.input.smokeUrls, ...fixture.input.smokeUrls]);
  assert.equal(result.dependencyInstall, "transitional-npm-ci");
  assert.equal(result.releaseHostNodeVersion, NODE_VERSION);
});

test("runtime dependency probe failure leaves current unchanged before restart", async (t) => {
  const fixture = await createDeployFixture(t);
  const commands = [];

  await assert.rejects(
    deployEnergyIqRelease(fixture.input, {
      nodeVersion: NODE_VERSION,
      nodeExecPath: fixture.nodeExecPath,
      run: commandRecorder(commands, async (command, args) => {
        if (command === fixture.nodeExecPath && args[0] === "-e") {
          throw new Error("duckdb native binding is unavailable");
        }
      }),
      checkHttp: async () => {},
    }),
    /runtime dependency probe failed/i,
  );

  await assertCurrentIs(fixture, fixture.previousRelease);
  assert.equal((await stat(path.join(fixture.releasesRoot, `.staging-${RELEASE_SHA}`))).isDirectory(), true);
  assert.equal(await lstat(path.join(fixture.releasesRoot, RELEASE_SHA)).then(() => true, () => false), false);
  assert.equal(commands.some(({ command }) => command === "systemctl"), false);
  assert.equal(await lstat(path.join(fixture.appRoot, ".deploy.lock")).then(() => true, () => false), false);
});

test("missing physical npm CLI fails closed before artifact verification or extraction", async (t) => {
  const fixture = await createDeployFixture(t);
  await rm(fixture.npmCliPath);
  let verifyCalls = 0;

  await assert.rejects(
    deployEnergyIqRelease(fixture.input, {
      nodeVersion: NODE_VERSION,
      nodeExecPath: fixture.nodeExecPath,
      verifyArtifact: async () => { verifyCalls += 1; },
      run: async () => { throw new Error("must not run"); },
      checkHttp: async () => { throw new Error("must not smoke"); },
    }),
    /npm CLI was not found/i,
  );

  assert.equal(verifyCalls, 0);
  await assertCurrentIs(fixture, fixture.previousRelease);
  assert.equal(await lstat(path.join(fixture.releasesRoot, `.staging-${RELEASE_SHA}`)).then(() => true, () => false), false);
  assert.equal(await lstat(path.join(fixture.appRoot, ".deploy.lock")).then(() => true, () => false), false);
});

for (const failure of [
  {
    name: "checksum mismatch",
    expected: /checksum/i,
    mutate: async (fixture) => writeFile(fixture.artifact.checksumPath, `${"0".repeat(64)}  bad.tar\n`),
  },
  {
    name: "malformed manifest",
    expected: /manifest.*json/i,
    mutate: async (fixture) => writeFile(fixture.artifact.manifestPath, "{not-json\n"),
  },
  {
    name: "Release Host Node mismatch",
    expected: /nodeVersion mismatch/i,
    nodeVersion: "v22.20.0",
  },
  {
    name: "expected Git SHA mismatch",
    expected: /gitSha mismatch/i,
    releaseSha: OTHER_SHA,
  },
]) {
  test(`${failure.name} does not extract, switch current, restart, or install`, async (t) => {
    const fixture = await createDeployFixture(t);
    await failure.mutate?.(fixture);
    const commands = [];
    const smokeChecks = [];
    const input = { ...fixture.input, releaseSha: failure.releaseSha ?? RELEASE_SHA };

    await assert.rejects(
      deployEnergyIqRelease(input, {
        nodeVersion: failure.nodeVersion ?? NODE_VERSION,
        nodeExecPath: fixture.nodeExecPath,
        run: commandRecorder(commands),
        checkHttp: async (url) => { smokeChecks.push(url); },
      }),
      failure.expected,
    );

    await assertCurrentIs(fixture, fixture.previousRelease);
    assert.equal(await lstat(path.join(fixture.releasesRoot, `.staging-${input.releaseSha}`)).then(() => true, () => false), false);
    assert.equal(await lstat(path.join(fixture.releasesRoot, input.releaseSha)).then(() => true, () => false), false);
    assert.equal(commands.length, 0);
    assert.equal(smokeChecks.length, 0);
    assert.equal(await lstat(path.join(fixture.appRoot, ".deploy.lock")).then(() => true, () => false), false);
  });
}

for (const corruption of [
  {
    name: "malformed truncated tar",
    expected: /terminator|truncated/i,
    mutate: async (artifact) => {
      const archive = await readFile(artifact.artifactPath);
      await updateArtifactSidecars(artifact, archive.subarray(0, archive.length - 700));
    },
  },
  {
    name: "hidden trailing tar payload",
    expected: /trailing|terminator/i,
    mutate: async (artifact) => {
      const archive = Buffer.concat([await readFile(artifact.artifactPath), Buffer.from("hidden payload")]);
      await updateArtifactSidecars(artifact, archive);
    },
  },
  {
    name: "symlink tar entry",
    expected: /regular file|entry type/i,
    mutate: async (artifact) => {
      const archive = await readFile(artifact.artifactPath);
      archive[156] = "2".charCodeAt(0);
      archive.fill(0x20, 148, 156);
      const headerChecksum = archive.subarray(0, 512).reduce((sum, value) => sum + value, 0);
      Buffer.from(headerChecksum.toString(8).padStart(6, "0") + "\0 ").copy(archive, 148);
      await updateArtifactSidecars(artifact, archive);
    },
  },
]) {
  test(`rejects ${corruption.name} before extraction or current switch`, async (t) => {
    const fixture = await createDeployFixture(t);
    await corruption.mutate(fixture.artifact);
    const commands = [];

    await assert.rejects(
      deployEnergyIqRelease(fixture.input, {
        nodeVersion: NODE_VERSION,
        nodeExecPath: fixture.nodeExecPath,
        run: commandRecorder(commands),
        checkHttp: async () => {},
      }),
      corruption.expected,
    );

    await assertCurrentIs(fixture, fixture.previousRelease);
    assert.equal(await lstat(path.join(fixture.releasesRoot, `.staging-${RELEASE_SHA}`)).then(() => true, () => false), false);
    assert.equal(commands.length, 0);
  });
}

test("pre-switch smoke failure leaves current and release directories untouched", async (t) => {
  const fixture = await createDeployFixture(t);
  const commands = [];
  await assert.rejects(
    deployEnergyIqRelease(fixture.input, {
      nodeVersion: NODE_VERSION,
      nodeExecPath: fixture.nodeExecPath,
      run: commandRecorder(commands),
      checkHttp: async () => { throw new Error("pre-switch smoke failed"); },
      smokeAttempts: 1,
    }),
    /pre-switch smoke failed/,
  );

  await assertCurrentIs(fixture, fixture.previousRelease);
  assert.equal(await lstat(path.join(fixture.releasesRoot, `.staging-${RELEASE_SHA}`)).then(() => true, () => false), false);
  assert.equal(await lstat(path.join(fixture.releasesRoot, RELEASE_SHA)).then(() => true, () => false), false);
  assert.equal(commands.length, 0);
});

test("post-switch smoke failure rolls back to the previous physical release", async (t) => {
  const fixture = await createDeployFixture(t);
  const sharedStorage = path.join(fixture.appRoot, "shared", "storage", "customer.txt");
  await mkdir(path.dirname(sharedStorage), { recursive: true });
  await writeFile(sharedStorage, "shared-remains-unchanged", "utf8");
  const commands = [];
  const smokeChecks = [];

  await assert.rejects(
    deployEnergyIqRelease(fixture.input, {
      nodeVersion: NODE_VERSION,
      nodeExecPath: fixture.nodeExecPath,
      run: commandRecorder(commands),
      checkHttp: async (url) => {
        smokeChecks.push(url);
        if (smokeChecks.length === 4) throw new Error("post-switch smoke failed");
      },
      smokeAttempts: 1,
    }),
    /post-switch smoke failed/,
  );

  await assertCurrentIs(fixture, fixture.previousRelease);
  assert.equal((await stat(path.join(fixture.releasesRoot, RELEASE_SHA))).isDirectory(), true);
  assert.equal(await readFile(sharedStorage, "utf8"), "shared-remains-unchanged");
  assert.deepEqual(
    commands.filter(({ command }) => command === "systemctl").map(({ args }) => args),
    [
      ["restart", "energyiq-api", "energyiq-web"],
      ["restart", "energyiq-api", "energyiq-web"],
    ],
  );
  assert.equal(await lstat(path.join(fixture.appRoot, ".deploy.lock")).then(() => true, () => false), false);
});

test("rollback verification failure retains the deploy lock for manual intervention", async (t) => {
  const fixture = await createDeployFixture(t);
  let smokeChecks = 0;

  await assert.rejects(
    deployEnergyIqRelease(fixture.input, {
      nodeVersion: NODE_VERSION,
      nodeExecPath: fixture.nodeExecPath,
      run: async () => ({ stdout: "", stderr: "" }),
      checkHttp: async () => {
        smokeChecks += 1;
        if (smokeChecks >= 4) throw new Error("new and rollback smoke failed");
      },
      smokeAttempts: 1,
    }),
    /rollback verification also failed.*lock retained/i,
  );

  await assertCurrentIs(fixture, fixture.previousRelease);
  const lockBody = JSON.parse(await readFile(path.join(fixture.appRoot, ".deploy.lock"), "utf8"));
  assert.equal(lockBody.releaseSha, RELEASE_SHA);
});

test("an existing deploy lock fails closed before verification", async (t) => {
  const fixture = await createDeployFixture(t);
  const lockPath = path.join(fixture.appRoot, ".deploy.lock");
  await writeFile(lockPath, "active deployment\n", "utf8");
  let verifyCalls = 0;

  await assert.rejects(
    deployEnergyIqRelease(fixture.input, {
      nodeVersion: NODE_VERSION,
      nodeExecPath: fixture.nodeExecPath,
      verifyArtifact: async () => { verifyCalls += 1; },
      run: async () => { throw new Error("must not run"); },
      checkHttp: async () => { throw new Error("must not smoke"); },
    }),
    /deploy lock already exists/i,
  );

  assert.equal(verifyCalls, 0);
  assert.equal(await readFile(lockPath, "utf8"), "active deployment\n");
  await assertCurrentIs(fixture, fixture.previousRelease);
});

test("dependency install must be explicit and cannot change package-lock", async (t) => {
  const fixture = await createDeployFixture(t);
  await assert.rejects(
    deployEnergyIqRelease({ ...fixture.input, dependencyInstall: undefined }, {
      nodeVersion: NODE_VERSION,
      nodeExecPath: fixture.nodeExecPath,
      run: async () => { throw new Error("must not run"); },
      checkHttp: async () => {},
    }),
    /explicitly.*transitional-npm-ci/i,
  );

  const commands = [];
  await assert.rejects(
    deployEnergyIqRelease(fixture.input, {
      nodeVersion: NODE_VERSION,
      nodeExecPath: fixture.nodeExecPath,
      run: commandRecorder(commands, async (command, _args, options) => {
        if (command === fixture.nodeExecPath && _args[0] === fixture.npmCliPath) {
          await writeFile(path.join(options.cwd, "package-lock.json"), "modified\n");
        }
      }),
      checkHttp: async () => {},
    }),
    /dependency install modified.*package-lock/i,
  );
  await assertCurrentIs(fixture, fixture.previousRelease);
  assert.equal(commands.some(({ command }) => command === "systemctl"), false);
  assert.equal((await stat(path.join(fixture.releasesRoot, `.staging-${RELEASE_SHA}`))).isDirectory(), true);
});
