import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { getDataDir } from "../config.js";
import { fileExists } from "../fs.js";

const CACHE_SUBDIR = "cache/images";

export interface CachedImageMeta {
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
    default: return extname(mimeType) || ".bin";
  }
}

function imagePath(fileId: string, mimeType: string): string {
  return resolve(getCacheDir(), `${fileId}${extensionForMime(mimeType)}`);
}

function metaPath(fileId: string): string {
  return resolve(getCacheDir(), `${fileId}.meta.json`);
}

/**
 * Check if an image is cached. Returns the cached metadata if found, null otherwise.
 */
export async function getCachedImage(fileId: string): Promise<CachedImageMeta | null> {
  const mp = metaPath(fileId);
  if (!(await fileExists(mp))) return null;

  try {
    const raw = await readFile(mp, "utf-8");
    return JSON.parse(raw) as CachedImageMeta;
  } catch {
    return null;
  }
}

/**
 * Store a downloaded image in the cache.
 */
export async function cacheImage(
  fileId: string,
  data: Buffer,
  meta: { mimeType: string; originalName: string },
): Promise<string> {
  const dir = getCacheDir();
  await mkdir(dir, { recursive: true });

  const ip = imagePath(fileId, meta.mimeType);
  const mp = metaPath(fileId);

  const metaData: CachedImageMeta = {
    mimeType: meta.mimeType,
    originalName: meta.originalName,
    cachedAt: new Date().toISOString(),
  };

  await writeFile(ip, data);
  await writeFile(mp, JSON.stringify(metaData, null, 2));

  return ip;
}

/**
 * Read a cached image as base64. Returns null if not cached.
 */
export async function readCachedImageBase64(
  fileId: string,
): Promise<{ data: string; mimeType: string } | null> {
  const meta = await getCachedImage(fileId);
  if (!meta) return null;

  const ip = imagePath(fileId, meta.mimeType);
  if (!(await fileExists(ip))) return null;

  try {
    const buf = await readFile(ip);
    return { data: buf.toString("base64"), mimeType: meta.mimeType };
  } catch {
    return null;
  }
}
