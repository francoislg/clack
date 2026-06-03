## Context

The `unify-trivia-button-answers` change established `AnswerTypeHandler` as the registry that lets each of the three trivia answer-shapes (`boolean`, `choice`, `freeform`) own its own per-format behavior. The interface today covers:

- Button-block rendering (`appendActionsBlock`)
- Live-roster grouping + labeling (`rosterGroupKey`, `rosterGroupLabel`)
- Reveal-time pipeline (`processReveal`, `buildRevealAnswer`)
- Synchronous click scoring (`resolveClick`, on the `ClickableAnswerHandler` sub-interface)

What it does NOT cover, today, are five other lifecycle points where consumers branch on the format string directly. Those points are:

| Lifecycle point | Today | Lines that branch |
|---|---|---|
| `save_question` field validation | `if (answersFormat === "boolean") { ... } else if (...) { ... }` | `saveQuestion.ts:180-289` |
| `save_question` record composition | ternary `answersFormat === "boolean" ? ... : ...` | `saveQuestion.ts:457-472` |
| `get_ideas` per-format roll metadata | `if (pickedAnswersFormat === "choice") { ... } if (pickedAnswersFormat === "freeform") { ... }` | `getIdeas.ts:239-265` |
| `get_question_history` response shape | `isChoice ? choiceShape : booleanShape` (no freeform branch!) | `getQuestionHistory.ts:82-128` |
| Action-handler wire-up | hardcoded regex `^vote:[^:]+:[^:]+$` + separate `freeform-answer:*` | `handlers.ts:72, 205` |

Adding a fifth format means editing every one of those files. The current state is "abstraction half-done."

Two interface-level leaks compound the problem:

1. **`AnswerPayload` is a public discriminated union** (`types.ts:80-83`). The vote handler unpacks it via `"answer" in scored.payload` / `"answerIndex" in scored.payload` (`handlers.ts:166-188`). Adding a format means adding a payload variant AND editing the caller's destructuring.
2. **Action-id shapes are caller-known**, not handler-owned. `handlers.ts` registers `^vote:[^:]+:[^:]+$` and `^freeform-answer:[^:]+$` directly; the handlers don't decide what action-ids they own.

This design extends the interface to cover all five lifecycle points and closes both leaks.

**Constraints:**

- Stays inside `src/plugins/trivia/` per the plugin sandbox rule
- No change to the on-disk shape of `questions.json` / `answers.json`
- No change to the Slack wire format (`action_id` strings stay identical)
- `get_question_history` is admin-gated; the freeform fix is a strict superset of today's output shape

**Stakeholders:**

- Future-format authors (the whole point of this change is to make adding a fifth format a single-file affair)
- Admins running `get_question_history` on freeform questions (today's output is misleading)
- The `unify-trivia-button-answers` change in flight — this change builds on its abstraction without altering its specs

## Goals / Non-Goals

**Goals:**

- Every per-format-string branch outside `answerTypes/` is moved into a handler method.
- `AnswerPayload` is internal; callers see opaque `ResolvedClick` only as input to handler methods.
- Handlers own their action_id registration (regex + dispatch body).
- `get_question_history` returns a correct freeform-shaped response for freeform questions.
- The handler interface still serves all three existing formats with zero behavior change at the user-visible boundary (Slack messages, reveal output, on-disk records).

**Non-Goals:**

- Abstracting the orthogonal `questionType: "fact" | "topical"` axis. That's a much larger change (it would refactor the entire scheduled-prompts matrix and the topical/sourceUrl validation). Captured as a future change idea, not this one.
- Changing the per-format roll-and-pick logic in `get_ideas` (`weightedPick` over the answers-format weights stays where it is).
- Touching `RevealAnswer` / `RevealAnswerDescriptor`. The unify change explicitly preserved this as a public discriminated union because the Claude-facing reveal prompt branches on `answer.type` — that's by design.
- Renaming the `freeform/` directory (unify decided against the rename for blast-radius reasons; this change inherits that call).

## Decisions

### D1. Handler interface extension — four new methods plus a click-patch hook

**Decision:** Add the following methods to `AnswerTypeHandler`:

```typescript
interface AnswerTypeHandler {
  // ... existing methods ...

  /**
   * Validate the per-format save args AND compose the persistable
   * TriviaQuestion in one step. The tool runs all cross-format checks first
   * (statement length / emojis / slot / category / context / fact-vs-topical /
   * sourceUrl); this method handles the per-format slice only.
   */
  getSavedQuestion(
    base: TriviaQuestionBase,
    args: SaveQuestionArgs,
    ctx: SaveValidationContext,
  ): { ok: true; question: TriviaQuestion } | { ok: false; error: string };

  /**
   * Roll the per-format suggestion metadata returned by get_ideas. Boolean
   * returns { suggestedAnswer: boolean }; choice returns { suggestedChoiceCount,
   * suggestedCorrectIndex }; freeform returns { suggestedFreeformAnswerShape }.
   * The cross-format roll (which format was picked) happens in the tool.
   */
  rollGenerationSuggestions(deps: SuggestionRollDeps): Record<string, JsonValue>;

  /**
   * Project a question + matching answer rows into the get_question_history
   * response payload. Each handler owns its own response shape, so freeform
   * stops falling through to the boolean shape.
   */
  buildHistoryResult(
    question: TriviaQuestion,
    matching: readonly SubmittedAnswer[],
    users: ReadonlyMap<string, TriviaUser>,
  ): JsonValue;

  /**
   * Register the handler's interaction action_id patterns with the SDK. Called
   * once at plugin boot per handler. Boolean and choice register narrowly
   * scoped `^vote:[^:]+:(true|false)$` / `^vote:[^:]+:[0-9]+$` patterns;
   * freeform registers `^freeform-answer:...$`. The caller (`registerInteractiveHandlers`)
   * is a thin registry loop and doesn't know what regex each handler registers.
   */
  registerInteractions(sdk: ClackSdk, deps: InteractionRegistrationDeps): void;
}

interface ClickableAnswerHandler extends AnswerTypeHandler {
  resolveClick(rawValue: string, question: TriviaQuestion): ResolvedClick | null;
  /**
   * Convert a resolved click into the Partial<SubmittedAnswer> the vote
   * handler should merge / write. Replaces the caller's
   * `"answer" in payload` / `"answerIndex" in payload` destructuring.
   */
  toAnswerPatch(resolved: ResolvedClick): Partial<SubmittedAnswer>;
}
```

`AnswerPayload` is no longer exported. `ResolvedClick.payload` becomes a private internal type (the union is declared inside `types.ts` but not exported), so callers receive `ResolvedClick` only as opaque-feeling data that they thread into `toAnswerPatch`.

The handler-input type `SaveQuestionArgs` is sourced from a shared Zod schema fragment (`answerTypes/saveSchema.ts`) so the tool's input type and the handler's input type are the same `z.infer<>` — no `as` cast at the boundary.

**Why one combined `getSavedQuestion`, not separate validate + build:**

Initial design split this into `validateSaveArgs` + `buildQuestionRecord` so the tool could interleave cross-format checks between the two. That ordering turned out to be unnecessary: the tool's cross-format checks (statement length / fact-vs-topical / slot / category / context / slot-axis weight) all read fields that are stable across formats — none depend on the per-format validation outcome. Collapsing into a single method:

- Removes the "did I forget to validate before building?" trap. The handler can never produce a record without running its own checks.
- Removes a second cast-friendly path. Two methods both needed `SaveQuestionArgs`; merging them halves the type surface.
- Makes adding a fifth format simpler — one method, not two.

The tool runs ALL cross-format checks first, assembles `TriviaQuestionBase` (everything except the format-specific fields), and then calls `handler.getSavedQuestion(base, args, ctx)`. The handler returns either the complete record or a Claude-readable error.

**Why this surface area, not less:**

- `rollGenerationSuggestions` is one method (not three) because `get_ideas` already picks the format first and then attaches per-format metadata. The handler doesn't need to know about other formats.
- `buildHistoryResult` returns `JsonValue` (not a typed `HistoryEntry` union) because each handler's response shape is independent — there's no shared type the renderer wants to switch on. The MCP tool emits the handler's projection as the tool result.
- `toAnswerPatch` keeps `ResolvedClick` (rather than separately re-parsing the click) because `resolveClick` already did the work.
- `registerInteractions` runs at plugin boot. `freeform/handlers.ts:registerInteractiveHandlers` becomes a registry loop — `for (const h of getAllAnswerTypeHandlers()) h.registerInteractions(sdk, deps)` — and never hardcodes an action_id pattern.

**Alternatives considered:**

- Two-method split (`validateSaveArgs` + `buildQuestionRecord`). Initial design call. Rejected during implementation: the imagined "tool runs cross-format checks BETWEEN the two" never materialized — all cross-format checks fit cleanly before the handler call.
- A `HistoryEntry` discriminated union as the return type of `buildHistoryResult`. Rejected — would re-expose `type: "boolean" | "choice" | "freeform"` as a public type, defeating the encapsulation goal.
- Make `ResolvedClick` itself opaque (e.g. a `Symbol`-keyed brand). Rejected — over-engineered; removing `AnswerPayload` from the exports and keeping the union as a file-internal type is enough.

### D2. Vote-handler refactor — registry-driven action registration

**Decision:** `registerInteractiveHandlers(deps)` in `freeform/handlers.ts` becomes a loop:

```typescript
export function registerInteractiveHandlers(deps: InteractiveHandlerDeps): void {
  for (const handler of getAllAnswerTypeHandlers()) {
    handler.registerInteractions(deps.sdk, {
      data: deps.data,
      getGameNames: deps.getGameNames,
    });
  }
}
```

The `vote` action body (resolve owning game → load question → check lock/cheater → resolveClick → write `Partial<SubmittedAnswer>` → refresh roster) moves into a small shared helper consumed by both `boolean.ts` and `choice.ts`'s `registerInteractions`. The freeform handler's `registerInteractions` registers the modal-trigger flow that's currently in `handlers.ts:205`.

`getAllAnswerTypeHandlers()` is a new helper in `registry.ts` returning every handler instance in registration order. It's a thin wrapper — no behavior change.

**Why the shared helper for boolean/choice:** The two formats have nearly-identical vote-handler bodies (parse action_id, scope lookup, lockout check, cheater check, `resolveClick`, `toAnswerPatch`, persist, refresh). Splitting into two copies would be straight duplication. Putting it in `answerTypes/_helpers.ts` keeps it in the family and lets future clickable formats reuse it.

**Why not put the whole `registerInteractions` in a base class:** No classes anywhere in the plugin; the codebase prefers plain object literals. A function-export `installClickableInteractions(sdk, handler, deps)` matches the project style.

**Alternatives considered:**

- Keep `registerVoteHandler` in `handlers.ts` and have it dispatch on `question.answersFormat` to call handler methods. Rejected — that's just renaming the switch, not removing it; the goal is for the registration itself (the regex `^vote:[^:]+:[^:]+$`) to live with the formats that use it.
- Have each handler own its own action_id namespace (`plugin:trivia:vote-boolean:<id>` etc.). Rejected — changing the Slack action_id wire shape forces a coordinated deploy; the proposal explicitly preserves wire compatibility.

### D3. `getQuestionHistory` fix — freeform projection

**Decision:** `getQuestionHistory.ts` collapses to:

```typescript
const handler = getAnswerTypeHandler(question.answersFormat);
const payload = handler.buildHistoryResult(question, matching, users);
return textResult({
  ...payload,
  questionType,
  cheaterUserIds: cheaterOrder,
  ...extras,  // context, sourceUrl, eventDate
});
```

Each handler returns its own projection:

- **Boolean**: `{ answersFormat: "boolean", isTrue, responses: [{ userId, displayName, answer, correct? }] }`
- **Choice**: `{ answersFormat: "choice", choices, correctIndex, responses: [{ userId, displayName, answerIndex, correct? }] }`
- **Freeform** (NEW — previously fell through to boolean): `{ answersFormat: "freeform", expectedAnswer, acceptableAnswers?, gradingNotes?, responses: [{ userId, displayName, answerText, correct?, judgeReason? }] }`

`questionType`, `cheaterUserIds`, and the topical/context extras (`context`, `sourceUrl`, `eventDate`) are cross-format — they're attached by the tool after the handler returns.

**Why include `judgeReason` in the freeform response:** The judge stamps it on the `SubmittedAnswer` row (`SubmittedAnswer.judgeReason`) precisely so admins can audit verdicts after-the-fact. The history tool is the only admin-facing surface that reads back full answer rows, so this is where `judgeReason` should naturally land.

**Bug-status note:** This is a real bug fix, not just a refactor — today's behavior on a freeform question is to return `{ answersFormat: "boolean", isTrue: false, responses: [{ ..., answer: false }] }` for every row, which is wrong on shape, wrong on payload field, and silently broken. Anyone calling `get_question_history` on a freeform question today gets misleading output. The fix is a strict superset (no boolean/choice consumer breaks).

**Spec update:** `trivia-question-search` capability gains a freeform requirement section. `trivia-freeform-questions` capability documents the freeform history shape under "Pending Free-Form Answer Storage Semantics" (already partially covers it; this change tightens it).

### D4. `saveQuestion` refactor — what moves, what stays

**Decision:** All per-format work (validation + record composition) moves to `handler.getSavedQuestion(base, args, { config })` — one method call instead of two. The tool's other steps stay inline because they span the format axis or interact with cross-format cascades.

The order becomes:

```
1. requireWritableGame
2. cross-format basic checks (statement length, emojis)
3. fact/topical validation (sourceUrl / eventDate / HTTPS / host)
4. slot / format resolution
5. category resolution
6. context resolution
7. slot-axis weight check
8. base record assembled (TriviaQuestionBase — everything except format-specific fields)
9. outcome = handler.getSavedQuestion(base, args, ctx)
    └─ per-format validation
    └─ per-format record composition
10. if (!outcome.ok) return errorResult(outcome.error)
11. scoped.saveQuestion(outcome.question)
```

**Why everything per-format collapses into one method:** the imagined ordering reason for a two-method split (run cross-format checks BETWEEN validation and composition) turned out to be unnecessary — none of steps 2-7 depend on the per-format validation outcome. Collapsing into one method removes the "skip validation by accident" trap and halves the handler-input type surface.

**The fields the tool extracts and builds into `TriviaQuestionBase` before calling the handler:**
- `id`, `category`, `statement`, `answersFormat`, `questionType`, `emojis`, `createdAt`
- `season` (when a current season exists)
- `slot` (when the active format has slots, with the snapshotted slot label)
- `suggestedDifficulty`, `difficulty` (when supplied)
- `context` (when validated against the active contexts list)
- `sourceUrl`, `eventDate` (cross-format fact/topical fields)

**Why this split, not move-everything-into-the-handler:** Steps 3-7 read multiple cross-cutting config sources (the active season, the game entry, the slot, the global categories, the context cascade). Pushing them into the handler would either duplicate the cascade logic across three handlers or force them to take a dozen-field context object. The split keeps the handler purely focused on "given the format-shape args, produce the format-shape record."

**Alternatives considered:**

- Pass a context-object factory to the handler so it can run any cross-cutting check it wants. Rejected — turns the handler into a god-object; the format dimension is the right slice.
- Initial design's two-method split (`validateSaveArgs` + `buildQuestionRecord`). Rejected during implementation when the ordering it imagined turned out to be unnecessary.

### D5. `getIdeas` refactor — what moves

**Decision:** The conditional metadata attachment (`getIdeas.ts:239-265`) moves to `handler.rollGenerationSuggestions(deps)`. The format pick (`weightedPick(answersFormatWeights)`) and all cross-format roll metadata (categories, difficulty, contexts, theme, slot info, firstFireOfSeason) stay in the tool.

Each handler attaches what it needs:

- Boolean: `{ suggestedAnswer: Math.random() < 0.5 }`
- Choice: `{ suggestedChoiceCount, suggestedCorrectIndex }` rolled within active bounds
- Freeform: `{ suggestedFreeformAnswerShape }` rolled from the active weights

The tool's response is `{ ...base, ...handler.rollGenerationSuggestions(deps) }`.

**Why a flat `Record<string, JsonValue>` return:** The MCP tool's response is already shaped as JSON; there's no consumer that needs TypeScript narrowing on the suggestion field set. The flat return keeps the handler's surface minimal — no need for a type-discriminated return.

**Alternatives considered:**

- Have the handler also do the `weightedPick` and own the active-weight cascade resolution. Rejected — the weight cascade (`slot → season → game → workspace → default`) is part of the general config system, not the per-format SDK. Pulling it into the handler would force the handler to take the entire `(currentSeasonEntry, slotIndex, gameEntry, config)` tuple just for the weight resolution.

### D6. Action-id wire compatibility

**Decision:** The Slack action_id strings stay byte-for-byte identical to today:

- Boolean / choice: `plugin:trivia:vote:<questionId>:<value>`
- Freeform: `plugin:trivia:freeform-answer:<questionId>`

The change is purely internal — the registration MOVES into the handler, but what gets registered doesn't change.

**Why preserve wire format:** Pending questions live across deploys. If the deploy lands while a question is mid-round, button clicks would dead-letter. Preserving the action_id strings makes the change a hot-swap.

### D6b. Split `_helpers.ts` into four scoped modules

**Decision:** The pre-existing `answerTypes/_helpers.ts` (a single 191-line module of "shared reveal-time helpers") is split along its natural concern seams into four scoped modules:

- `revealMessage.ts` — Slack-side I/O: `parseMessageCoordinates`, `fetchQuestionReactions`
- `cheaterFilter.ts` — cheat filtering logic: `loadQuestionCheaterIds`, `buildExcludeSet`, `isScoredAnswer`
- `reactorBuckets.ts` — reactor-side computations: `buildReactorIndex`, `buildReactionsList`, `buildNoAnswerBucket`
- `revealOutcome.ts` — output-shape packager: `makeRevealOutcome`

**Why split:** the four concerns are distinct (Slack I/O / filter logic / bucket computation / output shape), each handler imports a different subset, and adding new helpers in any one category was tempting `_helpers.ts` toward becoming a junk drawer. Per the project's "small files + tests at creation" preference, splitting now keeps every future addition in its rightful module.

**Why not keep a `_helpers.ts` re-export façade for back-compat:** the project's user rule prohibits re-exporting code for convenience. Each handler updates its imports to the new four-module surface directly. The leading-underscore name (`_helpers`) was already a signal that the module was internal — splitting it is a pure internal refactor with no external callers.

**Decision:** Each new handler method gets a unit test in its owner file (`boolean.test.ts`, `choice.test.ts`, `freeform.test.ts`). The consumer tools (`saveQuestion.test.ts`, `getIdeas.test.ts`, `getQuestionHistory.test.ts`) keep their existing tests — those exercise the integration (tool-through-handler) end-to-end, and a regression there means either the handler is wrong OR the tool is calling it wrong, both of which we want to catch.

The freeform history bug gets a dedicated test (currently no test exercises that path because the bug was silent — no caller noticed).

**Coverage minimums for the new methods:**

- `validateSaveArgs`: happy path + every field-collision rejection from today's inline checks
- `buildQuestionRecord`: happy path + verify cross-format fields don't leak
- `rollGenerationSuggestions`: shape assertion (the actual random values aren't asserted; the test seeds `Math.random`)
- `buildHistoryResult`: each format's response shape + the empty-responses case
- `toAnswerPatch`: each format's resulting `Partial<SubmittedAnswer>` shape
- `registerInteractions`: mocked SDK; assert the regex registered + a representative click flows through

## Risks / Trade-offs

- **[Risk] The `registerInteractions` move could regress live trivia rounds across deploy** → Action-id wire format is preserved (D6) so pending click buttons keep working. The risk is functionally zero, modulo "the new code has a bug that the old code didn't" — covered by the test suite.
- **[Risk] `buildHistoryResult` returns `JsonValue` — easy to drift across handlers** → Each handler's shape is tested explicitly; the test file documents the shape. If we ever want stronger typing, we can return a per-handler interface and union them at the tool layer, but that's a future tightening.
- **[Trade-off] Five new methods on the handler interface is a wider contract** → Yes — adding a fourth format means implementing five more methods than today. The alternative (keeping the branches inline) means a fourth format means editing five more files. The interface widening is the smaller cost.
- **[Trade-off] `_helpers.ts` grows with a shared `installClickableInteractions` helper** → Minor — the helper is ~30 lines and replaces ~80 lines of duplicated vote-handler logic across boolean.ts/choice.ts. Net code reduction.
- **[Trade-off] Bug fix landed mid-refactor** → The `get_question_history` freeform fix is a behavior change. We're shipping it inside the refactor rather than as a separate hotfix because (a) the refactor is the cleanest place to land the correct projection, (b) the bug has been latent since freeform was added and nobody noticed in practice, and (c) the fix is a strict superset of today's output for boolean/choice consumers.
