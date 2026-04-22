import type { App } from "@slack/bolt";
import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { Config } from "../config.js";
import type { SlackImageFile, SlackFile } from "../slack/slackFileBase.js";
import type { QueryToolContext, WorkerToolContext, DeliverFn } from "./types.js";
import type { McpServerManager } from "../claude/mcpServerManager.js";

export interface BuildQueryContextParams {
  userId: string;
  role: UserRole;
  session: SessionContext;
  config: Config;
  changesWorkflowEnabled: boolean;
  allowScheduledMessages?: boolean;
  slackClient?: App["client"];
  deliver?: DeliverFn;
  availableImages?: Map<string, SlackImageFile>;
  availableFiles?: Map<string, SlackFile>;
  requiredTools?: string[];
  skipConditions?: string;
  /**
   * MCP server lifecycle manager for this session. Owns session-start servers,
   * attached servers, and the effective registry; guarantees the merge invariant
   * on every `setMcpServers` call. Bound to the SDK Query by the orchestrator.
   */
  mcpManager?: McpServerManager;
}

export function buildQueryContext(params: BuildQueryContextParams): QueryToolContext {
  return {
    ...params,
    mode: "query",
    allowScheduledMessages: params.allowScheduledMessages ?? false,
  };
}

export interface BuildWorkerContextParams {
  worktreePath: string;
  branchName: string;
  repoName: string;
  repoUrl: string;
  channelId: string;
  threadTs: string;
  sessionId: string;
  config: Config;
}

export function buildWorkerContext(params: BuildWorkerContextParams): WorkerToolContext {
  return { mode: "worker", ...params };
}
