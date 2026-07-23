import type { Block as SlackRawBlock, RawTextElement } from "@slack/types";
import type { AuthoredRichTextCell, AuthoredTableBlock, AuthoredTableCell } from "./blockSchema.js";
import { logger } from "../logger.js";
import { t } from "../i18n/t.js";

/** Rows per page for the interactive `data_table` variant. Slack allows 1–100 (default 5);
 *  10 suits leaderboard-style tables without over-paginating. */
export const DATA_TABLE_PAGE_SIZE = 10;

/** Slack's aggregate serialized-size cap for a single `data_table` block. Beyond this the
 *  block is rejected, so we fall back to the legacy `table` block instead of failing delivery. */
export const DATA_TABLE_MAX_CHARS = 20_000;

/**
 * A `data_table` cell (Slack's interactive table). Our normalized authored cells are already
 * `raw_text` or `rich_text`, both of which `data_table` accepts, so the mapping is identity.
 */
type DataTableCell = RawTextElement | AuthoredRichTextCell;

interface DataTableBlock {
  type: "data_table";
  caption: string;
  page_size: number;
  rows: DataTableCell[][];
}

interface LegacyTableBlock {
  type: "table";
  rows: AuthoredTableCell[][];
  column_settings?: AuthoredTableBlock["column_settings"];
}

function toLegacyTableBlock(table: AuthoredTableBlock): LegacyTableBlock {
  return {
    type: "table",
    rows: table.rows,
    ...(table.column_settings && { column_settings: table.column_settings }),
  };
}

function toDataTableCell(cell: AuthoredTableCell): DataTableCell {
  // prepareTable has already normalized bare strings into raw_text, so a string here is
  // defensive — treat it as raw_text text.
  if (typeof cell === "string") return { type: "raw_text", text: cell };
  return cell;
}

function toDataTableBlock(table: AuthoredTableBlock): DataTableBlock {
  return {
    type: "data_table",
    caption: table.caption ?? t("blocks.data_table_default_caption"),
    page_size: DATA_TABLE_PAGE_SIZE,
    rows: table.rows.map((row) => row.map(toDataTableCell)),
  };
}

/**
 * Render a prepared authored table into the Slack block emitted at delivery. The authored
 * `variant` selects the block type: `"data_table"` emits Slack's interactive table (pagination,
 * sorting), everything else emits the legacy static `table`. When the `data_table` would exceed
 * Slack's 20k-char aggregate cap, delivery falls back to the legacy `table` block (with a log)
 * so the message still posts.
 */
export function renderTableForDelivery(table: AuthoredTableBlock): SlackRawBlock {
  if (table.variant !== "data_table") {
    return toLegacyTableBlock(table);
  }
  const dataTable = toDataTableBlock(table);
  if (JSON.stringify(dataTable).length > DATA_TABLE_MAX_CHARS) {
    logger.info(
      `table render: data_table (${table.rows.length} rows) exceeds the ${DATA_TABLE_MAX_CHARS}-char cap — falling back to legacy table block`,
    );
    return toLegacyTableBlock(table);
  }
  return dataTable;
}
