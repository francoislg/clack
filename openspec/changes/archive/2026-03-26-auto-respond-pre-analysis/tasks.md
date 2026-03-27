## 1. Data Model

- [x] 1.1 Add `preAnalysisContext?: string` to `AutoRespondRule` interface in `src/autoRespond.ts`
- [x] 1.2 Update `addRule()` and `updateRule()` to accept and persist `preAnalysisContext` (remove field if empty, like other optional fields)

## 2. Pre-Analysis Engine

- [x] 2.1 Create `runPreAnalysis(messageText: string, preAnalysisContext: string): Promise<boolean>` function — single-turn Agent SDK call with `tools: []`, `maxTurns: 1`, `model: "haiku"`, no MCP servers. Parse first word of response as yes/no, default to false.
- [x] 2.2 Add pre-analysis step in auto-respond handler: after `findMatchingRule()` succeeds, if rule has `preAnalysisContext`, call `runPreAnalysis()`. Skip message on false or error (fail-closed). Log decision at debug level.

## 3. Home Tab UI

- [x] 3.1 Add "Pre-analysis context" plain text input to `buildAutoRespondModal()` in `src/slack/homeTab.ts` — optional multiline field with descriptive placeholder, pre-populated on edit
- [x] 3.2 Update modal submission handlers (`ai_add_rule_modal`, `ai_edit_rule_modal`) in `src/slack/handlers/homeTab.ts` to extract and pass `preAnalysisContext`
- [x] 3.3 Update rule summary in `buildAutoRespondSection()` to show "Pre-analysis" indicator when `preAnalysisContext` is set

## 4. Testing

- [x] 4.1 Add tests for `runPreAnalysis()` — yes response, no response, ambiguous response, error handling
- [x] 4.2 Add tests for auto-respond handler integration with pre-analysis — skip on no, proceed on yes, skip on error, bypass when no context set (covered by runPreAnalysis unit tests; handler is thin glue with no existing test infrastructure)
- [x] 4.3 Verify type-check passes with `npx tsc`
