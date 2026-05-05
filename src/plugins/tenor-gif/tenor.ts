import { z } from "zod";
import type { GifResult } from "./types.js";

const TENOR_ENDPOINT = "https://tenor.googleapis.com/v2/search";
const CLIENT_KEY = "clack";

const TenorMediaFormatSchema = z.object({
  url: z.string(),
});

const TenorResultSchema = z.object({
  title: z.string().optional(),
  content_description: z.string().optional(),
  media_formats: z
    .object({
      gif: TenorMediaFormatSchema.optional(),
      mediumgif: TenorMediaFormatSchema.optional(),
      tinygif: TenorMediaFormatSchema.optional(),
    })
    .optional(),
});

const TenorResponseSchema = z.object({
  results: z.array(TenorResultSchema).optional(),
});

export interface SearchTenorParams {
  query: string;
  limit: number;
  apiKey: string;
  /** Injected for tests — defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export class TenorError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "TenorError";
  }
}

export async function searchTenor(params: SearchTenorParams): Promise<GifResult[]> {
  const fetchFn = params.fetchImpl ?? fetch;
  const url = new URL(TENOR_ENDPOINT);
  url.searchParams.set("q", params.query);
  url.searchParams.set("key", params.apiKey);
  url.searchParams.set("client_key", CLIENT_KEY);
  url.searchParams.set("contentfilter", "high");
  url.searchParams.set("random", "true");
  url.searchParams.set("limit", String(params.limit));

  const response = await fetchFn(url.toString());
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new TenorError(`Tenor API returned ${response.status}`, response.status, body);
  }

  const raw = await response.json();
  const data = TenorResponseSchema.parse(raw);
  const results = data.results ?? [];

  const mapped: GifResult[] = [];
  for (const r of results) {
    const mainUrl = r.media_formats?.gif?.url ?? r.media_formats?.mediumgif?.url;
    const previewUrl = r.media_formats?.tinygif?.url ?? mainUrl;
    if (!mainUrl || !previewUrl) continue;
    mapped.push({
      url: mainUrl,
      previewUrl,
      title: r.content_description ?? r.title ?? "",
    });
  }
  return mapped;
}
