import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { Config, McpServerRegistry } from "../config.js";
import type { SetMcpServersFn } from "../tools/types.js";
import { logger } from "../logger.js";
import { errorMessage } from "../errors.js";
import {
  getConfiguredMcpServerNames as defaultGetConfiguredMcpServerNames,
  loadAlwaysOnMcpServers as defaultLoadAlwaysOnMcpServers,
  loadMcpServer as defaultLoadMcpServer,
  resolveEffectiveRegistry,
} from "../mcp.js";
import { updateSession as defaultUpdateSession } from "../sessions.js";
import type { SessionContext } from "../sessions.js";

/**
 * Centralizes the session's MCP-server state and every call into
 * `Query.setMcpServers`. The single invariant: **every `setMcpServers` call must
 * include `sessionStart ∪ attached`**. The SDK's `setMcpServers` replaces the
 * full non-settings-file server set on each invocation — passing only the newly-
 * attached entries would disconnect the clack MCP (killing `submit_response`,
 * `find_user`, etc.) and every subsequent tool call would fail with "Not connected".
 *
 * Callers do not touch `setMcpServers` directly. `attach_integration` and the
 * resume replay both go through this manager so the invariant lives in one place.
 */
export interface AttachSuccess {
  ok: true;
}

export interface AttachFailure {
  ok: false;
  error: string;
}

export type AttachResult = AttachSuccess | AttachFailure;

export class McpServerManager {
  private attached: Record<string, McpServerConfig> = {};
  private setMcpServersFn?: SetMcpServersFn;

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
  ) {}

  /**
   * Bind the SDK `Query.setMcpServers` once the Query is available. Callers hold
   * the manager reference from before `clackSession(...)` returns, and the SDK's
   * `onQuery` callback fires `bind(query.setMcpServers.bind(query))`.
   */
  bind(fn: SetMcpServersFn): void {
    this.setMcpServersFn = fn;
  }

  isBound(): boolean {
    return this.setMcpServersFn !== undefined;
  }

  knowsServer(name: string): boolean {
    return name in this.registry;
  }

  isAttached(name: string): boolean {
    return name in this.attached;
  }

  /**
   * Pre-populate the attached set without calling `setMcpServers`. Used by the
   * session orchestrator on resume: the CLI's own session-state restore handles
   * re-registering previously-attached servers, so we only need to mirror that
   * state in the manager so `isAttached(…)` stays truthful for duplicate-attach
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

  /**
   * Attach `name` dynamically. Idempotent — if the name is already attached,
   * returns ok without calling setMcpServers.
   */
  async attach(name: string, config: McpServerConfig): Promise<AttachResult> {
    if (this.isAttached(name)) return { ok: true };

    const fn = this.setMcpServersFn;
    if (!fn) {
      return {
        ok: false,
        error: `setMcpServers not yet bound; cannot attach '${name}' at this time`,
      };
    }

    const nextAttached = { ...this.attached, [name]: config };
    const full = { ...this.sessionStart, ...nextAttached };

    try {
      const result = await fn(full);
      const err = result.errors?.[name];
      if (err) return { ok: false, error: err };

      // Log (don't fail) reconnect errors on session-start servers. They were
      // working before this call, so a failure here is worth surfacing — but not
      // the new attach's responsibility.
      for (const [otherName, otherErr] of Object.entries(result.errors ?? {})) {
        if (otherName !== name) {
          logger.warn(
            `setMcpServers reported reconnect error for '${otherName}' during attach of '${name}': ${otherErr}`,
          );
        }
      }

      this.attached = nextAttached;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
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
}

export const defaultMcpSessionSetupDeps: McpSessionSetupDeps = {
  getConfiguredMcpServerNames: defaultGetConfiguredMcpServerNames,
  loadAlwaysOnMcpServers: defaultLoadAlwaysOnMcpServers,
  loadMcpServer: defaultLoadMcpServer,
  updateSession: defaultUpdateSession,
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
}

/**
 * Prepare everything MCP-related for a session: resolve the effective registry,
 * load always-on externals, pre-load persisted attachments from resume, and
 * construct the manager.
 *
 * Callers still own the clack/plugin MCP servers (those are built from the tool
 * context, which depends on the manager). Once the caller knows the full
 * baseline set, it calls `completeSessionStart` to close the loop.
 */
export async function prepareMcpSession(
  session: SessionContext,
  config: Config,
  deps: McpSessionSetupDeps = defaultMcpSessionSetupDeps,
): Promise<McpSessionSetup> {
  const mcpServerNames = deps.getConfiguredMcpServerNames();
  const { registry } = resolveEffectiveRegistry({
    configRegistry: config.mcpServers,
    mcpServerNames,
    githubAutoInjected: mcpServerNames.includes("github"),
  });

  const alwaysOnExternals = (await deps.loadAlwaysOnMcpServers(registry)) ?? {};

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
      if (cfg) resumedAttached[name] = cfg;
      kept.push(name);
    } catch (error) {
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

  const manager = new McpServerManager({}, registry);

  // Seed attached set from resume so isAttached(…) is truthful and Claude's
  // idempotent attach_integration calls short-circuit correctly.
  for (const [name, cfg] of Object.entries(resumedAttached)) {
    manager.seedAttached(name, cfg);
  }

  return { manager, registry, alwaysOnExternals, resumedAttached };
}

/**
 * Finalize the session-start mcpServers set. Combines the always-on externals,
 * the clack + plugin servers the caller built from the tool context, and the
 * resumed attachments. Returns the full map (for `options.mcpServers`) and
 * hydrates the manager's baseline via `hydrateSessionStart`.
 */
export function completeSessionStart(
  setup: McpSessionSetup,
  clackAndPluginServers: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  const baseline = {
    ...setup.alwaysOnExternals,
    ...clackAndPluginServers,
  };
  setup.manager.hydrateSessionStart(baseline);
  return { ...baseline, ...setup.resumedAttached };
}
