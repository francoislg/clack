## Context

Three admin MCP tools currently address instruction files via a single path-string. The disk model has three identifiers — `role`, optional `topic`, `filename` — but the API smashes them into one string and validates with a path-shape check (`parts.length !== 2`). Topic files (under `{role}/topics/{topic}/...`) are silently rejected because their paths have four segments.

The on-disk layout is fixed by the resolver:

```
data/{configuration|default_configuration}/
  {role}/                           # role ∈ {user, dev, admin, owner}
    *.md                            # baseline files
    topics/
      {topic}/                      # topic name — open set, plugin/admin-creatable
        *.md                        # topic-scoped files for this role
```

Topics are per-role: `user/topics/metabase/rules.md` and `dev/topics/metabase/rules.md` are distinct files in the cascade. Same filename, different override layers.

## Goals / Non-Goals

**Goals**
- Make topic files reachable through the chat-based config-edit flow (read, list, propose update).
- Replace path-string parameters with semantic fields (`role`, `topic?`, `file`) so role validation moves into the JSON schema.
- Keep topic names open-ended — admins can create files for brand-new topics on the fly.

**Non-Goals**
- Resolved-view feature ("show me what a dev sees as a single concatenated string"). The current implementation overloads `read_config_file({ file: "dev" })` for this; we're removing that overload. If the feature is missed, it gets a separate dedicated tool later.
- Catalog-aware topic discovery (i.e., `list_config_files` showing topics from `data/config.json`'s MCP catalog even when no files exist). Filesystem-driven only.
- Surfacing topics in the Home Tab UI. Already separately specified, separately scoped.
- Backwards compatibility with the path-string shape. These tools are admin/owner-only and only Claude calls them via the system prompt — we update the prompt and the tools together.

## Decisions

### 1. Role is required; topic is optional and open-ended

```
read_config_file({ role: "dev", file: "changes.md" })                   // baseline
read_config_file({ role: "dev", topic: "metabase", file: "rules.md" })  // topic-scoped

propose_config_update({ role, file, content, operation })                       // baseline
propose_config_update({ role, topic, file, content, operation })                // topic-scoped
```

Why role-required even for topic files: every topic file lives under exactly one role on disk (`{role}/topics/{topic}/...`). The same filename can exist across roles with different content — they're distinct files in the cascade. Dropping role would force the tool to either guess (write where?) or sweep (read all variants?), neither of which the user asked for.

### 2. Validation schema

```ts
const ROLE = z.enum(["user", "dev", "admin", "owner"]);
const TOPIC = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/i);  // open, but no /, no .., no leading punct
const FILE = z.string().regex(/^[\w][\w.-]*\.md$/);        // bare filename ending .md, no /
```

- `role` is closed-set so typos fail at the schema boundary instead of as "directory not found" at write time.
- `topic` is open-set because new topics get created at write time. The regex blocks path traversal (`..`, `/`) at the schema layer.
- `file` regex enforces bare-filename and `.md` extension. Belt-and-suspenders with `writeInstructionFile`'s `startsWith(configDir)` check.

### 3. `list_config_files` output shape

```json
{
  "roles": [
    {
      "role": "user",
      "files": [
        { "file": "identity.md", "status": "default" },
        { "file": "changes.md", "status": "customized" }
      ],
      "topics": [
        {
          "topic": "metabase",
          "files": [
            { "file": "rules.md", "status": "customized" }
          ]
        }
      ]
    },
    { "role": "dev", "files": [...], "topics": [...] }
  ],
  "repos": [
    { "repo": "monorepo", "files": [...] }
  ]
}
```

- `roles` is now an explicit array (was an inline object keyed by role name) — this fits the semantic style and matches how Claude will pass the values back into the read/write tools.
- Each role gets `files` (baseline, was at the top level) and `topics` (new, grouped by topic).
- Repos restructured similarly so the entire response uses semantic field names instead of bare strings as keys.

### 4. Resolved-view feature: removed

`read_config_file({ file: "dev" })` returning the full cascaded instruction set is dropped. The overload only worked because `"dev"` happened to match a role enum and lacked a `.md` extension. With explicit `role` and `file` fields, there's no clean way to reuse the same schema. If admins still need this — common request: "what does a dev actually see?" — it goes into a dedicated tool (`resolve_role_instructions` or similar) with its own schema, possibly accepting `topics: string[]` for the resolved-with-active-topics view.

This is a regression of an existing, specced capability. We accept it because:
- The feature was a schema overload, not a clean API surface.
- The replacement (separate tool) is small enough to add later if missed.
- Listing files + reading them individually still gives admins a path to the same answer, just with more calls.

### 5. Internal write-path: keep one path string, build at the tool boundary

`writeInstructionFile(filename, content)` already accepts an arbitrary subpath under `configDir` and does `mkdir -p` + a `startsWith` traversal check. We keep that signature unchanged. The tool composes the path internally:

```ts
function buildPath(role: Role, topic: string | undefined, file: string): string {
  return topic ? `${role}/topics/${topic}/${file}` : `${role}/${file}`;
}
```

The staged intent (`IntentStore.stage({ type: "config_update", file, content })`) keeps `file` as a single path string. The button handler reads the same field. This minimizes blast radius in the `apply_config_update` flow.

### 6. Read-side helper: extend `readInstructionFile` or add `readConfigFile(role, topic?, file)`

Two options:

a) Keep `readInstructionFile(path)` and have the tool layer build the path. Same as the write path — uniform.
b) Add a new `readConfigFile({ role, topic?, file })` that wraps `readRoleFile` and `readRoleTopicFile` based on whether `topic` is present.

Going with **(a)** for consistency with write side. The functions in `cascadingConfigResolver.ts` (`readRoleFile`, `readRoleTopicFile`) are still used by tests and any future Home Tab work — but the tool layer composes the path and calls `readInstructionFile`, which internally splits and dispatches. Path is the internal lingua franca; the API just doesn't expose it.

`readInstructionFile` currently only accepts 2-segment paths. It needs to grow support for 4-segment topic paths (or split into `readBaselineFile` / `readTopicFile` and have a thin dispatcher). Implementation detail — the wrapper function exposed by `configurationFiles.ts` will dispatch to the right cascade-resolver function.

### 7. Append operation for topic files

`propose_config_update` with `operation: "append"` reads the current content and appends. For topic files, "current content" comes from `readRoleTopicFile(role, topic, file)` (or the unified `readInstructionFile` after dispatch lands). Same `custom_content ?? default_content` precedence rule as baseline files.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Claude calls old shape from cached prompts mid-rollout | Schema errors are explicit; Claude self-corrects on retry. No data loss path. |
| Resolved-view regression bites someone | Easy add-back as a focused tool. Spec change documents the removal explicitly so it's not a surprise. |
| Open-set topic field allows weird names like `MyTopic-1.0` | Regex permits `[a-z0-9_-]` case-insensitive; characters like `.` are blocked, which prevents `..` traversal. Anything that parses cleanly to a directory name is fine. |
| Test combinatorics balloon (role × topic-yes/no × append/replace × default/custom/missing) | Targeted matrix: representative scenarios per axis, not full cross-product. |
| Spec for `cascading-config-resolver`'s "Topic File Discovery in Home Tab" requires path-style entries (`user/topics/metabase/metabase.md`) | Modify that requirement: it says "for Home Tab or MCP tools," and we're changing the MCP tool shape. The Home Tab implementation is still pending — when it lands it can choose its own representation. The spec needs to allow either. |

## Migration Plan

This is a tool-API breaking change with a contained blast radius (admin tools, prompt-driven). Sequence:

1. Land code and schema changes on the tools.
2. Update `data/default_configuration/admin/*.md` instructions in the same change.
3. No data migration needed (disk layout unchanged).
4. No version-pinning or feature-flagging — the new shape is the only shape.

## Open Questions

<!-- Resolved during proposal review — kept here as a record of the decision rationale. -->

- ~~**Action handler intent shape**~~ → **Decided: keep as single path string.** The staged intent stays `{ type: "config_update", file: <composed path>, content }`. The propose tool composes the path via `buildInstructionPath(role, topic, file)` before staging. This preserves `applyConfigUpdate`'s current contract — it continues to read `intent.file` as a single path and call `writeInstructionFile(intent.file, content)` unchanged.

- ~~**`list_config_files` and pre-analysis pseudo-role**~~ → **Decided: top-level `preAnalysis` field.** The new `list_config_files` output shape is `{ roles: RoleEntry[], preAnalysis: FileEntry[], repos: RepoEntry[] }`. `pre-analysis` is not a real role (it's not in the role enum, doesn't cascade), so synthesizing it into the `roles` array would be misleading. A dedicated top-level field surfaces it as the distinct concept it is.
