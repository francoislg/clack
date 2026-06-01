// HTTP adapter for Wikipedia REST (page summary) + Wikimedia Commons API (imageinfo) +
// the thumbnail-byte download used for data-mode image results.
// Stateless: every call is a fresh HTTPS round-trip. No cache, no API key.
// All failures are returned as structured `SourceError` values — this module never throws.

/** Wikimedia API etiquette: descriptive User-Agent on every outbound request. */
const USER_AGENT = "Clack-Trivia-Image-Search/1.0";

const WIKIPEDIA_SUMMARY_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const COMMONS_API_BASE = "https://commons.wikimedia.org/w/api.php";

const DEFAULT_TIMEOUT_MS = 5000;
const RATE_LIMIT_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
/** Cap on downloaded thumbnail bytes — Claude's vision input has practical size limits. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Structured error shape matching the visual-questions external image-search contract. */
export interface SourceError {
  kind: "notFound" | "rateLimit" | "network" | "unknown" | "unsupportedFormat";
  message: string;
}

/** Subset of the Wikipedia REST page-summary response the plugin reads. */
export interface PageSummary {
  title?: string;
  wikibase_item?: string;
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
}

/** Subset of the Commons `imageinfo` response the plugin reads. */
interface ExtMetadataField {
  value?: string;
}
interface ImageInfoExtMetadata {
  LicenseShortName?: ExtMetadataField;
  UsageTerms?: ExtMetadataField;
  Artist?: ExtMetadataField;
  Credit?: ExtMetadataField;
}
interface CommonsPage {
  imageinfo?: Array<{ extmetadata?: ImageInfoExtMetadata }>;
}
interface CommonsImageInfoResponse {
  query?: { pages?: { [pageId: string]: CommonsPage } };
}

/** Injectable dependencies — defaults use the real `fetch`, `setTimeout`-backed sleep, and `Math.random`. */
export interface WikimediaDeps {
  fetchImpl?: typeof fetch;
  /** Backoff sleep. Injected in tests to avoid real timers. */
  sleep?: (ms: number) => Promise<void>;
  /** Jitter source. Injected in tests for determinism. */
  random?: () => number;
  timeoutMs?: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function isError(result: { ok: true } | SourceError): result is SourceError {
  return !("ok" in result);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

/**
 * GET a URL with bounded retry-with-backoff, returning the raw `Response` on a 2xx.
 * Status handling:
 * - 429/503: up to 2 jittered exponential-backoff retries, then `rateLimit`.
 * - other 5xx: one retry, then `network`.
 * - 404: `notFound`. timeout/connection failure: `network`.
 * Body parsing (and the `unknown` malformed-body case) is the caller's responsibility.
 */
async function requestRaw(
  url: string,
  deps: WikimediaDeps = {},
): Promise<{ ok: true; response: Response } | SourceError> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let rateLimitAttempts = 0;
  let serverErrorRetried = false;

  while (true) {
    let res: Response;
    try {
      res = await fetchWithTimeout(fetchImpl, url, timeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "network", message: `request failed: ${message}` };
    }

    if (res.ok) return { ok: true, response: res };

    if (res.status === 404) {
      return { kind: "notFound", message: "upstream returned 404" };
    }

    if (res.status === 429 || res.status === 503) {
      if (rateLimitAttempts < RATE_LIMIT_RETRIES) {
        const backoff = BACKOFF_BASE_MS * 2 ** rateLimitAttempts;
        await sleep(backoff + Math.floor(backoff * random()));
        rateLimitAttempts++;
        continue;
      }
      return { kind: "rateLimit", message: `upstream rate-limited (HTTP ${res.status})` };
    }

    if (res.status >= 500) {
      if (!serverErrorRetried) {
        serverErrorRetried = true;
        await sleep(BACKOFF_BASE_MS);
        continue;
      }
      return { kind: "network", message: `upstream server error (HTTP ${res.status})` };
    }

    return { kind: "unknown", message: `unexpected upstream status ${res.status}` };
  }
}

/**
 * Fetch the English-Wikipedia REST page summary for `query`.
 * Returns the parsed summary or a structured error.
 */
export async function fetchPageSummary(
  query: string,
  deps: WikimediaDeps = {},
): Promise<{ ok: true; summary: PageSummary } | SourceError> {
  const url = WIKIPEDIA_SUMMARY_BASE + encodeURIComponent(query);
  const raw = await requestRaw(url, deps);
  if (isError(raw)) return raw;
  let json: unknown;
  try {
    json = await raw.response.json();
  } catch {
    return { kind: "unknown", message: "page summary was HTTP 200 but not valid JSON" };
  }
  if (typeof json !== "object" || json === null) {
    return { kind: "unknown", message: "page summary response was not an object" };
  }
  return { ok: true, summary: json as PageSummary };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").trim();
}

/**
 * Fetch Commons `imageinfo` for a source file and extract license + attribution.
 * Degrades gracefully: missing metadata yields `"unknown"` / `"via Wikimedia Commons"`,
 * but an upstream/transport failure is still surfaced as a structured error so the
 * caller can decide whether to degrade or abort.
 */
export async function fetchImageInfo(
  filename: string,
  deps: WikimediaDeps = {},
): Promise<{ ok: true; license: string; attribution: string } | SourceError> {
  const params = new URLSearchParams({
    action: "query",
    titles: `File:${filename}`,
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    format: "json",
  });
  const url = `${COMMONS_API_BASE}?${params.toString()}`;
  const raw = await requestRaw(url, deps);
  if (isError(raw)) return raw;
  let json: unknown;
  try {
    json = await raw.response.json();
  } catch {
    return { kind: "unknown", message: "imageinfo was HTTP 200 but not valid JSON" };
  }

  const ext = extractExtMetadata(json);
  const license = ext?.LicenseShortName?.value ?? ext?.UsageTerms?.value ?? "unknown";
  const rawArtist = ext?.Artist?.value ?? ext?.Credit?.value;
  const stripped = rawArtist ? stripHtml(rawArtist) : "";
  const attribution = stripped || "via Wikimedia Commons";

  return { ok: true, license, attribution };
}

function extractExtMetadata(json: unknown): ImageInfoExtMetadata | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const pages = (json as CommonsImageInfoResponse).query?.pages;
  if (!pages) return undefined;
  const firstPage = Object.values(pages)[0];
  return firstPage?.imageinfo?.[0]?.extmetadata;
}

const EXTENSION_MIME: { [ext: string]: string } = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

function mimeFromUrl(url: string): string | undefined {
  const match = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(url);
  const ext = match?.[1]?.toLowerCase();
  return ext ? EXTENSION_MIME[ext] : undefined;
}

/**
 * Download a thumbnail and return it base64-encoded for a data-mode image content block.
 * MIME is read from the `Content-Type` header, falling back to the URL extension.
 * SVG and oversized payloads return `unsupportedFormat`.
 */
export async function fetchImageBytes(
  url: string,
  deps: WikimediaDeps = {},
): Promise<{ ok: true; data: string; mimeType: string } | SourceError> {
  const raw = await requestRaw(url, deps);
  if (isError(raw)) return raw;
  const headerMime = raw.response.headers.get("content-type")?.split(";")[0]?.trim();
  const mimeType = headerMime || mimeFromUrl(url) || "";
  if (!mimeType.startsWith("image/")) {
    return { kind: "unknown", message: `unexpected content-type "${mimeType || "(none)"}"` };
  }
  if (mimeType === "image/svg+xml") {
    return { kind: "unsupportedFormat", message: "thumbnail is SVG and won't render reliably" };
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await raw.response.arrayBuffer();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "network", message: `failed reading image bytes: ${message}` };
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return {
      kind: "unsupportedFormat",
      message: `thumbnail exceeds ${MAX_IMAGE_BYTES}-byte limit (${buffer.byteLength})`,
    };
  }
  return { ok: true, data: Buffer.from(buffer).toString("base64"), mimeType };
}

/**
 * Resolve the Commons SOURCE filename from a `thumbnail.source` URL.
 * Thumbnail URLs follow `/thumb/<a>/<ab>/<SourceFile>/<size>px-<SourceFile>.<ext>`,
 * so the source file is the segment BEFORE the rendered-size tail. Non-thumb URLs
 * (rare) fall back to the last path segment.
 */
export function sourceFilenameFromThumbUrl(thumbUrl: string): string {
  let pathname: string;
  try {
    pathname = new URL(thumbUrl).pathname;
  } catch {
    pathname = thumbUrl;
  }
  const parts = pathname.split("/").filter(Boolean);
  if (parts.includes("thumb") && parts.length >= 2) {
    return decodeURIComponent(parts[parts.length - 2]);
  }
  return decodeURIComponent(parts[parts.length - 1] ?? "");
}
