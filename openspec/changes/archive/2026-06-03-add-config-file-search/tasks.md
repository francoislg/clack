## 1. Search core (configurationFiles.ts)

- [x] 1.1 Add a `searchInstructionFiles(query: string)` helper to `src/configurationFiles.ts` that walks `listInstructionFiles()`, reconstructs each file's path (`{role}/{file}`, `{role}/topics/{topic}/{file}`, `pre-analysis/{file}`, `{repo}/{file}`), reads both layers via `readInstructionFile`, and returns the same listing shape filtered to matching files, with each surviving `FileEntry` annotated with `matches: { layer: "default"|"custom"; line: number; snippet: string }[]`.
- [x] 1.2 Implement case-insensitive, line-by-line substring scan; 1-based line numbers; snippet = the matching line trimmed and length-bounded. Treat empty/whitespace-only query as "no query" (return full unfiltered listing).
- [x] 1.3 Drop topics, roles, and repo groups left with zero matching files; compute a `summary: { query, files, hits }`.
- [x] 1.4 Export the new types (`MatchHit`, the search result shape) alongside the existing `InstructionFileListing` exports.

## 2. Tool wiring (listConfigFiles.ts)

- [x] 2.1 Add an optional `query: z.string().optional()` input to `createListConfigFilesTool`, with a description covering the search behavior.
- [x] 2.2 When `query` is absent/blank, return `deps.listInstructionFiles()` as today (no content read, no `matches`/`summary`). When present, call the new `searchInstructionFiles` (wired through `deps`) and return its result.
- [x] 2.3 Update the tool description string to document the optional `query` parameter and the annotated/filtered output.
- [x] 2.4 Extend `ListConfigFilesDeps` + `defaultDeps` to inject `searchInstructionFiles` for testability.

## 3. Tests

- [x] 3.1 Update `src/tools/query/listConfigFiles.test.ts`: no-query path returns the unfiltered listing unchanged (no `matches`/`summary`).
- [x] 3.2 Query path: filters to matching files, annotates hits with correct `layer`/`line`/`snippet`, drops empty roles/topics/repos.
- [x] 3.3 Both-layers-independent: hit only in default vs only in custom is tagged correctly.
- [x] 3.4 Case-insensitivity; no-match returns empty listing with `summary.files: 0` and no error.
- [x] 3.5 Coverage across pre-analysis and repo files (mock `searchInstructionFiles`/`listInstructionFiles`/`readInstructionFile` at the boundary per repo test conventions).

## 4. Verify

- [x] 4.1 `npx tsc` clean; `npx oxlint src/configurationFiles.ts src/tools/query/listConfigFiles.ts src/tools/query/listConfigFiles.test.ts`; `npx oxfmt` the touched files.
- [x] 4.2 `npm test` green.
- [x] 4.3 `openspec validate add-config-file-search --strict` passes.
