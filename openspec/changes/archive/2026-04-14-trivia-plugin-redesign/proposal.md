## Why

The trivia plugin's current tool set was designed around single-user interactions (one answer at a time, manual user registration, free-form topics). In practice, trivia questions are posted to a channel and answers arrive in batches. The tools need to reflect this: batch answer submission, a managed category pool to avoid repetition, and better question history search.

## What Changes

- **Replace `submit_answer` with `submit_answers`**: Accept a batch of answers for a question in one call, auto-registering users from the payload. Stamps the question with `postedAt` and `messageLink` on first submission.
- **Remove `register_user`**: User registration happens implicitly via `submit_answers` (userId + displayName in each answer entry).
- **Remove `get_past_topics`**: Replaced by `get_ideas` and `find_previous_questions`.
- **Rename `generate_question` to `save_question`**: Accepts a `category` (from the managed pool) instead of a free-form `topic`. Validates that the category exists in the pool.
- **Add `categories.json` data file**: Managed pool of trivia categories, seeded with 50 on first load.
- **Add `add_categories` / `remove_categories` tools** (dev+): Manage the category pool.
- **Add `get_ideas` tool**: Returns 5 random categories from the pool, excluding the last 10 used.
- **Add `find_previous_questions` tool**: Search past questions by category and/or statement text to avoid duplicates.
- **BREAKING**: `TriviaQuestion.topic` renamed to `category`. New fields: `postedAt?`, `messageLink?`.

## Capabilities

### New Capabilities

- `trivia-categories`: Category pool management — seeding, adding, removing, and random selection with recency exclusion.
- `trivia-batch-answers`: Batch answer submission with auto-registration and question metadata stamping.
- `trivia-question-search`: Search past questions by category and/or statement text.

### Modified Capabilities

_(No existing specs modified — the trivia plugin has no specs yet; all capabilities are new.)_

## Impact

- `src/plugins/trivia/` — All tool files rewritten or replaced
- `src/plugins/trivia/types.ts` — `TriviaQuestion` type changes (`topic` → `category`, new optional fields)
- `src/plugins/trivia/data.ts` — New data layer methods for categories
- `src/plugins/trivia/index.ts` — Tool registration updated (7 tools, mixed role gates)
- Data: existing `questions.json` files will have stale `topic` field (no migration needed — trivia data is ephemeral)
