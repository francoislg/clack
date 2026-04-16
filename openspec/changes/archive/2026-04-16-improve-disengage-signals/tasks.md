## 1. Schema and tool behavior

- [x] 1.1 Remove the `disengage requires skip_response: true` guard in `src/tools/presentation/submitResponse.ts`
- [x] 1.2 Update the `disengage` `.describe()` text to name dismissal phrases ("thanks Clack", "you're done", "that's all") and state that it may be combined with a normal response
- [x] 1.3 Expose the `disengage` flag on the schema for any session that supports `autoResponseActive` tracking (not only when `allowSkip` is true) — adjust the `allowSkip` / schema-selection logic accordingly
- [x] 1.4 On the normal response path, after successful delivery, mark the capture as disengaged when `args.disengage === true`
- [x] 1.5 Include `disengaged: true` in the success result returned to Claude when the normal path disengages

## 2. Response capture propagation

- [x] 2.1 Extend `ResponseCapture` (in `src/tools/server.ts` or wherever it is defined) to carry a `disengaged` flag on the normal-response path (either via a new `setDisengaged()` method or an optional arg to `set()`)
- [x] 2.2 Ensure the existing skip-path `setSkipped(disengaged)` continues to work and is not regressed

## 3. Handler integration

- [x] 3.1 In `src/slack/handlers/handlerResponse.ts`, on the success path, read the disengaged flag from `ResponseCapture` and call `setAutoResponseActive(sessionId, false)` when true, mirroring the skip-path logic at lines 396-398
- [x] 3.2 Ensure disengagement persists only after delivery succeeds (no persistence on `delivery_failed` errors)

## 4. Prompt guidance

- [x] 4.1 Update the delivery-context prompt in `src/claude/promptBuilder.ts` (or wherever the "Prompt Guidance for Disengagement" text lives) to cover the three cases: skip alone, skip + disengage, normal response + disengage
- [x] 4.2 Add explicit dismissal-phrase examples ("thanks Clack", "you're done", "that's all") to the prompt guidance

## 5. Tests

- [x] 5.1 Add a `submitResponse.test.ts` case: normal response with `disengage: true` succeeds and result contains `disengaged: true`
- [x] 5.2 Add a test: normal response with `disengage: true` but `delivery_failed` does NOT mark capture as disengaged
- [x] 5.3 Update any existing test asserting that `disengage` without `skip_response` is rejected — the rejection is gone
- [x] 5.4 Add a handler test covering the success-path disengagement writing `autoResponseActive = false` to the session
- [x] 5.5 Add an idempotency test: disengaging an already-disengaged session on the normal path still succeeds

## 6. Verification

- [x] 6.1 Run `npx tsc` to confirm type correctness
- [x] 6.2 Run `npm run test` and confirm all new + existing tests pass
- [x] 6.3 Run `openspec validate improve-disengage-signals --strict`
- [x] 6.4 Manual sanity check in a dev Slack: `@Clack thanks, you're done` in an active thread should trigger a reply plus disengagement; next thread reply should be ignored; `@Clack` again should re-activate
