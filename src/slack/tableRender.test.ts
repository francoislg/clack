import { describe, it, expect } from "vitest";
import type { AuthoredTableBlock } from "./blockSchema.js";
import { DATA_TABLE_PAGE_SIZE, renderTableForDelivery } from "./tableRender.js";

interface RenderedBlock {
  type: string;
  caption?: string;
  page_size?: number;
  rows: unknown[][];
  column_settings?: unknown[];
}

function render(table: AuthoredTableBlock): RenderedBlock {
  const plain: RenderedBlock = JSON.parse(JSON.stringify(renderTableForDelivery(table)));
  return plain;
}

describe("renderTableForDelivery", () => {
  it("emits a legacy table block when variant is absent", () => {
    const table: AuthoredTableBlock = {
      type: "table",
      rows: [[{ type: "raw_text", text: "A" }]],
      column_settings: [{ align: "center" }],
    };
    const block = render(table);
    expect(block.type).toBe("table");
    expect(block.column_settings).toEqual([{ align: "center" }]);
    expect(block.page_size).toBeUndefined();
    expect(block.caption).toBeUndefined();
  });

  it('emits a legacy table block when variant is explicitly "table"', () => {
    const block = render({
      type: "table",
      variant: "table",
      rows: [[{ type: "raw_text", text: "A" }]],
    });
    expect(block.type).toBe("table");
  });

  it("emits a data_table block with page_size and default caption for the data_table variant", () => {
    const table: AuthoredTableBlock = {
      type: "table",
      variant: "data_table",
      rows: [[{ type: "raw_text", text: "Name" }], [{ type: "raw_text", text: "Jane" }]],
    };
    const block = render(table);
    expect(block.type).toBe("data_table");
    expect(block.page_size).toBe(DATA_TABLE_PAGE_SIZE);
    expect(block.caption).toBe("Table");
    expect(block.rows).toEqual(table.rows);
    expect(block.column_settings).toBeUndefined();
  });

  it("uses the authored caption when provided under data_table", () => {
    const block = render({
      type: "table",
      variant: "data_table",
      caption: "Standings",
      rows: [[{ type: "raw_text", text: "A" }]],
    });
    expect(block.caption).toBe("Standings");
  });

  it("normalizes a bare-string cell into raw_text under data_table", () => {
    const block = render({ type: "table", variant: "data_table", rows: [["hello"]] });
    expect(block.rows[0][0]).toEqual({ type: "raw_text", text: "hello" });
  });

  it("falls back to a legacy table block when the data_table exceeds the 20k-char cap", () => {
    const bigCell = { type: "raw_text" as const, text: "x".repeat(500) };
    const rows = Array.from({ length: 60 }, () => [bigCell]);
    const block = render({ type: "table", variant: "data_table", rows });
    expect(block.type).toBe("table");
    expect(block.page_size).toBeUndefined();
  });
});
