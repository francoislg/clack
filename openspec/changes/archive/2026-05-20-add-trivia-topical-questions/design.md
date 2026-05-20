## Context

The trivia plugin today has a single `type` field on every question and every config tier that conflates two concerns: the answer shape (`boolean` vs `choice`) and the source of the question (always static knowledge). This shows up most concretely in `src/plugins/trivia/domain/questionTypes.ts`, which resolves "what kind of question to generate next" by reading `config.trivia.questionsTypes` / `season.questionsTypes` / `slot.questionTypes`. When we go to add "current events" (topical) questions, every combination needs to be expressible — `topical + boolean`, `topical + choice`, `fact + boolean`, `fact + choice` — so we factor the existing field into two orthogonal axes.

Separately, the user wants questions to lean toward a particular angle: regional ("Quebec", "International"), audience ("academic", "pop culture"), or anything else a config author wants to specify. This is a third axis, optional, that overlays cleanly onto the existing generation flow. It is most useful for topical questions ("today's Quebec news") but composes with fact questions too ("write a Quebec-flavored history fact").

The codebase already has the cascade machinery (`slot → season → config → default`) and the precedent for server-side rolls fed to Claude through `get_ideas` (e.g., `suggestedAnswer`, `suggestedCorrectIndex`). This change extends those patterns without inventing new architecture.

Stakeholders: admins who configure trivia games (they need new config fields and a migration), end users (zero visible change unless an admin enables topical/contexts), and Claude (new prompt branches, but the same shape of server-rolled hints).

## Goals / Non-Goals

**Goals:**

- Factor `type` into two orthogonal axes: `answersFormat` (boolean vs choice) and `questionType` (fact vs topical). Make both server-rolled and independently weight-configurable per cascade tier.
- Introduce a `contexts` axis that biases questions toward a configurable lens, with a clean fallback mechanic for "this lens yielded nothing usable."
- Land the rename in a single static migration so old data is never seen by new code paths.
- Keep zero-configuration behavior identical to today's: a deployment that doesn't set `questionType` weights or `contexts` generates the same questions it does today.
- Require source citation on topical questions to make them auditable in the reveal.

**Non-Goals:**

- Per-`questionType` context weights (e.g., "only apply Quebec lens to topical questions"). Can be added later if real usage demands it; out of scope for v1.
- Server-side freshness enforcement (a `rangeDays` field, a `publishedAt` cross-check). v1 leaves the freshness window to Claude's judgment per the prompt.
- Topical-specific dedupe scoping. Existing statement-similarity in `find_previous_questions` already catches same-event duplicates.
- Reveal-flow polish (surfacing `sourceUrl` in the verdict, surfacing the `context` used). The fields are stored; UI changes can come later.
- New external dependencies. WebSearch is already in Claude's globally allowed tool list.
- Per-category weighting. Categories stay `string[]`. (We considered this in exploration; the contexts axis subsumed the practical need.)

## Decisions

### Decision 1: Two orthogonal axes (`answersFormat` × `questionType`) rather than one compound type

`type: "boolean" | "choice"` becomes `answersFormat: "boolean" | "choice"`. A new field `questionType: "fact" | "topical"` is added alongside it. Both are independently weighted and independently rolled.

**Why not a compound type (`"boolean.fact"`, `"choice.topical"`)?** A flat enum scales poorly. If we add a third axis later (e.g., difficulty-bucket type, or a `multi-step` answer format), we get combinatorial enum explosion. Two orthogonal fields compose; one compound field doesn't.

**Why not keep `type` and add a parallel boolean flag (`topical: true`)?** Considered in exploration. The "topical-as-flag" model breaks down when you ask "what's the weight of topical questions?" — a flag isn't a weight. Making it a proper axis with weights `{ fact: 3, topical: 1 }` mirrors the existing `answersFormat` weights and uses the same cascade machinery. Symmetric data is easier to reason about and easier to extend.

**Alternative considered:** Keep `type` and add `nature: "fact" | "topical"`. Less migration churn, but leaves `type` permanently ambiguous about which axis it represents. We chose the full rename for long-term clarity.

### Decision 2: Contexts as a weighted-random ordered priority list, not a single rolled value

When `contexts` is configured at any cascade tier, `get_ideas` returns `contextPriority: string[]` — a freshly-rolled weighted-random ordering of every configured context (weighted random sampling without replacement). Claude reads it as a fallback chain: try index 0, descend on failure.

**Why a priority list rather than a single rolled value?** The user explicitly wants graceful degradation: "If there's nothing newsworthy in Quebec today, fall back to international." A single rolled value would require Claude to re-call `get_ideas` to re-roll, which is awkward and racy (no shared state across calls in a scheduled run). A priority list captures the full fallback chain in one tool call, and the *order* — not just the picks — encodes the fallback preference.

**Why weighted random ordering, not deterministic by weight?** Pure determinism ("always Quebec first because it has the highest weight") locks the lens for every question. The user wants Quebec usually-first, but with occasional natural variation. Weighted random sampling without replacement gives exactly this: high weight = high probability of being tried first, but not certainty.

**Empty-string context is first-class.** `{ name: "", weight: 1 }` means "no specific lean" — Claude generates without a flavor. Including it in the list provides a guaranteed terminator: when Claude has exhausted every flavored lens, the empty-string entry always succeeds.

**Alternative considered:** Explicit `categoryTiers: string[][]` shape with hand-authored fallback groupings. Rejected as more verbose and less flexible — weights generalize tiers (heavy weight = "almost always first," light weight = "rarely first," which mimics tiering) while also expressing finer gradations tiers can't.

### Decision 3: Categories stay flat (`string[]`)

The category axis does not gain per-category weights or per-category metadata in this change. Categories continue to be drawn uniformly at random from the active pool (with the existing recent-categories exclusion window).

**Why?** Contexts subsume the practical need for "weight some entries higher than others." A user who wants "more Quebec questions" expresses that as `contexts: [{ name: "Quebec", weight: 5 }, ...]`, not as `categoryWeights`. Keeping categories flat avoids touching `categories.json` / `add_categories` / `remove_categories` and keeps the migration scope smaller.

**Trade-off:** A user who genuinely wants "more Science questions, less Sports" without involving the context axis has no way to express that. We accept that limitation; if it becomes a real complaint, weighted categories can be added without disturbing the contexts mechanic.

### Decision 4: Freshness judgment lives in the prompt, not in stored config

The topical-path prompt instructs Claude: *"Aim for events from the last day or two. Go back up to about a week only if nothing notable surfaced from the most recent days."* No `rangeDays` field is stored or rolled.

**Why?** Three reasons:

1. The "right" window varies by topic (a celebrity death is newsworthy for a week; a sports result is stale in two days). A flat number can't capture that.
2. Storing a config-side `rangeDays` invites scope creep into deriving it from the cron expression, handling first-fire / off-days, etc. — added surface area for marginal benefit.
3. Statement-similarity dedupe via `find_previous_questions` already prevents repeat-question abuse regardless of window — a Drake-album question last week and a Drake-album question this week collide as duplicates regardless of `rangeDays`.

**Trade-off:** Less predictable freshness. We accept this for the simplicity; can revisit if questions feel consistently stale or stale-mismatched to game cadence.

### Decision 5: `sourceUrl` mandatory on topical questions

`save_question` requires `sourceUrl: string` when `questionType: "topical"` and forbids it when `questionType: "fact"`. The URL must be HTTPS and look like a URL (basic shape validation; no liveness check).

**Why?** Topical questions are claims about recent events. Without a citation, there's no audit trail for "did Claude make this up?" or "what story is this referring to?". The reveal flow can later surface the URL ("📰 source: …") to make the educational angle concrete. Forbidding it on fact questions prevents drift where Claude tacks URLs onto static-knowledge questions.

**Alternative considered:** Optional `sourceUrl`. Rejected because the failure mode of an absent URL on a topical question is bad enough (unverifiable claim about a recent event) that hard validation is warranted.

### Decision 6: Single static blocking migration for the rename

A new `blocking` migration in `src/migrations/` (scaffolded via `/create-migration`):

1. Reads `data/config.json`. If `trivia.questionsTypes` exists, renames it to `trivia.answersFormat`.
2. For every `data/plugins/trivia/games/*/questions.json`: for every record, renames `type` → `answersFormat`. If `answersFormat` is now undefined (legacy boolean), sets it to `"boolean"`. Always stamps `questionType: "fact"`.
3. For every `data/plugins/trivia/games/*/seasons.json`: for every `SeasonEntry`, renames `questionsTypes` → `answersFormat`. For every `SeasonFormatSlot` within `format.questions`, renames `questionTypes` → `answersFormat`.
4. Bumps `data/state/migration-version.json`.

**Why a single migration rather than read-time fallbacks?** Read-time fallbacks (treat absent `answersFormat` as the renamed value of `type`) would let old data flow through new code, but they spread legacy-handling logic across every read site and never get cleaned up. A one-time migration is cheap, testable in isolation, and removes the legacy concern entirely.

**Rollback:** The migration is unidirectional. To roll back, restore `data/` from backup. Production deployments take a backup of `data/` before any blocking migration runs (existing infrastructure).

### Decision 7: Prompt branches on a 4-way matrix

The existing `SEND_QUESTIONS_INSTRUCTIONS` already branches on `suggestedType` (boolean vs choice). The new prompt branches on `suggestedQuestionType` × `suggestedAnswersFormat`:

```
              boolean                 choice
fact     │ existing BOOLEAN PATH  │ existing CHOICE PATH       │
topical  │ NEW topical+boolean    │ NEW topical+choice         │
```

Each topical path opens with a WebSearch-driven research step that loops over `contextPriority`. The research step produces a verified event, a `sourceUrl`, and an optional `eventDate`. The downstream steps (polarity gate for boolean, distractor plausibility gate for choice) are identical to the fact-path equivalents — the difference is the *source of the statement*, not the validation downstream.

**Why duplicate the fact paths almost verbatim?** Because the gates (polarity, distractor plausibility, difficulty self-rating) operate on the *finished statement* and are agnostic to its source. Refactoring the prompt into "research step + shared validation" would help DRY but at the cost of harder-to-read prompt orchestration. Keeping four explicit paths makes each one auditable on its own. We can DRY later if maintenance friction shows up.

## Risks / Trade-offs

- **[Risk] Migration mismatched against in-flight changes.** If `add-trivia-game-namespacing` or `add-trivia-question-batch-id` lands first/concurrently, their data-shape changes could conflict with this rename. → **Mitigation**: This change's migration runs after any prior blocking migrations (numbered after). Verify migration version ordering and add explicit ordering guards in the migration runner if needed.

- **[Risk] Claude abuses the priority-list fallback to always pick the easiest context.** Claude could descend the priority list reflexively rather than genuinely trying the lens at index 0. → **Mitigation**: Prompt language emphasizes "only descend after a genuine attempt." Server-side telemetry logs `context` field on save_question; if reveals show consistently low context-index usage we revisit.

- **[Risk] Topical questions stale by reveal time.** A question posted at 9am about "today's news" might feel stale by the 5pm reveal if a big story breaks in between. → **Mitigation**: Out of scope for v1 — same question lifecycle as fact questions. If real complaints surface, consider a "topical reveal context" that mentions the time of posting.

- **[Risk] WebSearch hits rate limits or returns garbage during scheduled runs.** Claude's WebSearch is rate-limited and can return irrelevant results. → **Mitigation**: The priority-list descent already handles "no good results" naturally — Claude moves to the next lens or to the empty-string fallback. If all lenses fail, the prompt should instruct Claude to roll the questionType axis itself ("re-call get_ideas if no lens yields a topical event"). Add this safety hatch to the prompt.

- **[Risk] Empty-string context name confuses config authors.** A config like `{ name: "", weight: 1 }` looks like a typo. → **Mitigation**: Document the convention explicitly in config docs and lint-warn (not error) when config validation runs and detects empty-name entries.

- **[Trade-off] Larger prompt surface area.** Four paths instead of two; topical paths are roughly 50% longer than fact paths due to WebSearch orchestration. → **Accepted**: Auditability of explicit paths outweighs DRY for now.

- **[Trade-off] No per-questionType context weights.** Users who want "Quebec lens on topical, no lens on fact" must currently pick either-or at the slot level. → **Accepted**: Can split contexts per-questionType later if real usage demands it.

- **[Trade-off] Categories stay flat.** No "60% Science, 30% History, 10% Sports" without using contexts as a workaround. → **Accepted**: Contexts mostly cover the practical use case.

## Migration Plan

1. Scaffold the migration via `/create-migration` (per project convention — never create migrations manually).
2. The migration runs at boot, blocking startup until complete (see "Decisions / Decision 6" for steps).
3. After the migration succeeds, code paths reading `type` / `questionsTypes` no longer exist. The rename is complete in storage.
4. Rollout order:
   - Land the migration + spec changes + code rename in one PR (the rename touches enough code that splitting risks half-renamed states).
   - Topical generation (new prompts, `WebSearch` invocation, source URL validation) lands in a follow-up PR. The rename PR is a no-op for behavior — all existing questions still generate identically because no game has `questionType: { topical: N }` set yet.
   - Contexts is its own follow-up PR after topical. Each follow-up is independently revertable.

**Rollback:** Migration is unidirectional. Restore `data/` from backup if needed. Code rollback is by `git revert` (the rename PR is one squashed commit).

## Open Questions

- **Should `contexts` cascade allow an additive merge?** Today every cascade field is *replacement* (slot's value fully overrides season's). For `contexts`, the use case "season defines a default lens; slot adds an additional flavor option" is plausible. Default decision: replacement-only, same as everything else. Revisit if real usage demands additive merging.
- **What does the reveal payload do with `context`?** v1 stores it but doesn't surface it. The reveal could optionally mention "(Quebec lens)" in the verdict explanation. Punted to a polish task.
- **How does this interact with `add-trivia-game-namespacing` if both ship in parallel?** Both touch `seasons.json` and `config.json` shapes. They should land sequentially; document the ordering on the task list.
