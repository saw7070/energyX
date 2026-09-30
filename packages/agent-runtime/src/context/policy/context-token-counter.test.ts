import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveContextTokenizerCacheDir } from "./context-token-counter.js";

describe("Context tokenizer cache location", () => {
  it("keeps runtime cache in shared storage instead of an immutable release", () => {
    expect(resolveContextTokenizerCacheDir({
      storageRoot: "/srv/datafoundry/shared/storage",
      cwd: "/srv/datafoundry/releases/release-a/apps/api",
    })).toBe(join("/srv/datafoundry/shared/storage", "cache", "tokenizers"));
  });

  it("allows an explicit cache directory and preserves the local fallback", () => {
    expect(resolveContextTokenizerCacheDir({
      configuredCacheDir: "/srv/cache/tokenizers",
      storageRoot: "/srv/datafoundry/shared/storage",
      cwd: "/srv/datafoundry/releases/release-a/apps/api",
    })).toBe("/srv/cache/tokenizers");
    expect(resolveContextTokenizerCacheDir({ cwd: "/workspace/apps/api" }))
      .toBe(join("/workspace/apps/api", ".cache", "tokenizers"));
  });
});
