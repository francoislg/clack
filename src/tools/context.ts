import type { App } from "@slack/bolt";
import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { Config } from "../config.js";
import type { QueryToolContext, WorkerToolContext, DeliverFn } from "./types.js";

export interface BuildQueryContextParams {
  userId: string;
  role: UserRole;
  session: SessionContext;
  config: Config;
  changesWorkflowEnabled: boolean;
  slackClient?: App["client"];
  deliver?: DeliverFn;
}

export function buildQueryContext(params: BuildQueryContextParams): QueryToolContext {
  return {
    mode: "query",
    userId: params.userId,
    role: params.role,
    session: params.session,
    config: params.config,
    changesWorkflowEnabled: params.changesWorkflowEnabled,
    slackClient: params.slackClient,
    deliver: params.deliver,
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
  return {
    mode: "worker",
    worktreePath: params.worktreePath,
    branchName: params.branchName,
    repoName: params.repoName,
    repoUrl: params.repoUrl,
    channelId: params.channelId,
    threadTs: params.threadTs,
    sessionId: params.sessionId,
    config: params.config,
  };
}
