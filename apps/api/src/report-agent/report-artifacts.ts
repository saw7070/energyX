import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";

const types: Record<string, { mimeType: string; encoding: "utf8" | "base64" }> = {
  ".json": { mimeType: "application/json", encoding: "utf8" },
  ".md": { mimeType: "text/markdown", encoding: "utf8" },
  ".txt": { mimeType: "text/plain", encoding: "utf8" },
  ".csv": { mimeType: "text/csv", encoding: "utf8" },
  ".svg": { mimeType: "image/svg+xml", encoding: "utf8" },
  ".png": { mimeType: "image/png", encoding: "base64" },
  ".jpg": { mimeType: "image/jpeg", encoding: "base64" },
  ".jpeg": { mimeType: "image/jpeg", encoding: "base64" },
  ".webp": { mimeType: "image/webp", encoding: "base64" },
};
const maxBytes = 2 * 1024 * 1024;
export type ReportArtifactMetadata = { filename: string; mimeType: string; encoding: "utf8" | "base64"; bytes: number };
function inspect(directory: string, filename: string): ReportArtifactMetadata {
  if (!filename || filename.length > 200 || /[\\/:\x00-\x1f]/.test(filename) || /[. ]$/.test(filename) || filename.startsWith(".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename) || ["report.html", "project-skill.md"].includes(filename.toLowerCase())) throw new Error("REPORT_ARTIFACT_NOT_FOUND");
  const type = types[extname(filename).toLowerCase()];
  if (!type) throw new Error("REPORT_ARTIFACT_NOT_FOUND");
  for (const path of [dirname(directory), directory]) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("REPORT_ARTIFACT_NOT_FOUND");
  }
  const stat = lstatSync(join(directory, filename));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error("REPORT_ARTIFACT_NOT_FOUND");
  return { filename, ...type, bytes: stat.size };
}
export function listReportArtifacts(directory: string): ReportArtifactMetadata[] {
  try {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return [];
    return readdirSync(directory).sort().slice(0, 2000).flatMap(filename => {
      try { return [inspect(directory, filename)]; } catch { return []; }
    }).slice(0, 100);
  } catch { return []; }
}
export function readReportArtifact(directory: string, filename: string): { content: string; encoding: "utf8" | "base64"; mimeType: string; filename: string } {
  const metadata = inspect(directory, filename);
  const before = lstatSync(join(directory, filename));
  const fd = openSync(join(directory, filename), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes || stat.ino !== before.ino || stat.dev !== before.dev) throw new Error("REPORT_ARTIFACT_NOT_FOUND");
    inspect(directory, filename);
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytes = readSync(fd, buffer, length, buffer.length - length, null);
      if (!bytes) break;
      length += bytes;
    }
    if (length > maxBytes) throw new Error("REPORT_ARTIFACT_NOT_FOUND");
    return { content: buffer.subarray(0, length).toString(metadata.encoding), encoding: metadata.encoding, mimeType: metadata.mimeType, filename };
  } finally { closeSync(fd); }
}
