import { GiphyFetch, FetchError, type SearchOptions } from "@giphy/js-fetch-api";
import type { GifResult } from "./types.js";

/** Random offset window — Giphy's search has no `random=true` flag, so a random offset adds variety across calls. */
const RANDOM_OFFSET_MAX = 25;

export { FetchError as GiphyError };

export type GiphyMediaType = "gifs" | "stickers";
export type GiphyRating = "g" | "pg" | "pg-13" | "r" | "y";
export type GiphySort = "relevant" | "recent";

/**
 * Loose shape of the Giphy result fields we read. Wider than the SDK's `IGif` so
 * tests can build minimal fixtures without populating every required rendition.
 */
export interface GiphyGifLike {
  title?: string;
  images?: {
    original?: { url?: string };
    downsized_medium?: { url?: string };
    fixed_width_small?: { url?: string };
    preview_gif?: { url?: string };
  };
}

/**
 * Minimal slice of `GiphyFetch` we depend on. The real SDK satisfies this because
 * `IGif` is assignable to `GiphyGifLike`.
 */
export interface GiphySearchClient {
  search(term: string, options?: SearchOptions): Promise<{ data: GiphyGifLike[] }>;
}

export interface SearchGiphyParams {
  query: string;
  limit: number;
  apiKey: string;
  type?: GiphyMediaType;
  sort?: GiphySort;
  lang?: string;
  rating?: GiphyRating;
  channel?: string;
  /** Injected for tests — defaults to `(key) => new GiphyFetch(key)`. */
  clientFactory?: (apiKey: string) => GiphySearchClient;
  /** Injected for tests — defaults to `Math.random`. */
  randomImpl?: () => number;
}

export async function searchGiphy(params: SearchGiphyParams): Promise<GifResult[]> {
  const factory = params.clientFactory ?? ((key: string) => new GiphyFetch(key));
  const randomFn = params.randomImpl ?? Math.random;
  const client = factory(params.apiKey);

  const { data } = await client.search(params.query, {
    limit: params.limit,
    offset: Math.floor(randomFn() * RANDOM_OFFSET_MAX),
    rating: params.rating ?? "g",
    lang: params.lang ?? "en",
    sort: params.sort ?? "relevant",
    type: params.type ?? "gifs",
    ...(params.channel ? { channel: params.channel } : {}),
  });

  const mapped: GifResult[] = [];
  for (const gif of data) {
    const mainUrl = gif.images?.original?.url ?? gif.images?.downsized_medium?.url;
    const previewUrl =
      gif.images?.fixed_width_small?.url ?? gif.images?.preview_gif?.url ?? mainUrl;
    if (!mainUrl || !previewUrl) continue;
    mapped.push({
      url: mainUrl,
      previewUrl,
      title: gif.title ?? "",
    });
  }
  return mapped;
}
