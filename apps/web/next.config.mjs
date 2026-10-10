import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const releaseSha = process.env.ENERGYIQ_RELEASE_SHA?.trim();

if (releaseSha && !/^[0-9a-f]{40}$/.test(releaseSha)) {
  throw new Error("ENERGYIQ_RELEASE_SHA must be a lowercase 40-character Git SHA.");
}

const isProduction = process.env.NODE_ENV === "production";

/**
 * Browser security settings on every page and same-origin API response. The app loads nothing from other sites,
 * so everything is limited to its own origin. Next's hydration and the theme boot script are inline, hence
 * 'unsafe-inline' for scripts; development additionally needs eval and a websocket for hot reload. AI-written
 * HTML runs in sandboxed srcdoc frames with their own stricter policy.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isProduction ? "" : " ws: wss:"}`,
  "frame-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProduction ? ["upgrade-insecure-requests"] : []),
].join("; ");

export const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Browsers only honour this over HTTPS, which production always is.
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
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
