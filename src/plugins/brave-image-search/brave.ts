// HTTP adapter for the Brave Search Images API + the chosen-image byte download used for
// data-mode image results. Stateless: every call is a fresh HTTPS round-trip. No cache.
// All failures are returned as structured `SourceError` values — this module never throws.

/** Wikimedia-style etiquette: descriptive User-Agent on every outbound request. */
const USER_AGENT = "Clack-Trivia-Image-Search/1.0";

const BRAVE_IMAGES_ENDPOINT = "https://api.search.brave.com/res/v1/images/search";

const DEFAULT_TIMEOUT_MS = 5000;
const RATE_LIMIT_BACKOFF_MS = 1000;
const SERVER_ERROR_BACKOFF_MS = 500;
/** Cap on downloaded image bytes — Claude's vision input has practical size limits. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Structured error shape matching the visual-questions external image-search contract. */
export interface SourceError {
  kind: "keyMissing" | "notFound" | "rateLimit" | "network" | "unknown" | "unsupportedFormat";
  message: string;
}

/** Subset of a Brave image-search result the plugin reads. */
export interface BraveImageResult {
  title?: string;
  source?: string;
  properties?: { url?: string };
  thumbnail?: { src?: string };
}
interface BraveSearchResponse {
  results?: BraveImageResult[];
}

/** Injectable dependencies — defaults use the real `fetch`, `setTimeout`-backed sleep, and `Math.random`. */
export interface BraveDeps {
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

/**
 * Resolve the Brave API key from the environment (loaded from `data/auth/.env` at boot, the same
 * convention as the other media plugins). Returns `null` when unset so the tool can surface
 * `keyMissing`. Injectable for tests.
 */
export function loadBraveApiKey(
  env: { [key: string]: string | undefined } = process.env,
): string | null {
  const key = env.BRAVE_API_KEY?.trim();
  return key ? key : null;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  apiKey: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

/**
 * GET the Brave images endpoint with a bounded single-retry policy:
 * - 429: one retry after ~1s jittered backoff, then `rateLimit`.
 * - 5xx: one retry after ~500ms jittered backoff, then `network`.
 * - 200 with no `results` / empty `results`: `notFound`. malformed body: `unknown`.
 * - 4xx (other than 429), timeout, connection failure: mapped to `network`/`unknown`.
 */
export async function searchImages(
  query: string,
  apiKey: string,
  deps: BraveDeps = {},
): Promise<{ ok: true; results: BraveImageResult[] } | SourceError> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const params = new URLSearchParams({ q: query, safesearch: "strict" });
  const url = `${BRAVE_IMAGES_ENDPOINT}?${params.toString()}`;

  let rateLimitRetried = false;
  let serverErrorRetried = false;

  while (true) {
    let res: Response;
    try {
      res = await fetchWithTimeout(fetchImpl, url, apiKey, timeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "network", message: `request failed: ${message}` };
    }

    if (res.ok) {
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        return { kind: "unknown", message: "response was HTTP 200 but not valid JSON" };
      }
      const results = (json as BraveSearchResponse)?.results;
      if (!Array.isArray(results)) {
        return { kind: "unknown", message: "response is missing a results array" };
      }
      if (results.length === 0) {
        return { kind: "notFound", message: "Brave returned zero results" };
      }
      return { ok: true, results };
    }

    if (res.status === 429) {
      if (!rateLimitRetried) {
        rateLimitRetried = true;
        await sleep(RATE_LIMIT_BACKOFF_MS + Math.floor(RATE_LIMIT_BACKOFF_MS * random()));
        continue;
      }
      return { kind: "rateLimit", message: "Brave rate-limited (HTTP 429)" };
    }

    if (res.status >= 500) {
      if (!serverErrorRetried) {
        serverErrorRetried = true;
        await sleep(SERVER_ERROR_BACKOFF_MS + Math.floor(SERVER_ERROR_BACKOFF_MS * random()));
        continue;
      }
      return { kind: "network", message: `Brave server error (HTTP ${res.status})` };
    }

    return { kind: "network", message: `Brave request failed (HTTP ${res.status})` };
  }
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
 * Download an image and return it base64-encoded for a data-mode image content block.
 * MIME is read from the `Content-Type` header, falling back to the URL extension.
 * SVG and oversized payloads return `unsupportedFormat`.
 */
export async function fetchImageBytes(
  url: string,
  deps: BraveDeps = {},
): Promise<{ ok: true; data: string; mimeType: string } | SourceError> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "network", message: `image download failed: ${message}` };
  } finally {
    clearTimeout(id);
  }
  if (!res.ok) {
    return { kind: "network", message: `image download failed (HTTP ${res.status})` };
  }

  const headerMime = res.headers.get("content-type")?.split(";")[0]?.trim();
  const mimeType = headerMime || mimeFromUrl(url) || "";
  if (!mimeType.startsWith("image/")) {
    return { kind: "unknown", message: `unexpected content-type "${mimeType || "(none)"}"` };
  }
  if (mimeType === "image/svg+xml") {
    return { kind: "unsupportedFormat", message: "image is SVG and won't render reliably" };
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await res.arrayBuffer();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: "network", message: `failed reading image bytes: ${message}` };
  }
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return {
      kind: "unsupportedFormat",
      message: `image exceeds ${MAX_IMAGE_BYTES}-byte limit (${buffer.byteLength})`,
    };
  }
  return { ok: true, data: Buffer.from(buffer).toString("base64"), mimeType };
}

const RENDERABLE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const MAX_RESULTS_CONSIDERED = 10;

/** Return the first top-10 result whose image URL has a renderable extension, or `undefined`. */
export function selectRenderableResult(
  results: BraveImageResult[],
): { result: BraveImageResult; imageUrl: string } | undefined {
  for (const result of results.slice(0, MAX_RESULTS_CONSIDERED)) {
    const imageUrl = result.properties?.url;
    if (!imageUrl) continue;
    const match = /\.([a-z0-9]+)(?:\?.*)?$/i.exec(imageUrl);
    const ext = match?.[1]?.toLowerCase();
    if (ext && RENDERABLE_EXTENSIONS.has(ext)) return { result, imageUrl };
  }
  return undefined;
}

export { isError as isSourceError };
