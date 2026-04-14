## Context

The trivia plugin (`src/plugins/trivia/`) is a built-in Clack plugin with 5 MCP tools: `get_past_topics`, `generate_question`, `register_user`, `submit_answer`, and `retrieve_scores`. Data is persisted via the SDK's scoped file I/O into `data/plugins/trivia/` (questions.json, users.json, answers.json).

The current design assumes single-user interactions. In practice, trivia runs as a daily channel activity: a question is posted, multiple users react/respond, and answers are collected in batches. The tools need to match this pattern.

## Goals / Non-Goals

**Goals:**
- Replace per-user answer submission with batch submission
- Add a managed category pool to guide question creation and prevent repetition
- Enable searching past questions by category and statement text
- Auto-register users from answer submissions (eliminate separate registration step)
- Track when/where questions were posted (timestamp + Slack permalink)

**Non-Goals:**
- Multiplayer/real-time game mechanics (timers, rounds)
- Scoring algorithms beyond correct-answer counting
- Category hierarchy or tags (flat string list is sufficient)
- Migration of existing trivia data (ephemeral, can be reset)

## Decisions

### 1. Categories as a managed pool with seed data

Categories are stored in `categories.json` as a flat string array. On first plugin load, if the file is missing or empty, seed it with 50 hardcoded categories covering diverse topics.

**Why hardcoded over Claude-generated:** Deterministic, no API call at boot, no risk of duplicates or low-quality seeds. Devs can evolve the list via `add_categories`/`remove_categories`.

### 2. `save_question` validates category against the pool

When saving a question, the category must exist in `categories.json`. If not, the tool returns an error suggesting `add_categories`. This enforces the category pool as the source of truth.

**Why validate rather than auto-add:** Keeps the pool curated. Devs control what's in the pool. Claude can suggest adding a category, but a dev+ role is needed to actually add it.

### 3. `submit_answers` stamps question metadata

The first `submit_answers` call for a given question sets `postedAt` and `messageLink` on the question record. Subsequent calls for the same question skip the stamp (already set).

**Why on submit rather than on save:** At `save_question` time, the question hasn't been posted to Slack yet. The Slack permalink only exists after the message is sent. `submit_answers` is the natural point where the message context is available.

### 4. User auto-registration via `submit_answers`

Each answer entry includes `userId` and `displayName`. If the user doesn't exist in `users.json`, they're created. If they exist, `displayName` is updated. This eliminates `register_user` as a separate tool.

**Why implicit over explicit:** Reduces tool count, eliminates a mandatory step before answering, and `displayName` stays fresh since it's updated on every submission.

### 5. `get_ideas` exclusion window

`get_ideas` returns 5 random categories from the pool, excluding categories used in the last 10 questions. The exclusion is based on the `category` field of recent entries in `questions.json`.

**Why 10:** Large enough to prevent short-term repetition, small enough that categories cycle back into the pool. With 50 categories and 10 excluded, there are always 40+ candidates.

### 6. Role gating: category management is dev+, everything else is member

`add_categories` and `remove_categories` require dev+ role. All other tools are member-level. This keeps the pool curated while allowing anyone to participate in trivia.

## Risks / Trade-offs

- **Seed list quality** → The 50 hardcoded categories need to be diverse and interesting. Can be evolved post-launch via `add_categories`. Not a blocking risk.
- **Batch size unbounded** → `submit_answers` accepts any number of answers. For a channel trivia game this is fine (tens of users, not thousands). No need to cap.
- **No migration** → Existing `questions.json` files have `topic` instead of `category` and lack `postedAt`/`messageLink`. Since trivia data is ephemeral and the plugin is new, this is acceptable. Old data will be ignored by `find_previous_questions` if the field names don't match.
