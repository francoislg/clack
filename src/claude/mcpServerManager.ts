import { join } from "node:path";
import type { McpServerConfig, McpServerStatus } from "@anthropic-ai/claude-agent-sdk";
import { getDownloadsDir, type Config, type McpServerRegistry } from "../config.js";
import type { McpServerStatusFn, ReconnectMcpServerFn, SetMcpServersFn } from "../tools/types.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import {
  getConfiguredMcpServerNames as defaultGetConfiguredMcpServerNames,
  loadAlwaysOnMcpServers as defaultLoadAlwaysOnMcpServers,
  loadMcpServer as defaultLoadMcpServer,
  resolveEffectiveRegistry,
  resolveSessionPlaceholders,
  resolveSessionPlaceholdersAll,
} from "../mcp.js";
import { ensureOwnerFolder } from "../managedFiles/files.js";
import { getLoadedPluginIntegrations } from "../plugins-core/state.js";
import { updateSession as defaultUpdateSession } from "../sessions.js";
import type { SessionContext } from "../sessions.js";

/** Interval between status re-reads while a server is `pending`. */
const PENDING_SETTLE_INTERVAL_MS = 500;
/** Re-reads before a still-`pending` server counts as a failed attach (about 5 s). */
const PENDING_SETTLE_MAX_READS = 10;

/** `alreadyLive` is true when the server was connected and no SDK action was needed. */
export interface AttachSuccess {
  ok: true;
  alreadyLive: boolean;
}

/**
 * `error` is `<status>: <SDK error text>`, just `<status>` when the SDK gives no text,
 * the SDK / thrown error text alone when the status could not be read or an SDK call
 * threw, or a manager-authored precondition message (no server config for the name,
 * no reconnect fn bound, `setMcpServers` not bound yet).
 */
export interface AttachFailure {
  ok: false;
  error: string;
  retryable: boolean;
}

export type AttachResult = AttachSuccess | AttachFailure;

type ServerStatus = McpServerStatus["status"];

type StatusRead =
  | { kind: "known"; status: ServerStatus; error?: string }
  | { kind: "absent" }
  | { kind: "unknown" };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Log (don't fail) reconnect errors `setMcpServers` reports for servers other than
 * `name`. They were working before this call, so a failure is worth surfacing — but
 * not this attach's responsibility.
 */
function logOtherServerErrors(name: string, errors: Record<string, string> | undefined): void {
  for (const [otherName, otherErr] of Object.entries(errors ?? {})) {
    if (otherName !== name) {
      logger.warn(
        `setMcpServers reported reconnect error for '${otherName}' during attach of '${name}': ${otherErr}`,
      );
    }
  }
}

/** No attach retry changes a server that needs auth or is disabled. */
function isRetryableStatus(status: string): boolean {
  return status !== "needs-auth" && status !== "disabled";
}

function statusFailure(status: string, error?: string): AttachFailure {
  return {
    ok: false,
    error: error ? `${status}: ${error}` : status,
    retryable: isRetryableStatus(status),
  };
}

/**
 * Centralizes the session's MCP-server state and every call into
 * `Query.setMcpServers`. The single invariant: **every `setMcpServers` call must
 * include `sessionStart ∪ attached`**. The SDK's `setMcpServers` replaces the
 * full non-settings-file server set on each invocation — passing only the newly-
 * attached entries would disconnect the clack MCP (killing `submit_response`,
 * `find_user`, etc.) and every subsequent tool call would fail with "Not connected".
 *
 * Liveness comes from the SDK's `mcpServerStatus()`, not from the manager's sets:
 * `attach` succeeds when the SDK reports the server `connected`. When the status
 * can't be read, it succeeds on a registered name's registration alone (no SDK call),
 * or on the result of the SDK call it makes for any other name, logging a warning.
 * A server is recorded in `attached` only when the attach succeeds.
 *
 * Callers do not touch `setMcpServers` directly. `attach_integration` and the
 * resume replay both go through this manager so the invariant lives in one place.
 */
export class McpServerManager {
  private attached: Record<string, McpServerConfig> = {};
  /** Topics `attach_integration` attached mid-session, instructions-only ones included. */
  private topicsAttached = new Set<string>();
  private setMcpServersFn?: SetMcpServersFn;
  private mcpServerStatusFn?: McpServerStatusFn;
  private reconnectMcpServerFn?: ReconnectMcpServerFn;
  /**
   * Tail of the attach chain. `setMcpServers` replaces the full server set and each
   * payload snapshots `attached`, so overlapping attaches would drop each other's
   * server — every attach waits for the previous one to finish.
   */
  private attachQueue: Promise<AttachResult | undefined> = Promise.resolve(undefined);
  /**
   * Per-session map of integration name → SDK server config for plugin-self-declared
   * integrations (those with gated plugin tools but no `data/mcp.json` entry).
   * Populated by `buildQueryTools` at session start, consumed by `attach_integration`
   * when `loadMcpServer` returns null so the same `attach()` path can be used.
   */
  private integrationServers: Record<string, McpServerConfig> = {};

  constructor(
    /**
     * Servers passed to `options.mcpServers` at session start (clack MCP, plugins,
     * always-on externals). Must be merged into every `setMcpServers` call.
     * Populated via `hydrateSessionStart(…)` once the caller assembles the full
     * baseline (clack + plugins can only be built from the tool context, which
     * depends on the manager — so the manager is constructed with an empty
     * baseline and filled in later).
     */
    private readonly sessionStart: Record<string, McpServerConfig>,
    /** Effective MCP registry for this session. Public because callers need to
     *  inspect `registry[name].description` when rendering errors. */
    public readonly registry: McpServerRegistry,
    /** Per-session downloads folder substituted into dynamically attached configs. */
    private readonly sessionDownloadsDir?: string,
  ) {}

  /**
   * Bind the SDK `Query.setMcpServers`, `Query.mcpServerStatus` and
   * `Query.reconnectMcpServer` once the Query is available. Callers hold the
   * manager reference from before `clackSession(...)` returns, and the SDK's
   * `onQuery` callback binds all three.
   *
   * The status and reconnect fns are optional. Without a status fn every status
   * read is unknown and `attach` falls back to the SDK call's own result; without
   * a reconnect fn a `failed` server cannot be retried.
   */
  bind(
    setMcpServers: SetMcpServersFn,
    mcpServerStatus?: McpServerStatusFn,
    reconnectMcpServer?: ReconnectMcpServerFn,
  ): void {
    this.setMcpServersFn = setMcpServers;
    this.mcpServerStatusFn = mcpServerStatus;
    this.reconnectMcpServerFn = reconnectMcpServer;
  }

  isBound(): boolean {
    return this.setMcpServersFn !== undefined;
  }

  knowsServer(name: string): boolean {
    return name in this.registry;
  }

  /** True if `name` is part of the session-start baseline (e.g. an always-on
   *  external loaded at boot) — the static set passed to `options.mcpServers`,
   *  as opposed to the dynamic additions made via `attach()`. */
  isInSessionStart(name: string): boolean {
    return name in this.sessionStart;
  }

  /** True if `name` is registered with the SDK by the session start or an attach. */
  isRegistered(name: string): boolean {
    return name in this.attached || name in this.sessionStart;
  }

  recordTopicAttached(name: string): void {
    this.topicsAttached.add(name);
  }

  isTopicAttached(name: string): boolean {
    return this.topicsAttached.has(name);
  }

  /** The SDK's entry for `name`, `absent` when it lists none, `unknown` when the status can't be read. */
  private async readStatus(name: string): Promise<StatusRead> {
    const fn = this.mcpServerStatusFn;
    if (!fn) {
      logger.warn(`mcpServerStatus not bound; status of '${name}' is unknown`);
      return { kind: "unknown" };
    }
    try {
      const entry = (await fn()).find((s) => s.name === name);
      if (!entry) return { kind: "absent" };
      return { kind: "known", status: entry.status, error: entry.error };
    } catch (error) {
      logger.warn(`mcpServerStatus read failed for '${name}': ${errorMessage(error)}`);
      return { kind: "unknown" };
    }
  }

  /** Re-read a `pending` server until it leaves `pending` or the read budget runs out. */
  private async settle(name: string, read: StatusRead): Promise<StatusRead> {
    let current = read;
    for (
      let reads = 0;
      current.kind === "known" && current.status === "pending" && reads < PENDING_SETTLE_MAX_READS;
      reads++
    ) {
      await sleep(PENDING_SETTLE_INTERVAL_MS);
      current = await this.readStatus(name);
    }
    return current;
  }

  private resolveConfig(rawConfig: McpServerConfig): McpServerConfig {
    return this.sessionDownloadsDir === undefined
      ? rawConfig
      : resolveSessionPlaceholders(rawConfig, this.sessionDownloadsDir);
  }

  /** Record a connected server the manager doesn't hold yet, when its config is known. */
  private recordIfUnregistered(name: string, rawConfig: McpServerConfig | undefined): void {
    if (this.isRegistered(name) || !rawConfig) return;
    this.attached[name] = this.resolveConfig(rawConfig);
  }

  /**
   * Pre-populate the attached set without calling `setMcpServers`. Used by the
   * session orchestrator on resume: the CLI's own session-state restore handles
   * re-registering previously-attached servers, so we only need to mirror that
   * state in the manager so `isRegistered(…)` stays truthful for duplicate-attach
   * detection. Safe to call before `bind(…)` — no SDK interaction.
   */
  seedAttached(name: string, config: McpServerConfig): void {
    this.attached[name] = config;
  }

  /**
   * Populate the session-start baseline after construction. The manager is built
   * before the clack + plugin MCP servers exist (because those need the tool
   * context, which needs the manager), so the factory constructs the manager
   * with an empty baseline and then calls this once the baseline is known.
   * Mutates in place — later `attach` calls pick up the baseline automatically.
   */
  hydrateSessionStart(servers: Record<string, McpServerConfig>): void {
    for (const [k, v] of Object.entries(servers)) {
      this.sessionStart[k] = v;
    }
  }

  knownNames(): string[] {
    return Object.keys(this.registry).sort();
  }

  attachedNames(): string[] {
    return Object.keys(this.attached);
  }

  registerIntegrationServer(name: string, config: McpServerConfig): void {
    this.integrationServers[name] = config;
  }

  getIntegrationServer(name: string): McpServerConfig | undefined {
    return this.integrationServers[name];
  }

  /**
   * Make `name` live and report whether it is. Reads the SDK's status for it; a
   * `pending` status settles first and is then handled as the status it settles into:
   * `connected` → nothing; still `pending` → retryable failure; `failed` →
   * `reconnectMcpServer`; `needs-auth` / `disabled` → fail, not retryable; absent →
   * `setMcpServers(sessionStart ∪ attached ∪ {name})`; unreadable → success for a
   * registered name with no SDK call, otherwise `setMcpServers` decided by its own
   * result. After an SDK action it re-reads and settles the status, and succeeds only
   * on `connected` (or on the action's result when the status can't be read).
   * `rawConfig` is needed only when the manager holds no config for `name`. A
   * session-start server is never recorded in `attached`, and a failed attach records
   * nothing. Attaches run one at a time per manager.
   */
  attach(name: string, rawConfig?: McpServerConfig): Promise<AttachResult> {
    const run = this.attachQueue.then(() => this.attachNow(name, rawConfig));
    this.attachQueue = run.catch(() => undefined);
    return run;
  }

  private async attachNow(name: string, rawConfig?: McpServerConfig): Promise<AttachResult> {
    const before = await this.settle(name, await this.readStatus(name));
    if (before.kind === "unknown") {
      if (this.isRegistered(name)) return { ok: true, alreadyLive: true };
      return this.sendServers(name, rawConfig, false);
    }
    if (before.kind === "absent") return this.sendServers(name, rawConfig, true);

    switch (before.status) {
      case "connected":
        this.recordIfUnregistered(name, rawConfig);
        return { ok: true, alreadyLive: true };
      case "failed":
        return this.reconnect(name, rawConfig);
      default:
        return statusFailure(before.status, before.error);
    }
  }

  /**
   * Classify the settled status read after an SDK action on `name`. `fallbackError` is
   * the SDK's own error for the name: with the status unreadable it fails the attach,
   * and without it the action's result is trusted.
   */
  private finishAfterAction(
    name: string,
    after: StatusRead,
    record: () => void,
    fallbackError?: string,
  ): AttachResult {
    if (after.kind === "unknown") {
      if (fallbackError) return { ok: false, error: fallbackError, retryable: true };
      logger.warn(`Status of '${name}' unreadable after the SDK call; trusting its result`);
      record();
      return { ok: true, alreadyLive: false };
    }
    if (after.kind === "absent") return statusFailure("absent", fallbackError);
    if (after.status !== "connected") {
      return statusFailure(after.status, after.error ?? fallbackError);
    }
    record();
    return { ok: true, alreadyLive: false };
  }

  private async reconnect(
    name: string,
    rawConfig: McpServerConfig | undefined,
  ): Promise<AttachResult> {
    const fn = this.reconnectMcpServerFn;
    if (!fn) {
      return { ok: false, error: `reconnect not available for '${name}'`, retryable: true };
    }
    try {
      await fn(name);
    } catch (error) {
      return { ok: false, error: errorMessage(error), retryable: true };
    }

    const after = await this.settle(name, await this.readStatus(name));
    return this.finishAfterAction(name, after, () => this.recordIfUnregistered(name, rawConfig));
  }

  /**
   * Register `name` through `setMcpServers`. With `statusReadable` false the SDK's
   * error for the name alone decides; otherwise the settled status after the call does.
   */
  private async sendServers(
    name: string,
    rawConfig: McpServerConfig | undefined,
    statusReadable: boolean,
  ): Promise<AttachResult> {
    const config = rawConfig
      ? this.resolveConfig(rawConfig)
      : (this.attached[name] ?? this.sessionStart[name]);
    if (!config) {
      return { ok: false, error: `no server config for '${name}'`, retryable: false };
    }

    const fn = this.setMcpServersFn;
    if (!fn) {
      return {
        ok: false,
        error: `setMcpServers not yet bound; cannot attach '${name}' at this time`,
        retryable: true,
      };
    }

    let sdkError: string | undefined;
    try {
      const result = await fn({ ...this.sessionStart, ...this.attached, [name]: config });
      sdkError = result.errors?.[name];
      logOtherServerErrors(name, result.errors);
    } catch (error) {
      return { ok: false, error: errorMessage(error), retryable: true };
    }

    const after: StatusRead = statusReadable
      ? await this.settle(name, await this.readStatus(name))
      : { kind: "unknown" };
    return this.finishAfterAction(name, after, () => this.record(name, config), sdkError);
  }

  private record(name: string, config: McpServerConfig): void {
    if (name in this.sessionStart) return;
    this.attached[name] = config;
  }
}

// ---------------------------------------------------------------------------
// Session-setup factory
// ---------------------------------------------------------------------------

export interface McpSessionSetupDeps {
  getConfiguredMcpServerNames: typeof defaultGetConfiguredMcpServerNames;
  loadAlwaysOnMcpServers: typeof defaultLoadAlwaysOnMcpServers;
  loadMcpServer: typeof defaultLoadMcpServer;
  updateSession: typeof defaultUpdateSession;
  ensureSessionDownloadsDir: (sessionId: string) => Promise<string>;
}

export const defaultMcpSessionSetupDeps: McpSessionSetupDeps = {
  getConfiguredMcpServerNames: defaultGetConfiguredMcpServerNames,
  loadAlwaysOnMcpServers: defaultLoadAlwaysOnMcpServers,
  loadMcpServer: defaultLoadMcpServer,
  updateSession: defaultUpdateSession,
  ensureSessionDownloadsDir: (id) => ensureOwnerFolder("downloads", id),
};

export interface McpSessionSetup {
  /** Manager owning the session's MCP-server lifecycle. */
  manager: McpServerManager;
  /** Effective registry for this session (used by the prompt builder + catalog). */
  registry: McpServerRegistry;
  /** Always-on external servers loaded from mcp.json. Empty object if none qualify. */
  alwaysOnExternals: Record<string, McpServerConfig>;
  /**
   * Resumed-attachment configs pre-loaded from persisted `session.attachedIntegrations`.
   * Must be merged into `options.mcpServers` at session start so the CLI's restored
   * session state matches `--mcp-config` exactly — otherwise the overlap between the
   * two registers the same servers twice and the API rejects with "tools: Tool names
   * must be unique".
   */
  resumedAttached: Record<string, McpServerConfig>;
  /**
   * Configs for pre-attached topics that name an external MCP server, in topic-list order.
   * Merged into the session-start baseline so their tools are in the first turn's tool list.
   */
  preAttached: Record<string, McpServerConfig>;
}

/**
 * Prepare everything MCP-related for a session: resolve the effective registry,
 * load always-on externals, pre-load persisted attachments from resume and the
 * external servers named by `preAttachedTopics`, and construct the manager.
 *
 * Callers still own the clack/plugin MCP servers (those are built from the tool
 * context, which depends on the manager). Once the caller knows the full
 * baseline set, it calls `completeSessionStart` to close the loop.
 */
export async function prepareMcpSession(
  session: SessionContext,
  config: Config,
  preAttachedTopics: readonly string[] = [],
  deps: McpSessionSetupDeps = defaultMcpSessionSetupDeps,
): Promise<McpSessionSetup> {
  const mcpServerNames = deps.getConfiguredMcpServerNames();
  const { registry } = resolveEffectiveRegistry({
    configRegistry: config.mcpServers,
    mcpServerNames,
    githubAutoInjected: mcpServerNames.includes("github"),
    pluginIntegrations: getLoadedPluginIntegrations(),
  });

  let downloadsDir: string;
  try {
    downloadsDir = await deps.ensureSessionDownloadsDir(session.sessionId);
  } catch (error) {
    // A missing folder only affects servers that write exports; never block the session on it.
    downloadsDir = join(getDownloadsDir(), session.sessionId);
    logger.warn(
      `Could not create the session downloads folder ${downloadsDir}: ${errorMessage(error)}`,
    );
  }
  const alwaysOnExternals = resolveSessionPlaceholdersAll(
    (await deps.loadAlwaysOnMcpServers(registry)) ?? {},
    downloadsDir,
  );

  // Pre-load persisted attachments so they land in `options.mcpServers` at session
  // start. This avoids a delta between the CLI's restored session state and the
  // `--mcp-config` passed on resume, which was causing duplicate tool registrations
  // and the "tools: Tool names must be unique" API error on every resume turn.
  const persisted = session.attachedIntegrations ?? [];
  const resumedAttached: Record<string, McpServerConfig> = {};
  const stale: string[] = [];
  const kept: string[] = [];
  for (const name of persisted) {
    if (!(name in registry)) {
      stale.push(name);
      continue;
    }
    try {
      const cfg = await deps.loadMcpServer(name);
      if (cfg) resumedAttached[name] = resolveSessionPlaceholders(cfg, downloadsDir);
      kept.push(name);
    } catch (error) {
      // Still registered, so it stays persisted: a stale-name rewrite must not drop it.
      kept.push(name);
      logger.warn(
        `Failed to pre-load attached integration '${name}' on resume: ${errorMessage(error)}`,
      );
    }
  }
  if (stale.length > 0) {
    logger.warn(
      `Session ${session.sessionId}: dropping stale attached integrations no longer in the registry: ${stale.join(", ")}`,
    );
    deps
      .updateSession(session.sessionId, { attachedIntegrations: kept })
      .catch((err) => logger.warn(`Failed to persist stale-attach cleanup: ${errorMessage(err)}`));
  }

  // A pre-attached topic that names an external `mcp.json` server loads that server with
  // the session. Other names resolve to nothing here: built-in and plugin topics stay
  // instructions-only, and plugin on-demand servers load in `buildClackTools`.
  const preAttached: Record<string, McpServerConfig> = {};
  for (const name of preAttachedTopics) {
    if (!(name in registry) || name in alwaysOnExternals || name in resumedAttached) continue;
    try {
      const cfg = await deps.loadMcpServer(name);
      if (cfg) preAttached[name] = resolveSessionPlaceholders(cfg, downloadsDir);
    } catch (error) {
      logger.warn(
        `Failed to pre-load MCP server for pre-attached topic '${name}': ${errorMessage(error)}`,
      );
    }
  }

  const manager = new McpServerManager({}, registry, downloadsDir);

  // Seed attached set from resume so isRegistered(…) is truthful and Claude's
  // idempotent attach_integration calls short-circuit correctly.
  for (const [name, cfg] of Object.entries(resumedAttached)) {
    manager.seedAttached(name, cfg);
  }

  return { manager, registry, alwaysOnExternals, resumedAttached, preAttached };
}

/**
 * Finalize the session-start mcpServers set. Combines the always-on externals, the
 * pre-attached topic servers, the clack + plugin servers the caller built from the tool
 * context, and the resumed attachments. Returns the full map (for `options.mcpServers`) and
 * hydrates the manager's baseline via `hydrateSessionStart`.
 */
export function completeSessionStart(
  setup: McpSessionSetup,
  clackAndPluginServers: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  const baseline = {
    ...setup.alwaysOnExternals,
    ...setup.preAttached,
    ...clackAndPluginServers,
  };
  setup.manager.hydrateSessionStart(baseline);
  return { ...baseline, ...setup.resumedAttached };
}
