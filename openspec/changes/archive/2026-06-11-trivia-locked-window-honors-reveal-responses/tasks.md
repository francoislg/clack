## 1. Render-mode parameter on the roster builder

- [x] 1.1 In `src/plugins/trivia/freeform/roster.ts`, add an explicit render-mode arg to `buildRosterBlock` (e.g. `mode: "grouped" | "flat"`) that selects between the grouped path (`renderGroupCompact`/`renderGroupMultiline`) and the flat path (`renderHidden`), replacing the internal `question.liveAnswersVisible ?? true` read.
- [x] 1.2 Keep `buildRosterBlock` honoring the existing compact→multiline char-limit fallback within the grouped mode.

## 2. Locked-branch disclosure in editRosterIntoCard

- [x] 2.1 Hoist the answer-load + cheater-filter + `nameOf` (with `tagPlayers`) setup above the `answerLocked` branch so both branches share it; the `"no"` locked case skips appending a roster.
- [x] 2.2 Unlocked branch: pass `mode` derived from `question.liveAnswersVisible ?? true` (`true → "grouped"`, `false → "flat"`) — preserving current behavior.
- [x] 2.3 Locked branch: keep the localized "🔒 locked in" notice, then switch on `question.revealResponses ?? "yes"`:
  - `"yes"` → append divider + `buildRosterBlock(..., "grouped")`.
  - `"just-correctness"` / `"just-winners"` → append divider + `buildRosterBlock(..., "flat")`.
  - `"no"` → no roster (notice is the final block).
- [x] 2.4 Confirm the locked roster uses the same cheater-filtered answer set and `tagPlayers`-aware `nameOf` as the unlocked branch.

## 3. Tests

- [x] 3.1 Add `roster` unit tests for the locked window across all four `revealResponses` modes: `"yes"` (grouped, names+picks), `"just-correctness"` and `"just-winners"` (flat, names only, no picks), `"no"` (notice only, no roster footer).
- [x] 3.2 Test that absent `revealResponses` on a locked question renders as `"yes"` (grouped).
- [x] 3.3 Test that the locked roster excludes a flagged-cheater row.
- [x] 3.4 Test that `liveAnswersVisible` does NOT affect the locked roster (locked `"yes"` shows grouped even when `liveAnswersVisible: false`).
- [x] 3.5 Regression: unlocked rebuild and unlock-restore still follow `liveAnswersVisible`; locked-drops-buttons still holds.

## 4. Verify

- [x] 4.1 `npx tsc --noEmit` clean; `npx oxlint src/plugins/trivia/freeform/roster.ts` and `npx oxfmt --check` clean.
- [x] 4.2 `npm test` green (roster suite + any callers of `buildRosterBlock`).
- [x] 4.3 `openspec validate trivia-locked-window-honors-reveal-responses --strict` passes.
