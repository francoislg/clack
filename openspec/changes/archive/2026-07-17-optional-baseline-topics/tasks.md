## 1. Topic content reorg (shipped defaults)

- [x] 1.1 Create `data/default_configuration/user/topics/response-rendering/` and move `block-kit-formatting.md`, `slack-formatting.md`, `response-style.md` into it unchanged
- [x] 1.2 Split `data/default_configuration/user/submit-response.md`: baseline stub keeps must-call contract, `skip_response` semantics, multi-message gating, plus the attach-before-composing hint; rich-composition guidance moves to `topics/response-rendering/submit-response-rendering.md` (review split against `submit-response-mode` and `skip-response` spec scenarios)
- [x] 1.3 Add `src/instructions.defaultContent.test.ts` asserting the shipped baseline stub (`data/default_configuration/user/submit-response.md`) retains the must-call + `skip_response` + multi-message-gating language and contains the attach hint, and that the moved files exist under `user/topics/response-rendering/` (not at their old baseline paths)

## 2. Auto-attach by trigger type

- [x] 2.1 Create `src/claude/builtinTopics.ts` exporting the trigger→topics constant and a `builtinTopicsForTrigger(triggerType)` helper (interactive triggers → `["response-rendering"]`; `scheduled` → `[]`), with unit tests in `src/claude/builtinTopics.test.ts`
- [x] 2.2 Merge built-in topics (deduped) with caller-supplied `preAttachedTopics` at the session-start call sites feeding `buildSystemPrompt` / `processMessage`; cover each interactive trigger type and the scheduled passthrough with tests
- [x] 2.3 Add assertions that worker mode (`runClaude` uses `EXECUTION_SYSTEM_PROMPT`, no cascade) and the auto-respond pre-analysis prompt path receive no built-in topics — extend the existing execution/pre-analysis test files rather than inspecting by hand

## 3. Instructions-only catalog entry

- [x] 3.1 Add a code-level default registry entry for `response-rendering` (description only, guidance-only wording, no server) following the `DEFAULT_GITHUB_REGISTRY_ENTRY` pattern: define it beside the github default and insert it in `resolveEffectiveRegistry` (`src/mcp.ts`) when absent from the operator registry
- [x] 3.2 Test: `attach_integration("response-rendering")` resolves the topic files via the `instructions_only` path; duplicate attach on a pre-attached session short-circuits

## 4. Schedule tools: attached_topics

- [x] 4.1 Add `attached_topics` arg to `create_scheduled_message` (`src/tools/actions/createScheduledMessage.ts`; default `["response-rendering"]` when omitted) mapped to `createJob`'s `attachedTopics`; tests for default, explicit list, explicit empty
- [x] 4.2 Add `attached_topics` arg to `update_scheduled_message` (`src/tools/actions/updateScheduledMessage.ts`; replace; empty array clears) mapped to `updateJob`; tests
- [x] 4.3 Create `src/tools/actions/topicValidation.ts` with a shared `validateTopicNames(names)` used by both tools — enumerate known topics via `scanTopicNames` across the role chain (`src/cascadingConfigResolver.ts`) + `buildVirtualDefaults()` (`src/instructions.ts`) + effective-registry names; reject unknown names listing both the invalid entries and the known set; tests
- [x] 4.4 Update the scheduling topic instructions (`user/topics/scheduling/scheduling.md`) to document `attached_topics`

## 5. Boot migration

- [x] 5.1 Via `/create-migration`: stamp `attachedTopics: ["response-rendering"]` onto existing non-plugin-managed cron jobs missing the field; leave plugin-managed jobs untouched; test cases for both

## 6. Validation-error hint in submit_response

- [x] 6.1 Detect formatting-class errors (from `validateSingleMessage`) separately from action-class errors in the collect-all aggregator; append the attach hint only when formatting errors exist AND `response-rendering` is unattached (manager attach state + session pre-attached topics)
- [x] 6.2 Tests: formatting failure without topic → hint; action-only failure → no hint; attached session → no hint

## 7. Audit + docs

- [x] 7.1 Audit plugin cron specs (trivia, idler summary, casual-talk) and add `"response-rendering"` to `attachedTopics` on every spec that posts rich output; leave idler sync/work specs lean
- [x] 7.2 Deploy-time check: audit VM `data/configuration/user/` for overrides of the four moved files and re-home them to `topics/response-rendering/` (audited 2026-07-17: no overrides of the four files exist on the VM — nothing to re-home)
- [x] 7.3 Add a "Built-in topics" paragraph to CLAUDE.md's Instruction System section (trigger→topic map, the `response-rendering` topic, the user-schedule default) and update `docs/status-server.md`'s `/prompt` examples to mention `topics=response-rendering`
- [x] 7.4 Manual acceptance (post-implementation, uses the `/prompt` endpoint): render an interactive-role prompt and a lean scheduled prompt, record the size delta and confirm content parity for interactive sessions — evidence for the commit message, not a code artifact (measured locally via `loadInstructions`: owner cascade 59,663 chars with the topic vs 42,324 lean — 17,339 chars ≈ 4.3k tokens saved per lean scheduled fire)
