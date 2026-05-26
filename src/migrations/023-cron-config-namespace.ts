import type { Migration, StaticFileResult } from "./types.js";
import { logger } from "../logger.js";

/**
 * Rewrite legacy cron-related top-level config keys into the new `cron` namespace:
 *
 * - `allowScheduledMessages: boolean`        → `cron.userSchedules: boolean`
 * - `scheduledMessagesMaxRunHistory: number` → `cron.maxRunHistory: number`
 *
 * The legacy keys are removed after the move. When the new namespace already carries
 * a value for a target field, the new value wins (the legacy key is still deleted).
 * When neither is present, the file is unchanged for that key — runtime defaults
 * (`cron.enabled = true`, `cron.userSchedules = false`) apply at parse time.
 *
 * Idempotent: a second run sees no legacy keys and produces no writes.
 * Blocking priority so the file is in the new shape before `validateConfig` runs.
 */

const CONFIG_PATH = "data/config.json";

type JsonPrimitive = string | number | boolean | null;
type JsonArray = JsonValue[];
interface JsonObjectShape {
  [key: string]: JsonValue;
}
type JsonValue = JsonPrimitive | JsonArray | JsonObjectShape;

function isJsonObject(value: unknown): value is JsonObjectShape {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface MigrateResult {
  changed: boolean;
  movedFields: string[];
}

export function migrateCronConfig(value: JsonObjectShape): MigrateResult {
  const hasLegacyAllow = "allowScheduledMessages" in value;
  const hasLegacyMaxRun = "scheduledMessagesMaxRunHistory" in value;

  if (!hasLegacyAllow && !hasLegacyMaxRun) {
    return { changed: false, movedFields: [] };
  }

  const cron = isJsonObject(value.cron) ? value.cron : {};
  const movedFields: string[] = [];

  if (hasLegacyAllow) {
    if (!("userSchedules" in cron)) {
      cron.userSchedules = value.allowScheduledMessages;
      movedFields.push("allowScheduledMessages → cron.userSchedules");
    } else {
      movedFields.push("allowScheduledMessages (dropped; cron.userSchedules already set)");
    }
    delete value.allowScheduledMessages;
  }

  if (hasLegacyMaxRun) {
    if (!("maxRunHistory" in cron)) {
      cron.maxRunHistory = value.scheduledMessagesMaxRunHistory;
      movedFields.push("scheduledMessagesMaxRunHistory → cron.maxRunHistory");
    } else {
      movedFields.push("scheduledMessagesMaxRunHistory (dropped; cron.maxRunHistory already set)");
    }
    delete value.scheduledMessagesMaxRunHistory;
  }

  value.cron = cron;
  return { changed: true, movedFields };
}

export const migration: Migration = {
  version: 23,
  name: "Move allowScheduledMessages / scheduledMessagesMaxRunHistory under config.cron",
  priority: "blocking",
  files: [CONFIG_PATH],
  static: (files) => {
    const result: Record<string, StaticFileResult> = {};
    const raw = files[CONFIG_PATH];
    if (raw === null) return result;

    let parsed: JsonValue;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger.warn(
        `[migration 023] Skipping: malformed config.json (${err instanceof Error ? err.message : String(err)}).`,
      );
      return result;
    }

    if (!isJsonObject(parsed)) {
      logger.warn("[migration 023] Skipping: config.json root is not an object.");
      return result;
    }

    const { changed, movedFields } = migrateCronConfig(parsed);
    if (changed) {
      logger.info(`[migration 023] Rewrote cron config: ${movedFields.join("; ")}`);
      result[CONFIG_PATH] = JSON.stringify(parsed, null, 2) + "\n";
    }

    return result;
  },
};
