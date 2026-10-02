import type { FilesInfoResponse } from "@slack/web-api";
import type { SessionContext } from "../sessions.js";
import type { AccessRequest } from "./requesterAccess.js";
import type { MockSlackClient } from "./testSlackClient.js";

/** Fixtures shared by the requester-access unit test files. */

export const HOME_TEAM = "T_HOME";
export const PUBLIC = "C_PUBLIC";
export const PUBLIC_2 = "C_PUBLIC_2";
export const PRIVATE = "C_PRIVATE";
export const PRIVATE_2 = "C_PRIVATE_2";
export const PRIVATE_BOT_IN = "C_PRIVATE_BOT_IN";
export const GROUP_DM = "G_MPIM";
export const GROUP_DM_BOT_IN = "G_MPIM_BOT_IN";
export const NO_PRIVACY = "C_NO_PRIVACY";
export const DM = "D_ALICE";

/** The `conversations.info` channel per fixture id. The web-api channel type does not declare
 *  a DM's `user`, so the channels are built apart from the response literal. */
function channelFor(channelId: string, dmUser: string | undefined) {
  switch (channelId) {
    case PUBLIC:
      return { id: PUBLIC, name: "general", is_channel: true, is_private: false };
    case PUBLIC_2:
      return { id: PUBLIC_2, name: "random", is_channel: true, is_private: false };
    case PRIVATE:
      return { id: PRIVATE, name: "secret", is_private: true };
    case PRIVATE_2:
      return { id: PRIVATE_2, name: "secret-2", is_private: true };
    case PRIVATE_BOT_IN:
      return { id: PRIVATE_BOT_IN, name: "ops", is_private: true, is_member: true };
    case GROUP_DM_BOT_IN:
      return {
        id: GROUP_DM_BOT_IN,
        name: "mpdm-a--b--bot-1",
        is_private: true,
        is_mpim: true,
        is_member: true,
      };
    case GROUP_DM:
      return { id: GROUP_DM, name: "mpdm-a--b--c-1", is_private: true, is_mpim: true };
    case NO_PRIVACY:
      return { id: NO_PRIVACY, name: "unknown-privacy" };
    case DM:
      return { id: DM, is_im: true, ...(dmUser ? { user: dmUser } : {}) };
    default:
      return undefined;
  }
}

/** Program `conversations.info` for every fixture conversation; an unlisted id is reported as
 *  not found. `dmUser` is the user the DM fixture belongs to. */
export function setConversations(client: MockSlackClient, dmUser?: string): void {
  client.conversations.info.mockImplementation(async (args) => {
    const channel = args ? channelFor(args.channel, dmUser) : undefined;
    return channel ? { ok: true, channel } : { ok: false, error: "channel_not_found" };
  });
}

export function makeSession(accessGranted?: string[]): SessionContext {
  return {
    sessionId: "SID",
    channelId: "C_THREAD",
    messageTs: "1000.0001",
    threadTs: "1000.0001",
    userId: "U_ALICE",
    trigger: { type: "mentions", userId: "U_ALICE", messageTs: "1000.0001", messageText: "hi" },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: 0,
    createdAt: 0,
    ...(accessGranted ? { accessGranted } : {}),
  };
}

/** A member-role request from U_ALICE, with per-test overrides. */
export function makeRequest(
  client: MockSlackClient,
  overrides: Partial<Omit<AccessRequest, "client">> = {},
): AccessRequest {
  return { client, userId: "U_ALICE", role: "member", ...overrides };
}

/** Program who Slack reports as members of every channel. */
export function setMembers(client: MockSlackClient, ...members: string[]): void {
  client.conversations.members.mockResolvedValue({ ok: true, members });
}

interface RequesterFlags {
  team_id?: string;
  is_restricted?: boolean;
  is_ultra_restricted?: boolean;
  is_stranger?: boolean;
}

/** Program the requester's `users.info` record. */
export function setUser(client: MockSlackClient, user: RequesterFlags): void {
  client.users.info.mockResolvedValue({ ok: true, user: { id: "U_ALICE", ...user } });
}

/** Program the user the DM fixture's `conversations.info` reports. */
export function setDmUser(client: MockSlackClient, user: string): void {
  setConversations(client, user);
}

/** Program the `files.info` record for file F1. */
export function setFile(
  client: MockSlackClient,
  file: NonNullable<FilesInfoResponse["file"]>,
): void {
  client.files.info.mockResolvedValue({ ok: true, file: { id: "F1", ...file } });
}
