# Worker settings injection

Worker-mode Claude (the Changes Workflow — `executeChange` → `runClaude` in
`src/changes/execution.ts`) can load an **operator-provided native Claude Code
`settings.json`**, letting you attach external guardrails — PreToolUse command
hooks, and any other native settings key — **without any hook-specific code in
the repo**. Clack only ever locates the file and forwards it; it never knows what
is inside. Absent → the worker runs exactly as before.

The codebase contains **zero** references to any specific hook tool. Everything
tool-specific (the hook binary, its config, the settings file that wires it in)
is provided from outside — see [Installing a hook](#installing-a-hook-operator).

## How it works

By default the Agent SDK runs the worker in **isolation mode**: no filesystem
settings (`~/.claude/settings.json`, project `.claude/`) are loaded. So there is
no ambient way to attach hooks.

`runClaude` opens exactly one door: if `data/worker-settings.json` exists, its
**absolute** path is passed to the SDK's `settings` query option (equivalent to
the `--settings` CLI flag — the highest-priority "flag" settings layer). This
injects *only* that file's contents — it does **not** enable `settingSources` or
pull in CLAUDE.md / project config.

```
data/worker-settings.json  ──►  getWorkerSettingsPath()  ──►  query({ options: {
  hooks:    [buildWorkerBashGuardHook()],   // built-in guard, always on
  settings: "/abs/path/to/data/worker-settings.json",   // ← your file, when present
}})  ──►  Claude Code CLI runs the file's hooks natively
```

- **Path is always absolute**, resolved from `getDataDir()` — the worker `cwd` is
  a per-run git worktree, so a relative path would resolve against the worktree
  and break.
- **The built-in bash guard still fires.** `buildWorkerBashGuardHook` (which
  blocks raw `git push`, steering to the `git_push` tool) travels the
  programmatic `hooks` option; your command hooks travel `settings.hooks`. Both
  are active.
- **`permissions` rules are inert here.** The worker runs with
  `permissionMode: "bypassPermissions"`, which skips the allow/deny permission
  system. PreToolUse **hooks** are unaffected (they fire under bypass), so
  **hooks are the enforcement path** — put hard blocks in a PreToolUse hook that
  returns a deny decision, not in `permissions.deny`.

## File location & shape

- **Path:** `data/worker-settings.json` (gitignored — a sibling of `data/mcp.json`,
  also "pure Claude SDK shape").
- **Shape:** a native Claude Code `settings.json`. See
  [`data/worker-settings.example.json`](../data/worker-settings.example.json).

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*",
        "hooks": [{ "type": "command", "command": "/absolute/path/to/hook.sh" }]
      }
    ]
  }
}
```

## Runtime-environment requirements

The `command` path (and anything it invokes) must **exist at an absolute path
inside the environment the worker runs in** — for the Docker/GCE deployment that
is *inside the container*, not on your laptop — along with any prerequisites the
hook needs (e.g. `jq`, `bash`). See below.

## Deployment: the settings file travels with every deploy

`data/worker-settings.json` is part of the **standard deployment flow** — no
extra provisioning step. `scripts/gce-update-image.sh` (what `/deploy` runs)
pushes the local file to the VM's persistent disk on every deploy, right after
the image pre-pull:

- **Present locally** → pushed to the VM (chowned to the container UID `1001`).
  The local copy is the source of truth: the file is operator-owned and never
  edited VM-side, so this is always safe.
- **Absent locally** → the VM copy (if any) is deliberately **left untouched**,
  so deploying from a fresh checkout doesn't silently disable guardrails. To
  actually disable the hook, delete the file on the VM's data disk.

Edit the file locally → deploy → the next worker run picks it up (the path is
checked at each worker start, not at boot).

## Installing a hook (operator): the image overlay

The settings file alone is not enough — the hook **binaries** it points at must
exist inside the runtime environment. They ship via the optional
**per-instance image overlay**, a gitignored Dockerfile layered onto the pinned
**tools base image**:

1. `cp data/docker/Dockerfile.custom.example data/docker/Dockerfile.custom`
   (gitignored) and edit it — `FROM …/clack:tools-base`, `apk add` any packages
   the hook needs, `COPY` the hook files to a fixed absolute path like
   `/opt/worker-hooks/<your-hook>/` (anything `COPY`'d must live inside
   `data/docker/`, the build context). Stay root — the tools base has no `clack`
   user yet (the app stage creates it), so do not add a `USER clack` switch.
2. Write `data/worker-settings.json` pointing at those in-image paths.
3. Deploy normally. When `data/docker/Dockerfile.custom` exists,
   `scripts/gce-update-image.sh` builds the generic tools image as
   `clack:tools-base`, then builds your overlay on top and pushes it as the
   content-addressed `clack:tools-<hash>`; the app image builds `FROM` that.
   Without the file, the generic tools image *is* `clack:tools-<hash>`.

The overlay is folded into the tools image, which is rebuilt **only when its
inputs change** (`Dockerfile.tools` or anything under `data/docker/`) — a normal
code deploy reuses the existing tools image and doesn't touch it. It is still
repeatable by construction — the Dockerfile *is* the provisioning script; there
is no separate install step and nothing that can drift. The committed base
`Dockerfile` stays generic (it takes the tools image as a `TOOLS_IMAGE`
build-arg, so no instance-specific registry path is ever committed). A small
`provision.sh` inside `data/docker/` (re-fetching hook sources) keeps the build
context itself reproducible from a fresh checkout.

Note: do **not** bake `data/worker-settings.json` into an overlay — the
persistent-disk mount at `/app/data` shadows any image content at that path.
The standard deploy pushes the settings file for you (see above).

Instance-specific notes live alongside the overlay in `data/docker/README.md`
(gitignored).

## Verifying

Pipe a PreToolUse payload into the hook inside the running container (same user
and paths a real worker uses):

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"<a command your hook blocks>"}}' \
  | docker exec -i clack /opt/worker-hooks/<your-hook>/hook.sh
# a blocked call prints the hook's deny JSON and exits non-zero; an allowed call exits 0
```
