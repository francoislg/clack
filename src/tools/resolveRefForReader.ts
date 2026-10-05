import type { QueryToolContext } from "./types.js";
import { errorResult } from "./helpers.js";
import {
  accessRequestFrom,
  checkFileAccess,
  FILE_ACCESS_DENIED_MESSAGE,
  type FileAccess,
} from "../slack/requesterAccess.js";
import {
  fileRef,
  mergeRefs,
  messageRef,
  parsedRefId,
  parseSlackRef,
  readerGatesOf,
  type SlackFileRef,
  type SlackRef,
  type SlackRefKind,
} from "../slack/slackRefs.js";
import { MAX_FILE_SIZE } from "../slack/slackFileBase.js";

type ToolError = ReturnType<typeof errorResult>;
type AllowedFileAccess = Extract<FileAccess, { allowed: true }>;

export type ReaderContext = Pick<
  QueryToolContext,
  "slackClient" | "userId" | "role" | "session" | "config" | "availableRefs"
>;

export interface ReaderRefOptions {
  /** Run the requester's access check even when the ref is already registered. */
  alwaysCheckAccess: boolean;
}

export type ReaderRef =
  | {
      ok: true;
      ref: SlackRef;
      /** The List item id the argument itself named (a List URL's `record_id`). */
      itemId?: string;
      /** The access verdict, when this call fetched one. */
      access?: AllowedFileAccess;
    }
  | { ok: false; error: ToolError };

export function notASlackRefMessage(ref: string): string {
  return `"${ref}" is not a Slack reference. Pass a Slack file id (F…) or a Slack URL.`;
}

function article(label: string): string {
  return /^[aeiou]/i.test(label) ? "an" : "a";
}

export function wrongKindMessage(ref: SlackRef): string {
  return `"${ref.id}" is ${article(ref.label)} ${ref.label}: use ${ref.reader}`;
}

function checkKind(
  ref: SlackRef,
  expected: readonly SlackRefKind[],
  rest: { itemId?: string; access?: AllowedFileAccess },
): ReaderRef {
  if (!expected.includes(ref.kind)) return { ok: false, error: errorResult(wrongKindMessage(ref)) };
  return { ok: true, ref, ...rest };
}

/**
 * Turn a reader tool's argument into a `SlackRef` of the kind the reader handles. A message
 * permalink is parse-only. A file id registered in `availableRefs` supplies its kind; otherwise
 * (or always, with `alwaysCheckAccess`) the requester's access is checked, the file is classified
 * from the verdict's facts and registered. A ref of another kind gets the kind table's redirect.
 */
export async function resolveRefForReader(
  ctx: ReaderContext,
  ref: string,
  expected: readonly SlackRefKind[],
  opts: ReaderRefOptions,
): Promise<ReaderRef> {
  const parsed = parseSlackRef(ref);
  if (parsed === undefined) return { ok: false, error: errorResult(notASlackRefMessage(ref)) };

  if (parsed.type === "message") {
    const registered = ctx.availableRefs?.get(parsedRefId(parsed));
    return checkKind(
      registered?.type === "message" ? registered : messageRef(parsed, false),
      expected,
      {},
    );
  }

  const itemId = parsed.itemId !== undefined ? { itemId: parsed.itemId } : {};
  const registered = ctx.availableRefs?.get(parsed.fileId);
  const registeredFile: SlackFileRef | undefined =
    registered?.type === "file" ? registered : undefined;

  if (registeredFile && !opts.alwaysCheckAccess) {
    if (registeredFile.inaccessible) {
      return { ok: false, error: errorResult(FILE_ACCESS_DENIED_MESSAGE) };
    }
    return checkKind(registeredFile, expected, itemId);
  }

  if (!ctx.slackClient) {
    return { ok: false, error: errorResult("Slack client is not available in this context") };
  }
  const access = await checkFileAccess(
    accessRequestFrom({ ...ctx, slackClient: ctx.slackClient }),
    parsed.fileId,
  );
  if (!access.allowed) return { ok: false, error: errorResult(FILE_ACCESS_DENIED_MESSAGE) };

  if (registeredFile && !registeredFile.inaccessible) {
    return checkKind(registeredFile, expected, { ...itemId, access });
  }

  const resolved = fileRef(parsed.fileId, access.facts, readerGatesOf(ctx.config), {
    fromCurrentMessage: false,
    itemId: parsed.itemId,
    tooLarge: access.facts.size !== undefined && access.facts.size > MAX_FILE_SIZE,
  });
  if (ctx.availableRefs) mergeRefs(ctx.availableRefs, [resolved]);
  return checkKind(resolved, expected, { ...itemId, access });
}
