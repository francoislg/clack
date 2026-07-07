## 1. Core session field + primitive

- [x] 1.1 Add an optional `creationContext?: string` to `SessionContext` (`src/sessions.ts`) and its zod schema (graceful/permissive — absence is legal, never wipes state).
- [x] 1.2 Rename `EngageThreadOptions.followUpContext` → `creationContext` (`src/sessions.ts`); in `registerThreadSession`, store it on the session's dedicated `creationContext` field instead of `additionalSystemPrompt`. Update the surrounding doc comment (no legacy-narration).
- [x] 1.3 Verify no other writer depends on `registerThreadSession` setting `additionalSystemPrompt`; adjust the `handlerResponse.ts` channel-reply handoff so that when the anchor session carries an `additionalSystemPrompt`, it is passed as the `creationContext` option to `registerThreadSession` (else pass nothing) — a pass-through, not a transformation.

## 2. Answer-turn injection

- [x] 2.1 In `src/claude/promptBuilder.ts`, inject `session.creationContext` as a labeled block (distinct from the existing `additionalSystemPrompt` "ADMINISTRATOR INSTRUCTIONS" injection). Keep it Claude-facing English.

## 3. Judge (pre-analysis) wiring

- [x] 3.1 Thread path (`src/slack/handlers/autoRespond.ts`, ~line 376 and the active-run variant): append `session.creationContext` to the `preAnalysisContext` string passed to `runPreAnalysis` / `runActiveRunPreAnalysis`. No signature change.
- [x] 3.2 Top-level ephemeral path (`resolveEphemeralConversation`): append `rule.creationContext` to the classifier context passed to the pre-analysis call.
- [x] 3.3 Answer path for ephemeral: rename `rule.followUpContext` → `rule.creationContext` in `buildChannelReplyPrompt`.

## 4. Ephemeral rule rename

- [x] 4.1 In `src/ephemeralRules.ts`, rename `followUpContext` → `creationContext` on the type, the zod schema, and `seedEphemeralRule`; accept a legacy `followUpContext` on read and map it to `creationContext` (short-TTL back-compat).
- [x] 4.2 In `src/slack/handlers/autoRespond.ts`, rename the `followUpContext` property on the local `EphemeralRule`-carrying deps/options type (~line 43) to `creationContext`.

## 5. Tool schema (Claude-facing, required)

- [x] 5.1 In `src/tools/presentation/submitResponse.ts`: rename `followUpContextField` → `creationContextField`, make it **required** (drop `.optional()`), broaden the `.describe(...)` to the provenance/background framing (why posted + facts to remember + reply handling; not shown to users).
- [x] 5.2 Rename `follow_up_context` → `creation_context` on the `post_to` action schema (~line 187) and the `deliver_to` entry schema (~line 882); update the mapping site (~line 1164) `entry.follow_up_context` → `entry.creation_context`. Also update any sibling-field descriptions that name the old field (e.g. `channel_attention_level`'s "sits alongside … `follow_up_context`" text) to say `creation_context`.
- [x] 5.3 Update `src/tools/types.ts` (`follow_up_context` at ~115/535 → `creation_context`; `followUpContext` at ~136 → `creationContext`) and `src/tools/server.ts` local var (`followUpContext` → `creationContext` at ~621/656/683).

## 6. Auto-execute seeding

- [x] 6.1 In `src/slack/handlers/autoExecute.ts`, map `action.creation_context` → `creationContext` when calling `registerThreadSession` (~628) and `seedEphemeralRule` (~652). NOTE: `attention_level` (thread → `registerThreadSession`) and `channel_attention_level` (top-level → `seedEphemeralRule`) already exist and already gate these two calls — this change does NOT add or re-gate them; it only threads `creation_context` through the existing calls (replacing the old `follow_up_context`).

## 7. Plugin SDK + trivia

- [x] 7.1 Rename the `engageThread` option `followUpContext` → `creationContext` in `src/plugins/sdk.ts` (signature at ~532/1381, mapping at ~1388, doc at ~526).
- [x] 7.2 Update the trivia call site `src/plugins/trivia/tools/questions/postQuestions.ts` (~377) `followUpContext:` → `creationContext:`.

## 8. Tests

- [x] 8.1 Schema: `creation_context` is required on `post_to` and `deliver_to` (missing → validation error); description present.
- [x] 8.2 Seeding: a non-`"off"` `post_to`/`deliver_to` seeds a session whose `creationContext` equals the field; `"off"` seeds nothing.
- [x] 8.3 Judge: thread pre-analysis and ephemeral pre-analysis receive the seeded `creationContext` in their context string; absence leaves context unchanged.
- [x] 8.4 Answer turn: `promptBuilder` injects `session.creationContext` as its labeled block.
- [x] 8.5 Ephemeral rule: legacy `followUpContext` on-disk reads back as `creationContext`.
- [x] 8.6 Ephemeral seeding: a top-level `post_to`/`deliver_to` with `channel_attention_level` stores the `creation_context` on the seeded ephemeral rule's `creationContext` (and the ephemeral judge path reads it).
- [x] 8.7 Update existing tests referencing `follow_up_context`/`followUpContext` (engaged-thread-registration, deliver_to, auto-execute, sdk `engageThread`, trivia postQuestions) to the new names.

## 9. Verify

- [x] 9.1 `npx tsc` (no emit) is clean.
- [x] 9.2 `npx oxlint` on changed files is clean; `npx oxfmt` applied.
- [x] 9.3 `npm test` passes.
