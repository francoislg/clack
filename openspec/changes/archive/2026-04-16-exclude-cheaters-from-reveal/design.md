## Context

The Trivia plugin's interactive `trivia-check` instruction silently records cheat attempts via `save_cheating` (per `trivia-cheating-detection`), persisting `cheats.json` keyed by `(cheaterUserId, questionId)`. The scheduled answer-reveal run (`process_responses_instructions` per `trivia-scheduled-prompts`) does not consume this data: it categorizes every reactor — including caught cheaters — into "Nailed it!", "Not quite!", fence-sitter, or wildcard buckets, and submits their votes via `submit_answers`. The cheater is publicly mentioned in the reveal and their stats accumulate.

Two structural facts drive the design:

1. **No reader exists for cheats.** `save_cheating` is write-only (per its tool description and the existing spec). The data sits in `cheats.json` unreachable from any tool, so the reveal flow can't filter on it.
2. **`find_previous_questions` over-shares.** The tool is gated to `member` (lowest tier, used by `trivia-check` in any session) and returns the full `TriviaQuestion`, including `isTrue` — the answer key. This is a pre-existing leak: any user can prompt Clack to surface past questions and their truth values.

Schedule B's reveal run also has a latent gap: step 8 of `process_responses_instructions` requires a `questionId` for `submit_answers`, but Schedule B's `requiredTools` doesn't currently include `find_previous_questions`. There is no documented path to obtain the ID. Adding `find_previous_questions` to Schedule B is needed regardless.

## Goals / Non-Goals

**Goals:**
- Cheaters caught on a question are **silently** excluded from that question's reveal — they don't appear in any voter section, their reactions don't count toward stats, and the message never alludes to their exclusion.
- Cheater identities and answer-key data become reachable only by admin+ sessions and the deployment owner DM.
- Schedule B can reliably obtain a `questionId` for `submit_answers`.
- Provide a foundation for future per-question history features (leaderboard, "who answered" views) without further plumbing.

**Non-Goals:**
- Auto-migrate pre-existing Schedule B cron jobs. Per the existing `trivia-scheduled-prompts` policy, admins re-run the setup recipe to upgrade.
- Change `save_cheating` semantics, the `trivia-check` interactive flow, or owner DMs.
- Surface cheaters anywhere visible to non-admins (no "🚨 cheaters today" line, no asterisks, no implicit count drops).
- Retroactively re-process past reveals.

## Decisions

### Decision 1: Two tools, not one

**Choice:** Keep `find_previous_questions` (member) returning *only* search-safe metadata. Introduce a separate `get_question_history(questionId)` (admin) returning `isTrue`, `cheaterUserIds`, and `responses`.

**Alternatives considered:**
- **Single tool, always-on extra fields.** Add `cheaterUserIds`, `responses`, `isTrue` to `find_previous_questions` for everyone. Rejected: leaks the answer key and cheater identities to any member-tier session; a determined user could prompt Clack into dumping it.
- **Single tool, role-aware response shape.** Same tool returns extra fields only when the session is admin+. Rejected: same tool returning different shapes by role is surprising, hard to test, and obscures the contract; the leak risk for `trivia-check` (member context) remains structurally awkward.
- **Single tool, opt-in `includeHistory` flag.** Cheaper API surface. Rejected: still one tool callable by `member`, so the gate is the flag value, not the role — easy to misuse and harder to audit.

**Rationale:** Splitting along the role boundary makes the gate self-evident and forces a deliberate decision at every call site. Schedule B (admin context) gets both tools in `requiredTools`; `trivia-check` (any-tier context) keeps only the safe one.

### Decision 2: Drop `isTrue` from `find_previous_questions` entirely

**Choice:** Remove `isTrue` from the response shape (BREAKING for any external caller, but no internal caller depends on it).

**Alternatives considered:**
- **Keep `isTrue`, add admin gate.** Move the whole tool to admin. Rejected: `trivia-check` *requires* member-tier access and uses `find_previous_questions` heavily for cheat detection.
- **Keep `isTrue`, document the leak.** Rejected: per project policy, "pre-existing" is not an excuse to skip a fix when the change touches the surrounding area.

**Audit of internal callers:**
| Caller | Uses `isTrue`? |
|---|---|
| `trivia-check` instruction (any session) | No — only compares `statement` text |
| Schedule A (question generation) — duplicate check via step 4 | No — only compares `statement` text |
| Schedule B (reveal) — researches truth fresh per step 3 | No — by design, validates independently |
| Server-side scoring in `submit_answers` | Reads `data.loadQuestions()` directly, never via the MCP tool |

Removing `isTrue` from the tool response is safe across all known consumers.

### Decision 3: Silent exclusion at the reveal layer, not the storage layer

**Choice:** Cheaters' submitted answers (if any did get persisted before being caught) remain in `answers.json` as historical record. The exclusion happens in the reveal-time categorization: drop `cheaterUserIds` from each reaction list before partitioning voters and before building the `submit_answers` payload.

**Alternatives considered:**
- **Filter inside `submit_answers`.** Server-side drop, can't be bypassed by Claude. Rejected: doesn't help the user-facing reveal — Claude would still mention cheaters in "Nailed it!" / "Not quite!" sections built from its own categorization.
- **Hard-delete cheater answers from `answers.json`.** Rejected: destroys auditable history; the `responses` field on `get_question_history` would lose the record of what the cheater claimed.

**Rationale:** The reveal flow is the only place that surfaces voters publicly, so it's the only place the silent drop matters. `responses` continues to reflect the storage truth.

### Decision 4: Reuse `find_previous_questions` to obtain the `questionId`

**Choice:** Schedule B's reveal run calls `find_previous_questions` with a keyword from the message statement to find the matching question and grab its `id`, then calls `get_question_history(id)` for the cheater list and `isTrue` (research-validated separately).

**Alternatives considered:**
- **A new `find_question_by_statement` tool.** Rejected: redundant with what `find_previous_questions` already does (text search). One more tool to register and gate.
- **Stamp `questionId` into the trivia message itself** (e.g., a hidden footer block). Rejected: changes question-posting behavior, surfaces internal IDs in the user-facing message, and creates a parallel discovery mechanism.

**Rationale:** Closes the latent gap (no documented `questionId` discovery for Schedule B) using the existing tool with no new surface.

### Decision 5: `responses` shape

**Choice:** `responses: { userId: string, displayName: string, answer: boolean, correct: boolean }[]`. Drop `timestamp` and `questionId` (the latter is redundant with the lookup key; the former is not needed for any current or near-future use case).

**Rationale:** Minimal payload covering the natural questions: who answered, what did they say, were they right. `displayName` is enriched at read time from `users.json` so the consumer doesn't need to make a second lookup.

### Decision 6: No data migration; old cron jobs degrade gracefully

**Choice:** Pre-existing Schedule B cron jobs whose `requiredTools` predates this change continue to function — Claude won't have access to the new tools, so categorization runs as today (no exclusion). Admins re-run `create_schedules_instructions` to upgrade.

**Rationale:** Matches the existing policy in `trivia-scheduled-prompts` for the fat-prompt → thin-dispatcher migration. Keeps the change reversible.

## Risks / Trade-offs

- **Pre-existing schedules behave inconsistently until re-run.** → Admins are notified to re-run setup; the spec already establishes this expectation pattern.
- **Cheater submits an answer before being caught, then is excluded from reveal but their answer persists in `answers.json`.** Their `responses` entry shows up in `get_question_history` even though they're absent from the reveal. → Acceptable: storage records what was submitted; reveal records what was counted. The two should diverge here.
- **Schedule B does its own research per step 3 — could disagree with `isTrue` from storage.** → Pre-existing trade-off; this change does not alter it. The reveal trusts research, not storage. `get_question_history.isTrue` reflects storage and is provided for completeness, not as the canonical reveal truth.
- **`find_previous_questions` keyword-matching to find `questionId` may fail on edge cases** (e.g., paraphrased statements, multiple matches). → The instruction directs Claude to use a distinctive keyword from the statement; ambiguity falls back to inspecting `createdAt` order. Documented in the prompt.
- **Privacy-by-tool-gating only protects against non-admin users.** Admins can read all cheater identities. → Intentional; admins already receive owner-DM notifications today.

## Migration Plan

1. Ship the new tool and updated instructions. Admins continue with old cron jobs.
2. Admins re-run `create_schedules_instructions` per channel to refresh Schedule B's `requiredTools`. Confirmation message lists the updated tool set.
3. No data migration — `cheats.json`, `answers.json`, `questions.json`, `users.json` are read as-is.
4. **Rollback:** revert the code change and re-run setup; the new `requiredTools` entries become inert (the tools no longer exist), and old behavior resumes.

## Open Questions

- Should `get_question_history` also expose `categoryUsageCounters` or other aggregates for future leaderboard tooling, or stay strictly per-question? Lean: stay focused; aggregates can ship as a separate tool when needed.
- Should the description of `get_question_history` warn against surfacing cheater identities in user-facing output (analogous to `save_cheating`'s silence rule)? Lean: yes — admin-only access protects from members, but the description should remind Claude that cheater names stay internal even within an admin session unless explicitly asked.
