import type { App } from "@slack/bolt";
import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { Config } from "../config.js";
import type { SlackImageFile } from "../slack/imageExtractor.js";
import type { QueryToolContext, WorkerToolContext, DeliverFn } from "./types.js";

export interface BuildQueryContextParams {
  userId: string;
  role: UserRole;
  session: SessionContext;
  config: Config;
  changesWorkflowEnabled: boolean;
  slackClient?: App["client"];
  deliver?: DeliverFn;
  availableImages?: Map<string, SlackImageFile>;
}

export function buildQueryContext(params: BuildQueryContextParams): QueryToolContext {
  return { mode: "query", ...params };
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
