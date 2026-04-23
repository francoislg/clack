## 1. Normalization helper

- [x] 1.1 Add `normalizeSlackTimestamp(input: string): string | { error: string }` in `src/tools/query/fetchChannelMessages.ts` (not exported from a shared module — no other tool needs it today).
- [x] 1.2 Implement detection: match `/^\d+(\.\d+)?$/` first and pass through; otherwise run `Date.parse` and divide by 1000, formatting to six fractional digits (e.g., `"1745294400.000000"`).
- [x] 1.3 Return a structured error value when both strategies fail (include the offending argument name and the raw input in the error message).

## 2. Handler integration

- [x] 2.1 In the tool handler, normalize `args.oldest` and `args.latest` before the `conversations.history` call.
- [x] 2.2 On normalization failure for either argument, return `errorResult(...)` with a clear message naming which argument failed. Do NOT call the Slack API in that case.
- [x] 2.3 Replace the direct spread of `args.oldest`/`args.latest` into the Slack client call with the normalized values.

## 3. Response shape

- [x] 3.1 Thread the normalized `oldest`/`latest` values (and their ISO forms, computed from the epoch value) through to the result builder.
- [x] 3.2 Unify the empty-result branch and the non-empty branch so both include `has_more`, and both include `oldest`/`latest`/`oldest_iso`/`latest_iso` only when those inputs were provided.
- [x] 3.3 Ensure `oldest_iso`/`latest_iso` are formatted as full ISO 8601 strings (e.g., via `new Date(epoch * 1000).toISOString()`).

## 4. Schema and descriptions

- [x] 4.1 Update the Zod `.describe()` text for `oldest` and `latest` in `fetchChannelMessages.ts` to reflect that both numeric epoch strings and ISO 8601 datetime strings are accepted, with at least one concrete example of each.

## 5. Tests

- [x] 5.1 Extend `src/tools/query/fetchChannelMessages.test.ts` with cases for: numeric-string epoch pass-through, ISO 8601 normalization, date-only (`"2026-04-22"`) normalization, unparseable input rejection (tool error, no Slack call).
- [x] 5.2 Add response-shape tests asserting `oldest`/`latest`/`oldest_iso`/`latest_iso`/`has_more` appear on both empty and non-empty paths when timestamps are provided, and are omitted when they aren't.
- [x] 5.3 Update existing tests if their expected result shape no longer matches (e.g., tests that assert exact response object equality on the empty-result branch). *No-op: existing tests use field-specific assertions, not full-object equality — nothing broke.*

## 6. Verification

- [x] 6.1 Run `npx tsc` to confirm type-checking succeeds.
- [x] 6.2 Run `npm run test` to confirm all tests pass.
- [x] 6.3 Run `npx openspec validate harden-fetch-channel-messages-input --strict` to confirm spec deltas validate.
