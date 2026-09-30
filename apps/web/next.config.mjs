import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const releaseSha = process.env.ENERGYIQ_RELEASE_SHA?.trim();

if (releaseSha && !/^[0-9a-f]{40}$/.test(releaseSha)) {
  throw new Error("ENERGYIQ_RELEASE_SHA must be a lowercase 40-character Git SHA.");
}

/** @type {import("next").NextConfig} */
const nextConfig = {
  // Release builds pin Next's otherwise-random BUILD_ID to the exact source
  // identity. Ordinary local builds keep Next's default generated ID.
  generateBuildId: async () => releaseSha ?? null,
  // Allow parallel local servers and production builds to use separate output
  // directories. Sharing `.next` makes one process delete another process's
  // development manifests.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  outputFileTracingRoot: workspaceRoot,
  // Next's default `compress: true` applies gzip to `text/*`, including
  // `text/event-stream`. Even with flush hooks, compression is the wrong layer
  // for AG-UI SSE. Disable here; terminate TLS/gzip at the reverse proxy for
  // HTML/assets (see deploy/nginx.datafoundry.conf.example), and leave
  // `/api/copilotkit` uncompressed.
  compress: false,
  // Production / test builds: tree-shake heavy package entrypoints.
  experimental: {
    optimizePackageImports: ["zod"],
  },
  // Dev uses Turbopack (see `dev` script). Declaring this key pins the
  // monorepo root and silences the "Webpack is configured while Turbopack is
  // not" warning; the webpack() hook below still applies to `next build`.
  turbopack: {
    root: workspaceRoot,
  },
  // Same-origin `/api/*` is owned by App Router route handlers
  // (`app/api/**/route.ts` → `proxyToApi`). Do not add rewrites for those
  // paths: rewrites cannot set SSE anti-buffering headers, and would race the
  // intentional streaming BFF.
  webpack(config, { isServer }) {
    if (isServer && config.output) {
      config.output.chunkFilename = "chunks/[name].js";
    }
    return config;
  },
};

export default nextConfig;
