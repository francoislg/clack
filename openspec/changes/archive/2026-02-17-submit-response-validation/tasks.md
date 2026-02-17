## 1. Block Validation in submit_response

- [x] 1.1 Create `validateSlackBlocks()` function in `src/slack/blocks.ts` that checks rendered blocks against Slack limits (section text ≤ 3000 chars, button label ≤ 75 chars, total blocks ≤ 50) and returns an array of error objects with section/action index, current count, and limit
- [x] 1.2 Import `getStructuredResponseBlocks` and `validateSlackBlocks` into `submitResponse.ts` — render blocks inside the tool, validate, return errors to Claude if invalid
- [x] 1.3 Cache rendered blocks in `ResponseCapture` alongside the payload so handlers can reuse them without re-rendering (add `renderedBlocks` field)

## 2. Handler-Level Retry on invalid_blocks

- [x] 2.1 Add retry logic to `postSuccessResponse` in `core.ts`: wrap Slack posting in try/catch for `invalid_blocks`, inject error as refinement, re-invoke `askClaude()` (max 1 retry)
- [x] 2.2 Add the same retry logic to `postSuccessResponse` in `handlerResponse.ts` (button handler shared path)
- [x] 2.3 On exhausted retries, fall back to posting plain text answer (no blocks), respecting ephemeral/regular response style

## 3. Integration

- [x] 3.1 Update `ClackToolsResult` in `types.ts` to expose `getRenderedBlocks()` alongside `getResult()` so handlers can use pre-validated blocks
- [x] 3.2 Update handlers (`core.ts`, `handlerResponse.ts`) to use pre-rendered blocks from `getRenderedBlocks()` instead of re-calling `getStructuredResponseBlocks()`
- [x] 3.3 Verify TypeScript builds cleanly and no circular imports exist between tools → slack layers
