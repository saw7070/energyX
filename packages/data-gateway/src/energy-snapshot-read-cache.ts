import { statSync } from "node:fs";

/**
 * Remembers fact-store reads whose answer depends only on a published data snapshot, such as which dates have
 * readings or how many readings each meter sent. Pages ask these on every visit (Analysis asked twice at once), yet
 * the answer only changes when new readings are written, about once a night.
 *
 * The key includes the fact store's size and modification time, and those of its write-ahead log, so any write to
 * the store (a sync, an import, a rebuild) makes every remembered answer for it stale at once. Identical reads that
 * arrive while one is running share it instead of scanning the store again. In-memory stores are never remembered.
 */
const LIMIT = 256;
const results = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();

const fileStamp = (path: string): string => {
  try {
    const stats = statSync(path);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "-";
  }
};

export const readThroughSnapshotCache = async <T>(databasePath: string, key: unknown, read: () => Promise<T>): Promise<T> => {
  if (databasePath === ":memory:") return read();
  const cacheKey = JSON.stringify([databasePath, fileStamp(databasePath), fileStamp(`${databasePath}.wal`), key]);
  if (results.has(cacheKey)) {
    const value = results.get(cacheKey) as T;
    results.delete(cacheKey);
    results.set(cacheKey, value);
    return structuredClone(value);
  }
  const running = inFlight.get(cacheKey) as Promise<T> | undefined;
  if (running) return structuredClone(await running);
  const pending = read()
    .then((value) => {
      results.set(cacheKey, value);
      while (results.size > LIMIT) results.delete(results.keys().next().value as string);
      return value;
    })
    .finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, pending);
  return structuredClone(await pending);
};

/** Forgets every remembered read, for tests that rewrite a store between reads. */
export const clearSnapshotReadCache = (): void => {
  results.clear();
  inFlight.clear();
};
