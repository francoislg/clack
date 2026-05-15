import type { QueueEntry, Worker } from "./types.js";
import { Cancelled } from "./errors.js";

/**
 * Per-repo FIFO queue of pending acquire requests. Entries can be cancelled
 * before they are dequeued (e.g., 🛑 reaction on a queued change).
 */
export class WorkerQueue {
  private queues = new Map<string, QueueEntry[]>();

  depth(repo: string): number {
    return this.queues.get(repo)?.length ?? 0;
  }

  list(repo?: string): ReadonlyArray<QueueEntry> {
    if (repo) return this.queues.get(repo) ?? [];
    const all: QueueEntry[] = [];
    for (const entries of this.queues.values()) all.push(...entries);
    return all;
  }

  /**
   * Push an entry to the back of the repo's queue. Returns the promise that resolves
   * when the entry is dequeued and given a worker, or rejects if cancelled.
   */
  enqueueAndWait(repo: string, branch: string, sessionId: string): Promise<Worker> {
    return new Promise<Worker>((resolve, reject) => {
      const entry: QueueEntry = {
        repo,
        branch,
        sessionId,
        enqueuedAt: new Date(),
        resolve,
        reject,
        cancel: (reason?: string) => this.removeEntry(entry, reason),
      };
      const list = this.queues.get(repo);
      if (list) list.push(entry);
      else this.queues.set(repo, [entry]);
    });
  }

  /**
   * Pop and return the next pending entry for the repo, or null if empty.
   */
  dequeue(repo: string): QueueEntry | null {
    const list = this.queues.get(repo);
    if (!list || list.length === 0) return null;
    const entry = list.shift();
    if (list.length === 0) this.queues.delete(repo);
    return entry ?? null;
  }

  /**
   * Find a queued entry by sessionId across all repos (for cancel by session).
   */
  findBySession(sessionId: string): QueueEntry | null {
    for (const list of this.queues.values()) {
      const entry = list.find((e) => e.sessionId === sessionId);
      if (entry) return entry;
    }
    return null;
  }

  private removeEntry(entry: QueueEntry, reason?: string): void {
    const list = this.queues.get(entry.repo);
    if (!list) return;
    const idx = list.indexOf(entry);
    if (idx >= 0) {
      list.splice(idx, 1);
      if (list.length === 0) this.queues.delete(entry.repo);
      entry.reject(new Cancelled(reason));
    }
  }
}
