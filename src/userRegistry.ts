import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { logger } from "./logger.js";
import { fileExists } from "./fs.js";
import type { JsonObject, JsonValue } from "./config.js";
import { zodErrorToResult } from "./plugins/zodResult.js";

// ============================================================================
// Dependency Injection
// ============================================================================

export interface UserRegistryDeps {
  readFile: (path: string, encoding: "utf-8") => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<string | undefined>;
  fileExists: (path: string) => Promise<boolean>;
}

export const defaultUserRegistryDeps: UserRegistryDeps = {
  readFile,
  writeFile,
  mkdir,
  fileExists,
};

let deps: UserRegistryDeps = defaultUserRegistryDeps;

export function setUserRegistryDeps(d: UserRegistryDeps): void {
  deps = d;
}

export function resetUserRegistryDeps(): void {
  deps = defaultUserRegistryDeps;
}

// ============================================================================
// Types & Schema
// ============================================================================

/**
 * One record in `data/state/users.json`. `displayName` and `lastFetched` are core
 * bookkeeping (the latter is the epoch-millis of the last successful Slack resolution,
 * never surfaced to plugins). `github` is an OPTIONAL core identity attribute (the user's
 * mapped GitHub login) — a first-class field, NOT a plugin namespace. `plugins` is a
 * per-plugin namespace bag — each plugin owns its own slice under `plugins.<pluginName>`
 * and validates it with its own zod schema.
 */
export interface UserRecord {
  userId: string;
  displayName: string;
  lastFetched: number;
  github?: { username: string };
  plugins?: { [pluginName: string]: JsonObject };
}

/** The plugin-facing identity projection — never includes `lastFetched` or namespaces. */
export interface UserIdentity {
  userId: string;
  displayName: string;
}

const jsonValueZod: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueZod),
    z.record(z.string(), jsonValueZod),
  ]),
);

const jsonObjectZod = z.record(z.string(), jsonValueZod);

// Graceful (permissive) reader: a state file, so on a shape mismatch we log + treat the
// registry as empty rather than throwing — and never narrow so hard that a real record is
// dropped. Fields tolerate missing values so a single legacy entry can't fail the whole map.
const userRecordZod = z.object({
  userId: z.string(),
  displayName: z.string().default(""),
  lastFetched: z.number().default(0),
  // Tolerant per-field: a malformed `github` is logged and dropped to absent so it can't
  // fail the record (or the whole registry) parse and wipe real state.
  github: z
    .object({ username: z.string() })
    .optional()
    .catch(() => {
      logger.warn("users.json: malformed 'github' field dropped (expected { username: string })");
      return undefined;
    }),
  plugins: z.record(z.string(), jsonObjectZod).optional(),
});

const registryZod = z.record(z.string(), userRecordZod);

interface RegistryMap {
  [userId: string]: UserRecord;
}

// ============================================================================
// Load / persist
// ============================================================================

let cached: RegistryMap | null = null;

// All mutations funnel through this promise chain so concurrent read-modify-write from
// core + multiple plugins can't lose updates (the registry is the single writer; plugins
// reach it only through the SDK).
let writeChain: Promise<void> = Promise.resolve();

function getStateDir(): string {
  return resolve(process.cwd(), "data", "state");
}

function getRegistryPath(): string {
  return resolve(getStateDir(), "users.json");
}

export async function loadRegistry(): Promise<RegistryMap> {
  if (cached) {
    return cached;
  }

  const path = getRegistryPath();

  if (!(await deps.fileExists(path))) {
    cached = {};
    return cached;
  }

  try {
    const content = await deps.readFile(path, "utf-8");
    const result = registryZod.safeParse(JSON.parse(content));
    if (!result.success) {
      logger.warn(
        `users.json has unexpected shape; using empty: ${zodErrorToResult(result.error, "users").error}`,
      );
      cached = {};
      return cached;
    }
    cached = result.data;
    return cached;
  } catch (error) {
    logger.error("Failed to load user registry:", error);
    cached = {};
    return cached;
  }
}

async function persist(map: RegistryMap): Promise<void> {
  const stateDir = getStateDir();
  if (!(await deps.fileExists(stateDir))) {
    await deps.mkdir(stateDir, { recursive: true });
  }
  await deps.writeFile(getRegistryPath(), JSON.stringify(map, null, 2));
  cached = map;
}

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ============================================================================
// Reads
// ============================================================================

export async function getUserRecord(userId: string): Promise<UserRecord | null> {
  const map = await loadRegistry();
  return map[userId] ?? null;
}

export async function listUserIdentities(): Promise<UserIdentity[]> {
  const map = await loadRegistry();
  return Object.values(map).map((r) => ({ userId: r.userId, displayName: r.displayName }));
}

export async function getUserNamespace(plugin: string, userId: string): Promise<JsonObject | null> {
  const map = await loadRegistry();
  return map[userId]?.plugins?.[plugin] ?? null;
}

// ============================================================================
// Writes (serialized)
// ============================================================================

/**
 * Write-through identity upsert from the core resolution primitive. Preserves any existing
 * plugin namespaces; only touches the core identity fields.
 */
export function upsertIdentity(
  userId: string,
  displayName: string,
  lastFetched: number,
): Promise<void> {
  return serialize(async () => {
    const map = await loadRegistry();
    const existing = map[userId];
    map[userId] = {
      userId,
      displayName,
      lastFetched,
      ...(existing?.github ? { github: existing.github } : {}),
      ...(existing?.plugins ? { plugins: existing.plugins } : {}),
    };
    await persist(map);
  });
}

/**
 * Field-merge `partial` into `plugins.<plugin>` for `userId` (omitted fields keep their prior
 * value). Creates a placeholder record (empty identity, `lastFetched: 0`) when the user is not
 * yet known — a later `get` refreshes the identity. Serialized so concurrent merges from
 * different plugins both persist.
 */
export function mergeUserNamespace(
  plugin: string,
  userId: string,
  partial: JsonObject,
): Promise<void> {
  return serialize(async () => {
    const map = await loadRegistry();
    const base: UserRecord = map[userId] ?? { userId, displayName: "", lastFetched: 0 };
    const prevNamespace = base.plugins?.[plugin] ?? {};
    map[userId] = {
      ...base,
      userId,
      plugins: { ...base.plugins, [plugin]: { ...prevNamespace, ...partial } },
    };
    await persist(map);
  });
}

/**
 * Set or clear a user's core `github` field. `null` removes the field. Preserves all other
 * core fields and plugin namespaces; creates a placeholder record (empty identity,
 * `lastFetched: 0`) for an unknown user — a later `get` refreshes the identity. Serialized
 * so concurrent writes don't lose updates.
 */
export function mergeUserGithub(
  userId: string,
  github: { username: string } | null,
): Promise<void> {
  return serialize(async () => {
    const map = await loadRegistry();
    const base: UserRecord = map[userId] ?? { userId, displayName: "", lastFetched: 0 };
    if (github === null) {
      const { github: _dropped, ...rest } = base;
      map[userId] = { ...rest, userId };
    } else {
      map[userId] = { ...base, userId, github: { username: github.username } };
    }
    await persist(map);
  });
}

/**
 * Set a user's core `displayName` directly (a manual override of the Slack-resolved value).
 * Bumps `lastFetched` to now so the lazy refresh doesn't immediately clobber it within the
 * freshness TTL. Preserves `github` and plugin namespaces. Serialized.
 */
export function setUserDisplayName(userId: string, displayName: string): Promise<void> {
  return serialize(async () => {
    const map = await loadRegistry();
    const base: UserRecord = map[userId] ?? { userId, displayName: "", lastFetched: 0 };
    map[userId] = { ...base, userId, displayName, lastFetched: Date.now() };
    await persist(map);
  });
}

// Clear cache (useful for testing).
export function clearRegistryCache(): void {
  cached = null;
  writeChain = Promise.resolve();
}
