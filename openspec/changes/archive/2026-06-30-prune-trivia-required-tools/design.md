## Context

The `submit_response` required-tools gate (`src/tools/presentation/submitResponse.ts:998-1010`) refuses to accept termination until every tool in the run's `requiredTools` set has been recorded as called, and returns an error telling Claude to "Call them before submitting." The recorder counts a call whenever the handler runs — on success, on a returned `errorResult`, or on a thrown exception (`src/tools/server.ts:198-211`); only a Zod-schema rejection (handler never runs) leaves a call uncounted.

Trivia declares four required-tools lists in `src/plugins/trivia/domain/buildGameSpecs.ts`. Several entries are **conditional** — invoked by the prompt only in some run shapes. Because the gate force-calls every entry, conditional entries misfire:

- Read-only conditional tools (`find_previous_questions`, `find_previous_subjects`) → a wasted submit→bounce→retry round-trip.
- Mutating conditional tools (`save_question`, `settle_question`, `update_question`) → Claude must invent arguments; `settle_question` was observed re-settling a real question with `override: true`, surviving only because `rescored: 0`.
- `post_questions` with `.min(1)` items → on a flexible zero-question day, no valid call exists, so the gate cannot be satisfied without fabricating a question.

Production transcripts (game `fifa-predictions`, channel `C0B9TTGB8HJ`) show **every** recent fire of both crons bouncing the gate. This is the steady state, not an edge case.

`requiredTools` feeds ONLY the gate plus a name-validity warning (`src/tools/server.ts:676,698-709`); it does not restrict the available tool set (that is `disallowedTools`, set elsewhere). Pruning a tool therefore does not make it unavailable — the prompt still calls it via the normal tool surface / ToolSearch.

## Goals / Non-Goals

**Goals:**
- Each trivia required-tools list contains ONLY tools called on 100% of valid runs of that spec.
- Eliminate the per-fire gate bounce and the forced-mutation hazard on reveals and staged question/prep runs.
- Keep the `post_questions` deliverable guarantee for non-flexible games.
- Pin the invariant with a guard test and a doc comment so the next contributor doesn't re-introduce a conditional tool.

**Non-Goals:**
- Changing the gate mechanism in `submitResponse.ts`. This change only corrects which tools each trivia cron declares.
- Closing the season-imposed-flexible `post_questions` deadlock (see Risks). That would require an empty-array no-op on `post_questions`; deferred.
- Touching the lock list (`["mcp__trivia__lock_questions"]`) — already minimal and idempotent.
- Re-spec'ing the obsolete `process_reveal_answers` name beyond the requiredTools requirement being modified here.

## Decisions

### D1: Prune to the always-called set per cron

Final lists:

| Spec | requiredTools |
|---|---|
| PREP | `[get_ideas, find_previous_questions]` |
| QUESTION (non-flexible) | `[get_ideas, post_questions]` |
| QUESTION (flexible) | `[get_ideas]` |
| REVEAL | `[compute_answers]` |
| LOCK | `[lock_questions]` (unchanged) |

Rationale: the gate's value is "you cannot finish without doing the mandatory step." The mandatory step is the deliverable (`post_questions` for a normal question fire) or the single hot-path tool (`compute_answers` for reveal). Everything else the prompt drives conditionally. `get_ideas` is retained everywhere it applies because it opens every generation flow and is read-only (harmless even if it were ever forced).

### D2: Branch the QUESTION list on `game.format?.flexible`

`post_questions` is the deliverable for a non-flexible fire but is legitimately skipped on a flexible zero-question day. `buildGameSpecs` already receives the `TriviaGame`, so `game.format?.flexible` is readable at build time. Build the question list conditionally.

Alternatives considered:
- *Keep `post_questions` always required* → re-introduces the flexible-zero deadlock (rejected).
- *Empty-array no-op on `post_questions` (keep it required for all)* → fully closes the deadlock incl. season-flexible, but expands scope to the tool schema + the FORMAT_AND_POST prompt. Deferred; recorded as the future closure for the residual gap.
- *Drop `post_questions` entirely* → simplest but loses the deliverable guard for normal games (rejected — the guard is cheap and valuable when it is genuinely always-called).

### D3: Correct spec drift across all specs that document the lists

The `requiredTools` contract is documented in more than one place, and all the copies have drifted. `trivia-managed-schedules` ("Required Tools…") and `trivia-scheduled-prompts` ("requiredTools per spec") both still name `process_reveal_answers` (long since split into `compute_answers` et al.) and describe the pre-prune lists. `trivia-scheduled-prompts` additionally carries a standalone "Reveal `requiredTools` includes `update_question`" requirement that directly contradicts the prune. The deltas restate the two "list" requirements against current reality and REMOVE the contradicting `update_question` requirement (with a migration note: the tool stays registered and is still called by the prompt's `"yes"` branch — only its gate-list membership is dropped). `trivia-games` only asserts "prep excludes `post_questions`", which stays true, so it needs no delta.

### D4: Add a guard test for the invariant

A test asserts none of trivia's required-tools lists contains a tool from a small denylist of known-conditional/mutating tools (`save_question`, `find_previous_subjects`, `settle_question`, `update_question`, `update_answers_block`, `start_new_season`). This converts the invariant from a comment into a failing test if violated.

### D5: Delete the dead `CREATE_SCHEDULES_INSTRUCTIONS` rather than prune it

`CREATE_SCHEDULES_INSTRUCTIONS` (`scheduledPrompts.ts`) is a second hardcoded source of `requiredTools` lists (the old manual `create_scheduled_message` admin flow). It has the same conditional-tool bug — but it is **dead**: no production code imports it (only its own export + one test), and it instructs calling `send_questions_instructions`, a tool that is no longer registered. Schedules are now internally managed by `buildGameSpecs` auto-reconcile. So rather than maintain a parallel pruned copy, delete the constant and its test outright — removing the drift source permanently. Alternative considered: prune its lists to match. Rejected — pruning dead code just preserves a maintenance trap; the only value-add is deletion.

## Risks / Trade-offs

- **Season-imposed flexible format still deadlocks `post_questions` on a zero-question day** → `buildGameSpecs` is season-independent by design (pinned by an existing test), so it can't detect a season-level `flexible`. Mitigation: documented residual; the per-game branch covers the common case (game-level flexible); full closure tracked as the empty-array-no-op follow-up. Severity is low — it requires a season to impose a flexible format AND a zero-material day to coincide.
- **Losing the gate as a "did Claude dedup?" nudge** → removing `find_previous_questions` means the gate no longer forces a dedup call. Mitigation: the gate never guaranteed *good* dedup anyway (a junk call satisfied it); dedup is driven by the prompt, which is unchanged.
- **Reveal no longer force-completes season rollover / card edits** → these were only ever force-called as a side effect of the bug; the prompt already invokes them when applicable. Mitigation: the prompt logic is the real driver and is untouched; the transcript evidence shows the forced calls were spurious or harmful, not load-bearing.

## Migration Plan

No data migration. Pure code + spec change. Deploy is a normal build/restart; cron specs reconcile in place on next plugin load (`reconcileCronJobs` is idempotent). Rollback is reverting the constants — no persisted state depends on the list contents.
