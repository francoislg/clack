import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ClackSdk } from "../../sdk.js";
import { errorResult, textResult } from "../helpers.js";
import { idlerConfigSchema, loadConfig, saveConfig } from "../config.js";
import { loadLedger, saveLedger } from "../ledger.js";
import type { IdlerConfig } from "../types.js";

const SLACK_CHANNEL_ID = /^[CGD][A-Z0-9]+$/;

export function createSetConfigTool(sdk: ClackSdk) {
  return tool(
    "set_idler_config",
    "Patch idler runtime settings. Only the fields you pass change; others are kept. Validated before saving; hot-reloads on the next fire.",
    {
      enabled: z.boolean().optional(),
      reportingChannel: z.string().optional().describe("Channel ID for the summary digest"),
      summaryHour: z
        .number()
        .int()
        .min(0)
        .max(23)
        .optional()
        .describe("Hour [0..23] the morning digest fires; defaults to the active-window start"),
      maxActionsPerFire: z.number().int().min(1).max(20).optional(),
      maxActionsPerNight: z.number().int().min(1).max(100).optional(),
      trackerSource: z.boolean().optional().describe("Enable/disable the external-tracker source"),
      ownPrsSource: z.boolean().optional().describe("Enable/disable the own-PRs source"),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      const next = {
        ...config,
        enabled: args.enabled ?? config.enabled,
        reportingChannel: args.reportingChannel ?? config.reportingChannel,
        summaryHour: args.summaryHour ?? config.summaryHour,
        maxActionsPerFire: args.maxActionsPerFire ?? config.maxActionsPerFire,
        maxActionsPerNight: args.maxActionsPerNight ?? config.maxActionsPerNight,
        sources: {
          ...config.sources,
          tracker: args.trackerSource ?? config.sources.tracker,
          ownPrs: args.ownPrsSource ?? config.sources.ownPrs,
        },
      };
      const parsed = idlerConfigSchema.safeParse(next);
      if (!parsed.success) {
        return errorResult(sdk.t("validation_failed", { message: String(parsed.error) }));
      }
      await saveConfig(sdk, next);
      const key =
        args.enabled === true
          ? "idler_enabled"
          : args.enabled === false
            ? "idler_disabled"
            : "config_updated";
      return textResult({ ok: true, message: sdk.t(key) });
    },
  );
}

export function createSetWorkHoursTool(sdk: ClackSdk) {
  return tool(
    "set_idler_work_hours",
    "Set the idler's work window — when it makes autonomous progress. It fires INSIDE this window. Use start > end for an overnight window (e.g. start 18, end 9 = 6 PM–9 AM); end is exclusive. Sync runs hourly outside this window unless an explicit sync window is set.",
    {
      start: z.number().int().min(0).max(23),
      end: z.number().int().min(1).max(24),
      tz: z.string().describe("IANA timezone, e.g. America/Montreal"),
      days: z.array(z.number().int().min(0).max(6)).min(1).describe("Work days (0=Sun)"),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      const next = {
        ...config,
        workHours: { start: args.start, end: args.end, tz: args.tz, days: args.days },
      };
      const parsed = idlerConfigSchema.safeParse(next);
      if (!parsed.success) {
        return errorResult(sdk.t("validation_failed", { message: String(parsed.error) }));
      }
      await saveConfig(sdk, next);
      return textResult({ ok: true, message: sdk.t("config_updated") });
    },
  );
}

export function createSetSyncHoursTool(sdk: ClackSdk) {
  return tool(
    "set_idler_sync_hours",
    "Set the idler's sync (ledger-priming) window — read-only discovery fires INSIDE it. Pass clear: true to remove it, so sync is derived automatically as the complement of the work window. tz/days default to the work window's when omitted.",
    {
      start: z.number().int().min(0).max(23).optional(),
      end: z.number().int().min(1).max(24).optional(),
      tz: z.string().optional().describe("IANA timezone; defaults to the work window's tz"),
      days: z
        .array(z.number().int().min(0).max(6))
        .min(1)
        .optional()
        .describe("Sync days (0=Sun); defaults to the work window's days"),
      clear: z.boolean().optional().describe("Remove syncHours so it's derived from workHours"),
    },
    async (args) => {
      const config = await loadConfig(sdk);
      let next: IdlerConfig;
      if (args.clear) {
        const { syncHours: _omit, ...rest } = config;
        next = rest;
      } else {
        if (args.start === undefined || args.end === undefined) {
          return errorResult("Provide both start and end, or pass clear: true.");
        }
        next = {
          ...config,
          syncHours: {
            start: args.start,
            end: args.end,
            tz: args.tz ?? config.workHours.tz,
            days: args.days ?? config.workHours.days,
          },
        };
      }
      const parsed = idlerConfigSchema.safeParse(next);
      if (!parsed.success) {
        return errorResult(sdk.t("validation_failed", { message: String(parsed.error) }));
      }
      await saveConfig(sdk, next);
      return textResult({ ok: true, message: sdk.t("config_updated") });
    },
  );
}

export function createAddRepoTool(sdk: ClackSdk) {
  return tool(
    "add_idler_repo",
    "Add a repository to the idler allowlist. The idler acts ONLY on allowlisted repos.",
    { repo: z.string().min(1).describe("Repository name as configured in Clack") },
    async (args) => {
      const config = await loadConfig(sdk);
      if (config.repoAllowlist.includes(args.repo)) {
        return textResult({ ok: true, message: sdk.t("repo_added", { repo: args.repo }) });
      }
      await saveConfig(sdk, { ...config, repoAllowlist: [...config.repoAllowlist, args.repo] });
      return textResult({ ok: true, message: sdk.t("repo_added", { repo: args.repo }) });
    },
  );
}

export function createRemoveRepoTool(sdk: ClackSdk) {
  return tool(
    "remove_idler_repo",
    "Remove a repository from the idler allowlist.",
    { repo: z.string().min(1) },
    async (args) => {
      const config = await loadConfig(sdk);
      if (!config.repoAllowlist.includes(args.repo)) {
        return errorResult(sdk.t("repo_not_found", { repo: args.repo }));
      }
      const repoAllowlist = config.repoAllowlist.filter((r) => r !== args.repo);
      await saveConfig(sdk, { ...config, repoAllowlist });
      return textResult({ ok: true, message: sdk.t("repo_removed", { repo: args.repo }) });
    },
  );
}

export function createAddChannelTool(sdk: ClackSdk) {
  return tool(
    "add_idler_channel",
    "Add a Slack channel to the idler's discovery list (incl. bot-alert channels like #sentry-alerts).",
    { id: z.string().regex(SLACK_CHANNEL_ID, "channel ID must be C…/G…/D…") },
    async (args) => {
      const config = await loadConfig(sdk);
      if (config.sources.channels.includes(args.id)) {
        return textResult({ ok: true, message: sdk.t("channel_added", { id: args.id }) });
      }
      const channels = [...config.sources.channels, args.id];
      await saveConfig(sdk, { ...config, sources: { ...config.sources, channels } });
      return textResult({ ok: true, message: sdk.t("channel_added", { id: args.id }) });
    },
  );
}

export function createRemoveChannelTool(sdk: ClackSdk) {
  return tool(
    "remove_idler_channel",
    "Remove a Slack channel from the idler's discovery list.",
    { id: z.string() },
    async (args) => {
      const config = await loadConfig(sdk);
      if (!config.sources.channels.includes(args.id)) {
        return errorResult(sdk.t("channel_not_found", { id: args.id }));
      }
      const channels = config.sources.channels.filter((c) => c !== args.id);
      await saveConfig(sdk, { ...config, sources: { ...config.sources, channels } });
      return textResult({ ok: true, message: sdk.t("channel_removed", { id: args.id }) });
    },
  );
}

export function createViewIdeasTool(sdk: ClackSdk) {
  return tool(
    "view_idler_ideas",
    "View the full idler ledger (all work units, open and done) for inspection.",
    {},
    async () => {
      const ledger = await loadLedger(sdk);
      return textResult({ count: ledger.ideas.length, ideas: ledger.ideas });
    },
  );
}

export function createClearIdeaTool(sdk: ClackSdk) {
  return tool(
    "clear_idler_idea",
    "Remove a single work unit from the ledger by its key.",
    { key: z.string() },
    async (args) => {
      const ledger = await loadLedger(sdk);
      if (!ledger.ideas.some((u) => u.key === args.key)) {
        return errorResult(sdk.t("idea_not_found", { key: args.key }));
      }
      const ideas = ledger.ideas.filter((u) => u.key !== args.key);
      await saveLedger(sdk, { ...ledger, ideas });
      return textResult({ ok: true, message: sdk.t("idea_cleared", { key: args.key }) });
    },
  );
}
