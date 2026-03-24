import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { getDataDir } from "../config.js";
import { fileExists } from "../fs.js";

const CACHE_SUBDIR = "cache/files";

export interface CachedFileMeta {
  mimeType: string;
  originalName: string;
  cachedAt: string;
}

export function getCacheDir(): string {
  return resolve(getDataDir(), CACHE_SUBDIR);
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return ".png";
    case "image/jpeg": return ".jpg";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    case "application/pdf": return ".pdf";
    case "application/json": return ".json";
    case "text/plain": return ".txt";
    case "text/csv": return ".csv";
    case "text/html": return ".html";
    case "text/markdown": return ".md";
    default: return extname(mimeType) || ".bin";
  }
}

function filePath(fileId: string, mimeType: string): string {
  return resolve(getCacheDir(), `${fileId}${extensionForMime(mimeType)}`);
}

function metaPath(fileId: string): string {
  return resolve(getCacheDir(), `${fileId}.meta.json`);
}

/**
 * Check if a file is cached. Returns the cached metadata if found, null otherwise.
 */
export async function getCachedFile(fileId: string): Promise<CachedFileMeta | null> {
  const mp = metaPath(fileId);
  if (!(await fileExists(mp))) return null;

  try {
    const raw = await readFile(mp, "utf-8");
    return JSON.parse(raw) as CachedFileMeta;
  } catch {
    return null;
  }
}

/**
 * Store a downloaded file in the cache.
 */
export async function cacheFile(
  fileId: string,
  data: Buffer,
  meta: { mimeType: string; originalName: string },
): Promise<string> {
  const dir = getCacheDir();
  await mkdir(dir, { recursive: true });

  const fp = filePath(fileId, meta.mimeType);
  const mp = metaPath(fileId);

  const metaData: CachedFileMeta = {
    mimeType: meta.mimeType,
    originalName: meta.originalName,
    cachedAt: new Date().toISOString(),
  };

  await writeFile(fp, data);
  await writeFile(mp, JSON.stringify(metaData, null, 2));

  return fp;
}

/**
 * Read a cached file as base64. Returns null if not cached.
 */
export async function readCachedFileBase64(
  fileId: string,
): Promise<{ data: string; mimeType: string } | null> {
  const meta = await getCachedFile(fileId);
  if (!meta) return null;

  const fp = filePath(fileId, meta.mimeType);
  if (!(await fileExists(fp))) return null;

  try {
    const buf = await readFile(fp);
    return { data: buf.toString("base64"), mimeType: meta.mimeType };
  } catch {
    return null;
  }
}

/**
 * Read a cached file as a raw Buffer. Returns null if not cached.
 */
export async function readCachedFileBuffer(
  fileId: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  const meta = await getCachedFile(fileId);
  if (!meta) return null;

  const fp = filePath(fileId, meta.mimeType);
  if (!(await fileExists(fp))) return null;

  try {
    const buf = await readFile(fp);
    return { data: buf, mimeType: meta.mimeType };
  } catch {
    return null;
  }
}
