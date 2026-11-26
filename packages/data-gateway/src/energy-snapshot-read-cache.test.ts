import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { clearSnapshotReadCache, readThroughSnapshotCache } from "./energy-snapshot-read-cache.js";

describe("snapshot read cache", () => {
  beforeEach(() => clearSnapshotReadCache());

  const store = () => {
    const path = join(mkdtempSync(join(tmpdir(), "snapshot-cache-")), "facts.duckdb");
    writeFileSync(path, "v1");
    return path;
  };

  it("reads the store once for repeated and simultaneous identical questions", async () => {
    const path = store();
    let reads = 0;
    const read = async () => { reads += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return { from: "2026-11-12" }; };
    const [first, second] = await Promise.all([readThroughSnapshotCache(path, ["coverage", "s1"], read), readThroughSnapshotCache(path, ["coverage", "s1"], read)]);
    const third = await readThroughSnapshotCache(path, ["coverage", "s1"], read);
    expect([first, second, third]).toEqual([{ from: "2026-11-12" }, { from: "2026-11-12" }, { from: "2026-11-12" }]);
    expect(reads).toBe(1);
  });

  it("asks again for another snapshot, and after the store is written", async () => {
    const path = store();
    let reads = 0;
    const read = async () => ({ reads: ++reads });
    await readThroughSnapshotCache(path, ["coverage", "s1"], read);
    expect(await readThroughSnapshotCache(path, ["coverage", "s2"], read)).toEqual({ reads: 2 });
    writeFileSync(path, "v2 with more readings");
    expect(await readThroughSnapshotCache(path, ["coverage", "s1"], read)).toEqual({ reads: 3 });
  });

  it("gives each caller its own copy and never remembers an in-memory store or a failed read", async () => {
    const path = store();
    const value = await readThroughSnapshotCache(path, ["health"], async () => [{ status: "usable" }]);
    value[0]!.status = "changed by a caller";
    expect(await readThroughSnapshotCache(path, ["health"], async () => [])).toEqual([{ status: "usable" }]);
    let memoryReads = 0;
    await readThroughSnapshotCache(":memory:", ["x"], async () => ++memoryReads);
    await readThroughSnapshotCache(":memory:", ["x"], async () => ++memoryReads);
    expect(memoryReads).toBe(2);
    await expect(readThroughSnapshotCache(path, ["fails"], async () => { throw new Error("busy"); })).rejects.toThrow("busy");
    expect(await readThroughSnapshotCache(path, ["fails"], async () => "ok")).toBe("ok");
  });
});
