import { SLACK_FILE_ID_PATTERN, slackUrlSegments } from "./fileRef.js";

const LIST_ITEM_ID_PATTERN = /^Rec[A-Z0-9]+$/;

export interface ListRef {
  listId: string;
  itemId: string | undefined;
}

/** The List file id (`F…`), and the item id when the URL names one, from a List id or a Slack List URL; undefined for anything else. */
export function parseListRef(ref: string): ListRef | undefined {
  const trimmed = ref.trim();
  if (SLACK_FILE_ID_PATTERN.test(trimmed)) return { listId: trimmed, itemId: undefined };

  const parsed = slackUrlSegments(trimmed);
  if (parsed === undefined || parsed.segments[0] !== "lists") return undefined;

  const listId = [...parsed.segments]
    .reverse()
    .find((segment) => SLACK_FILE_ID_PATTERN.test(segment));
  if (listId === undefined) return undefined;

  const recordId = parsed.url.searchParams.get("record_id");
  const itemId = recordId !== null && LIST_ITEM_ID_PATTERN.test(recordId) ? recordId : undefined;
  return { listId, itemId };
}
