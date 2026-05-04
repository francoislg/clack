## Why

The trivia question-generation flow currently asks Claude to "randomly decide whether to keep [the statement] TRUE or modify it to make it FALSE" and to self-rate difficulty. Both decisions are model-driven and prone to skew — Claude tends to keep statements true and cluster difficulty in a narrow band — which makes the daily question feel repetitive. Moving these random choices server-side gives us a reliable distribution and frees the model to focus on research and phrasing.

## What Changes

- Reshape the `get_ideas` MCP tool result. **BREAKING** for any caller that consumed the previous flat shape (only the trivia scheduled-prompts flow consumes it today).
  - Before: `{ ideas, totalCategories, excluded }`
  - After: `{ categories: { ideas, total, excluded }, suggestedAnswer: boolean, suggestedDifficulty: "Easy" | "Medium" | "Hard" }`
- Compute `suggestedAnswer` server-side as a uniform 50/50 coin flip.
- Compute `suggestedDifficulty` server-side as a weighted random pick: 30% Easy, 60% Medium, 10% Hard.
- Map difficulty buckets onto the existing 1–10 scale: Easy = 4–6, Medium = 7–8, Hard = 9–10 (inclusive).
- Update `QUESTION_FLOW_STEPS` in `src/plugins/trivia/scheduledPrompts.ts`:
  - Step 3 changes from "randomly decide TRUE or FALSE" to "honor `suggestedAnswer`".
  - A new instruction directs Claude to target the bucket named by `suggestedDifficulty` using the bucket-to-1–10 mapping above.
  - The existing ≤3/10 reject gate stays as a safety net.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trivia-categories`: the "Get ideas tool" requirement gets a new result shape and two new sub-requirements covering `suggestedAnswer` and `suggestedDifficulty` (including their distributions and the bucket-to-1–10 mapping).
- `trivia-scheduled-prompts`: the "Send Questions Instructions Tool" requirement updates step 3 to honor `suggestedAnswer` and adds a difficulty-hint instruction tied to `suggestedDifficulty`.

## Impact

- Code: `src/plugins/trivia/getIdeas.ts` (logic + result shape), `src/plugins/trivia/scheduledPrompts.ts` (`QUESTION_FLOW_STEPS` constant), associated tests.
- Specs: deltas in `trivia-categories` and `trivia-scheduled-prompts`.
- Runtime data: none — no new files, no migrations.
- Backward compatibility: the only consumer of `get_ideas` is the in-repo trivia scheduled prompt, updated in lockstep. Old fat-prompt cron jobs that still inline the previous step 3 wording continue to run (they don't depend on the new fields), they just won't benefit from the server-side coin flip until re-created via `create_schedules_instructions`.
