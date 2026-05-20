## 1. Schema

- [x] 1.1 Add `theme?: string` to the `SeasonEntry` interface in `src/plugins/trivia/core/types.ts` (placed adjacent to `endedAt?` for readability; JSDoc explaining it is a short narrative label surfaced by the opener)
- [x] 1.2 Confirm no JSON-schema validators / zod schemas elsewhere need updating to accept the new optional field; add a unit test for round-trip persistence (write season with theme → read back → field preserved)

## 2. `upsert_season` tool

- [x] 2.1 Extend the zod input schema for `upsert_season` to accept `theme: z.union([z.string(), z.null()]).optional()`
- [x] 2.2 On CREATE, when `theme` is provided: trim, reject empty result with a structured "theme must be non-empty" error, persist verbatim
- [x] 2.3 On UPDATE: omit-to-keep when `theme` is undefined in args; replace when a non-empty string; remove the field when explicitly `null`; reject empty/whitespace-only strings with the same error as on CREATE
- [x] 2.4 Add `hasTheme: boolean` to the return shape (true iff the resulting entry has a non-empty `theme`)
- [x] 2.5 Update the tool description string to mention `theme` parameter semantics
- [x] 2.6 Write tests covering: create-with-theme, add-theme-on-update, clear-via-null, omit-to-keep, reject-empty, reject-whitespace-only

## 3. `applySeasonRollover` continuation

- [x] 3.1 Confirm `applySeasonRollover` (in `src/plugins/trivia/tools/reveal/rollover.ts`) constructs continuation seasons without copying `theme` from the closing snapshot (current behavior already omits it — verify and add a guard if needed)
- [x] 3.2 Add a rollover unit test asserting that when the closing season has `theme: "X"`, the auto-continuation entry has no `theme` field

## 4. `get_ideas` tool output

- [x] 4.1 In `get_ideas` (likely `src/plugins/trivia/tools/categories/getIdeas.ts` or equivalent), compute `firstFireOfSeason` at the end of the handler:
      - false when seasons disabled, OR `findCurrentSeason` returns null
      - else: count saved questions where `q.season === currentSlug` for the resolved game; `firstFireOfSeason = (count === 0)`
- [x] 4.2 Add `theme` to the response when the current season's `theme` is a non-empty string; OMIT the key entirely otherwise (do not serialize null or empty string)
- [x] 4.3 Extend the tool's output zod schema / type definitions to include the two new fields
- [x] 4.4 Write tests covering:
      - `firstFireOfSeason: true` when zero stamped questions exist
      - `firstFireOfSeason: false` after one stamped question saved
      - `firstFireOfSeason: false` during a gap
      - `firstFireOfSeason: false` when seasons disabled
      - `theme` mirrored verbatim when set
      - `theme` key absent (not null) when unset

## 5. Question-posting prompt (`SEND_QUESTIONS_INSTRUCTIONS`)

- [x] 5.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, add a new prompt section near the top of `SEND_QUESTIONS_INSTRUCTIONS` that documents the opener branch — keyed on `firstFireOfSeason === true` from the `get_ideas` payload
- [x] 5.2 Spell out the two-block structure: `header` block with literal `"🆕 NEW SEASON"` prefix (Unicode, not `:new:`), then a `section` block of in-persona prose naming the slug and (conditionally) the theme
- [x] 5.3 Explicitly tell Claude NOT to render the opener blocks when `firstFireOfSeason` is `false`
- [x] 5.4 Explicitly tell Claude NOT to mention a theme when `theme` is absent — no fabrication, no category-enumeration fallback, no "no theme yet" phrasing
- [x] 5.5 Place the branch outside the single/multi-question split so it applies uniformly to both flows; opener blocks sit ABOVE the entire question-content payload
- [x] 5.6 Reference the Unicode-emoji-in-Slack-blocks rule (consistent with the table-cells rule documented elsewhere in the prompt)

## 6. Prompt assertion tests

- [x] 6.1 In `scheduledPrompts.test.ts`, assert `SEND_QUESTIONS_INSTRUCTIONS` references `firstFireOfSeason`
- [x] 6.2 Assert the prompt mentions the `header` + `section` opener shape
- [x] 6.3 Assert the prompt contains the literal Unicode `🆕` (sanity-check there is no accidental `:new:` shortcode use)
- [x] 6.4 Assert the prompt explicitly forbids mentioning theme when absent (regex on "do NOT" near "theme")
- [x] 6.5 Assert the opener branch documentation is positioned so it applies to both single-question and multi-slot flows

## 7. Integration smoke test

- [x] 7.1 Add an integration-style test (or extend an existing one) that:
      - Bootstraps a game with seasons enabled
      - Calls `get_ideas` → asserts `firstFireOfSeason: true`
      - Calls `save_question` with the returned context
      - Calls `get_ideas` again → asserts `firstFireOfSeason: false`
- [x] 7.2 Variant of the above where the season has `theme: "Halloween Spooktacular"` set via `upsert_season` — assert `theme` flows through to `get_ideas` output on the first call

## 8. Type-check, lint, format

- [x] 8.1 `npx tsc --noEmit` clean
- [x] 8.2 `npx oxlint <touched files>` clean
- [x] 8.3 `npx oxfmt <touched files>` applied
- [x] 8.4 Full `npm test` green

## 9. Spec sync (post-implementation)

- [x] 9.1 Run `openspec validate add-trivia-season-opener --strict` and confirm green
- [x] 9.2 Verify implementation matches each scenario in the three spec deltas (`trivia-seasons`, `trivia-categories`, `trivia-scheduled-prompts`); add missing tests for any uncovered scenario
- [ ] 9.3 When complete, run `/opsx:archive add-trivia-season-opener` to fold deltas into the canonical specs
