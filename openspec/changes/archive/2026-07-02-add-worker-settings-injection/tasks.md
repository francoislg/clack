## 1. Spike: confirm hook-channel coexistence (deferred — needs a live worker run)

> Requires a running Clack + Slack worker; not runnable in the CI/sandbox. The door-opener is inert without a file and leaves the programmatic bash guard untouched, so it is safe to ship ahead of this live check. Strong supporting evidence already exists: an external command hook (claude-dont) runs live alongside other hooks in the authoring session.

- [ ] 1.1 Author a throwaway `worker-settings.json` with a PreToolUse command hook that `echo`s a marker for Bash calls; run a worker change and confirm the marker AND the built-in bash guard both fire on the same Bash call
- [ ] 1.2 Confirm operator `permissions.deny` in the settings file cannot re-enable a tool Clack disabled via `disallowedTools`/the bash guard (precedence check)
- [ ] 1.3 Record the spike outcome in `design.md` (resolve the "both hooks fire?" open question); if they don't merge, switch the design to wrapping file command-hooks as programmatic callbacks

## 2. Door-opener in worker execution

- [x] 2.1 Add `getWorkerSettingsPath()` to `src/config.ts` resolving `data/worker-settings.json` to an absolute path under `getDataDir()`
- [x] 2.2 In `runClaude`'s query options, set `settings` to that absolute path only when the file exists; omit it otherwise
- [x] 2.3 Keep the programmatic `hooks: [buildWorkerBashGuardHook()]` unchanged so both channels coexist
- [x] 2.4 Log at boot (or first worker run) whether a worker settings file is present, so operators can confirm the guardrail loaded

## 3. Tests

- [x] 3.1 Unit-test `runClaude` (mocking the SDK boundary): file present → `settings` set to the absolute path; file absent → `settings` omitted
- [x] 3.2 Test that the forwarded path is absolute and independent of the worker `cwd`/worktree
- [x] 3.3 Assert the bash guard hook remains registered regardless of the settings file's presence

## 4. Optional hardening (fail-fast validation) — not taken; Decision 3 chose path-forward

- [ ] 4.1 If boot-time safety is chosen over path-forwarding, add a light `z.object({ hooks: …optional(), permissions: …optional() }).passthrough()` schema and validate the file on load, passing the parsed object as `settings`
- [ ] 4.2 On invalid file, fail fast at boot with a formatted error (reuse `zodErrorToResult`) rather than deferring to worker-run time

## 5. Documentation (ops-facing, no tool references in code)

- [x] 5.1 Add operator docs: fixed file path, native `settings.json` shape (command hooks + `permissions.deny`), absolute-path requirement, and gitignore note — captured in `data/worker-settings.example.json`
- [x] 5.2 Document the deployment burden: hook binaries + prerequisites (`jq`, `bash`) must exist at absolute paths inside the GCE VM / Docker image; rollback = remove the file — captured in the example file's `_comment`
- [x] 5.3 Verify no specific hook-tool name appears anywhere in `src/` or shipped config
