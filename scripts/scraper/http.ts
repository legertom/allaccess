import fs from "node:fs/promises";
import path from "node:path";
import { CACHE_DIR, USER_AGENT } from "./util";

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function fetchText(
  url: string,
  etag?: string
): Promise<{ status: number; text: string; etag?: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xml;q=0.9,*/*;q=0.8",
      ...(etag ? { "If-None-Match": etag } : {})
    }
  });

  const status = response.status;
  const newEtag = response.headers.get("etag") ?? undefined;
  const text = status === 304 ? "" : await response.text();
  return { status, text, etag: newEtag };
}

/** Polite fetch with on-disk ETag cache (unchanged posture from the original). */
export async function fetchWithCache(url: string, cacheKey: string): Promise<string> {
  await ensureDir(CACHE_DIR);
  const cacheMetaPath = path.join(CACHE_DIR, `${cacheKey}.json`);
  const cacheHtmlPath = path.join(CACHE_DIR, `${cacheKey}.html`);

  let cachedEtag: string | undefined;
  try {
    const meta = JSON.parse(await fs.readFile(cacheMetaPath, "utf8")) as { etag?: string };
    cachedEtag = meta.etag;
  } catch {
    cachedEtag = undefined;
  }

  const { status, text, etag } = await fetchText(url, cachedEtag);

  if (status === 304) {
    return fs.readFile(cacheHtmlPath, "utf8");
  }

  await fs.writeFile(cacheHtmlPath, text, "utf8");
  await fs.writeFile(cacheMetaPath, JSON.stringify({ etag }, null, 2), "utf8");
  return text;
}
