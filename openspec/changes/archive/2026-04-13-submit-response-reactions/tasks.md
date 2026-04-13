## 1. DeliverFn Contract

- [x] 1.1 Update `DeliverFn` type in `src/tools/types.ts` — add optional `reactions: string[]` to opts, add optional `ts: string` to success result
- [x] 1.2 Update `buildDeliverFn` in `handlerResponse.ts` — return `ts` from streamer path (`streamer.getMessageTs()`) and fallback path (`result.ts`)
- [x] 1.3 Update `buildDirectDeliverFn` in `handlerResponse.ts` — return `ts` from `result.ts`

## 2. Add Reactions in Delivery Layer

- [x] 2.1 After successful delivery in `buildDeliverFn`, if `opts.reactions` is non-empty and `ts` is available, add reactions in parallel via `Promise.all` with `client.reactions.add` — log warnings on failure, silently ignore `already_reacted`
- [x] 2.2 Same for `buildDirectDeliverFn`

## 3. submit_response Schema

- [x] 3.1 Add optional `reactions: z.array(z.string())` to both `normalResponseSchema` and `skipEnabledResponseSchema` in `submitResponse.ts`
- [x] 3.2 Pass `args.reactions` through to the `deliver()` call in the normal response path

## 4. Tests

- [x] 4.1 Add tests in `submitResponse.test.ts` — reactions passed through to deliver, reactions ignored when no deliver callback
- [x] 4.2 Add tests in `handlerResponse.test.ts` — reactions added after delivery, invalid emoji logged as warning, already_reacted ignored, reactions run in parallel

## 5. Validation

- [x] 5.1 Run `npx tsc` to verify no type errors
- [x] 5.2 Run full test suite to verify no regressions
