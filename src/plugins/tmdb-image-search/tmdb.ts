// HTTP adapter for the TMDB API (search, /images) + the image-CDN byte download used for
// data-mode image results. Stateless: every call is a fresh HTTPS round-trip. No cache.
// All failures are returned as structured `SourceError` values — this module never throws.

const USER_AGENT = "Clack-Trivia-Image-Search/1.0";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_CDN_BASE = "https://image.tmdb.org/t/p";

// Fixed CDN sizes (design Decision 7): `original` is multi-MB and risks the byte cap.
export const BACKDROP_SIZE = "w780";
export const PROFILE_SIZE = "h632";

const DEFAULT_TIMEOUT_MS = 5000;
const RATE_LIMIT_BACKOFF_MS = 1000;
const SERVER_ERROR_BACKOFF_MS = 500;
/** Cap on downloaded image bytes — Claude's vision input has practical size limits. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Structured error shape matching the visual-questions external image-search contract. */
export interface SourceError {
  kind:
    | "keyMissing"
    | "notFound"
    | "rateLimit"
    | "network"
    | "tooLarge"
    | "unsupportedFormat"
    | "unknown";
  message: string;
}

/** Subset of a TMDB movie search result the plugin reads (`/search/movie`). */
export interface TmdbMovieResult {
  id: number;
  title?: string;
  backdrop_path?: string | null;
}

/** Subset of a TMDB TV search result the plugin reads (`/search/tv`). */
export interface TmdbTvResult {
  id: number;
  name?: string;
  backdrop_path?: string | null;
}

/** Subset of a TMDB person search result the plugin reads (`/search/person`). */
export interface TmdbPersonResult {
  id: number;
  name?: string;
  profile_path?: string | null;
}

/** Language-null backdrop entry from `/{movie|tv}/{id}/images`. */
export interface TmdbBackdrop {
  file_path: string;
  vote_average?: number;
}

interface TmdbSearchBody<T> {
  results?: T[];
}

interface TmdbImagesBody {
  backdrops?: TmdbBackdrop[];
}

/** Success shape of a raw TMDB JSON GET; callers validate the fields they read. */
interface TmdbJsonSuccess {
  ok: true;
  json: unknown;
}

/** Injectable dependencies — defaults use the real `fetch`, `setTimeout`-backed sleep, and `Math.random`. */
export interface TmdbDeps {
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

/**
 * Resolve the TMDB v4 read access token from the environment (loaded from `data/auth/.env` at
 * boot, the same convention as the other media plugins). Returns `null` when unset so the tool
 * can surface `keyMissing`. Injectable for tests.
 */
export function loadTmdbReadToken(
  env: { [key: string]: string | undefined } = process.env,
): string | null {
  const token = env.TMDB_READ_TOKEN?.trim();
  return token ? token : null;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  headers: { [name: string]: string },
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * GET a TMDB API endpoint as JSON with a bounded single-retry policy:
 * - 429: one retry after ~1s jittered backoff, then `rateLimit`.
 * - 5xx: one retry after ~500ms jittered backoff, then `network`.
 * - timeout / connection failure: `network`, no retry.
 * - 200 with a malformed body: `unknown`. Other 4xx: `network`.
 * Auth is `Authorization: Bearer <token>` (v4 read token) — never `?api_key=`.
 */
async function tmdbGetJson(
  url: string,
  token: string,
  deps: TmdbDeps,
): Promise<TmdbJsonSuccess | SourceError> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": USER_AGENT,
  };

  let rateLimitRetried = false;
  let serverErrorRetried = false;

  while (true) {
    let res: Response;
    try {
      res = await fetchWithTimeout(fetchImpl, url, headers, timeoutMs);
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
      return { ok: true, json };
    }

    if (res.status === 429) {
      if (!rateLimitRetried) {
        rateLimitRetried = true;
        await sleep(RATE_LIMIT_BACKOFF_MS + Math.floor(RATE_LIMIT_BACKOFF_MS * random()));
        continue;
      }
      return { kind: "rateLimit", message: "TMDB rate-limited (HTTP 429)" };
    }

    if (res.status >= 500) {
      if (!serverErrorRetried) {
        serverErrorRetried = true;
        await sleep(SERVER_ERROR_BACKOFF_MS + Math.floor(SERVER_ERROR_BACKOFF_MS * random()));
        continue;
      }
      return { kind: "network", message: `TMDB server error (HTTP ${res.status})` };
    }

    return { kind: "network", message: `TMDB request failed (HTTP ${res.status})` };
  }
}

async function tmdbSearch<T>(
  endpoint: "movie" | "tv" | "person",
  query: string,
  token: string,
  deps: TmdbDeps,
): Promise<{ ok: true; results: T[] } | SourceError> {
  const params = new URLSearchParams({
    query,
    language: "en-US",
    include_adult: "false",
  });
  const url = `${TMDB_API_BASE}/search/${endpoint}?${params.toString()}`;
  const res = await tmdbGetJson(url, token, deps);
  if (!("ok" in res)) return res;
  const body = res.json as TmdbSearchBody<T>;
  const results = body?.results;
  if (!Array.isArray(results)) {
    return { kind: "unknown", message: "response is missing a results array" };
  }
  return { ok: true, results };
}

/** Search movies. An empty `results` array is returned as-is — zero-result handling is the tool's. */
export function searchMovies(
  query: string,
  token: string,
  deps: TmdbDeps = {},
): Promise<{ ok: true; results: TmdbMovieResult[] } | SourceError> {
  return tmdbSearch<TmdbMovieResult>("movie", query, token, deps);
}

/** Search TV series. */
export function searchTv(
  query: string,
  token: string,
  deps: TmdbDeps = {},
): Promise<{ ok: true; results: TmdbTvResult[] } | SourceError> {
  return tmdbSearch<TmdbTvResult>("tv", query, token, deps);
}

/** Search people (actors / crew). */
export function searchPerson(
  query: string,
  token: string,
  deps: TmdbDeps = {},
): Promise<{ ok: true; results: TmdbPersonResult[] } | SourceError> {
  return tmdbSearch<TmdbPersonResult>("person", query, token, deps);
}

/**
 * Fetch the language-null (textless) backdrops for a movie or TV series.
 * `include_image_language=null` filters to backdrops with no language tag — scene stills
 * without overlaid titles/logos, the only spoiler-safe imagery for "guess the title" questions.
 */
export async function fetchTextlessBackdrops(
  kind: "movie" | "tv",
  id: number,
  token: string,
  deps: TmdbDeps = {},
): Promise<{ ok: true; backdrops: TmdbBackdrop[] } | SourceError> {
  const url = `${TMDB_API_BASE}/${kind}/${id}/images?include_image_language=null`;
  const res = await tmdbGetJson(url, token, deps);
  if (!("ok" in res)) return res;
  const body = res.json as TmdbImagesBody;
  const backdrops = body?.backdrops;
  if (!Array.isArray(backdrops)) {
    return { kind: "unknown", message: "response is missing a backdrops array" };
  }
  return { ok: true, backdrops };
}

/**
 * Pick the backdrop `file_path` with the highest `vote_average` (ties → array order).
 * When `backdrops` is empty, fall back to the search result's own `backdrop_path` (it is
 * language-agnostic in the search payload — acceptable secondary candidate), else `null`.
 */
export function pickBestBackdrop(
  backdrops: TmdbBackdrop[],
  searchBackdropPath: string | null,
): string | null {
  if (backdrops.length === 0) return searchBackdropPath;
  let best = backdrops[0];
  for (const candidate of backdrops.slice(1)) {
    if ((candidate.vote_average ?? 0) > (best.vote_average ?? 0)) best = candidate;
  }
  return best.file_path;
}

/** Build the CDN URL for a TMDB image path (paths from the API start with `/`). */
export function cdnUrl(size: string, filePath: string): string {
  return `${TMDB_CDN_BASE}/${size}${filePath}`;
}

/**
 * Download an image from the TMDB CDN and return it base64-encoded for a data-mode image
 * content block. MIME comes from `Content-Type`, falling back to `image/jpeg` when absent.
 * SVG / non-image payloads return `unsupportedFormat`; > 5 MB returns `tooLarge`;
 * 4xx returns `network`; 5xx gets one jittered retry then `network`.
 */
export async function fetchImageBytes(
  url: string,
  token: string,
  deps: TmdbDeps = {},
): Promise<{ ok: true; data: string; mimeType: string } | SourceError> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "image/*",
    "User-Agent": USER_AGENT,
  };

  let serverErrorRetried = false;

  let res: Response;
  while (true) {
    try {
      res = await fetchWithTimeout(fetchImpl, url, headers, timeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { kind: "network", message: `image download failed: ${message}` };
    }
    if (res.status >= 500 && !serverErrorRetried) {
      serverErrorRetried = true;
      await sleep(SERVER_ERROR_BACKOFF_MS + Math.floor(SERVER_ERROR_BACKOFF_MS * random()));
      continue;
    }
    break;
  }
  if (!res.ok) {
    return { kind: "network", message: `image download failed (HTTP ${res.status})` };
  }

  const headerMime = res.headers.get("content-type")?.split(";")[0]?.trim();
  const mimeType = headerMime || "image/jpeg";
  if (!mimeType.startsWith("image/")) {
    return { kind: "unsupportedFormat", message: `unexpected content-type "${mimeType}"` };
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
      kind: "tooLarge",
      message: `image exceeds ${MAX_IMAGE_BYTES}-byte limit (${buffer.byteLength})`,
    };
  }
  return { ok: true, data: Buffer.from(buffer).toString("base64"), mimeType };
}
