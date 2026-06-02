# Fix visual-trivia image-tool discovery (drop the `image_search` substring contract)

## Why

Visual trivia (`promptMedium: "image"`) silently never fires. The cause is a naming mismatch, not a platform quirk:

- Built-in image plugins register under **hyphenated** names (`commons-image-search`, `brave-image-search` — `src/plugins/registry.ts:34-35`).
- The Claude Agent SDK uses the MCP server name **verbatim** in the resolved tool name (no hyphen→underscore conversion — confirmed by `tenor-gif`, which correctly documents its own tool as `mcp__tenor-gif__find_gif`). So the real tool names are `mcp__commons-image-search__find_subject` / `mcp__brave-image-search__find_image` — **with hyphens**.
- The trivia visual-research subflow, the contract doc, and several tool descriptions all instruct Claude to look for tools whose name contains the substring **`image_search`** (underscore). `commons-image-search` does not contain `image_search`.

The discovery step therefore fails to match any installed image tool → the subflow hits its "no image provider installed" short-circuit → it falls back to text on every fire. No error surfaces, which is why the breakage went unnoticed. The docstring comments at `commons-image-search/index.ts:11` and `brave-image-search/index.ts:11` even assert the wrong (underscore) tool name about their own plugin.

Beyond the immediate bug, **the substring contract itself is the smell**: a literal magic string in tool names is brittle (one rename re-breaks it) and redundant — Claude already chooses among image tools by reading their *descriptions*. The fix is to stop matching a magic substring and discover image tools by their described capability.

## What Changes

- **Discovery by description, not by name.** The visual-research subflow stops scanning for the substring `image_search`. Instead it instructs Claude to use any available tool whose **description** identifies it as a trivia image source (returns an image inline + the metadata contract). Tool *names* become non-load-bearing.
- **Soften the contract.** `docs/image-search-contract.md` and the `trivia-visual-questions` spec drop the "name MUST contain `image_search`" requirement. The binding contract becomes: registered on the plugin's always-on default server + a description that clearly identifies it as a trivia image source + the existing return/error contract (unchanged). A recognizable name (e.g. `*-image-search`) stays a **recommendation**, not a hard requirement.
- **Fallback stays graceful.** When Claude surveys its tools and finds no image source, it generates a text question for the same `answersFormat × questionType` — same observable outcome as today, keyed off capability instead of a substring.
- **Fix the wrong comments** in `commons-image-search/index.ts` and `brave-image-search/index.ts` that claim underscore tool names.
- **Sweep the stale `image_search` / `*_image_search__*` wording** out of `scheduledPrompts.ts`, `getIdeas.ts`, `saveQuestion.ts`, `upsertSeason.ts`, `core/configTypes.ts`, `core/types.ts`, `buildGameSpecs.ts`, and the READMEs.

## Impact

- Affected spec: `trivia-visual-questions` (the external-tool contract requirement + the no-tool short-circuit scenario + the inspection-gate re-roll wording).
- Affected code: `src/plugins/trivia/prompts/scheduledPrompts.ts`, `src/plugins/trivia/tools/questions/getIdeas.ts`, `src/plugins/trivia/tools/questions/saveQuestion.ts`, `src/plugins/trivia/tools/seasons/upsertSeason.ts`, `src/plugins/trivia/core/{configTypes,types}.ts`, `src/plugins/trivia/domain/buildGameSpecs.ts`, `src/plugins/commons-image-search/index.ts`, `src/plugins/brave-image-search/index.ts`, plus `docs/image-search-contract.md` and the two plugin READMEs.
- **Trade-off (see design.md):** the "no image provider installed → text" guarantee moves from a (broken) substring check to Claude's capability judgment. It becomes soft rather than code-deterministic. Accepted as the cost of removing the brittleness — the deterministic alternative (a first-class SDK image-source capability) is out of scope.
- In-flight plugin proposals (`add-commons-image-search-plugin`, `add-brave-image-search-plugin`, `add-tmdb-image-search-plugin`) still reference the `*_image_search__*` convention. They should be reconciled to the description-based contract when next touched — noted in tasks, not rewritten here.
