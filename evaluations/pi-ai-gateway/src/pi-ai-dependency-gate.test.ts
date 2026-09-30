import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;

const readJson = (url: URL): JsonObject => JSON.parse(readFileSync(url, "utf8")) as JsonObject;

describe("pi-ai evaluation dependency gate", () => {
  it("pins the candidate, transitive telemetry artifact and supported Node runtime exactly", () => {
    const evaluationPackage = readJson(new URL("../package.json", import.meta.url));
    const installedPackage = readJson(new URL("../node_modules/@earendil-works/pi-ai/package.json", import.meta.url));
    const lock = readJson(new URL("../package-lock.json", import.meta.url));
    const lockPackages = lock.packages as Record<string, JsonObject>;
    const piLock = lockPackages["node_modules/@earendil-works/pi-ai"]!;
    const telemetryLock = lockPackages["node_modules/@earendil-works/pi-telemetry"]!;
    const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);

    expect(evaluationPackage).toMatchObject({
      private: true,
      engines: { node: ">=22.19.0" },
      devDependencies: { "@earendil-works/pi-ai": "0.84.2" },
    });
    expect((evaluationPackage.scripts as JsonObject).test)
      .toBe("vitest run src/pi-ai-gateway-evaluation.test.ts src/pi-ai-dependency-gate.test.ts");
    expect(installedPackage).toMatchObject({ version: "0.84.2", engines: { node: ">=22.19.0" } });
    expect(piLock).toMatchObject({
      version: "0.84.2",
      dev: true,
      resolved: "https://registry.npmjs.org/@earendil-works/pi-ai/-/pi-ai-0.84.2.tgz",
      integrity: "sha512-6MzsrYIYNVlE7SfpbL2yYb67Qo58p/7Q+xWG1RZvoX1P80aRCHSod2/13aFpxkow1lPO2LEh3c495J0Gwmyjig=="
    });
    expect(telemetryLock).toMatchObject({
      version: "0.84.2",
      integrity: "sha512-wg5caea7uIv1BHRBm2Y116RvFG4oSAiP5qk9tA2463PDGIr4K8M1Ceyyg5DOpF/shUUl0gk826yQJAeAcHYB9g=="
    });
    expect(major > 22 || (major === 22 && minor >= 19)).toBe(true);
  });

  it("keeps the candidate and its lock graph outside root workspaces and production Providers", () => {
    const rootPackage = readJson(new URL("../../../package.json", import.meta.url));
    const rootLock = readFileSync(new URL("../../../package-lock.json", import.meta.url), "utf8");
    const providerPackage = readJson(new URL("../../../packages/providers/package.json", import.meta.url));
    const providerIndex = readFileSync(new URL("../../../packages/providers/src/index.ts", import.meta.url), "utf8");

    expect(rootPackage.workspaces).toEqual(["apps/*", "packages/*"]);
    expect(rootLock).not.toContain("@earendil-works/pi-ai");
    expect(JSON.stringify(providerPackage)).not.toContain("@earendil-works/pi-ai");
    expect(providerIndex).not.toContain("runPiAiGatewayEvaluation");
    expect(providerIndex).not.toContain("runPiAiOpenAiCompatibleRequestEvaluation");
    expect(providerIndex).not.toContain("runPiAiToolRoundTripEvaluation");
  });

  it("runs the isolated evaluation suite through an explicit GitHub CI gate", () => {
    const workflow = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");

    expect(workflow).toContain("Run isolated pi-ai Model Gateway evaluation");
    expect(workflow).toContain("working-directory: evaluations/pi-ai-gateway");
    expect(workflow).toContain("npm ci --ignore-scripts --no-audit --no-fund");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm test -- --maxWorkers=1 --minWorkers=1");
    expect(workflow).toContain("npm run test:cold-repeat");
  });
});
