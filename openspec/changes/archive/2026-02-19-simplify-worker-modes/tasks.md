## 1. Remove WorkerMode Type

- [x] 1.1 Delete `WorkerMode` type from `src/tools/types.ts` and change `WorkerToolContext.mode` to literal `"worker"`
- [x] 1.2 Remove `WorkerMode` from import in `src/tools/context.ts`, remove `mode` from `BuildWorkerContextParams`, hardcode `mode: "worker"` in `buildWorkerContext` return

## 2. Simplify Worker Tool Registration

- [x] 2.1 Replace the 5-case switch in `buildWorkerTools` (`src/tools/server.ts`) with unconditional registration of all worker tools (git_push, ensure_pr, merge_pr, close_pr)

## 3. Permission Gating

- [x] 3.1 Gate follow-up action tools on `canRequestChanges(ctx.role)` in `src/tools/server.ts` — change `if (ctx.changeSession)` to `if (ctx.changeSession && canRequestChanges(ctx.role))`
- [x] 3.2 Add role-based permission check to `handleAutoExecuteActions` in `src/slack/handlers/core.ts` — import `canRequestChanges`, add `role` parameter, early-return if not privileged
- [x] 3.3 Update `handleAutoExecuteActions` call site in `processMessage` to pass `claudeOptions.role ?? "member"`

## 4. Remove Mode from Callers

- [x] 4.1 Remove `mode: "execute"` from `buildWorkerContext` call in `src/changes/execution.ts`
- [x] 4.2 Remove the mode ternary chain from `buildWorkerContext` call in `src/changes/workflow.ts`

## 5. Update Specs

- [x] 5.1 Sync delta specs to main specs via `openspec sync`

## 6. Verify

- [x] 6.1 Run `npx tsc --noEmit` to confirm no type errors from removed `WorkerMode` references
