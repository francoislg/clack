import { isAbsolute, normalize } from "node:path";
import { z } from "zod";
import type { UserRole } from "./roles.js";
import type {
  Config,
  CronConfig,
  BackupConfig,
  InvestigationsConfig,
  JsonObject,
  JsonValue,
  ThinkingFeedbackConfig,
  RepositoryConfig,
  ReusableFoldersConfig,
  ReactionsChangesWorkflowConfig,
} from "./config.js";

// Defaults/consts are inlined (not imported from config.ts) so this stays a value-import
// leaf — config.ts value-imports the validator, so importing values back would cycle.
export const VALID_ROLES: readonly UserRole[] = ["member", "dev", "admin", "owner"];
export const VALID_MERGE_STRATEGIES = ["squash", "merge", "rebase"] as const;
export const VALID_DM_TYPES = ["assistant", "classic", "agent"] as const;
const MAX_SUGGESTED_PROMPTS = 4;
const MAX_ADDITIONAL_MESSAGES_MIN = 1;
const MAX_ADDITIONAL_MESSAGES_MAX = 10;
const DEFAULT_MAX_ADDITIONAL_MESSAGES = 5;
const MIN_ADMIN_WORD_LENGTH = 3;

export function isValidRole(value: string): value is UserRole {
  return (VALID_ROLES as readonly string[]).includes(value);
}

export function isPlainObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Leaf section schemas
// ---------------------------------------------------------------------------

export const thinkingZod: z.ZodType<ThinkingFeedbackConfig | undefined> = z
  .object({ type: z.enum(["message", "emoji"]), emoji: z.string().optional() })
  .optional()
  .catch(undefined);

/** Emoji name field: string without colons/whitespace, or null; "" coerces to null. */
export function emojiField(configPath: string): z.ZodType<string | null | undefined> {
  return z
    .unknown()
    .superRefine((val, ctx) => {
      if (val === undefined || val === null) return;
      if (typeof val !== "string") {
        ctx.addIssue({
          code: "custom",
          message: `Config '${configPath}' must be a string or null`,
        });
        return;
      }
      if (val.length === 0) return;
      if (val.includes(":") || /\s/.test(val)) {
        ctx.addIssue({
          code: "custom",
          message: `Config '${configPath}' must be an emoji name without colons or whitespace (e.g., 'octagonal_sign', not ':octagonal_sign:')`,
        });
      }
    })
    .transform((val) => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      if (typeof val === "string") return val.length === 0 ? null : val;
      return null;
    });
}

const repoAccessRawZod = z.object({ read: z.unknown(), write: z.unknown() }).partial();

export const repositoryZod: z.ZodType<RepositoryConfig> = z
  .object({
    name: z
      .string({ error: "Repository 'name' is required" })
      .min(1, { error: "Repository 'name' is required" }),
    url: z
      .string({ error: "Repository 'url' is required" })
      .min(1, { error: "Repository 'url' is required" }),
    description: z.string({ error: "Repository 'description' is required" }),
    branch: z.string().optional(),
    access: repoAccessRawZod.optional(),
    worktreeBasePath: z.string().optional(),
    mergeStrategy: z.unknown().optional(),
  })
  .superRefine((repo, ctx) => {
    const read = repo.access?.read;
    if (read !== undefined && (typeof read !== "string" || !isValidRole(read))) {
      ctx.addIssue({
        code: "custom",
        message: `Repository '${repo.name}' access.read must be one of: ${VALID_ROLES.join(", ")}`,
      });
    }
    const write = repo.access?.write;
    if (write !== undefined && (typeof write !== "string" || !isValidRole(write))) {
      ctx.addIssue({
        code: "custom",
        message: `Repository '${repo.name}' access.write must be one of: ${VALID_ROLES.join(", ")}`,
      });
    }
    const ms = repo.mergeStrategy;
    if (
      ms !== undefined &&
      (typeof ms !== "string" || !(VALID_MERGE_STRATEGIES as readonly string[]).includes(ms))
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Repository 'mergeStrategy' must be one of: ${VALID_MERGE_STRATEGIES.join(", ")} (got '${String(ms)}')`,
      });
    }
  })
  .transform((repo): RepositoryConfig => {
    const read =
      typeof repo.access?.read === "string" && isValidRole(repo.access.read)
        ? repo.access.read
        : undefined;
    const write =
      typeof repo.access?.write === "string" && isValidRole(repo.access.write)
        ? repo.access.write
        : undefined;
    const mergeStrategy =
      typeof repo.mergeStrategy === "string" &&
      (VALID_MERGE_STRATEGIES as readonly string[]).includes(repo.mergeStrategy)
        ? (repo.mergeStrategy as RepositoryConfig["mergeStrategy"])
        : undefined;
    return {
      name: repo.name,
      url: repo.url,
      description: repo.description,
      branch: repo.branch || "main",
      access: repo.access ? { read, write } : undefined,
      worktreeBasePath: repo.worktreeBasePath,
      mergeStrategy,
    };
  });

export const reusableFoldersZod: z.ZodType<ReusableFoldersConfig> = z
  .object({
    enabled: z.boolean().catch(false),
    minimumProvisioned: z.number().catch(0),
    maxConcurrent: z.number().catch(3),
    maxQueueDepth: z.number().catch(5),
    idleReleaseHours: z.number().catch(24),
    dirtyTrackedQuarantine: z.boolean().catch(true),
  })
  .transform((r) => ({
    enabled: r.enabled ?? false,
    minimumProvisioned: r.minimumProvisioned ?? 0,
    maxConcurrent: r.maxConcurrent ?? 3,
    maxQueueDepth: r.maxQueueDepth ?? 5,
    idleReleaseHours: r.idleReleaseHours ?? 24,
    dirtyTrackedQuarantine: r.dirtyTrackedQuarantine ?? true,
  }));

export const reactionsChangesWorkflowZod: z.ZodType<ReactionsChangesWorkflowConfig> = z
  .object({ enabled: z.boolean().catch(false), trigger: z.string().optional() })
  .transform((c) => ({ enabled: c.enabled ?? false, trigger: c.trigger }));

/**
 * Fail-fast optional boolean for the top-level `allowPublicSearch` flag. Absent → undefined
 * (callers treat as `false`). A non-boolean value throws a formatted error at boot rather than
 * silently degrading — this flag gates a Slack scope and a workspace reinstall, so a typo that
 * quietly reads as `false` would be confusing to debug.
 */
export const allowPublicSearchZod: z.ZodType<boolean | undefined> = z
  .boolean({ error: "Config 'allowPublicSearch' must be a boolean" })
  .optional();

export const triggerChangesWorkflowZod = z
  .object({ enabled: z.boolean().catch(false) })
  .transform((c) => ({ enabled: c.enabled ?? false }));

// ---------------------------------------------------------------------------
// Registry / complex section schemas (per-key interpolated messages)
// ---------------------------------------------------------------------------

export const mcpServersZod = z.unknown().transform((raw, ctx): Config["mcpServers"] => {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw as JsonValue)) {
    ctx.addIssue({
      code: "custom",
      message: "Config 'mcpServers' must be an object keyed by server name",
    });
    return z.NEVER;
  }
  const entries = raw as JsonObject;
  const registry: NonNullable<Config["mcpServers"]> = {};
  for (const [name, value] of Object.entries(entries)) {
    if (!name || /\s/.test(name)) {
      ctx.addIssue({
        code: "custom",
        message: `Config 'mcpServers' key '${name}' must be a non-empty identifier`,
      });
      return z.NEVER;
    }
    if (!isPlainObject(value)) {
      ctx.addIssue({ code: "custom", message: `Config 'mcpServers.${name}' must be an object` });
      return z.NEVER;
    }
    if (typeof value.alwaysLoad !== "boolean") {
      ctx.addIssue({
        code: "custom",
        message: `Config 'mcpServers.${name}.alwaysLoad' must be a boolean`,
      });
      return z.NEVER;
    }
    if (typeof value.description !== "string" || value.description.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `Config 'mcpServers.${name}.description' must be a non-empty string`,
      });
      return z.NEVER;
    }
    let toolMapping: { name: string; label?: string } | undefined;
    if (value.toolMapping !== undefined) {
      const tm = value.toolMapping;
      if (!isPlainObject(tm)) {
        ctx.addIssue({
          code: "custom",
          message: `Config 'mcpServers.${name}.toolMapping' must be an object`,
        });
        return z.NEVER;
      }
      if (typeof tm.name !== "string" || tm.name.trim().length === 0 || /\s/.test(tm.name)) {
        ctx.addIssue({
          code: "custom",
          message: `Config 'mcpServers.${name}.toolMapping.name' must be a non-empty identifier`,
        });
        return z.NEVER;
      }
      let label: string | undefined;
      if (tm.label !== undefined) {
        if (typeof tm.label !== "string" || tm.label.trim().length === 0) {
          ctx.addIssue({
            code: "custom",
            message: `Config 'mcpServers.${name}.toolMapping.label' must be a non-empty string`,
          });
          return z.NEVER;
        }
        label = tm.label;
      }
      for (const key of Object.keys(tm)) {
        if (key !== "name" && key !== "label") {
          ctx.addIssue({
            code: "custom",
            message: `Config 'mcpServers.${name}.toolMapping' contains unknown key '${key}'`,
          });
          return z.NEVER;
        }
      }
      toolMapping = label !== undefined ? { name: tm.name, label } : { name: tm.name };
    }
    registry[name] = toolMapping
      ? { alwaysLoad: value.alwaysLoad, description: value.description, toolMapping }
      : { alwaysLoad: value.alwaysLoad, description: value.description };
  }
  return registry;
});

export const skillPluginsZod = z.unknown().transform((raw, ctx): Config["skillPlugins"] => {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw as JsonValue)) {
    ctx.addIssue({
      code: "custom",
      message: "Config 'skillPlugins' must be an object keyed by plugin name",
    });
    return z.NEVER;
  }
  const entries = raw as JsonObject;
  const registry: NonNullable<Config["skillPlugins"]> = {};
  for (const [name, value] of Object.entries(entries)) {
    if (!name || /\s/.test(name)) {
      ctx.addIssue({
        code: "custom",
        message: `Config 'skillPlugins' key '${name}' must be a non-empty identifier`,
      });
      return z.NEVER;
    }
    if (!isPlainObject(value)) {
      ctx.addIssue({ code: "custom", message: `Config 'skillPlugins.${name}' must be an object` });
      return z.NEVER;
    }
    if (typeof value.lazyLoad !== "boolean") {
      ctx.addIssue({
        code: "custom",
        message: `Config 'skillPlugins.${name}.lazyLoad' must be a boolean`,
      });
      return z.NEVER;
    }
    const description = value.description;
    if (value.lazyLoad) {
      if (typeof description !== "string" || description.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `Config 'skillPlugins.${name}.description' must be a non-empty string when lazyLoad is true`,
        });
        return z.NEVER;
      }
      registry[name] = { lazyLoad: true, description };
    } else {
      if (description !== undefined && typeof description !== "string") {
        ctx.addIssue({
          code: "custom",
          message: `Config 'skillPlugins.${name}.description' must be a string if provided`,
        });
        return z.NEVER;
      }
      registry[name] = {
        lazyLoad: false,
        description: typeof description === "string" ? description : "",
      };
    }
  }
  return registry;
});

export const userSkillsZod = z.unknown().transform((raw, ctx): Config["userSkills"] => {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw as JsonValue)) {
    ctx.addIssue({ code: "custom", message: "Config 'userSkills' must be an object" });
    return z.NEVER;
  }
  const obj = raw as JsonObject;
  if (typeof obj.enabled !== "boolean") {
    ctx.addIssue({ code: "custom", message: "Config 'userSkills.enabled' must be a boolean" });
    return z.NEVER;
  }
  for (const key of Object.keys(obj)) {
    if (key !== "enabled") {
      ctx.addIssue({
        code: "custom",
        message: `Config 'userSkills' contains unknown key '${key}'`,
      });
      return z.NEVER;
    }
  }
  return { enabled: obj.enabled };
});

export const assistantZod = z.unknown().transform((raw, ctx): Config["assistant"] => {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw as JsonValue)) {
    ctx.addIssue({ code: "custom", message: "Config 'assistant' must be an object" });
    return z.NEVER;
  }
  const obj = raw as JsonObject;
  const result: NonNullable<Config["assistant"]> = {};
  if (obj.greeting !== undefined) {
    if (typeof obj.greeting !== "string" || obj.greeting.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Config 'assistant.greeting' must be a non-empty string",
      });
      return z.NEVER;
    }
    result.greeting = obj.greeting;
  }
  if (obj.suggestedPrompts !== undefined) {
    if (!Array.isArray(obj.suggestedPrompts)) {
      ctx.addIssue({
        code: "custom",
        message: "Config 'assistant.suggestedPrompts' must be an array",
      });
      return z.NEVER;
    }
    if (obj.suggestedPrompts.length > MAX_SUGGESTED_PROMPTS) {
      ctx.addIssue({
        code: "custom",
        message: `Config 'assistant.suggestedPrompts' may contain at most ${MAX_SUGGESTED_PROMPTS} entries`,
      });
      return z.NEVER;
    }
    const prompts: { title: string; message: string }[] = [];
    for (let i = 0; i < obj.suggestedPrompts.length; i++) {
      const p = obj.suggestedPrompts[i];
      if (!isPlainObject(p)) {
        ctx.addIssue({
          code: "custom",
          message: `Config 'assistant.suggestedPrompts[${i}]' must be an object`,
        });
        return z.NEVER;
      }
      if (typeof p.title !== "string" || p.title.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `Config 'assistant.suggestedPrompts[${i}].title' must be a non-empty string`,
        });
        return z.NEVER;
      }
      if (typeof p.message !== "string" || p.message.trim().length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `Config 'assistant.suggestedPrompts[${i}].message' must be a non-empty string`,
        });
        return z.NEVER;
      }
      prompts.push({ title: p.title, message: p.message });
    }
    result.suggestedPrompts = prompts;
  }
  return result;
});

export const adminZod = z.unknown().transform((raw, ctx): Config["admin"] => {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw as JsonValue)) {
    ctx.addIssue({ code: "custom", message: "Config 'admin' must be an object" });
    return z.NEVER;
  }
  const wordsRaw = (raw as JsonObject).additionalWords;
  if (wordsRaw === undefined) return undefined;
  if (!Array.isArray(wordsRaw)) {
    ctx.addIssue({
      code: "custom",
      message: "Config 'admin.additionalWords' must be an array of strings",
    });
    return z.NEVER;
  }
  const seen = new Set<string>();
  const additionalWords: string[] = [];
  for (const entry of wordsRaw) {
    if (typeof entry !== "string") {
      ctx.addIssue({
        code: "custom",
        message: "Config 'admin.additionalWords' must contain only strings",
      });
      return z.NEVER;
    }
    const word = entry.trim().toLowerCase().replace(/’/g, "'");
    if (word.length < MIN_ADMIN_WORD_LENGTH) {
      ctx.addIssue({
        code: "custom",
        message: `Config 'admin.additionalWords' entries must be at least ${MIN_ADMIN_WORD_LENGTH} characters after trimming (got ${JSON.stringify(entry)})`,
      });
      return z.NEVER;
    }
    if (!seen.has(word)) {
      seen.add(word);
      additionalWords.push(word);
    }
  }
  if (additionalWords.length === 0) return undefined;
  return { additionalWords };
});

export const testerZod = z.unknown().transform((raw, ctx): Config["tester"] => {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw as JsonValue)) {
    ctx.addIssue({ code: "custom", message: "Config 'tester' must be an object" });
    return z.NEVER;
  }
  const obj = raw as JsonObject;
  for (const key of Object.keys(obj)) {
    if (
      ![
        "enabled",
        "sidecarUrl",
        "recordingsDir",
        "appHost",
        "maxConcurrent",
        "dockerProxyUrl",
        "servicesBudgetMb",
        "serviceImageAllowlist",
      ].includes(key)
    ) {
      ctx.addIssue({ code: "custom", message: `Config 'tester' contains unknown key '${key}'` });
      return z.NEVER;
    }
  }
  if (typeof obj.enabled !== "boolean") {
    ctx.addIssue({ code: "custom", message: "Config 'tester.enabled' must be a boolean" });
    return z.NEVER;
  }
  const requireString = (
    key: "sidecarUrl" | "recordingsDir" | "appHost" | "dockerProxyUrl",
  ): string | undefined => {
    const val = obj[key];
    if (val === undefined) return undefined;
    if (typeof val !== "string" || val.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `Config 'tester.${key}' must be a non-empty string`,
      });
      return undefined;
    }
    return val;
  };
  const sidecarUrl = requireString("sidecarUrl");
  const recordingsDir = requireString("recordingsDir");
  const appHost = requireString("appHost");
  if (obj.enabled && (!sidecarUrl || !recordingsDir)) {
    ctx.addIssue({
      code: "custom",
      message:
        "Config 'tester.sidecarUrl' and 'tester.recordingsDir' are required when 'tester.enabled' is true",
    });
    return z.NEVER;
  }
  let maxConcurrent: number | undefined;
  if (obj.maxConcurrent !== undefined) {
    if (
      typeof obj.maxConcurrent !== "number" ||
      !Number.isInteger(obj.maxConcurrent) ||
      obj.maxConcurrent < 1
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Config 'tester.maxConcurrent' must be a positive integer (got ${JSON.stringify(obj.maxConcurrent)})`,
      });
      return z.NEVER;
    }
    maxConcurrent = obj.maxConcurrent;
  }
  const dockerProxyUrl = requireString("dockerProxyUrl");
  let servicesBudgetMb: number | undefined;
  if (obj.servicesBudgetMb !== undefined) {
    if (
      typeof obj.servicesBudgetMb !== "number" ||
      !Number.isInteger(obj.servicesBudgetMb) ||
      obj.servicesBudgetMb < 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Config 'tester.servicesBudgetMb' must be a non-negative integer (got ${JSON.stringify(obj.servicesBudgetMb)})`,
      });
      return z.NEVER;
    }
    servicesBudgetMb = obj.servicesBudgetMb;
  }
  let serviceImageAllowlist: string[] | undefined;
  if (obj.serviceImageAllowlist !== undefined) {
    const list = obj.serviceImageAllowlist;
    if (
      !Array.isArray(list) ||
      list.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Config 'tester.serviceImageAllowlist' must be an array of non-empty strings",
      });
      return z.NEVER;
    }
    serviceImageAllowlist = list as string[];
  }
  return {
    enabled: obj.enabled,
    ...(sidecarUrl !== undefined && { sidecarUrl }),
    ...(recordingsDir !== undefined && { recordingsDir }),
    ...(appHost !== undefined && { appHost }),
    ...(maxConcurrent !== undefined && { maxConcurrent }),
    ...(dockerProxyUrl !== undefined && { dockerProxyUrl }),
    ...(servicesBudgetMb !== undefined && { servicesBudgetMb }),
    ...(serviceImageAllowlist !== undefined && { serviceImageAllowlist }),
  };
});

export const investigationsZod = z
  .unknown()
  .transform((raw, ctx): InvestigationsConfig | undefined => {
    if (raw === undefined) return undefined;
    if (!isPlainObject(raw as JsonValue)) {
      ctx.addIssue({ code: "custom", message: "Config 'investigations' must be an object" });
      return z.NEVER;
    }
    const obj = raw as JsonObject;
    for (const key of Object.keys(obj)) {
      if (key !== "enabled" && key !== "emoji") {
        ctx.addIssue({
          code: "custom",
          message: `Config 'investigations' contains unknown key '${key}'`,
        });
        return z.NEVER;
      }
    }
    if (typeof obj.enabled !== "boolean") {
      ctx.addIssue({
        code: "custom",
        message: "Config 'investigations.enabled' must be a boolean",
      });
      return z.NEVER;
    }
    let emoji = "mag";
    if (obj.emoji !== undefined) {
      if (typeof obj.emoji !== "string") {
        ctx.addIssue({
          code: "custom",
          message:
            "Config 'investigations.emoji' must be an emoji name without colons or whitespace",
        });
        return z.NEVER;
      }
      const emojiVal = obj.emoji;
      if (emojiVal.length > 0) {
        if (emojiVal.includes(":") || /\s/.test(emojiVal)) {
          ctx.addIssue({
            code: "custom",
            message:
              "Config 'investigations.emoji' must be an emoji name without colons or whitespace (e.g., 'mag', not ':mag:')",
          });
          return z.NEVER;
        }
        emoji = emojiVal;
      }
    }
    return { enabled: obj.enabled, emoji };
  });

export const cronCatchUpZod = z.unknown().transform((raw, ctx): CronConfig["catchUp"] => {
  if (raw === undefined) return undefined;
  if (!isPlainObject(raw as JsonValue)) {
    ctx.addIssue({ code: "custom", message: "Config 'cron.catchUp' must be an object" });
    return z.NEVER;
  }
  const obj = raw as JsonObject;
  for (const key of Object.keys(obj)) {
    if (key !== "delayMinutes") {
      ctx.addIssue({
        code: "custom",
        message: `Config 'cron.catchUp' contains unknown key '${key}'`,
      });
      return z.NEVER;
    }
  }
  let delayMinutes: number | undefined;
  if (obj.delayMinutes !== undefined) {
    if (
      typeof obj.delayMinutes !== "number" ||
      !Number.isInteger(obj.delayMinutes) ||
      obj.delayMinutes < 0
    ) {
      ctx.addIssue({
        code: "custom",
        message: `Config 'cron.catchUp.delayMinutes' must be an integer >= 0 (got ${JSON.stringify(obj.delayMinutes)})`,
      });
      return z.NEVER;
    }
    delayMinutes = obj.delayMinutes;
  }
  return {
    ...(delayMinutes !== undefined && { delayMinutes }),
  };
});

// Defaults inlined (not imported) to keep this a value-import leaf — see the file-head note.
const BACKUP_DEFAULT_FOLDERS = ["state"];
const BACKUP_DEFAULT_TIMEZONE = "America/Montreal";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reason a `backup.folders` entry is unsafe, or `null` when it is a safe relative path that
 * cannot resolve to the backup tree or an ancestor of `data/`. Guards against `""`, `"."`,
 * absolute paths, `..`-escapes, and any path targeting `backups/`.
 */
function unsafeBackupFolderReason(folder: string): string | null {
  if (folder.trim() === "" || folder === ".") return "must be a non-empty relative path";
  if (isAbsolute(folder)) return "must not be an absolute path";
  const norm = normalize(folder).replace(/\/+$/, "");
  if (norm === "" || norm === ".") return "must be a non-empty relative path";
  if (norm === ".." || norm.startsWith("../")) return "must not escape the data directory";
  if (norm.split("/")[0] === "backups") return "must not target the backups directory";
  return null;
}

export const backupZod = z.unknown().transform((raw, ctx): BackupConfig => {
  const defaults: BackupConfig = {
    enabled: true,
    folders: [...BACKUP_DEFAULT_FOLDERS],
    timezone: BACKUP_DEFAULT_TIMEZONE,
  };
  if (raw === undefined) return defaults;
  if (!isPlainObject(raw as JsonValue)) {
    ctx.addIssue({ code: "custom", message: "Config 'backup' must be an object" });
    return z.NEVER;
  }
  const obj = raw as JsonObject;
  for (const key of Object.keys(obj)) {
    if (key !== "enabled" && key !== "folders" && key !== "timezone") {
      ctx.addIssue({ code: "custom", message: `Config 'backup' contains unknown key '${key}'` });
      return z.NEVER;
    }
  }

  let enabled = defaults.enabled;
  if (obj.enabled !== undefined) {
    if (typeof obj.enabled !== "boolean") {
      ctx.addIssue({ code: "custom", message: "Config 'backup.enabled' must be a boolean" });
      return z.NEVER;
    }
    enabled = obj.enabled;
  }

  let folders = defaults.folders;
  if (obj.folders !== undefined) {
    if (!Array.isArray(obj.folders) || !obj.folders.every((f) => typeof f === "string")) {
      ctx.addIssue({
        code: "custom",
        message: "Config 'backup.folders' must be an array of strings",
      });
      return z.NEVER;
    }
    if (obj.folders.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Config 'backup.folders' must be a non-empty array",
      });
      return z.NEVER;
    }
    for (const f of obj.folders as string[]) {
      const reason = unsafeBackupFolderReason(f);
      if (reason) {
        ctx.addIssue({
          code: "custom",
          message: `Config 'backup.folders' entry ${JSON.stringify(f)} ${reason}`,
        });
        return z.NEVER;
      }
    }
    folders = [...(obj.folders as string[])];
  }

  let timezone = defaults.timezone;
  if (obj.timezone !== undefined) {
    if (typeof obj.timezone !== "string" || !isValidTimeZone(obj.timezone)) {
      ctx.addIssue({
        code: "custom",
        message: `Config 'backup.timezone' must be a valid IANA timezone (got ${JSON.stringify(obj.timezone)})`,
      });
      return z.NEVER;
    }
    timezone = obj.timezone;
  }

  return { enabled, folders, timezone };
});

export const submitResponseZod = z.unknown().transform((raw, ctx): Config["submitResponse"] => {
  const fallback = { maxAdditionalMessages: DEFAULT_MAX_ADDITIONAL_MESSAGES };
  if (raw === undefined) return fallback;
  if (!isPlainObject(raw as JsonValue)) {
    ctx.addIssue({ code: "custom", message: "Config 'submitResponse' must be an object" });
    return z.NEVER;
  }
  const obj = raw as JsonObject;
  const maxRaw = obj.maxAdditionalMessages;
  if (maxRaw === undefined) return fallback;
  if (typeof maxRaw !== "number" || !Number.isInteger(maxRaw)) {
    ctx.addIssue({
      code: "custom",
      message: "Config 'submitResponse.maxAdditionalMessages' must be an integer",
    });
    return z.NEVER;
  }
  if (maxRaw < MAX_ADDITIONAL_MESSAGES_MIN || maxRaw > MAX_ADDITIONAL_MESSAGES_MAX) {
    ctx.addIssue({
      code: "custom",
      message: `Config 'submitResponse.maxAdditionalMessages' must be in [${MAX_ADDITIONAL_MESSAGES_MIN}, ${MAX_ADDITIONAL_MESSAGES_MAX}] (got ${maxRaw})`,
    });
    return z.NEVER;
  }
  return { maxAdditionalMessages: maxRaw };
});
