// HTTP adapter for MusicBrainz (release-group search) + the Cover Art Archive (front-cover
// fetch) + the cover-byte download used for data-mode image results.
// Stateless: every call is a fresh HTTPS round-trip. No cache, no API key.
// All failures are returned as structured `SourceError` values — this module never throws.

/** MusicBrainz etiquette: descriptive User-Agent on every outbound request. */
const USER_AGENT = "Clack-Trivia-Image-Search/1.0 (https://github.com/francoislg/clack)";

const MUSICBRAINZ_SEARCH_BASE = "https://musicbrainz.org/ws/2/release-group/";
const COVERART_BASE = "https://coverartarchive.org/release-group/";

const DEFAULT_TIMEOUT_MS = 5000;
const RATE_LIMIT_RETRIES = 2;
const BACKOFF_BASE_MS = 500;
/** Cap on downloaded cover bytes — Claude's vision input has practical size limits. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Structured error shape matching the visual-questions external image-search contract. */
export interface SourceError {
  kind: "notFound" | "rateLimit" | "network" | "unknown" | "unsupportedFormat";
  message: string;
}

/** Subset of a MusicBrainz release-group search entry the plugin reads. */
export interface ReleaseGroup {
  id: string;
  title?: string;
  "artist-credit"?: Array<{ name?: string }>;
}

interface ReleaseGroupSearchResponse {
  "release-groups"?: ReleaseGroup[];
}

/** Injectable dependencies — defaults use the real `fetch`, `setTimeout`-backed sleep, and `Math.random`. */
export interface MusicBrainzDeps {
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
  extraHeaders: { [name: string]: string },
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT, ...extraHeaders },
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
  deps: MusicBrainzDeps = {},
  extraHeaders: { [name: string]: string } = {},
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
      res = await fetchWithTimeout(fetchImpl, url, timeoutMs, extraHeaders);
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
 * Search MusicBrainz release-groups (album-as-work granularity) for `query`.
 * Returns the raw candidate list in rank order — an empty list is `ok` (the
 * caller's selection loop turns it into `notFound`).
 */
export async function searchReleaseGroups(
  query: string,
  deps: MusicBrainzDeps = {},
): Promise<{ ok: true; releaseGroups: ReleaseGroup[] } | SourceError> {
  const url = `${MUSICBRAINZ_SEARCH_BASE}?query=${encodeURIComponent(query)}&fmt=json&limit=10`;
  const raw = await requestRaw(url, deps, { Accept: "application/json" });
  if (isError(raw)) return raw;
  let json: unknown;
  try {
    json = await raw.response.json();
  } catch {
    return { kind: "unknown", message: "release-group search was HTTP 200 but not valid JSON" };
  }
  if (typeof json !== "object" || json === null) {
    return { kind: "unknown", message: "release-group search response was not an object" };
  }
  const releaseGroups = (json as ReleaseGroupSearchResponse)["release-groups"];
  if (!Array.isArray(releaseGroups)) {
    return { kind: "unknown", message: "release-group search response missing release-groups" };
  }
  return { ok: true, releaseGroups };
}

/** The canonical CAA front-cover URL for a release-group MBID (500px variant). */
export function frontCoverUrl(mbid: string): string {
  return `${COVERART_BASE}${encodeURIComponent(mbid)}/front-500`;
}

/**
 * Probe the Cover Art Archive for a release-group's front cover. CAA 404 means the
 * release-group has no cover art — the caller advances to its next candidate. On
 * success returns the CANONICAL front-500 URL (not the post-redirect target), so the
 * same album always yields the same `imageUrl`; `fetchImageBytes` downloads it
 * separately (fetch follows the 307 itself).
 */
export async function fetchFrontCover(
  mbid: string,
  deps: MusicBrainzDeps = {},
): Promise<{ ok: true; coverUrl: string } | SourceError> {
  const url = frontCoverUrl(mbid);
  const raw = await requestRaw(url, deps);
  if (isError(raw)) return raw;
  return { ok: true, coverUrl: url };
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
 * Download a cover image and return it base64-encoded for a data-mode image content block.
 * MIME is read from the `Content-Type` header, falling back to the URL extension.
 * SVG and oversized payloads return `unsupportedFormat`.
 */
export async function fetchImageBytes(
  url: string,
  deps: MusicBrainzDeps = {},
): Promise<{ ok: true; data: string; mimeType: string } | SourceError> {
  const raw = await requestRaw(url, deps);
  if (isError(raw)) return raw;
  const headerMime = raw.response.headers.get("content-type")?.split(";")[0]?.trim();
  const mimeType = headerMime || mimeFromUrl(url) || "";
  if (!mimeType.startsWith("image/")) {
    return { kind: "unknown", message: `unexpected content-type "${mimeType || "(none)"}"` };
  }
  if (mimeType === "image/svg+xml") {
    return { kind: "unsupportedFormat", message: "cover is SVG and won't render reliably" };
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
      message: `cover exceeds ${MAX_IMAGE_BYTES}-byte limit (${buffer.byteLength})`,
    };
  }
  return { ok: true, data: Buffer.from(buffer).toString("base64"), mimeType };
}
