/**
 * Pushable async iterable used as the `prompt` source for `query()` in streaming-input mode.
 *
 * Items are buffered until consumed. `push(item)` adds to the queue; `end()` marks the
 * iterable as complete; iteration drains the queue then returns. Once ended, further
 * `push` calls throw.
 */
export interface PushableAsyncIterable<T> extends AsyncIterable<T> {
  push(item: T): void;
  end(): void;
  readonly ended: boolean;
  /**
   * Number of items pushed but not yet pulled by an iterator. Used by callers that need to
   * gate downstream actions (e.g. `submit_response`) on "is there unread input?".
   */
  readonly pendingCount: number;
}

export function createPushableAsyncIterable<T>(): PushableAsyncIterable<T> {
  const buffer: T[] = [];
  const waiters: Array<(value: IteratorResult<T, void>) => void> = [];
  let ended = false;

  function push(item: T): void {
    if (ended) {
      throw new Error("Cannot push to an ended PushableAsyncIterable");
    }
    const waiter = waiters.shift();
    if (waiter) {
      waiter({ value: item, done: false });
    } else {
      buffer.push(item);
    }
  }

  function end(): void {
    if (ended) return;
    ended = true;
    while (waiters.length > 0) {
      const waiter = waiters.shift()!;
      waiter({ value: undefined, done: true });
    }
  }

  return {
    push,
    end,
    get ended() {
      return ended;
    },
    get pendingCount() {
      return buffer.length;
    },
    [Symbol.asyncIterator](): AsyncIterator<T, void> {
      return {
        next(): Promise<IteratorResult<T, void>> {
          if (buffer.length > 0) {
            const value = buffer.shift()!;
            return Promise.resolve({ value, done: false });
          }
          if (ended) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiters.push(resolve);
          });
        },
        return(): Promise<IteratorResult<T, void>> {
          end();
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}
