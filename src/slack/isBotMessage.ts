/**
 * Shared bot-message predicate: a message authored by any bot (a present `bot_id`, the
 * `bot_message` subtype) or by Clack itself never counts as human activity. Used by the
 * investigations drain and follow-event tee so the checks stay in sync.
 */
export interface BotMessageFields {
  userId?: string;
  botId?: string;
  subtype?: string;
  /** Clack's own bot user id, when known. */
  botUserId?: string;
}

export function isBotMessage(fields: BotMessageFields): boolean {
  return (
    fields.botId != null ||
    fields.subtype === "bot_message" ||
    (fields.botUserId != null && fields.userId === fields.botUserId)
  );
}
