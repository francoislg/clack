import type { App, BlockAction } from "@slack/bolt";
import { logger } from "../../logger.js";
import { getSession, addRefinement, type SessionContext } from "../../sessions.js";
import { decodeActionValue } from "../blocks.js";
import { activeSessions, type SessionInfo } from "../activeSessions.js";
import { executeAndDeliver, getHandlerClaudeOptions } from "./handlerResponse.js";
import { canRequestChanges } from "../../permissions.js";
import type { AskClaudeOptions, ClaudeResponse } from "../../claude/index.js";
import type { UserRole } from "../../roles.js";

export interface ChoiceDeps {
  decodeActionValue: (value: string) => {
    sessionId: string;
    choiceValue?: string;
    workMode?: boolean;
  };
  restoreSession: (sessionId: string) => Promise<SessionInfo | undefined>;
  getSession: (sessionId: string) => Promise<SessionContext | null>;
  addRefinement: (sessionId: string, text: string) => Promise<SessionContext | null>;
  getHandlerClaudeOptions: (info: SessionInfo) => Promise<AskClaudeOptions>;
  canRequestChanges: (role: UserRole) => boolean;
  executeAndDeliver: (params: {
    client: App["client"];
    session: SessionContext;
    sessionInfo: SessionInfo;
    claudeOptions: AskClaudeOptions;
  }) => Promise<ClaudeResponse>;
}

export const defaultChoiceDeps: ChoiceDeps = {
  decodeActionValue,
  restoreSession: (sessionId: string) => activeSessions.restore(sessionId),
  getSession,
  addRefinement,
  getHandlerClaudeOptions,
  canRequestChanges,
  executeAndDeliver,
};

export function registerChoiceHandler(app: App, deps: ChoiceDeps = defaultChoiceDeps): void {
  app.action<BlockAction>(/^clack_choice_\d+$/, async ({ ack, body, client }) => {
    await ack();

    const rawValue = (body.actions[0] as { value: string }).value;
    const { sessionId, choiceValue, workMode } = deps.decodeActionValue(rawValue);

    if (!choiceValue) {
      logger.error("Choice handler: missing choice value");
      return;
    }

    const sessionInfo = await deps.restoreSession(sessionId);
    if (!sessionInfo) {
      logger.error(`Choice handler: could not restore session ${sessionId}`);
      return;
    }

    const session = await deps.getSession(sessionId);
    if (!session) {
      logger.error(`Choice handler: session ${sessionId} not found`);
      return;
    }

    // Inject the user's choice as a refinement
    await deps.addRefinement(session.sessionId, `The user chose: ${choiceValue}`);
    const updatedSession = (await deps.getSession(session.sessionId))!;

    const claudeOptions = await deps.getHandlerClaudeOptions(sessionInfo);
    const effectiveWorkMode =
      workMode &&
      claudeOptions.changesWorkflowEnabled &&
      deps.canRequestChanges(claudeOptions.role ?? "member");

    await deps.executeAndDeliver({
      client,
      session: updatedSession,
      sessionInfo,
      claudeOptions: { ...claudeOptions, workMode: effectiveWorkMode || false },
    });
  });
}
