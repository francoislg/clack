import type { PlanBlock, RichTextBlock, TaskCardBlock, TaskUpdateChunk } from "@slack/types";

/** Slack's cap on the number of task cards in one plan block. */
export const PLAN_BLOCK_MAX_TASKS = 50;

type ProjectedTask = { title: string; status: TaskUpdateChunk["status"]; details: string };

/**
 * The task card as Slack renders it from a stream of `task_update` chunks: title and status
 * replace, details append. Renders the card as a static `plan` block for `chat.update`.
 */
export class TaskCardProjection {
  private tasks = new Map<string, ProjectedTask>();

  apply(chunks: TaskUpdateChunk[]): void {
    for (const chunk of chunks) {
      const existing = this.tasks.get(chunk.id);
      this.tasks.set(chunk.id, {
        title: chunk.title,
        status: chunk.status,
        details: (existing?.details ?? "") + (chunk.details ?? ""),
      });
    }
  }

  /** Keeps the first task (the thinking row) plus the most recent ones when over the cap. */
  toPlanBlock(title: string): PlanBlock & { tasks: TaskCardBlock[] } {
    const entries = [...this.tasks.entries()];
    const kept =
      entries.length > PLAN_BLOCK_MAX_TASKS
        ? [entries[0], ...entries.slice(entries.length - (PLAN_BLOCK_MAX_TASKS - 1))]
        : entries;
    return { type: "plan", title, tasks: kept.map(([id, task]) => toTaskCard(id, task)) };
  }
}

function toTaskCard(id: string, task: ProjectedTask): TaskCardBlock {
  const card: TaskCardBlock = {
    type: "task_card",
    task_id: id,
    title: task.title,
    status: task.status,
  };
  if (task.details.trim() !== "") card.details = toRichText(task.details.replace(/^\n+/, ""));
  return card;
}

function toRichText(text: string): RichTextBlock {
  return {
    type: "rich_text",
    elements: [{ type: "rich_text_section", elements: [{ type: "text", text }] }],
  };
}
