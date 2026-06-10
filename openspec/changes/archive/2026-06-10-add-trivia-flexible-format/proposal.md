## Why

Today every trivia fire posts **exactly** `format.questions.length` questions — the slot roster is both the *shape* and the *count*. That rules out games whose useful question count varies night-to-night: "2–5 topical questions depending on what's interesting," or "post a question only if there's good material today (else skip the day)." The slot machinery already supports heterogeneous per-slot shapes; the only thing missing is permission to fill **fewer** slots than are defined — down to zero.

## What Changes

- Add an optional **`flexible: boolean`** field to the `SeasonFormat` structural object (`{ questions: SeasonFormatSlot[], flexible?: boolean }`). Default absent → `false` → **today's behavior is byte-for-byte unchanged**.
- When `flexible: true`, a fire posts a **prefix** of the defined slots — `0..questions.length` questions, filled **in array order**, with the count chosen by Claude based on available material. Slots keep their heterogeneous per-index definitions (slot 0 T/F, slot 1 choice, slot 2 freeform); `flexible` changes **only the count contract**, never the slot shapes.
- **Zero is a legitimate outcome.** A flexible fire that finds no good material posts nothing and **skips the day** — no question card, no error. The downstream reveal cron then finds nothing to reveal and **reuses the existing empty-reveal silent skip** (`reveals.length === 0` already terminates the reveal run with no post). No reveal change is required; season-end rollover bookkeeping still runs on a zero-question day.
- **`flexible` rides the existing `format` cascade.** `format` is STRUCTURAL (not a `CascadeAxes` member) and resolves by **whole-format replace per tier** (`season.format → game.format → null`). `flexible` is a property of whichever format *wins*: a `flexible` game format is masked when an active season supplies its own (non-flexible) format, exactly as the rest of that format would be. No new independently-cascading axis is introduced.
- **`get_ideas`** surfaces `flexible: true` alongside the existing `{ slotCount, slots: [...] }` so the generation prompt knows it may stop early and post zero. The slot definitions returned are unchanged.
- **The generation prompt fills a prefix when flexible.** The staged-pool/inline-gen loop's "fill every slot `[0..slotCount-1]`" mandate becomes "fill slots in order, stopping at the first slot with no good question; posting fewer than all — down to zero — is valid." Fixed games keep the unconditional fill-every-slot behavior.

## Capabilities

### New Capabilities
- `trivia-flexible-format`: the `flexible` field on `SeasonFormat`, its default-off behavior, the prefix-count contract (`0..questions.length`, in order, count chosen by available material), zero-as-valid-skip, the `flexible`-rides-the-format-cascade rule, `get_ideas` surfacing the flag, and the `flexible`-gated graceful-zero reveal vs. fixed-game anomaly distinction.

### Modified Capabilities
- `trivia-seasons`: the `Per-season question format` requirement gains the optional `flexible` field and its parse/validation; the "a fire posts `questions.length` questions" invariant becomes "posts `questions.length` when fixed, a `0..questions.length` prefix when `flexible`." `save_question slot binding` is unchanged (index still `[0, questions.length)`), but fewer-than-all slots being saved is now valid.
- `trivia-question-posting`: the `POST_QUESTIONS_INSTRUCTIONS queries the staged pool before generating` requirement's "for each slot `[0..slotCount-1]` … once every slot has a question" loop is qualified — under a flexible format the loop fills a prefix and may stop early (including zero), so `post_questions` receives `0..slotCount` items rather than exactly `slotCount`.

## Impact

- **Type:** `flexible?: boolean` on `SeasonFormat` (`core/configTypes.ts`).
- **Resolver:** `resolveEffectiveFormat` (`domain/format.ts`) already returns the winning format whole — `flexible` is carried for free; no resolver change.
- **Count derivation:** the `effectiveFormat.questions.length` count sites branch on `flexible` (`getIdeas.ts`, the generation/reveal prompts in `prompts/scheduledPrompts.ts`).
- **Config parser:** `validateFormat` + the format zod (`core/configParsers/format.ts`) accept `flexible`.
- **Write tools:** `upsert_game` / `upsert_season` already pass `format` through `validateFormat`; they inherit `flexible` once the validator accepts it (verify, no new field plumbing).
- **Read/audit:** `list_games` surfaces `flexible` on the format it already echoes (verify the format is shown).
- **Reveal:** no change — a zero-question day produces `reveals.length === 0`, which the reveal prompt already silently skips.
- **Out of scope:** `maxQuestions` (homogeneous single-template repeat beyond `questions.length`), subject-keyed staged pool (only needed if an entity-bound game adds a `prepCron`), anomaly detection for a *fixed* game that posts zero (today every zero-reveal silently skips; distinguishing breakage from a flexible skip is a separate concern), and predictions (a downstream consumer that composes with `flexible` but is specified separately). These are explicit follow-ups.
- **No data migration:** absent `flexible` reads as `false`; existing `questions.json` and config files are untouched.
