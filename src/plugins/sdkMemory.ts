import type { z } from "zod";
import type { JsonObject } from "../config.js";
import {
  getMemory,
  listMemory,
  searchMemory,
  rememberCore,
  getMemoryNamespace,
  mergeMemoryNamespace,
  registerBeforeExpire,
  type MemoryEntry,
  type MemorySearchResult,
  type SearchMemoryArgs,
  type RememberInput,
  type BeforeExpireHook,
} from "../memoryRegistry.js";
import type { ClackSdkMemory, ClackSdkMemoryData } from "./sdk.js";

/**
 * The registry accessors backing `sdk.memory`. All optional so tests can omit them;
 * {@link createMemorySurface} falls back to the real implementations.
 */
export interface MemorySurfaceDeps {
  getMemory?: typeof getMemory;
  listMemory?: typeof listMemory;
  searchMemory?: typeof searchMemory;
  rememberCore?: typeof rememberCore;
  getMemoryNamespace?: typeof getMemoryNamespace;
  mergeMemoryNamespace?: typeof mergeMemoryNamespace;
  registerBeforeExpire?: typeof registerBeforeExpire;
}

/**
 * Build the `sdk.memory` surface for one plugin. `get`/`list`/`recall` expose core entries
 * (whole records, incl. plugin namespaces); `data(schema)` reads/merges the plugin's own
 * namespace (auto-scoped to `pluginName`); `onBeforeExpire` registers the plugin's pre-expire
 * hook so its in-flight work isn't pruned out from under it.
 */
export function createMemorySurface(
  deps: MemorySurfaceDeps,
  pluginName: string,
  warn: (message: string) => void,
): ClackSdkMemory {
  return {
    get(id: string): Promise<MemoryEntry | null> {
      return (deps.getMemory ?? getMemory)(id);
    },
    list(): Promise<MemoryEntry[]> {
      return (deps.listMemory ?? listMemory)();
    },
    recall(args: SearchMemoryArgs): Promise<MemorySearchResult> {
      return (deps.searchMemory ?? searchMemory)(args);
    },
    remember(input: RememberInput): Promise<MemoryEntry> {
      return (deps.rememberCore ?? rememberCore)(input);
    },
    onBeforeExpire(fn: BeforeExpireHook): void {
      (deps.registerBeforeExpire ?? registerBeforeExpire)(pluginName, fn);
    },
    data<T>(schema: z.ZodType<T>): ClackSdkMemoryData<T> {
      return {
        async get(id: string): Promise<T | null> {
          const raw = await (deps.getMemoryNamespace ?? getMemoryNamespace)(pluginName, id);
          if (raw === null) {
            return null;
          }
          const parsed = schema.safeParse(raw);
          if (!parsed.success) {
            warn(`[plugin:${pluginName}] memory.data namespace for ${id} failed schema; ignoring`);
            return null;
          }
          return parsed.data;
        },
        async merge(id: string, partial: Partial<T>, opts?: { touch?: boolean }): Promise<void> {
          await (deps.mergeMemoryNamespace ?? mergeMemoryNamespace)(
            pluginName,
            id,
            partial as JsonObject,
            opts,
          );
        },
      };
    },
  };
}
