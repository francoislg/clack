import { describe, expect, it } from "vitest";
import {
  fromFields,
  isWritableColumnType,
  resolveColumn,
  toCells,
  WRITABLE_COLUMN_TYPES,
} from "./listCells.js";
import type { ListColumn, ListFieldValue } from "./listTypes.js";
import { toRichText } from "./richText.js";

function column(overrides: Partial<ListColumn> & Pick<ListColumn, "name" | "type">): ListColumn {
  return {
    id: `Col_${overrides.name}`,
    key: overrides.name.toLowerCase(),
    isPrimary: false,
    choices: [],
    ...overrides,
  };
}

function statusChoices(): ListColumn["choices"] {
  return [
    { value: "OptTodo", label: "To Do" },
    { value: "OptDone", label: "Done" },
  ];
}

/** Translates one value for a single-column schema of the given type. */
function write(type: string, value: ListFieldValue, extra: Partial<ListColumn> = {}) {
  const schema = [column({ name: "Field", type, id: "C1", ...extra })];
  return toCells(schema, [{ column: "Field", value }]);
}

function problemOf(type: string) {
  return { ok: false, problems: [expect.stringContaining(`Column "Field" (${type}): `)] };
}

describe("WRITABLE_COLUMN_TYPES", () => {
  it("lists exactly the writable types", () => {
    expect(WRITABLE_COLUMN_TYPES).toEqual([
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
    ]);
  });

  it("tells writable types from read-only ones", () => {
    expect(isWritableColumnType("todo_assignee")).toBe(true);
    expect(isWritableColumnType("attachment")).toBe(false);
  });
});

describe("resolveColumn", () => {
  it("matches a name case-insensitively and trimmed", () => {
    const schema = [
      column({ name: "Title", type: "text" }),
      column({ name: "Owner", type: "user" }),
    ];
    expect(resolveColumn(schema, "  owner ")).toEqual({ ok: true, column: schema[1] });
  });

  it("falls back to the exact key when no name matches", () => {
    const schema = [column({ name: "Title", type: "text", key: "name" })];
    expect(resolveColumn(schema, "name")).toEqual({ ok: true, column: schema[0] });
  });

  it("lists the column names for an unknown column", () => {
    const schema = [
      column({ name: "Title", type: "text" }),
      column({ name: "Owner", type: "user" }),
    ];
    expect(resolveColumn(schema, "Nope")).toEqual({
      ok: false,
      problem: 'Unknown column "Nope". Columns: Title, Owner.',
    });
  });

  it("rejects a name matching several columns", () => {
    const schema = [
      column({ name: "Status", type: "select", id: "C1" }),
      column({ name: "status", type: "text", id: "C2" }),
    ];
    expect(resolveColumn(schema, "status")).toEqual({
      ok: false,
      problem: 'Column "status" matches several columns. Columns: Status, status.',
    });
  });
});

describe("toCells", () => {
  it.each<[string, ListFieldValue, object]>([
    ["text", "hello", { rich_text: [toRichText("hello")] }],
    ["number", 4.5, { number: [4.5] }],
    ["number", "42", { number: [42] }],
    ["checkbox", false, { checkbox: false }],
    ["checkbox", "TRUE", { checkbox: true }],
    ["date", "2026-02-28", { date: ["2026-02-28"] }],
    ["user", "U123", { user: ["U123"] }],
    ["user", ["U123", "<@U456>", "<@W789|sam>"], { user: ["U123", "U456", "W789"] }],
    ["channel", "C123", { channel: ["C123"] }],
    ["channel", ["C123", "<#G456>", "<#C789|general>"], { channel: ["C123", "G456", "C789"] }],
    ["rating", 3, { rating: [3] }],
    ["rating", "0", { rating: [0] }],
    ["email", "a@b.co", { email: ["a@b.co"] }],
    ["email", ["a@b.co", "c@d.co"], { email: ["a@b.co", "c@d.co"] }],
    ["phone", "555-0100", { phone: ["555-0100"] }],
    ["phone", ["555-0100", "555-0101"], { phone: ["555-0100", "555-0101"] }],
    ["todo_completed", "true", { checkbox: true }],
    ["todo_due_date", "2026-10-02", { date: ["2026-10-02"] }],
    ["todo_assignee", "<@U123|sam>", { user: ["U123"] }],
  ])("writes a %s column from %j", (type, value, expected) => {
    expect(write(type, value, { max: 5 })).toEqual({
      ok: true,
      cells: [{ column_id: "C1", ...expected }],
    });
  });

  it.each<[string, ListFieldValue]>([
    ["text", 3],
    ["number", ""],
    ["number", "   "],
    ["number", "abc"],
    ["number", Number.NaN],
    ["number", true],
    ["checkbox", "yes"],
    ["checkbox", 1],
    ["date", "2026-02-30"],
    ["date", "2026-13-01"],
    ["date", "02/28/2026"],
    ["date", 20260228],
    ["select", 1],
    ["multi_select", true],
    ["user", "sam"],
    ["user", ["U123", "<@sam>"]],
    ["channel", "#general"],
    ["channel", 4],
    ["rating", 6],
    ["rating", -1],
    ["rating", 2.5],
    ["rating", "many"],
    ["email", ""],
    ["email", ["a@b.co", " "]],
    ["email", 5],
    ["phone", ""],
    ["phone", false],
    ["link", "ftp://x"],
    ["link", "not a url"],
    ["link", 7],
    ["todo_completed", "maybe"],
    ["todo_due_date", "tomorrow"],
    ["todo_assignee", "sam"],
  ])("rejects a %s column given %j", (type, value) => {
    const result = write(type, value, { max: 5, choices: statusChoices() });
    expect(result).toEqual(problemOf(type));
    expect(result).toMatchObject({ problems: [expect.stringMatching(/[^.]\.$/)] });
  });

  it.each(["multi_select", "user", "channel", "email", "phone"])(
    "rejects an empty array for a %s column",
    (type) => {
      expect(write(type, [], { choices: statusChoices() })).toEqual({
        ok: false,
        problems: [`Column "Field" (${type}): needs at least one value.`],
      });
    },
  );

  it("accepts a rating with no max", () => {
    expect(write("rating", 99)).toEqual({ ok: true, cells: [{ column_id: "C1", rating: [99] }] });
  });

  it("points at find_user for a user that is not an id", () => {
    expect(write("user", "sam")).toMatchObject({
      problems: [expect.stringMatching(/user id.*find_user/)],
    });
  });

  it("points at find_channel for a channel that is not an id", () => {
    expect(write("channel", "general")).toMatchObject({
      problems: [expect.stringMatching(/channel id.*find_channel/)],
    });
  });

  it("writes a link with the url as its display name", () => {
    expect(write("link", "https://example.com/a")).toEqual({
      ok: true,
      cells: [
        {
          column_id: "C1",
          link: [
            {
              original_url: "https://example.com/a",
              display_as_url: true,
              display_name: "https://example.com/a",
            },
          ],
        },
      ],
    });
  });

  describe("select", () => {
    it.each<[string, ListFieldValue, string]>([
      ["a label, case-insensitively", " to do ", "OptTodo"],
      ["a value", "OptDone", "OptDone"],
      ["a one-element array", ["Done"], "OptDone"],
    ])("matches an option by %s", (_label, value, expected) => {
      expect(write("select", value, { choices: statusChoices() })).toEqual({
        ok: true,
        cells: [{ column_id: "C1", select: [expected] }],
      });
    });

    it("rejects two entries", () => {
      expect(write("select", ["Done", "To Do"], { choices: statusChoices() })).toEqual({
        ok: false,
        problems: ['Column "Field" (select): takes one option.'],
      });
    });

    it("lists the labels for an unknown option", () => {
      expect(write("select", "Later", { choices: statusChoices() })).toEqual({
        ok: false,
        problems: ['Column "Field" (select): unknown option "Later". Options: To Do, Done.'],
      });
    });
  });

  describe("multi_select", () => {
    it("writes several options, by label or value", () => {
      expect(write("multi_select", ["done", "OptTodo"], { choices: statusChoices() })).toEqual({
        ok: true,
        cells: [{ column_id: "C1", select: ["OptDone", "OptTodo"] }],
      });
    });

    it("writes a single string", () => {
      expect(write("multi_select", "Done", { choices: statusChoices() })).toEqual({
        ok: true,
        cells: [{ column_id: "C1", select: ["OptDone"] }],
      });
    });

    it("lists the labels for an unknown option", () => {
      expect(write("multi_select", ["Done", "Later"], { choices: statusChoices() })).toEqual({
        ok: false,
        problems: ['Column "Field" (multi_select): unknown option "Later". Options: To Do, Done.'],
      });
    });
  });

  it("rejects a read-only column type", () => {
    expect(write("attachment", "F123")).toEqual({
      ok: false,
      problems: ['Column "Field" has type "attachment", which cannot be written.'],
    });
  });

  it("reports an unknown column with the column names", () => {
    const schema = [
      column({ name: "Title", type: "text" }),
      column({ name: "Done", type: "checkbox" }),
    ];
    expect(toCells(schema, [{ column: "Nope", value: "x" }])).toEqual({
      ok: false,
      problems: ['Unknown column "Nope". Columns: Title, Done.'],
    });
  });

  it("reports an ambiguous column", () => {
    const schema = [
      column({ name: "Status", type: "select", id: "C1" }),
      column({ name: "status", type: "text", id: "C2" }),
    ];
    expect(toCells(schema, [{ column: "STATUS", value: "x" }])).toEqual({
      ok: false,
      problems: ['Column "STATUS" matches several columns. Columns: Status, status.'],
    });
  });

  it("resolves a column by key", () => {
    const schema = [column({ name: "Title", type: "text", id: "C1", key: "name" })];
    expect(toCells(schema, [{ column: "name", value: "x" }])).toEqual({
      ok: true,
      cells: [{ column_id: "C1", rich_text: [toRichText("x")] }],
    });
  });

  it("returns every problem together", () => {
    const schema = [
      column({ name: "Title", type: "text", id: "C1" }),
      column({ name: "Due", type: "date", id: "C2" }),
      column({ name: "Files", type: "attachment", id: "C3" }),
    ];
    const result = toCells(schema, [
      { column: "Title", value: "fine" },
      { column: "Due", value: "2026-02-30" },
      { column: "Files", value: "F1" },
      { column: "Ghost", value: "x" },
    ]);
    expect(result).toEqual({
      ok: false,
      problems: [
        expect.stringContaining('Column "Due" (date): '),
        'Column "Files" has type "attachment", which cannot be written.',
        'Unknown column "Ghost". Columns: Title, Due, Files.',
      ],
    });
  });

  it("translates several pairs in the order given", () => {
    const schema = [
      column({ name: "Title", type: "text", id: "C1" }),
      column({ name: "Count", type: "number", id: "C2" }),
    ];
    expect(
      toCells(schema, [
        { column: "count", value: 2 },
        { column: "title", value: "a" },
      ]),
    ).toEqual({
      ok: true,
      cells: [
        { column_id: "C2", number: [2] },
        { column_id: "C1", rich_text: [toRichText("a")] },
      ],
    });
  });
});

describe("fromFields", () => {
  it.each<[string, string[], ListFieldValue]>([
    ["select", ["OptDone"], "Done"],
    ["select", ["OptGone"], "OptGone"],
    ["select", ["OptDone", "OptTodo"], ["Done", "To Do"]],
    ["multi_select", ["OptDone"], ["Done"]],
    ["multi_select", ["OptTodo", "OptGone"], ["To Do", "OptGone"]],
  ])("renders a %s holding %j as labels", (type, select, expected) => {
    const schema = [column({ name: "Status", type, id: "C1", choices: statusChoices() })];
    expect(fromFields(schema, [{ columnId: "C1", text: "rendered", select }])).toEqual([
      { column: "Status", value: expected },
    ]);
  });

  it.each<[string, object, ListFieldValue]>([
    ["user", { user: ["U1", "U2"] }, ["U1", "U2"]],
    ["todo_assignee", { user: ["U1"] }, ["U1"]],
    ["channel", { channel: ["C1"] }, ["C1"]],
    ["checkbox", { checkbox: false }, false],
    ["todo_completed", { checkbox: true }, true],
    ["number", { number: [0] }, 0],
    ["rating", { rating: [4] }, 4],
    ["date", { date: ["2026-10-02"] }, "2026-10-02"],
    ["todo_due_date", { date: ["2026-10-03"] }, "2026-10-03"],
    ["email", { email: ["a@b.co"] }, ["a@b.co"]],
    ["phone", { phone: ["555"] }, ["555"]],
    ["text", {}, "rendered"],
    ["link", {}, "rendered"],
  ])("renders a %s field from its typed value", (type, typed, expected) => {
    const schema = [column({ name: "Field", type, id: "C1" })];
    expect(fromFields(schema, [{ columnId: "C1", text: "rendered", ...typed }])).toEqual([
      { column: "Field", value: expected },
    ]);
  });

  it("falls back to text for an unmodelled type", () => {
    const schema = [column({ name: "Votes", type: "vote", id: "C1" })];
    expect(fromFields(schema, [{ columnId: "C1", text: "3 votes", number: [3] }])).toEqual([
      { column: "Votes", value: "3 votes" },
    ]);
  });

  it.each([
    "select",
    "multi_select",
    "user",
    "channel",
    "checkbox",
    "number",
    "rating",
    "date",
    "email",
    "phone",
  ])("falls back to text when a %s field has no typed value", (type) => {
    const schema = [column({ name: "Field", type, id: "C1" })];
    expect(fromFields(schema, [{ columnId: "C1", text: "plain" }])).toEqual([
      { column: "Field", value: "plain" },
    ]);
  });

  it("renders an empty string when there is neither a typed value nor text", () => {
    const schema = [column({ name: "Count", type: "number", id: "C1" })];
    expect(fromFields(schema, [{ columnId: "C1" }])).toEqual([{ column: "Count", value: "" }]);
  });

  it("follows schema order, skips columns without a field and fields without a column", () => {
    const schema = [
      column({ name: "Title", type: "text", id: "C1" }),
      column({ name: "Count", type: "number", id: "C2" }),
      column({ name: "Due", type: "date", id: "C3" }),
    ];
    expect(
      fromFields(schema, [
        { columnId: "C9", text: "orphan" },
        { columnId: "C3", date: ["2026-10-02"] },
        { columnId: "C1", text: "first" },
      ]),
    ).toEqual([
      { column: "Title", value: "first" },
      { column: "Due", value: "2026-10-02" },
    ]);
  });
});
