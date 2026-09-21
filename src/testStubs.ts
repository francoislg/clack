/**
 * Narrowing for deliberately partial test fixtures.
 *
 * Third-party surfaces like Slack's `WebClient` / `App` and Octokit are far too large to build
 * in a test, and `Partial<T>` is shallow — a stub carrying only `chat.postMessage` still fails,
 * because `chat` itself is incomplete.
 *
 * The input is checked against the real type: every key must exist on `T`, nesting is followed,
 * and a typo or a wrong member name is a compile error. What is loosened is exactly what a
 * fixture cannot express — a member may be omitted, and a function member may return a partial
 * of the real return type (a `vi.fn()` returning `{ ok: true }` stands in for a full Slack
 * response).
 */
export type StubShape<T> = T extends (...args: infer A) => Promise<infer R>
  ? (...args: A) => Promise<StubShape<R>>
  : T extends (...args: infer A) => infer R
    ? (...args: A) => StubShape<R>
    : T extends ReadonlyArray<infer E>
      ? ReadonlyArray<StubShape<E>>
      : T extends object
        ? { [K in keyof T]?: StubShape<T[K]> }
        : T;

export function stub<T>(value: StubShape<T>): T {
  return value as T;
}
