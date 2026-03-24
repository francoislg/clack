## 1. Tool Implementation

- [x] 1.1 Create `src/tools/query/uploadFile.ts` with the `upload_file` tool — accepts `content`, `filename`, optional `title`, `channel`, `thread_ts`; validates content (non-empty, ≤500KB); calls `files.uploadV2`; returns `{ ok, file_id, permalink }` or error result
- [x] 1.2 Register `upload_file` in `buildQueryTools()` in `src/tools/server.ts` — gated on `ctx.slackClient` presence (same pattern as `find_user`)

## 2. Instructions

- [x] 2.1 Update `data/default_configuration/user/identity.md` filesystem guardrail to reference `upload_file` as the way to share file content with users

## 3. Testing

- [x] 3.1 Add unit tests for `upload_file` — content validation (empty, too large), default thread targeting, explicit channel/thread override, Slack API error handling
- [x] 3.2 Type-check with `npx tsc`
