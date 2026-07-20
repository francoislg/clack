import type { App } from "@slack/bolt";
import type { z } from "zod";
import type { JsonObject } from "../../config.js";
import {
  listUserIdentities,
  getUserNamespace,
  mergeUserNamespace,
  type UserIdentity,
} from "../../userRegistry.js";
import { resolveUserIdentity } from "../../slack/userCache.js";
import type { ClackUser, ClackSdkUsers, ClackSdkUserData } from "../sdk.js";

/**
 * The registry/userCache accessors backing `sdk.users`. All optional so tests can omit
 * them; {@link createUsersSurface} falls back to the real implementations.
 */
export interface UsersSurfaceDeps {
  getSlackClient: () => App["client"] | null;
  resolveUserIdentity?: typeof resolveUserIdentity;
  listUserIdentities?: typeof listUserIdentities;
  getUserNamespace?: typeof getUserNamespace;
  mergeUserNamespace?: typeof mergeUserNamespace;
}

/**
 * Build the `sdk.users` surface for one plugin. `get`/`list` expose core identity from the
 * central registry; `data(schema)` reads/merges the plugin's own namespace (auto-scoped to
 * `pluginName`). Population, persistence, and TTL-gated refresh live in core and stay invisible.
 */
export function createUsersSurface(
  deps: UsersSurfaceDeps,
  pluginName: string,
  warn: (message: string) => void,
): ClackSdkUsers {
  return {
    async get(userId: string): Promise<ClackUser | null> {
      const resolve = deps.resolveUserIdentity ?? resolveUserIdentity;
      const identity: UserIdentity | null = await resolve(deps.getSlackClient(), userId);
      return identity;
    },
    list(): Promise<ClackUser[]> {
      return (deps.listUserIdentities ?? listUserIdentities)();
    },
    data<T>(schema: z.ZodType<T>): ClackSdkUserData<T> {
      return {
        async get(userId: string): Promise<T | null> {
          const raw = await (deps.getUserNamespace ?? getUserNamespace)(pluginName, userId);
          if (raw === null) {
            return null;
          }
          const parsed = schema.safeParse(raw);
          if (!parsed.success) {
            warn(
              `[plugin:${pluginName}] users.data namespace for ${userId} failed schema; ignoring`,
            );
            return null;
          }
          return parsed.data;
        },
        async merge(userId: string, partial: Partial<T>): Promise<void> {
          await (deps.mergeUserNamespace ?? mergeUserNamespace)(
            pluginName,
            userId,
            partial as JsonObject,
          );
        },
      };
    },
  };
}
