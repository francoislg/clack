## 1. Elapsed-time plumbing (autoRespond.ts)

- [x] 1.1 In `resolveAutoRespondContext`, after building `enrichment`, derive `secondsSinceLastBotMessage` from the most recent bot entry in `enrichment.history` (filter `isBot`, take last, parse `ts`) compared to the incoming `messageTs`; leave it `undefined` when no prior bot message exists.
- [x] 1.2 Pass `secondsSinceLastBotMessage` into the `runPreAnalysis` call on the thread-reply path.
- [x] 1.3 Pass `secondsSinceLastBotMessage` into the `runActiveRunPreAnalysis` call on the active-run path.

## 2. Main gate prompt (runPreAnalysis in preAnalysis.ts)

- [x] 2.1 Add a new optional `secondsSinceLastBotMessage?: number` parameter; render a human-readable elapsed-time line (reuse `formatRelativeAge`) into the prompt only when defined.
- [x] 2.2 Add a DIRECT-ADDRESS OVERRIDE block at the top of the classification section: by-name address or a bot-only imperative/question rules out `"skip"`; verdict follows intent (request/question → `"respond"`, explicit sign-off/stop → `"stop"`); takes priority over tone assessment; note that explicit `<@mention>` never reaches this gate.
- [x] 2.3 Add a TEMPORAL-PROXIMITY block: short gap ⇒ strong lean to `"respond"`; lean decays with the gap; elapsed time alone is never grounds for `"skip"`/`"stop"`.
- [x] 2.4 Rewrite the `"stop"` definition with positive framing — fire on explicit sign-off or clear topic change with no bot involvement across several messages; remove the tone-based "prefer stop in serious threads" steer; avoid blunt "DO NOT" phrasing.
- [x] 2.5 Verify `"skip"` remains the documented default for ambient/between-other-users chatter (no loosening).

## 3. Active-run gate prompt (runActiveRunPreAnalysis in preAnalysis.ts)

- [x] 3.1 Add the same optional `secondsSinceLastBotMessage?: number` parameter and elapsed-time line.
- [x] 3.2 Mirror the DIRECT-ADDRESS guidance (directed follow-up → `"append"`, never `"skip"`).
- [x] 3.3 Mirror the TEMPORAL-PROXIMITY guidance (short gap ⇒ strong lean to `"append"`; long gap never forces `"skip"`).

## 4. Tests

- [x] 4.1 Unit tests for `runPreAnalysis` (stub `clackQuery`): by-name request → `"respond"`; "Clack, stop" → `"stop"`; directed message never `"skip"`; ambient name-drop ("ask Clack tomorrow") still `"skip"`.
- [x] 4.2 Unit tests for the elapsed-time line: present when a prior bot message exists, omitted when not; long-gap message that is otherwise a reply does not resolve to `"skip"`/`"stop"`.
- [x] 4.3 Unit tests for `runActiveRunPreAnalysis`: directed follow-up → `"append"`; ambient cross-talk → `"skip"`.
- [x] 4.4 Handler test in `autoRespond` covering `secondsSinceLastBotMessage` derivation (bot message present vs absent) and that it is forwarded to both gates.

## 5. Verify

- [x] 5.1 Run `npx tsc`, `npx oxlint src/claude/preAnalysis.ts src/slack/handlers/autoRespond.ts`, `npx oxfmt --check`, and `npm test`.
- [x] 5.2 Re-run `openspec validate improve-preanalysis-direct-address --strict`.
