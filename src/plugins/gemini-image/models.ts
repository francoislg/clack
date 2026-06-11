import { z } from "zod";

export type Quality = "fast" | "best";

export interface ModelMap {
  fast: string;
  best: string;
  edit: string;
}

/**
 * Built-in tier→model defaults. Claude only ever sees the `quality` tier; these
 * IDs stay internal and are overridable so a model rename is a config edit.
 */
export const DEFAULT_MODEL_MAP: ModelMap = {
  fast: "gemini-2.5-flash-image",
  best: "gemini-3-pro-image-preview",
  edit: "gemini-2.5-flash-image",
};

const ModelMapOverrideSchema = z
  .object({
    fast: z.string().min(1),
    best: z.string().min(1),
    edit: z.string().min(1),
  })
  .partial();

/**
 * Parse a `models.json` override and merge it over the defaults. Graceful reader:
 * any unparseable/invalid content logs nothing here (the caller logs) and falls
 * back to the defaults rather than wiping the map.
 */
export function parseModelMap(raw: string | null): ModelMap {
  if (raw === null || raw.trim() === "") return DEFAULT_MODEL_MAP;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return DEFAULT_MODEL_MAP;
  }
  const parsed = ModelMapOverrideSchema.safeParse(json);
  if (!parsed.success) return DEFAULT_MODEL_MAP;
  return { ...DEFAULT_MODEL_MAP, ...parsed.data };
}

export function resolveModel(map: ModelMap, quality: Quality, opts?: { edit?: boolean }): string {
  if (opts?.edit) return map.edit;
  return map[quality];
}

let cachedMap: ModelMap = DEFAULT_MODEL_MAP;

export function getModelMap(): ModelMap {
  return cachedMap;
}

export function setModelMap(map: ModelMap): void {
  cachedMap = map;
}
