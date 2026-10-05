import type {
  ListCell,
  ListColumn,
  ListColumnChoice,
  ListField,
  ListFieldPair,
  ListFieldValue,
} from "./listTypes.js";
import { toRichText } from "./richText.js";

/** Column types a tool may write. */
export const WRITABLE_COLUMN_TYPES: readonly string[] = [
  "text",
  "number",
  "checkbox",
  "date",
  "select",
  "multi_select",
  "user",
  "channel",
  "rating",
  "email",
  "phone",
  "link",
  "todo_completed",
  "todo_due_date",
  "todo_assignee",
];

export function isWritableColumnType(type: string): boolean {
  return WRITABLE_COLUMN_TYPES.includes(type);
}

export type ColumnMatch = { ok: true; column: ListColumn } | { ok: false; problem: string };

export type CellsResult = { ok: true; cells: ListCell[] } | { ok: false; problems: string[] };

type Coerced<T> = { ok: true; value: T } | { ok: false; reason: string };
type Coercer = (column: ListColumn, value: ListFieldValue) => Coerced<ListCell>;
type Reader = (column: ListColumn, field: ListField) => ListFieldValue | undefined;

const TYPE_ALIASES = new Map<string, string>([
  ["todo_completed", "checkbox"],
  ["todo_due_date", "date"],
  ["todo_assignee", "user"],
]);

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const USER_ID_PATTERN = /^[UW][A-Z0-9]+$/;
const USER_MENTION_PATTERN = /^<@([UW][A-Z0-9]+)(?:\|[^>]*)?>$/;
const CHANNEL_ID_PATTERN = /^[CGD][A-Z0-9]+$/;
const CHANNEL_MENTION_PATTERN = /^<#([CGD][A-Z0-9]+)(?:\|[^>]*)?>$/;

function ok<T>(value: T): Coerced<T> {
  return { ok: true, value };
}

function fail<T>(reason: string): Coerced<T> {
  return { ok: false, reason };
}

function kindOf(type: string): string {
  return TYPE_ALIASES.get(type) ?? type;
}

function columnNames(schema: ListColumn[]): string {
  return schema.map((column) => column.name).join(", ");
}

/**
 * Match by `name` case-insensitively (trimmed); when no name matches, by `key` exactly.
 * Zero matches and more than one name match are problems listing the column names.
 */
export function resolveColumn(schema: ListColumn[], name: string): ColumnMatch {
  const wanted = name.trim().toLowerCase();
  const byName = schema.filter((column) => column.name.trim().toLowerCase() === wanted);
  if (byName.length > 1) {
    return {
      ok: false,
      problem: `Column "${name}" matches several columns. Columns: ${columnNames(schema)}.`,
    };
  }
  const column = byName[0] ?? schema.find((candidate) => candidate.key === name);
  if (!column) {
    return { ok: false, problem: `Unknown column "${name}". Columns: ${columnNames(schema)}.` };
  }
  return { ok: true, column };
}

function toStringList(value: ListFieldValue): Coerced<string[]> {
  if (typeof value === "string") return ok([value]);
  if (!Array.isArray(value)) return fail("needs a string or a list of strings");
  if (value.length === 0) return fail("needs at least one value");
  return ok(value);
}

function toFiniteNumber(value: ListFieldValue): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function findChoice(choices: ListColumnChoice[], entry: string): ListColumnChoice | undefined {
  const wanted = entry.trim().toLowerCase();
  return (
    choices.find((choice) => choice.label.trim().toLowerCase() === wanted) ??
    choices.find((choice) => choice.value === entry)
  );
}

function toChoiceValues(column: ListColumn, entries: string[]): Coerced<string[]> {
  const values: string[] = [];
  for (const entry of entries) {
    const choice = findChoice(column.choices, entry);
    if (!choice) {
      const labels = column.choices.map((candidate) => candidate.label).join(", ");
      return fail(`unknown option "${entry}". Options: ${labels}`);
    }
    values.push(choice.value);
  }
  return ok(values);
}

function toIds(
  entries: string[],
  idPattern: RegExp,
  mentionPattern: RegExp,
  reason: string,
): Coerced<string[]> {
  const ids: string[] = [];
  for (const entry of entries) {
    const trimmed = entry.trim();
    const id = idPattern.test(trimmed) ? trimmed : mentionPattern.exec(trimmed)?.[1];
    if (!id) return fail(reason);
    ids.push(id);
  }
  return ok(ids);
}

function coerceText(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  if (typeof value !== "string") return fail("needs a string");
  return ok({ column_id: column.id, rich_text: [toRichText(value)] });
}

function coerceNumber(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  const parsed = toFiniteNumber(value);
  if (parsed === undefined) return fail("needs a number");
  return ok({ column_id: column.id, number: [parsed] });
}

function coerceCheckbox(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  if (typeof value === "boolean") return ok({ column_id: column.id, checkbox: value });
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (text !== "true" && text !== "false") return fail("needs true or false");
  return ok({ column_id: column.id, checkbox: text === "true" });
}

function coerceDate(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  if (typeof value !== "string" || !isCalendarDate(value)) {
    return fail("needs a date as YYYY-MM-DD");
  }
  return ok({ column_id: column.id, date: [value] });
}

function coerceSelect(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  const entries = toStringList(value);
  if (!entries.ok) return entries;
  if (entries.value.length > 1) return fail("takes one option");
  return coerceChoices(column, entries.value);
}

function coerceMultiSelect(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  const entries = toStringList(value);
  if (!entries.ok) return entries;
  return coerceChoices(column, entries.value);
}

function coerceChoices(column: ListColumn, entries: string[]): Coerced<ListCell> {
  const values = toChoiceValues(column, entries);
  if (!values.ok) return values;
  return ok({ column_id: column.id, select: values.value });
}

function coerceUser(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  const entries = toStringList(value);
  if (!entries.ok) return entries;
  const ids = toIds(
    entries.value,
    USER_ID_PATTERN,
    USER_MENTION_PATTERN,
    "pass a user id (resolve names with find_user first)",
  );
  if (!ids.ok) return ids;
  return ok({ column_id: column.id, user: ids.value });
}

function coerceChannel(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  const entries = toStringList(value);
  if (!entries.ok) return entries;
  const ids = toIds(
    entries.value,
    CHANNEL_ID_PATTERN,
    CHANNEL_MENTION_PATTERN,
    "pass a channel id (resolve names with find_channel first)",
  );
  if (!ids.ok) return ids;
  return ok({ column_id: column.id, channel: ids.value });
}

function coerceRating(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  const parsed = toFiniteNumber(value);
  if (parsed === undefined || !Number.isInteger(parsed) || parsed < 0) {
    return fail("needs a whole number of 0 or more");
  }
  if (column.max !== undefined && parsed > column.max) {
    return fail(`cannot be above ${column.max}`);
  }
  return ok({ column_id: column.id, rating: [parsed] });
}

function toNonEmptyStrings(value: ListFieldValue): Coerced<string[]> {
  const entries = toStringList(value);
  if (!entries.ok) return entries;
  if (entries.value.some((entry) => entry.trim() === "")) return fail("needs non-empty values");
  return entries;
}

function coerceEmail(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  const entries = toNonEmptyStrings(value);
  if (!entries.ok) return entries;
  return ok({ column_id: column.id, email: entries.value });
}

function coercePhone(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  const entries = toNonEmptyStrings(value);
  if (!entries.ok) return entries;
  return ok({ column_id: column.id, phone: entries.value });
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:";
}

function coerceLink(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  if (typeof value !== "string" || !isHttpUrl(value)) return fail("needs an http(s) URL");
  return ok({
    column_id: column.id,
    link: [{ original_url: value, display_as_url: true, display_name: value }],
  });
}

const COERCERS = new Map<string, Coercer>([
  ["text", coerceText],
  ["number", coerceNumber],
  ["checkbox", coerceCheckbox],
  ["date", coerceDate],
  ["select", coerceSelect],
  ["multi_select", coerceMultiSelect],
  ["user", coerceUser],
  ["channel", coerceChannel],
  ["rating", coerceRating],
  ["email", coerceEmail],
  ["phone", coercePhone],
  ["link", coerceLink],
]);

function toCell(column: ListColumn, value: ListFieldValue): Coerced<ListCell> {
  const coerce = COERCERS.get(kindOf(column.type));
  if (!coerce) {
    return fail(`Column "${column.name}" has type "${column.type}", which cannot be written.`);
  }
  const cell = coerce(column, value);
  if (cell.ok) return cell;
  return fail(`Column "${column.name}" (${column.type}): ${cell.reason}.`);
}

/** Translate every pair; collect every problem. ok only when there are none. */
export function toCells(schema: ListColumn[], fields: ListFieldPair[]): CellsResult {
  const cells: ListCell[] = [];
  const problems: string[] = [];
  for (const pair of fields) {
    const match = resolveColumn(schema, pair.column);
    if (!match.ok) {
      problems.push(match.problem);
      continue;
    }
    const cell = toCell(match.column, pair.value);
    if (cell.ok) cells.push(cell.value);
    else problems.push(cell.reason);
  }
  return problems.length === 0 ? { ok: true, cells } : { ok: false, problems };
}

function choiceLabels(column: ListColumn, values: string[]): string[] {
  return values.map(
    (value) => column.choices.find((choice) => choice.value === value)?.label ?? value,
  );
}

function readSelect(column: ListColumn, field: ListField): ListFieldValue | undefined {
  if (!field.select) return undefined;
  const labels = choiceLabels(column, field.select);
  return labels.length === 1 ? labels[0] : labels;
}

function readMultiSelect(column: ListColumn, field: ListField): ListFieldValue | undefined {
  return field.select ? choiceLabels(column, field.select) : undefined;
}

const READERS = new Map<string, Reader>([
  ["select", readSelect],
  ["multi_select", readMultiSelect],
  ["user", (_column, field) => field.user],
  ["channel", (_column, field) => field.channel],
  ["checkbox", (_column, field) => field.checkbox],
  ["number", (_column, field) => field.number?.[0]],
  ["rating", (_column, field) => field.rating?.[0]],
  ["date", (_column, field) => field.date?.[0]],
  ["email", (_column, field) => field.email],
  ["phone", (_column, field) => field.phone],
]);

function readValue(column: ListColumn, field: ListField): ListFieldValue {
  const read = READERS.get(kindOf(column.type));
  return read?.(column, field) ?? field.text ?? "";
}

/**
 * Render an item's cells by column name, in schema order, skipping columns the item has no
 * field for. Fields whose columnId is not in the schema are skipped.
 */
export function fromFields(schema: ListColumn[], fields: ListField[]): ListFieldPair[] {
  const pairs: ListFieldPair[] = [];
  for (const column of schema) {
    const field = fields.find((candidate) => candidate.columnId === column.id);
    if (field) pairs.push({ column: column.name, value: readValue(column, field) });
  }
  return pairs;
}
