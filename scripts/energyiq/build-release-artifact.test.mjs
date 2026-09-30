import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  createReleaseArtifact,
  verifyReleaseArtifact,
} from "./build-release-artifact.mjs";

const RELEASE_SHA = "1234567890abcdef1234567890abcdef12345678";
const BUILT_AT = "2026-08-20T00:00:00.000Z";
const NODE_VERSION = "v22.19.0";
const METADATA_SCHEMA_REVISION = "0038_energyiq_overview_definition_renderer";
const BUILTIN_SKILL_RESOURCES = new Map([
  ["packages/skills/builtin/data-analysis/SKILL.md", "# Data analysis\n"],
  ["packages/skills/builtin/energy-insight-investigation/SKILL.md", "# Energy insight\n"],
]);
const BACKUP_RUNBOOK_RELEASE_PAYLOAD = new Map([
  ["scripts/energyiq/backup-shared-storage.sh", "#!/usr/bin/env bash\nset -euo pipefail\n"],
  ["scripts/energyiq/shared-storage-backup-preflight.mjs", "export const preflight = true;\n"],
  ["scripts/energyiq/verify-shared-storage-backup.mjs", "export const verifier = true;\n"],
  ["deploy/systemd/energyiq-shared-storage-backup.service", "[Unit]\nDescription=Backup fixture\n"],
  ["deploy/systemd/energyiq-shared-storage-backup.timer", "[Timer]\nOnCalendar=*-*-* 02:15:00\n"],
]);

const sha256 = (body) => createHash("sha256").update(body).digest("hex");

const writeFixtureFile = async (root, relativePath, body) => {
  const target = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
};

const createFixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-source-"));
  const requiredServerFiles = {
    version: 1,
    config: {
      outputFileTracingRoot: root,
      turbopack: { root },
      configFileName: "next.config.mjs",
    },
    appDir: path.join(root, "apps", "web"),
    relativeAppDir: path.join("apps", "web"),
    files: [
      ".next/routes-manifest.json",
      ".next/server/pages-manifest.json",
      ".next/BUILD_ID",
      ".next/required-server-files.json",
    ],
  };

  await writeFixtureFile(root, "package.json", JSON.stringify({
    name: "datafoundry",
    private: true,
    type: "module",
    workspaces: ["apps/*", "packages/*"],
    scripts: {
      "start:api": "npm --prefix apps/api run start",
      "start:web": "npm --prefix apps/web run start",
    },
  }, null, 2) + "\n");
  await writeFixtureFile(root, "package-lock.json", "{\n  \"lockfileVersion\": 3\n}\n");
  await writeFixtureFile(root, "scripts/energyiq/build-release-artifact.mjs", "export const buildTool = true;\n");
  await writeFixtureFile(root, "scripts/energyiq/deploy-release.mjs", "export const deployTool = true;\n");
  for (const [releasePath, body] of BACKUP_RUNBOOK_RELEASE_PAYLOAD) {
    await writeFixtureFile(root, releasePath, body);
  }
  await writeFixtureFile(root, "apps/api/package.json", JSON.stringify({
    name: "@datafoundry/api",
    private: true,
    type: "module",
    main: "dist/index.js",
    scripts: { start: "node dist/index.js" },
    dependencies: { "@datafoundry/contracts": "0.2.0" },
  }, null, 2) + "\n");
  await writeFixtureFile(root, "apps/api/dist/index.js", "console.log('api fixture');\n");
  await writeFixtureFile(root, "apps/api/dist/index.test.js", "throw new Error('test output');\n");
  await writeFixtureFile(root, "apps/api/dist/index.d.ts", "export {};\n");
  await writeFixtureFile(root, "apps/api/dist/index.js.map", "{}\n");
  await writeFixtureFile(root, "apps/web/package.json", JSON.stringify({
    name: "@datafoundry/web",
    private: true,
    scripts: { start: "next start" },
    dependencies: { "@datafoundry/contracts": "0.2.0", next: "15.5.19" },
  }, null, 2) + "\n");
  await writeFixtureFile(root, "apps/web/next.config.mjs", "export default { compress: false };\n");
  await writeFixtureFile(root, "apps/web/.next/BUILD_ID", `${RELEASE_SHA}\n`);
  await writeFixtureFile(
    root,
    "apps/web/.next/required-server-files.json",
    JSON.stringify(requiredServerFiles, null, 2) + "\n",
  );
  await writeFixtureFile(root, "apps/web/.next/routes-manifest.json", "{}\n");
  await writeFixtureFile(root, "apps/web/.next/server/pages-manifest.json", "{}\n");
  await writeFixtureFile(root, "apps/web/.next/static/chunks/app.js", "console.log('web fixture');\n");
  await writeFixtureFile(root, "apps/web/public/logo.svg", "<svg/>\n");
  await writeFixtureFile(root, "packages/contracts/package.json", JSON.stringify({
    name: "@datafoundry/contracts",
    private: true,
    type: "module",
    main: "dist/index.js",
  }, null, 2) + "\n");
  await writeFixtureFile(root, "packages/contracts/dist/index.js", "export const contract = true;\n");
  await writeFixtureFile(root, "packages/unused/package.json", JSON.stringify({
    name: "@datafoundry/unused",
    private: true,
    type: "module",
    main: "dist/index.js",
  }, null, 2) + "\n");
  await writeFixtureFile(root, "packages/unused/dist/index.js", "throw new Error('unused');\n");
  for (const [resourcePath, body] of BUILTIN_SKILL_RESOURCES) {
    await writeFixtureFile(root, resourcePath, body);
  }

  return root;
};

const packFixture = async (sourceDir, outputDir) => createReleaseArtifact({
  sourceDir,
  outputDir,
  gitSha: RELEASE_SHA,
  builtAt: BUILT_AT,
  nodeVersion: NODE_VERSION,
  metadataSchemaRevision: METADATA_SCHEMA_REVISION,
});

test("creates a deterministic prebuilt artifact and exact sidecar manifest", async (t) => {
  const sourceDir = await createFixture();
  const firstOutput = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-first-"));
  const secondOutput = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-second-"));
  t.after(() => Promise.all([
    rm(sourceDir, { recursive: true, force: true }),
    rm(firstOutput, { recursive: true, force: true }),
    rm(secondOutput, { recursive: true, force: true }),
  ]));

  const first = await packFixture(sourceDir, firstOutput);
  const second = await packFixture(sourceDir, secondOutput);
  const [firstArtifact, secondArtifact, manifestBody] = await Promise.all([
    readFile(first.artifactPath),
    readFile(second.artifactPath),
    readFile(first.manifestPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestBody);

  assert.deepEqual(firstArtifact, secondArtifact);
  assert.equal(await readFile(second.manifestPath, "utf8"), manifestBody);
  assert.equal(manifest.gitSha, RELEASE_SHA);
  assert.equal(manifest.packageLockHash, sha256("{\n  \"lockfileVersion\": 3\n}\n"));
  assert.equal(manifest.builtAt, BUILT_AT);
  assert.equal(manifest.nodeVersion, NODE_VERSION);
  assert.equal(manifest.metadataSchemaRevision, METADATA_SCHEMA_REVISION);
  assert.equal(manifest.webBuildId, RELEASE_SHA);
  assert.equal(manifest.artifactSha256, sha256(firstArtifact));
  assert.equal(await readFile(first.checksumPath, "utf8"), `${manifest.artifactSha256}  ${path.basename(first.artifactPath)}\n`);

  const entryPaths = manifest.entries.map(({ path: entryPath }) => entryPath);
  assert.ok(entryPaths.includes("apps/api/dist/index.js"));
  assert.equal(entryPaths.some((entryPath) => /(?:\.test\.js|\.d\.ts|\.js\.map)$/.test(entryPath)), false);
  assert.ok(entryPaths.includes("apps/web/.next/static/chunks/app.js"));
  assert.ok(entryPaths.includes("apps/web/next.config.mjs"));
  assert.ok(entryPaths.includes("apps/web/public/logo.svg"));
  assert.ok(entryPaths.includes("packages/contracts/dist/index.js"));
  assert.ok(entryPaths.includes("scripts/energyiq/build-release-artifact.mjs"));
  assert.ok(entryPaths.includes("scripts/energyiq/deploy-release.mjs"));
  assert.equal(entryPaths.some((entryPath) => entryPath.includes("packages/unused")), false);

  assert.equal(firstArtifact.includes(Buffer.from(sourceDir)), false, "build-host path leaked into artifact");
  await verifyReleaseArtifact({ artifactPath: first.artifactPath, manifestPath: first.manifestPath });
});

test("packages the complete builtin skill resource tree required by API bootstrap", async (t) => {
  const sourceDir = await createFixture();
  const outputDir = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-builtin-resources-"));
  t.after(() => Promise.all([
    rm(sourceDir, { recursive: true, force: true }),
    rm(outputDir, { recursive: true, force: true }),
  ]));
  const expectedResources = new Map([
    ...BUILTIN_SKILL_RESOURCES,
    ["packages/skills/builtin/data-analysis/references/runtime-policy.md", "# Runtime policy\n"],
  ]);
  for (const [resourcePath, body] of expectedResources) {
    await writeFixtureFile(sourceDir, resourcePath, body);
  }

  const result = await packFixture(sourceDir, outputDir);
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  const verified = await verifyReleaseArtifact({
    artifactPath: result.artifactPath,
    manifestPath: result.manifestPath,
    checksumPath: result.checksumPath,
    includeEntries: true,
  });
  const manifestPaths = new Set(manifest.entries.map((entry) => entry.path));
  const archivedEntries = new Map(verified.entries.map((entry) => [entry.path, entry.body.toString("utf8")]));

  for (const [resourcePath, body] of expectedResources) {
    assert.equal(manifestPaths.has(resourcePath), true, `${resourcePath} missing from manifest`);
    assert.equal(archivedEntries.get(resourcePath), body, `${resourcePath} missing from tar`);
  }
});

test("packages the complete Shared Storage backup payload required by the production Runbook", async (t) => {
  const sourceDir = await createFixture();
  const outputDir = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-backup-payload-"));
  t.after(() => Promise.all([
    rm(sourceDir, { recursive: true, force: true }),
    rm(outputDir, { recursive: true, force: true }),
  ]));

  const result = await packFixture(sourceDir, outputDir);
  const verified = await verifyReleaseArtifact({
    artifactPath: result.artifactPath,
    manifestPath: result.manifestPath,
    checksumPath: result.checksumPath,
    includeEntries: true,
  });
  const archivedEntries = new Map(verified.entries.map((entry) => [entry.path, entry.body.toString("utf8")]));

  for (const [releasePath, body] of BACKUP_RUNBOOK_RELEASE_PAYLOAD) {
    assert.equal(archivedEntries.get(releasePath), body, `${releasePath} missing from verified Artifact`);
  }
});

for (const releasePath of BACKUP_RUNBOOK_RELEASE_PAYLOAD.keys()) {
  test(`fails closed when the production backup payload is missing: ${releasePath}`, async (t) => {
    const sourceDir = await createFixture();
    const outputDir = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-missing-backup-payload-"));
    t.after(() => Promise.all([
      rm(sourceDir, { recursive: true, force: true }),
      rm(outputDir, { recursive: true, force: true }),
    ]));
    await rm(path.join(sourceDir, ...releasePath.split("/")));

    await assert.rejects(
      packFixture(sourceDir, outputDir),
      new RegExp(`${path.posix.basename(releasePath).replaceAll(".", "\\.")}.*missing`, "iu"),
    );
  });
}

test("rejects a runtime Next config that requires dev-only TypeScript", async (t) => {
  const sourceDir = await createFixture();
  const outputDir = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-typescript-next-config-"));
  t.after(() => Promise.all([
    rm(sourceDir, { recursive: true, force: true }),
    rm(outputDir, { recursive: true, force: true }),
  ]));
  const requiredPath = path.join(sourceDir, "apps", "web", ".next", "required-server-files.json");
  const required = JSON.parse(await readFile(requiredPath, "utf8"));
  required.config.configFileName = "next.config.ts";
  await writeFile(requiredPath, JSON.stringify(required, null, 2) + "\n");
  await writeFixtureFile(sourceDir, "apps/web/next.config.ts", "export default { compress: false };\n");

  await assert.rejects(
    packFixture(sourceDir, outputDir),
    /Next config.*production-native.*\.m?js/i,
  );
});

test("production Next config is native ESM and preserves release semantics", async () => {
  const originalReleaseSha = process.env.ENERGYIQ_RELEASE_SHA;
  const originalDistDir = process.env.NEXT_DIST_DIR;
  const configUrl = pathToFileURL(path.resolve("apps/web/next.config.mjs")).href;
  const validSha = "abcdef1234567890abcdef1234567890abcdef12";
  try {
    delete process.env.ENERGYIQ_RELEASE_SHA;
    process.env.NEXT_DIST_DIR = ".next-contract-test";
    const localConfig = (await import(`${configUrl}?local=${Date.now()}`)).default;
    assert.equal(await localConfig.generateBuildId(), null);
    assert.equal(localConfig.distDir, ".next-contract-test");
    assert.equal(localConfig.outputFileTracingRoot, path.resolve("."));
    assert.equal(localConfig.compress, false);
    assert.deepEqual(localConfig.experimental.optimizePackageImports, ["zod"]);
    assert.equal(localConfig.turbopack.root, path.resolve("."));
    const webpackConfig = { output: {} };
    assert.equal(localConfig.webpack(webpackConfig, { isServer: true }), webpackConfig);
    assert.equal(webpackConfig.output.chunkFilename, "chunks/[name].js");

    process.env.ENERGYIQ_RELEASE_SHA = validSha;
    const releaseConfig = (await import(`${configUrl}?release=${Date.now()}`)).default;
    assert.equal(await releaseConfig.generateBuildId(), validSha);

    process.env.ENERGYIQ_RELEASE_SHA = "not-a-git-sha";
    await assert.rejects(import(`${configUrl}?invalid=${Date.now()}`), /lowercase 40-character Git SHA/);

    const [rootManifest, webManifest] = await Promise.all([
      readFile("package.json", "utf8").then(JSON.parse),
      readFile("apps/web/package.json", "utf8").then(JSON.parse),
    ]);
    assert.equal(rootManifest.dependencies?.typescript, undefined);
    assert.equal(webManifest.dependencies?.typescript, undefined);
  } finally {
    if (originalReleaseSha === undefined) delete process.env.ENERGYIQ_RELEASE_SHA;
    else process.env.ENERGYIQ_RELEASE_SHA = originalReleaseSha;
    if (originalDistDir === undefined) delete process.env.NEXT_DIST_DIR;
    else process.env.NEXT_DIST_DIR = originalDistDir;
  }
});

for (const forbidden of [
  ["apps/web/.next/.env.production", "SECRET=value\n", /\.env/i],
  ["apps/web/.next/storage/workbench.sqlite", "sqlite", /storage|sqlite/i],
  ["apps/web/.next/server/facts.duckdb", "duckdb", /duckdb/i],
  ["apps/web/public/outputs/acceptance.png", "png", /outputs|acceptance/i],
  ["apps/web/public/server-secret.pem", "PRIVATE KEY", /secret|private key/i],
]) {
  test(`rejects forbidden release content: ${forbidden[0]}`, async (t) => {
    const sourceDir = await createFixture();
    const outputDir = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-forbidden-"));
    t.after(() => Promise.all([
      rm(sourceDir, { recursive: true, force: true }),
      rm(outputDir, { recursive: true, force: true }),
    ]));
    await writeFixtureFile(sourceDir, forbidden[0], forbidden[1]);

    await assert.rejects(packFixture(sourceDir, outputDir), forbidden[2]);
  });
}

test("fails closed when a Next build-declared runtime file is missing", async (t) => {
  const sourceDir = await createFixture();
  const outputDir = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-missing-"));
  t.after(() => Promise.all([
    rm(sourceDir, { recursive: true, force: true }),
    rm(outputDir, { recursive: true, force: true }),
  ]));

  const requiredPath = path.join(sourceDir, "apps", "web", ".next", "required-server-files.json");
  const required = JSON.parse(await readFile(requiredPath, "utf8"));
  required.files.push("next.config.mjs");
  required.files.push("missing-runtime-config.json");
  await writeFile(requiredPath, JSON.stringify(required, null, 2) + "\n");

  await assert.rejects(packFixture(sourceDir, outputDir), /missing-runtime-config\.json.*missing/i);
});

test("rejects a Web build whose BUILD_ID is not the release Git SHA", async (t) => {
  const sourceDir = await createFixture();
  const outputDir = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-build-id-"));
  t.after(() => Promise.all([
    rm(sourceDir, { recursive: true, force: true }),
    rm(outputDir, { recursive: true, force: true }),
  ]));
  await writeFixtureFile(sourceDir, "apps/web/.next/BUILD_ID", "random-next-build-id\n");

  await assert.rejects(packFixture(sourceDir, outputDir), /BUILD_ID.*gitSha.*ENERGYIQ_RELEASE_SHA/i);
});

test("verification rejects a modified artifact", async (t) => {
  const sourceDir = await createFixture();
  const outputDir = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-tamper-"));
  t.after(() => Promise.all([
    rm(sourceDir, { recursive: true, force: true }),
    rm(outputDir, { recursive: true, force: true }),
  ]));

  const result = await packFixture(sourceDir, outputDir);
  await writeFile(result.artifactPath, Buffer.from("tampered"));
  await assert.rejects(
    verifyReleaseArtifact({ artifactPath: result.artifactPath, manifestPath: result.manifestPath }),
    /artifact.*sha256|checksum/i,
  );
});

test("verification derives lock and Web identities from the archived bytes", async (t) => {
  const sourceDir = await createFixture();
  const outputDir = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-manifest-tamper-"));
  t.after(() => Promise.all([
    rm(sourceDir, { recursive: true, force: true }),
    rm(outputDir, { recursive: true, force: true }),
  ]));

  const result = await packFixture(sourceDir, outputDir);
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  manifest.packageLockHash = "0".repeat(64);
  await writeFile(result.manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  await assert.rejects(
    verifyReleaseArtifact({ artifactPath: result.artifactPath, manifestPath: result.manifestPath }),
    /packageLockHash.*archived package-lock/i,
  );
});

test("verification rejects hidden trailing payload after the tar terminator", async (t) => {
  const sourceDir = await createFixture();
  const outputDir = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-trailing-"));
  t.after(() => Promise.all([
    rm(sourceDir, { recursive: true, force: true }),
    rm(outputDir, { recursive: true, force: true }),
  ]));

  const result = await packFixture(sourceDir, outputDir);
  const archive = Buffer.concat([await readFile(result.artifactPath), Buffer.from("hidden payload")]);
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  manifest.artifactSha256 = sha256(archive);
  await writeFile(result.artifactPath, archive);
  await writeFile(result.manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  await assert.rejects(
    verifyReleaseArtifact({ artifactPath: result.artifactPath, manifestPath: result.manifestPath }),
    /trailing|terminator/i,
  );
});

test("verification rejects a tar entry that is not a regular file", async (t) => {
  const sourceDir = await createFixture();
  const outputDir = await mkdtemp(path.join(tmpdir(), "energyiq-artifact-type-"));
  t.after(() => Promise.all([
    rm(sourceDir, { recursive: true, force: true }),
    rm(outputDir, { recursive: true, force: true }),
  ]));

  const result = await packFixture(sourceDir, outputDir);
  const archive = await readFile(result.artifactPath);
  archive[156] = "2".charCodeAt(0);
  archive.fill(0x20, 148, 156);
  const headerChecksum = archive.subarray(0, 512).reduce((sum, value) => sum + value, 0);
  Buffer.from(headerChecksum.toString(8).padStart(6, "0") + "\0 ").copy(archive, 148);
  const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
  manifest.artifactSha256 = sha256(archive);
  await writeFile(result.artifactPath, archive);
  await writeFile(result.manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  await assert.rejects(
    verifyReleaseArtifact({ artifactPath: result.artifactPath, manifestPath: result.manifestPath }),
    /regular file|entry type/i,
  );
});
