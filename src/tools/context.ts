import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { Config } from "../config.js";
import type { ChangeSession } from "../changes/types.js";
import type { ToolContext } from "./types.js";

export interface BuildToolContextParams {
  userId: string;
  role: UserRole;
  session: SessionContext;
  config: Config;
  changesWorkflowEnabled: boolean;
  changeSession?: ChangeSession;
}

export function buildToolContext(params: BuildToolContextParams): ToolContext {
  return {
    userId: params.userId,
    role: params.role,
    session: params.session,
    config: params.config,
    changesWorkflowEnabled: params.changesWorkflowEnabled,
    changeSession: params.changeSession,
  };
}
