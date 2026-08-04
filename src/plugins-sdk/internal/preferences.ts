import type { z } from "zod";
import { getPluginPreferenceSlice } from "../../userPreferences.js";
import type { ClackSdkPreferences } from "../sdk.js";

export interface PreferencesSurfaceDeps {
  getPluginPreferenceSlice?: typeof getPluginPreferenceSlice;
}

export function createPreferencesSurface(
  deps: PreferencesSurfaceDeps,
  pluginName: string,
  warn: (message: string) => void,
): ClackSdkPreferences {
  return {
    async get<T>(userId: string, schema: z.ZodType<T>): Promise<T | null> {
      const raw = await (deps.getPluginPreferenceSlice ?? getPluginPreferenceSlice)(
        pluginName,
        userId,
      );
      if (raw === null) return null;
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        warn(`[plugin:${pluginName}] preferences slice for ${userId} failed schema; ignoring`);
        return null;
      }
      return parsed.data;
    },
  };
}
