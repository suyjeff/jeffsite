// videoeventsasset manifest validation. NBA retires old pbp clips by replacing each MP4 at its URL with one
// shared "VIDEO NOT AVAILABLE" bumper (same bytes, same ETag), so a manifest URL that still answers 206 can be
// dead. Each URL is probed with a two-byte Range request; the total size and ETag identify the bumper.

import { existsSync, readFileSync, writeFileSync } from "fs";
import type { RawGame } from "./raw";

export type VideoStatus = "live" | "retired" | "error";

/** The bumper NBA serves in place of retired clips (observed 2026-11). */
const RETIRED_SIZE = 869898;
const RETIRED_ETAG = "ba77f14c629236bdb1e13d116d9fb07b";

export async function probeOne(url: string): Promise<VideoStatus> {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-1" } });
    const total = Number(res.headers.get("content-range")?.split("/")[1] ?? res.headers.get("content-length") ?? 0);
    const etag = res.headers.get("etag") ?? "";
    await res.arrayBuffer().catch(() => undefined);
    if (!res.ok) return "error";
    return total === RETIRED_SIZE || etag.includes(RETIRED_ETAG) ? "retired" : "live";
  } catch {
    return "error";
  }
}

/** Probe every manifest URL (cached on disk), returning gameId:actionNumber → {url, status}. */
export async function probeVideo(raws: RawGame[], cachePath: string, concurrency = 24) {
  const cache: Record<string, VideoStatus> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  const out = new Map<string, { url: string; status: VideoStatus }>();
  const todo: { key: string; url: string }[] = [];
  for (const g of raws)
    for (const v of g.video) {
      const key = `${g.gameId}:${v.actionNumber}`;
      if (cache[v.url] && cache[v.url] !== "error") out.set(key, { url: v.url, status: cache[v.url] });
      else todo.push({ key, url: v.url });
    }
  let done = 0;
  const worker = async () => {
    for (;;) {
      const job = todo.pop();
      if (!job) return;
      const status = await probeOne(job.url);
      cache[job.url] = status;
      out.set(job.key, { url: job.url, status });
      if (++done % 500 === 0) {
        process.stdout.write(`  probed ${done}\n`);
        writeFileSync(cachePath, JSON.stringify(cache));
      }
    }
  };
  if (todo.length) {
    console.log(`probing ${todo.length} clip manifests…`);
    await Promise.all(Array.from({ length: concurrency }, worker));
    writeFileSync(cachePath, JSON.stringify(cache));
  }
  return out;
}
