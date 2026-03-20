## 1. Config Types and Parsing

- [x] 1.1 Add `ConditionalHiddenRule` interface (`tool`, `arg`, `pattern`) and `conditionalHidden` field to `ToolMappingConfig` in `toolMappingLoader.ts`
- [x] 1.2 Add `ResolvedConditionalHiddenRule` (with pre-compiled `regex: RegExp`) and `conditionalHidden` field to `ResolvedToolMapping`
- [x] 1.3 Parse `conditionalHidden` in `resolveConfig()` — compile regex patterns, skip invalid ones with warning

## 2. Label Resolution

- [x] 2.1 Add `conditionalHidden` check in `getToolLabel()` after `hidden` check and before label lookup — iterate rules, test tool name + arg pattern, return null on match

## 3. Default Config

- [x] 3.1 Add `conditionalHidden` rule to `_builtins.json`: hide `Read` when `file_path` matches `^tool-results/`

## 4. Tests

- [x] 4.1 Unit tests for `resolveConfig` with `conditionalHidden` — valid rules, invalid regex (skipped), empty array
- [x] 4.2 Unit tests for `getToolLabel` conditional hiding — pattern match (hidden), no match (shown), missing arg (shown), multiple rules (first match wins)
- [x] 4.3 Verify shipped `_builtins.json` config validation still passes with the new field

## 5. Skill Update

- [x] 5.1 Update `.claude/skills/create-tool-mapping/SKILL.md` — document `conditionalHidden` in the config schema section and add guidance in the label writing guidelines
