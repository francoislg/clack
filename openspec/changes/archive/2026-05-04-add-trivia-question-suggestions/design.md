## Context

`get_ideas` is the entry point of the daily trivia question flow. Today it returns a category short-list and the model decides everything else: whether to keep the underlying fact true or flip it, and what difficulty to aim for. Both decisions empirically skew — questions trend true and cluster in a narrow difficulty band — which dulls the daily game.

The existing flow is documented in `QUESTION_FLOW_STEPS` (src/plugins/trivia/scheduledPrompts.ts:18) and gated by a self-rated 1–10 difficulty check (≥4/10) at step 6. The tool itself lives at src/plugins/trivia/getIdeas.ts and is one of three trivia tools listed in Schedule A's `requiredTools` (trivia-scheduled-prompts spec, Requirement: Create Schedules Instructions Tool). The category logic is unchanged by this design.

## Goals / Non-Goals

**Goals:**

- Server-side coin flip for true/false to guarantee long-run distribution.
- Server-side weighted draw for difficulty (30/60/10) so the daily question varies.
- Keep the changes narrow: one tool, one prompt constant, two spec deltas.
- Preserve the existing 1–10 difficulty self-rating gate as a quality safety net.

**Non-Goals:**

- Validating server-side that `save_question.isTrue` matches `suggestedAnswer`. Trust the prompt; mismatches are tolerated.
- Removing or restructuring the 1–10 gate.
- Changing the category pool, seeding, or recency-exclusion logic.
- Persisting the suggestions (no new state, no logging beyond what already exists).
- Migrating older fat-prompt cron jobs.

## Decisions

### Result shape

```ts
{
  categories: { ideas: string[]; total: number; excluded: number };
  suggestedAnswer: boolean;
  suggestedDifficulty: "Easy" | "Medium" | "Hard";
}
```

Nesting category-pool stats under `categories` reads cleanly and leaves room for further `suggested*` fields without flattening the namespace.

**Alternatives considered:** flat shape `{ ideas, totalCategories, excluded, suggestedAnswer, suggestedDifficulty }` — minor edit, but mixes pool stats with question-shaping hints. Rejected.

### Distribution

- `suggestedAnswer`: `Math.random() < 0.5`. No crypto-grade randomness needed; this is gameplay variety.
- `suggestedDifficulty`: single `Math.random()` with thresholds at 0.30 (Easy) and 0.90 (Medium); the remaining 0.10 is Hard.

**Alternatives considered:** seeded RNG keyed on date so the same day always picks the same suggestion. Rejected — that gives every channel running the schedule the same flavor on the same day, which is undesirable.

### Bucket-to-1–10 mapping

| Bucket | 1–10 range |
| ------ | ---------- |
| Easy   | 4–6        |
| Medium | 7–8        |
| Hard   | 9–10       |

The existing reject-≤3 gate becomes a redundant safety net (no bucket maps below 4) and stays in place. The mapping is encoded in the prompt, not in code — the server emits the bucket name; Claude reads the mapping in `QUESTION_FLOW_STEPS` and rates accordingly.

**Alternatives considered:** emitting the numeric range from the server (e.g. `suggestedDifficulty: { bucket: "Easy", min: 4, max: 6 }`). Rejected — adds payload weight for a mapping the prompt already needs to spell out for the model to act on.

### Enforcement posture

`suggestedAnswer` is enforced by prompt wording only. `save_question` does not validate that `isTrue === suggestedAnswer`. This keeps the change tiny and avoids threading session-scoped state between two tools. The risk (model ignores the suggestion) is bounded because the prompt is explicit and the model already follows similar instructions in this flow.

**Alternatives considered:** thread `suggestedAnswer` through to `save_question` and reject mismatches. Rejected for v1 — extra plumbing, and a rejection mid-flow would force the model to redo research; not worth the cost for a soft preference.

### Prompt edits

Two surgical edits to `QUESTION_FLOW_STEPS`:

1. Step 1 gains a sentence: "`get_ideas` also returns `suggestedAnswer` (true/false) and `suggestedDifficulty` (Easy/Medium/Hard). Read both — they steer the next steps."
2. Step 3 rewrites: "If `suggestedAnswer` is `true`, keep the statement TRUE. If `suggestedAnswer` is `false`, modify a key detail to make it FALSE (e.g., swap 'shrimp' → 'lobster')." — removes the random-decide language.
3. Step 6 (difficulty gate) gains a leading sentence: "Aim for the bucket named by `suggestedDifficulty`: Easy = 4–6, Medium = 7–8, Hard = 9–10. Then rate the question 1–10 as before." — keeps the ≤3 reject rule intact.

Step 8 (`save_question`) is unchanged: `isTrue` is still the model's call, derived from the statement it actually produced.

## Risks / Trade-offs

- **Model ignores `suggestedAnswer`** → mitigation: explicit prompt wording; observed-skew can be revisited later by adding `save_question` validation if it becomes a real problem.
- **Same channel may see runs of similar buckets due to small-N randomness** → mitigation: none for v1. 30/60/10 over a daily cadence will look noisy short-term and converge long-term; acceptable.
- **Spec consumers expecting old flat shape break** → mitigation: only the in-repo prompt and tests consume `get_ideas`; both updated in the same change. No external API.
- **Existing fat-prompt cron jobs don't benefit until recreated** → mitigation: documented; admins can re-run `create_schedules_instructions` when they choose. The new `requiredTools` list is unchanged (still `mcp__trivia__get_ideas`), so no schedule edit is forced.
