## 1. Schema & validation

- [x] 1.1 Add an `initialSeason` field to the `upsert_game` Zod input schema (`src/plugins/trivia/tools/games/upsertGame.ts`): optional object `{ slug: string; expectedEndAt: number; startedAt?: number }` with a `.describe()` stating it is REQUIRED on CREATE when seasons are enabled, rejected when disabled, and rejected on UPDATE — enrich via `upsert_season` afterward.
- [x] 1.2 Reuse the existing season slug / interval validators (`core/seasonTimeline.ts`, the season config parsers) to validate `slug` (non-empty kebab-case) and `expectedEndAt > startedAt`; do not hand-roll guards.

## 2. CREATE-branch handler logic

- [x] 2.1 In the CREATE branch (game does not yet exist), resolve `seasonsEnabled` from `loadTriviaConfig()?.seasons?.enabled`. When enabled and `initialSeason` is absent, return `errorResult` naming the missing field; do not write the game.
- [x] 2.2 When seasons are disabled and `initialSeason` is present, return `errorResult` ("seasons disabled"). When the game already exists (UPDATE branch) and `initialSeason` is present, return `errorResult` directing the caller to `upsert_season`.
- [x] 2.3 On a valid CREATE with seasons enabled: after the game entry is persisted to config, atomically write `games/<name>/seasons.json` via `data.forGame(name).saveSeasonsState(...)` with exactly one entry `{ slug, startedAt: startedAt ?? Date.now(), expectedEndAt }` — no `categories`/`theme`/`format`/axis fields.
- [x] 2.4 Ensure the season write happens only on successful game creation (no orphan `seasons.json` if config write fails) and that `startedAt` defaults to creation time when omitted.

## 3. Instruction & tool description

- [x] 3.1 Update the `upsert_game` tool description and the `trivia:management` admin instruction to document the required `initialSeason` on CREATE (when seasons on), the minimal shape, and the "bootstrap now, enrich with `upsert_season` later" flow.

## 4. Tests

- [x] 4.1 CREATE with seasons enabled + missing `initialSeason` → structured error, no game written.
- [x] 4.2 CREATE with seasons enabled + valid `initialSeason` → game created AND `seasons.json` has the single explicit entry (correct slug/startedAt/expectedEndAt, no extra fields); `findCurrentSeason` returns it immediately.
- [x] 4.3 `startedAt` omitted defaults to now; `expectedEndAt <= startedAt` rejected.
- [x] 4.4 `initialSeason` rejected when seasons disabled, and rejected on UPDATE (existing game).
- [x] 4.5 Lazy-bootstrap fallback regression: a seasons-enabled game whose `seasons.json` is missing (config-edited path) still auto-seeds on first tool use; an `upsert_game`-created game does NOT get the `season-YYYY-MM` starter written over its explicit entry.

## 5. Verify

- [x] 5.1 `npx tsc` clean, `npx oxlint`/`npx oxfmt --check` clean, `npm test` green.
- [x] 5.2 `openspec validate require-initial-season-on-game-create --strict` passes.
