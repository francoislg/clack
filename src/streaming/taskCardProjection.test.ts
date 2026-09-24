import { describe, it, expect } from "vitest";
import type { TaskCardBlock, TaskUpdateChunk } from "@slack/types";
import { PLAN_BLOCK_MAX_TASKS, TaskCardProjection } from "./taskCardProjection.js";

function chunk(
  id: string,
  title: string,
  status: TaskUpdateChunk["status"] = "in_progress",
  details?: string,
): TaskUpdateChunk {
  return { type: "task_update", id, title, status, ...(details !== undefined && { details }) };
}

function cards(projection: TaskCardProjection): TaskCardBlock[] {
  return projection.toPlanBlock("Plan").tasks;
}

describe("TaskCardProjection", () => {
  it("renders a plan block with the given title", () => {
    const projection = new TaskCardProjection();
    projection.apply([chunk("a", "A")]);
    expect(projection.toPlanBlock("Working")).toEqual({
      type: "plan",
      title: "Working",
      tasks: [{ type: "task_card", task_id: "a", title: "A", status: "in_progress" }],
    });
  });

  it("replaces title and status but appends details", () => {
    const projection = new TaskCardProjection();
    projection.apply([chunk("a", "A", "in_progress", "first")]);
    projection.apply([chunk("a", "A ⏱ 30s", "in_progress", "\n .")]);
    projection.apply([chunk("a", "A done", "complete", " .")]);

    const [card] = cards(projection);
    expect(card.title).toBe("A done");
    expect(card.status).toBe("complete");
    expect(card.details).toEqual({
      type: "rich_text",
      elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "first\n . ." }] }],
    });
  });

  it("keeps first-seen order; updates do not move a task", () => {
    const projection = new TaskCardProjection();
    projection.apply([chunk("a", "A"), chunk("b", "B")]);
    projection.apply([chunk("a", "A2"), chunk("c", "C")]);
    expect(cards(projection).map((c) => c.task_id)).toEqual(["a", "b", "c"]);
  });

  it("omits details when the accumulated string is empty or whitespace", () => {
    const projection = new TaskCardProjection();
    projection.apply([chunk("a", "A"), chunk("b", "B", "in_progress", "\n  ")]);
    for (const card of cards(projection)) expect(card).not.toHaveProperty("details");
  });

  it("strips leading newlines from details", () => {
    const projection = new TaskCardProjection();
    projection.apply([chunk("a", "A", "in_progress", "\n\nline1\nline2")]);
    const [card] = cards(projection);
    expect(card.details?.elements).toEqual([
      { type: "rich_text_section", elements: [{ type: "text", text: "line1\nline2" }] },
    ]);
  });

  it("caps at the plan limit, keeping the first task and the latest ones", () => {
    const projection = new TaskCardProjection();
    const total = PLAN_BLOCK_MAX_TASKS + 10;
    projection.apply(Array.from({ length: total }, (_, i) => chunk(`t${i}`, `T${i}`)));

    const ids = cards(projection).map((c) => c.task_id);
    expect(ids).toHaveLength(PLAN_BLOCK_MAX_TASKS);
    expect(ids[0]).toBe("t0");
    expect(ids[1]).toBe(`t${total - (PLAN_BLOCK_MAX_TASKS - 1)}`);
    expect(ids.at(-1)).toBe(`t${total - 1}`);
  });

  it("does not cap at exactly the limit", () => {
    const projection = new TaskCardProjection();
    projection.apply(Array.from({ length: PLAN_BLOCK_MAX_TASKS }, (_, i) => chunk(`t${i}`, "T")));
    expect(cards(projection).map((c) => c.task_id)).toEqual(
      Array.from({ length: PLAN_BLOCK_MAX_TASKS }, (_, i) => `t${i}`),
    );
  });
});
