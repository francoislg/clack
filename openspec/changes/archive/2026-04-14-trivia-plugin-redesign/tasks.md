## 1. Data Model Updates

- [x] 1.1 Update `TriviaQuestion` type: rename `topic` to `category`, add `postedAt?: number` and `messageLink?: string`
- [x] 1.2 Add `TriviaCategory` types and data layer methods: `loadCategories`, `saveCategories`
- [x] 1.3 Add seed data: hardcoded array of 50 categories in a `seedCategories.ts` file
- [x] 1.4 Add category seeding logic to plugin init: if categories file is missing/empty, write seed data

## 2. Data Layer

- [x] 2.1 Add `loadCategories(): Promise<string[]>` and `saveCategories(categories: string[]): Promise<void>` to `TriviaDataLayer`
- [x] 2.2 Add `updateQuestion(id: string, updates: Partial<TriviaQuestion>): Promise<void>` to support stamping `postedAt`/`messageLink`
- [x] 2.3 Implement new methods in SDK data layer (`createSdkDataLayer`)
- [x] 2.4 Implement new methods in in-memory data layer (for tests)

## 3. New Tools — Categories

- [x] 3.1 Create `addCategories.ts` — `add_categories` tool (dev+ role): append categories, deduplicate, return result
- [x] 3.2 Create `removeCategories.ts` — `remove_categories` tool (dev+ role): remove by exact match, return result
- [x] 3.3 Create `getIdeas.ts` — `get_ideas` tool (member role): 5 random categories excluding last 10 used

## 4. Updated Tools — Questions

- [x] 4.1 Rewrite `generateQuestion.ts` → `saveQuestion.ts` — `save_question` tool: accept `category` instead of `topic`, validate category exists in pool
- [x] 4.2 Create `findPreviousQuestions.ts` — `find_previous_questions` tool: search by `category` and/or `text` (case-insensitive), require at least one parameter

## 5. Updated Tools — Answers

- [x] 5.1 Rewrite `submitAnswer.ts` → `submitAnswers.ts` — `submit_answers` tool: accept batch of `{ userId, displayName, answer }`, auto-register users, skip duplicates, return per-user results with stats
- [x] 5.2 Add question metadata stamping: set `postedAt` and `messageLink` on first submission for a question

## 6. Cleanup & Registration

- [x] 6.1 Delete removed tool files: `registerUser.ts`, `getPastTopics.ts`
- [x] 6.2 Update `index.ts`: register all 7 tools with correct roles and tool mappings, update instructions text
- [x] 6.3 Update `retrieve_scores` tool mapping label (no logic change needed)

## 7. Tests

- [x] 7.1 Add tests for category seeding logic (missing file, empty file, existing file)
- [x] 7.2 Add tests for `add_categories` and `remove_categories` (dedup, not found)
- [x] 7.3 Add tests for `get_ideas` (exclusion window, small pool)
- [x] 7.4 Add tests for `save_question` (valid category, invalid category, validation)
- [x] 7.5 Add tests for `find_previous_questions` (by category, by text, both, neither, no matches)
- [x] 7.6 Add tests for `submit_answers` (batch save, auto-register, duplicate skip, metadata stamp, per-user stats)
- [x] 7.7 Type-check and run full test suite
