import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { classifyMimeType } from "./fileExtractor.js";
import { SLACK_FILE_ID_PATTERN, slackUrlSegments } from "./fileRef.js";
import { checkFileAccess, type AccessRequest, type FileFacts } from "./requesterAccess.js";
import { IMAGE_MIME_TYPES, MAX_FILE_SIZE, type SlackFileBase } from "./slackFileBase.js";

/**
 * One resolver for internal Slack references (files, Lists, canvases, message permalinks):
 * parse a tool argument or free text, gather each file's facts (from the attachment itself or
 * from the requester's access check), and classify it with the ordered kind table.
 */

/** At most this many distinct references are taken from one input. */
export const MAX_REFS_PER_INPUT = 10;

const LIST_ITEM_ID_PATTERN = /^Rec[A-Z0-9]+$/;
const CHANNEL_ID_PATTERN = /^[CGD][A-Z0-9]+$/;
/** A permalink's message segment: `p` + the ts digits without the dot (10 + 6). */
const PERMALINK_TS_PATTERN = /^p\d{16}$/;

/** The strict file-id pattern, unanchored and bounded by non-word characters, for free text. */
const BARE_FILE_ID_PATTERN = new RegExp(
  `(?<![A-Za-z0-9_])${SLACK_FILE_ID_PATTERN.source.replace(/^\^/, "").replace(/\$$/, "")}(?![A-Za-z0-9_])`,
  "g",
);

/** A URL inside Slack's `<url|label>` / `<url>` markup (group 1), or a plain URL (group 2). */
const URL_IN_TEXT_PATTERN = /<(https?:\/\/[^|>\s]+)(?:\|[^>]*)?>|(https?:\/\/[^\s<>|]+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;
const SLACK_LINK_MARKUP = /^<(https?:\/\/[^|>\s]+)(?:\|[^>]*)?>$/;

export type ParsedSlackRef =
  | { type: "file"; fileId: string; itemId?: string }
  | { type: "message"; channelId: string; ts: string; threadTs?: string };

export type SlackRefKind = "message" | "list" | "canvas" | "image" | "document" | "file";

export type SlackFeatureMode = "off" | "read" | "write";

/** Which optional reader tools are registered under the live config. */
export interface ReaderGates {
  listsMode: SlackFeatureMode;
  canvasesMode: SlackFeatureMode;
}

/** The reader gates of the live config: `lists.mode` and `canvases.mode`, absent ≡ `"off"`. */
export function readerGatesOf(config: Pick<Config, "lists" | "canvases">): ReaderGates {
  return {
    listsMode: config.lists?.mode ?? "off",
    canvasesMode: config.canvases?.mode ?? "off",
  };
}

export interface RefKind {
  kind: SlackRefKind;
  label(facts: FileFacts): string;
  matches(facts: FileFacts): boolean;
  /** The reader tool's name, or null when it isn't registered (the ref falls to the next kind). */
  reader(gates: ReaderGates): string | null;
  mustOpen: boolean;
}

interface SlackRefBase {
  id: string;
  kind: SlackRefKind;
  label: string;
  reader: string;
  mustOpen: boolean;
  fromCurrentMessage: boolean;
}

export interface SlackFileRef extends SlackRefBase {
  type: "file";
  kind: Exclude<SlackRefKind, "message">;
  name?: string;
  facts?: FileFacts;
  itemId?: string;
  /** The requester cannot see this file: no name or facts are kept, and it is never readable. */
  inaccessible?: boolean;
  tooLarge?: boolean;
}

export interface SlackMessageRef extends SlackRefBase {
  type: "message";
  kind: "message";
  channelId: string;
  ts: string;
  threadTs?: string;
}

export type SlackRef = SlackFileRef | SlackMessageRef;

const VIEW_SLACK_FILE = "view_slack_file";

function isDocumentMimetype(mimetype: string | undefined): boolean {
  if (mimetype === undefined) return false;
  const tier = classifyMimeType(mimetype);
  return tier === "pdf" || tier === "text";
}

/** Message permalinks are recognized by the parser, never by file facts. */
const MESSAGE_KIND = {
  kind: "message",
  label: () => "Slack message",
  matches: () => false,
  reader: () => "fetch_slack_message",
  mustOpen: false,
} satisfies RefKind;

/** The kind table, checked in order; `file` is the catch-all. */
export const REF_KINDS: readonly RefKind[] = [
  MESSAGE_KIND,
  {
    kind: "list",
    label: () => "Slack List",
    matches: (facts) =>
      facts.filetype === "list" || facts.mimetype === "application/vnd.slack-list",
    reader: (gates) => (gates.listsMode === "off" ? null : "read_list"),
    mustOpen: false,
  },
  {
    kind: "canvas",
    label: () => "Canvas",
    matches: (facts) =>
      facts.filetype === "quip" || facts.mimetype === "application/vnd.slack-docs",
    reader: (gates) => (gates.canvasesMode === "off" ? null : "read_canvas"),
    mustOpen: false,
  },
  {
    kind: "image",
    label: () => "Image",
    matches: (facts) => facts.mimetype !== undefined && IMAGE_MIME_TYPES.has(facts.mimetype),
    reader: () => VIEW_SLACK_FILE,
    mustOpen: true,
  },
  {
    kind: "document",
    label: (facts) => facts.prettyType ?? "Document",
    matches: (facts) => isDocumentMimetype(facts.mimetype),
    reader: () => VIEW_SLACK_FILE,
    mustOpen: true,
  },
  {
    kind: "file",
    label: (facts) => facts.prettyType ?? facts.mimetype ?? "File",
    matches: () => true,
    reader: () => VIEW_SLACK_FILE,
    mustOpen: false,
  },
];

export interface FileClassification {
  kind: Exclude<SlackRefKind, "message">;
  label: string;
  reader: string;
  mustOpen: boolean;
}

/** The first file kind that matches the facts and whose reader is registered. */
export function classifyFile(facts: FileFacts, gates: ReaderGates): FileClassification {
  for (const entry of REF_KINDS) {
    if (entry.kind === "message" || !entry.matches(facts)) continue;
    const reader = entry.reader(gates);
    if (reader === null) continue;
    return { kind: entry.kind, label: entry.label(facts), reader, mustOpen: entry.mustOpen };
  }
  throw new Error("slackRefs: the kind table has no catch-all");
}

/** Whether a file is an image, by the kind table's `image` matcher. Needs no config. */
export function isImageFile(file: { mimetype: string }): boolean {
  return REF_KINDS.some((entry) => entry.kind === "image" && entry.matches(file));
}

function fileIdAt(segments: string[], index: number): string | undefined {
  const candidate = segments[index];
  return candidate !== undefined && SLACK_FILE_ID_PATTERN.test(candidate) ? candidate : undefined;
}

function parseListUrl(segments: string[], url: URL): ParsedSlackRef | undefined {
  const fileId = fileIdAt(segments, 2);
  if (!fileId) return undefined;
  const recordId = url.searchParams.get("record_id");
  return recordId !== null && LIST_ITEM_ID_PATTERN.test(recordId)
    ? { type: "file", fileId, itemId: recordId }
    : { type: "file", fileId };
}

function parsePermalink(segments: string[], url: URL): ParsedSlackRef | undefined {
  const [, channelId, messageSegment] = segments;
  if (segments.length !== 3 || channelId === undefined || messageSegment === undefined) {
    return undefined;
  }
  if (!CHANNEL_ID_PATTERN.test(channelId) || !PERMALINK_TS_PATTERN.test(messageSegment)) {
    return undefined;
  }
  const ts = `${messageSegment.slice(1, 11)}.${messageSegment.slice(11)}`;
  const threadTs = url.searchParams.get("thread_ts");
  return threadTs
    ? { type: "message", channelId, ts, threadTs }
    : { type: "message", channelId, ts };
}

function parseSlackUrl(ref: string): ParsedSlackRef | undefined {
  const parsed = slackUrlSegments(ref.replaceAll("&amp;", "&"));
  if (parsed === undefined) return undefined;
  const { segments, url } = parsed;

  switch (segments[0]) {
    case "files":
    case "docs": {
      const fileId = fileIdAt(segments, 2);
      return fileId ? { type: "file", fileId } : undefined;
    }
    case "canvas": {
      const fileId = fileIdAt(segments, 1);
      return fileId ? { type: "file", fileId } : undefined;
    }
    case "lists":
      return parseListUrl(segments, url);
    case "archives":
      return parsePermalink(segments, url);
    default:
      return undefined;
  }
}

/** One tool argument: a bare file id, a Slack URL, or a Slack URL in `<url|label>` markup. */
export function parseSlackRef(ref: string): ParsedSlackRef | undefined {
  const trimmed = ref.trim();
  if (SLACK_FILE_ID_PATTERN.test(trimmed)) return { type: "file", fileId: trimmed };
  const markup = SLACK_LINK_MARKUP.exec(trimmed);
  return parseSlackUrl(markup ? markup[1] : trimmed);
}

/** The registry key of a parsed ref: the file id, or `<channel>:<ts>` for a message. */
export function parsedRefId(ref: ParsedSlackRef): string {
  return ref.type === "file" ? ref.fileId : `${ref.channelId}:${ref.ts}`;
}

/** Every reference in free text, in order of appearance, deduped by id and capped. */
export function parseSlackRefs(text: string): ParsedSlackRef[] {
  const found: { index: number; ref: ParsedSlackRef }[] = [];
  let remainder = text;

  for (const match of text.matchAll(URL_IN_TEXT_PATTERN)) {
    // Blank out every URL so an id inside a non-Slack URL is not read as a bare id.
    remainder =
      remainder.slice(0, match.index) +
      " ".repeat(match[0].length) +
      remainder.slice(match.index + match[0].length);
    const url = match[1] ?? match[2].replace(TRAILING_PUNCTUATION, "");
    const ref = parseSlackUrl(url);
    if (ref) found.push({ index: match.index, ref });
  }
  for (const match of remainder.matchAll(BARE_FILE_ID_PATTERN)) {
    found.push({ index: match.index, ref: { type: "file", fileId: match[0] } });
  }
  found.sort((a, b) => a.index - b.index);

  const byId = new Map<string, ParsedSlackRef>();
  for (const { ref } of found) {
    const id = parsedRefId(ref);
    if (!byId.has(id)) byId.set(id, ref);
  }
  const refs = [...byId.values()];
  if (refs.length > MAX_REFS_PER_INPUT) {
    logger.warn(
      `slackRefs: dropped ${refs.length - MAX_REFS_PER_INPUT} Slack reference(s) beyond the cap of ${MAX_REFS_PER_INPUT} per input`,
    );
  }
  return refs.slice(0, MAX_REFS_PER_INPUT);
}

function factsOfAttachment(file: SlackFileBase): FileFacts {
  return {
    filetype: file.filetype,
    prettyType: file.pretty_type,
    name: file.name,
    title: file.title,
    mimetype: file.mimetype,
    size: file.size,
    urlPrivate: file.url_private,
  };
}

export interface FileRefOptions {
  fromCurrentMessage: boolean;
  itemId?: string;
  tooLarge: boolean;
}

/** A file ref classified from its facts with the kind table. */
export function fileRef(
  id: string,
  facts: FileFacts,
  gates: ReaderGates,
  options: FileRefOptions,
): SlackFileRef {
  const classification = classifyFile(facts, gates);
  // A canvas's or List's `name` is a file-safe slug that reads like a path; its title is its name.
  const name =
    classification.kind === "canvas" || classification.kind === "list"
      ? (facts.title ?? facts.name)
      : (facts.name ?? facts.title);
  return {
    type: "file",
    id,
    ...classification,
    ...(name !== undefined && { name }),
    facts,
    ...(options.itemId !== undefined && { itemId: options.itemId }),
    ...(options.tooLarge && { tooLarge: true }),
    fromCurrentMessage: options.fromCurrentMessage,
  };
}

function inaccessibleRef(
  fileId: string,
  gates: ReaderGates,
  fromCurrentMessage: boolean,
): SlackFileRef {
  return {
    type: "file",
    id: fileId,
    ...classifyFile({}, gates),
    label: "Slack file",
    inaccessible: true,
    fromCurrentMessage,
  };
}

export function messageRef(
  ref: Extract<ParsedSlackRef, { type: "message" }>,
  fromCurrentMessage: boolean,
): SlackMessageRef {
  return {
    type: "message",
    id: parsedRefId(ref),
    kind: "message",
    label: MESSAGE_KIND.label(),
    reader: MESSAGE_KIND.reader(),
    mustOpen: MESSAGE_KIND.mustOpen,
    channelId: ref.channelId,
    ts: ref.ts,
    ...(ref.threadTs !== undefined && { threadTs: ref.threadTs }),
    fromCurrentMessage,
  };
}

export interface ResolveSlackRefsInput {
  text?: string;
  files?: SlackFileBase[];
  fromCurrentMessage: boolean;
  gates: ReaderGates;
}

async function resolveParsedRef(
  req: AccessRequest,
  ref: ParsedSlackRef,
  attached: Map<string, SlackRef>,
  input: ResolveSlackRefsInput,
): Promise<SlackRef> {
  const { fromCurrentMessage, gates } = input;
  if (ref.type === "message") return messageRef(ref, fromCurrentMessage);

  const known = attached.get(ref.fileId);
  if (known?.type === "file") {
    return ref.itemId !== undefined && known.itemId === undefined
      ? { ...known, itemId: ref.itemId }
      : known;
  }
  const access = await checkFileAccess(req, ref.fileId);
  if (!access.allowed) return inaccessibleRef(ref.fileId, gates, fromCurrentMessage);
  return fileRef(ref.fileId, access.facts, gates, {
    fromCurrentMessage,
    itemId: ref.itemId,
    tooLarge: access.facts.size !== undefined && access.facts.size > MAX_FILE_SIZE,
  });
}

/**
 * Resolve one input's references. Attached files are classified from their own facts with no
 * Slack call; a file ref in text that no attachment covers goes through `checkFileAccess` once
 * (an allowance is classified from its facts, a denial yields an inaccessible ref with no name
 * or facts); message permalinks are parse-only.
 */
export async function resolveSlackRefs(
  req: AccessRequest,
  input: ResolveSlackRefsInput,
): Promise<SlackRef[]> {
  const refs = new Map<string, SlackRef>();

  for (const file of input.files ?? []) {
    if (refs.has(file.id)) continue;
    refs.set(
      file.id,
      fileRef(file.id, factsOfAttachment(file), input.gates, {
        fromCurrentMessage: input.fromCurrentMessage,
        tooLarge: file.unavailable === "too_large",
      }),
    );
  }

  const parsed = input.text === undefined ? [] : parseSlackRefs(input.text);
  const resolved = await Promise.all(parsed.map((ref) => resolveParsedRef(req, ref, refs, input)));
  for (const ref of resolved) refs.set(ref.id, ref);

  return [...refs.values()];
}

/** One message's references to resolve. */
export type RefSource = Omit<ResolveSlackRefsInput, "gates">;

export interface ResolveRefsIntoDeps {
  resolveSlackRefs: typeof resolveSlackRefs;
}

/**
 * Resolve every source concurrently, then merge each into `target` in source order.
 * Returns each source's own refs, in source order.
 */
export async function resolveRefsInto(
  req: AccessRequest,
  gates: ReaderGates,
  sources: readonly RefSource[],
  target: Map<string, SlackRef>,
  deps: ResolveRefsIntoDeps = { resolveSlackRefs },
): Promise<SlackRef[][]> {
  const resolved = await Promise.all(
    sources.map((source) => deps.resolveSlackRefs(req, { ...source, gates })),
  );
  for (const refs of resolved) mergeRefs(target, refs);
  return resolved;
}

/** Whether `candidate` carries facts that `current` lacks. */
function hasRicherFacts(current: SlackRef, candidate: SlackRef): boolean {
  return (
    current.type === "file" &&
    current.facts === undefined &&
    candidate.type === "file" &&
    candidate.facts !== undefined
  );
}

/** Add refs to a registry. A ref is current-message if any source was; that is never undone. */
export function mergeRefs(map: Map<string, SlackRef>, refs: readonly SlackRef[]): void {
  for (const ref of refs) {
    const existing = map.get(ref.id);
    if (existing === undefined) {
      map.set(ref.id, ref);
      continue;
    }
    const base = hasRicherFacts(existing, ref) ? ref : existing;
    map.set(ref.id, {
      ...base,
      fromCurrentMessage: existing.fromCurrentMessage || ref.fromCurrentMessage,
    });
  }
}
