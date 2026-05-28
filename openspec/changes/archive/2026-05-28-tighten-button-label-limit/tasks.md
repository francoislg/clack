## 1. Shared limit constant and schema helper

- [x] 1.1 Export `SLACK_BUTTON_LABEL_MAX = 40` from `src/slack/blocks.ts` (replace the existing `SLACK_BUTTON_LABEL_LIMIT = 75` constant; if the old name is imported elsewhere, rename call sites)
- [x] 1.2 Create `buttonLabelSchema` (a `z.string().max(SLACK_BUTTON_LABEL_MAX)` with a `describe()` text that states the 40-char cap) in `src/tools/presentation/submitResponse.ts`, importing the constant from `src/slack/blocks.js`

## 2. Apply the helper to every action schema

- [x] 2.1 Replace `z.string().describe("Button label")` with `buttonLabelSchema` on `followupActionSchema.label`
- [x] 2.2 Replace `z.string().describe("Button label")` with `buttonLabelSchema` on `choiceActionSchema.label`
- [x] 2.3 Replace `z.string().optional().describe(...)` with `buttonLabelSchema.optional()` on `postToActionSchema.label`, preserving the "default: 'Post to thread'" hint in the describe text via a re-applied `.describe()` if needed
- [x] 2.4 Same treatment on `changeActionSchema.label` (default "Start Change")
- [x] 2.5 Same treatment on `configUpdateActionSchema.label` (default "Apply Update")
- [x] 2.6 Same treatment on `updateActionSchema.label` (default "Update")
- [x] 2.7 Same treatment on `skillCreateActionSchema.label` (default "Create skill")
- [x] 2.8 Same treatment on `skillUpdateActionSchema.label` (default "Edit skill")
- [x] 2.9 Same treatment on `skillDisableActionSchema.label` (default "Disable")
- [x] 2.10 Same treatment on `skillRestoreActionSchema.label` (default "Restore")

## 3. Tighten the runtime validator

- [x] 3.1 Update `validateActionButtonLabels` in `src/slack/blocks.ts` so the error message reflects the 40-char limit (the comparison already uses the constant, so only the message string changes)
- [x] 3.2 Confirm both call sites in `submitResponse.ts` (primary and `post_to`) still wire `validateActionButtonLabels` through unchanged — no signature change

## 4. Tests

- [x] 4.1 Add a unit test in the existing `submitResponse` test suite (or a new `submitResponse.buttonLabel.test.ts`) that, for each of the 10 action types, asserts the schema rejects a 41-char label with a Zod max-length error and accepts a 40-char label
- [x] 4.2 Add a unit test in the `blocks` test suite that iterates every action type handled by `defaultActionLabel` and asserts each returned string has length ≤ `SLACK_BUTTON_LABEL_MAX`
- [x] 4.3 Update existing `validateActionButtonLabels` tests to use the new 40-char threshold (a label of 41 should now fail; one of 75 should now fail; one of 40 should still pass)

## 5. Sanity verification

- [x] 5.1 Run `npx tsc` to confirm no type errors
- [x] 5.2 Run `npx oxlint src/tools/presentation/submitResponse.ts src/slack/blocks.ts` to confirm no lint errors
- [x] 5.3 Run `npm test` and confirm all suites pass, including the new ones
- [x] 5.4 Run `openspec validate tighten-button-label-limit --strict`
