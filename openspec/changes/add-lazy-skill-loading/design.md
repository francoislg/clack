## Context

The `add-lazy-mcp-loading` change (just landed) reduced session-start MCP server tool-schema baseline from ~130K tokens to a manageable floor by introducing a registry + `attach_integration` tool + topic-scoped instruction files. The remaining sizeable baseline contributor is **Claude Code plugin skills**: each plugin passed via `--plugin-dir` contributes every `SKILL.md`'s frontmatter (name + description) to the system prompt at session start. The `marketingskills` plugin in this repo has 32 skills × ~300-600 chars per description = ~15-20K tokens paid on every session even if marketing is irrelevant to the question.

Unlike MCP servers, the Claude Agent SDK does **not** expose a `setPlugins()` equivalent. The plugin set is frozen at `query()` invocation — whatever `--plugin-dir` values are passed become the permanent skill catalog for that session. Skill *bodies* are already lazy (loaded on `Skill("name")` invocation by the CLI), but skill *descriptions* (frontmatter) are always in baseline. So "native" lazy skill loading is off the table until Anthropic adds an SDK capability.

Current state references:
- `src/skillPlugins.ts:46` — `discoverPluginInfo()` scans `data/skill-plugins/` and returns all found plugins
- `src/skillPlugins.ts:96` — `discoverPlugins()` wraps them as `SdkPluginConfig[]` passed to `query()`
- `src/claude/index.ts` (buildQuerySetup) — passes `plugins: discoverPlugins()` unconditionally
- `src/claude/promptBuilder.ts` — `buildIntegrationsCatalog` renders AVAILABLE INTEGRATIONS; no equivalent for skills yet

## Goals / Non-Goals

**Goals:**
- Allow operators to tag a skill plugin as `lazyLoad: true`. The CLI does NOT load it via `--plugin-dir` — zero baseline contribution from that plugin's skill frontmatter.
- Claude sees a short **pack-level** catalog in the prompt ("marketing — CRO, copywriting, SEO, paid ads (32 skills)") and can discover individual skills on demand via a `list_skill_pack_skills` tool call.
- Claude can load a specific skill's full body via a `load_skill` tool call, which returns the SKILL.md contents as a tool result (conversation context, not baseline).
- Per-session caching: calling `load_skill` twice for the same pair returns the cached body without re-reading the file.
- Backwards-compatible: plugins without a `skillPlugins` entry continue to load via `--plugin-dir` exactly as today. No operator action required to keep working.
- Operator can migrate a pack from "always loaded" to "lazy" by flipping the registry entry and letting migration 018 rewrite any existing references in custom instruction files.

**Non-Goals:**
- NOT adding native `Skill(...)` invocation support for lazy packs. Claude must use `load_skill` instead. If an instruction file says `Skill("marketing-x")`, it won't work — the migration rewrites these, and the fallback rule in `integrations.md` catches the misses.
- NOT lazy-loading Clack's internal plugins (`src/plugins/`) — those are different from `data/skill-plugins/` Claude Code plugins. This change is scoped to the latter.
- NOT changing how skill *bodies* are loaded for `--plugin-dir`-passed plugins. Those continue to work via native `Skill(...)` invocation.
- NOT building a generalized plugin-mutation abstraction. If Anthropic ships `setPlugins()`, that's a future rewrite.

## Decisions

### D1: Registry lives in `config.json`, not a per-plugin manifest

Chosen: a new top-level `skillPlugins` object in `data/config.json`, keyed by plugin directory name:
```json
"skillPlugins": {
  "marketingskills": {
    "lazyLoad": true,
    "description": "Marketing playbooks: CRO, copywriting, SEO, paid ads, cold email, onboarding flows, pricing, referrals"
  }
}
```

**Alternatives considered:**
- Per-plugin sidecar (`data/skill-plugins/<name>/.clack-plugin.json`) — would require touching every vendored plugin; some are git-tracked external repos and a side-car creates merge friction.
- Hard-coded list in Clack — too rigid; every operator has different plugins.

**Rationale:** mirrors the shape of `mcpServers` registry (operators already understand this pattern) and keeps per-deployment config in a single, version-controlled-by-operator location.

### D2: Two tools, not one

Chosen: `list_skill_pack_skills({ pack })` + `load_skill({ pack, skill })`.

**Alternatives considered:**
- Single tool `attach_skill_pack(pack)` that loads ALL skills' descriptions into conversation — eliminates the "browse before load" step but pays the cost of all 32 marketing skills' descriptions when Claude only needs one.
- Reuse `attach_integration` — requires the skill pack to be an MCP server too; it isn't, and making it one just to reuse infrastructure is worse than a small custom tool pair.

**Rationale:** the two-step flow (list then load) matches how Claude already uses tools in similar situations (e.g., `find_pull_requests` then `get_pull_request`). Cost-aware: browsing descriptions is cheap (one pack's catalog), loading a body pays the actual skill cost only when the skill is chosen.

### D3: Catalog rendering alongside integrations, not in a unified block

Chosen: two separate blocks in the prompt — `AVAILABLE INTEGRATIONS` (existing) and `AVAILABLE SKILL PACKS` (new).

**Alternatives considered:**
- Unified "AVAILABLE CAPABILITIES" block that lists both — simpler but hides the distinction in tool usage (Claude needs to call different tools for each kind).
- Extend the catalog generator to include both in the same block — loses the tool-invocation guidance clarity.

**Rationale:** the tools are different (`attach_integration` vs `load_skill`), so Claude benefits from a clearly-separated catalog with its own "how to use" preamble.

### D4: Per-session skill-load caching

Chosen: track loaded `(pack, skill)` pairs in a session field `loadedSkills: Array<{ pack, skill }>` and short-circuit repeated `load_skill` calls.

**Alternatives considered:**
- No caching — Claude might re-load the same skill across turns, inflating conversation history.
- Read-through cache on disk (session-scoped) — overcomplicates things; SKILL.md files don't change during a session.

**Rationale:** idempotent calls should stay cheap; the session already has storage for similar ephemeral state (`attachedIntegrations`, `mcpAttachHistory`).

### D5: Tool output shape

Chosen for `list_skill_pack_skills`: a plain-text list, one line per skill: `- <skill-name> — <first-paragraph-of-description>`.

Chosen for `load_skill`: the full SKILL.md body starting at the first heading after the frontmatter, wrapped in a brief preamble: "Loaded skill '<name>' from pack '<pack>'. Apply its guidance to the current question.\n\n---\n\n<body>".

**Rationale:** consistent with how `attach_integration` returns topic instructions today; Claude reads tool results as context and the preamble signals "this is instructions, not data".

### D7: A `SkillsManager` class parallels `McpServerManager`

Chosen: introduce `src/claude/skillsManager.ts` exporting a `SkillsManager` class + a `prepareSkillsSession(session, pluginInfos, registry)` factory. The manager encapsulates:
- Lazy-pack metadata (name, path, operator-supplied description, per-skill list with frontmatter) — scanned once at session start
- Per-session `loadedSkills` Set (seeded from `session.loadedSkills`)
- Methods: `knowsLazyPack`, `isEagerPack`, `knownLazyPackNames`, `packDescription`, `listSkills`, `getSkill`, `readSkillBody`, `isSkillLoaded`, `markLoaded`

The `list_skill_pack_skills` and `load_skill` tools become thin wrappers that delegate to the manager (same pattern as `attach_integration` delegating to `McpServerManager`).

**Alternatives considered:**
- Two free-standing helper modules (one for filesystem scanning, one for load-tracking) — loses the single-place invariant and spreads session-lifecycle state across files.
- Per-tool filesystem scan — re-reading the skills directory on every `list_skill_pack_skills` call is wasteful and duplicates frontmatter parsing between tools.

**Rationale:** operators and maintainers already understand the `McpServerManager` pattern; reusing the same shape for skills makes the two infrastructures easier to reason about together. The session-start scan amortizes frontmatter parsing across every subsequent tool call.

**Scope note:** unlike `McpServerManager`, the skills manager does NOT wrap an SDK mutation call — the SDK plugin set is frozen at session start. `load_skill` returns file contents as a tool result; it does not re-register plugins. The manager is pure-ish: filesystem read at construction, pure accessors afterwards, with one `updateSession` side effect when a skill is marked loaded.

### D6: Migration scope

Chosen: scaffold migration `018-lazy-skill-references` as a Claude-powered (`enhancement`-priority, prompt-based) migration that reads every user instruction file in `data/configuration/{role}/` (including topic files) and rewrites skill references.

**Alternatives considered:**
- Static regex-based migration — too brittle; operator-authored prose varies too widely.
- No migration, rely on the fallback rule in `integrations.md` — works for one-offs but leaves outdated instructions in place long-term.

**Rationale:** same shape as the 017-split-topic-files migration we just landed. Prompt-based migrations in this codebase have a working template.

## Risks / Trade-offs

- **[Risk] Claude defaults to `Skill(...)` out of habit** (we saw this in the Asana debug session: Claude called `Skill("asana")` despite `integrations.md` saying otherwise). → **Mitigation:** explicit DO NOT example in `integrations.md` fallback rule ("if `Skill('<name>')` returns unknown, try `load_skill('<pack>', '<name>')` instead"), migration 018 rewrites references.
- **[Risk] Operators flip a plugin to lazy without migrating their custom files** → the old `Skill("ab-test-setup")` references in custom files will fail at runtime (tool returns "Unknown skill"). → **Mitigation:** migration runs as enhancement-priority on next boot; fallback rule prevents a stuck session. Document the operator flow (flip config → restart → migration runs → instructions updated).
- **[Risk] Conversation-history cost of loaded skills** — if Claude loads 3-4 skills in a turn, those bodies land in conversation history. On the next turn, cached input tokens still cost money (even with prompt caching) though less than fresh tokens. → **Mitigation:** prompt caching still applies to the conversation prefix; cost is lower than baseline. And Claude typically needs 0-1 skills per turn for any given question.
- **[Trade-off] No native `Skill(...)` for lazy packs** → once a plugin is lazy, the full `--plugin-dir` support disappears. Plugins that rely on native skill invocation (e.g., nested skill-calls-skill) would not work lazy. → Operators should only flip plugins to lazy when they're confident the skills are self-contained. Document this in the lazy-skill-loading spec.
- **[Trade-off] Duplication between MCP lazy-loading and skill lazy-loading infrastructure** — two parallel registries, two catalogs, two attach flows. → Accepted: the shapes are similar but the SDK surfaces are different (setMcpServers vs. frozen plugin set). Consolidating into "one catalog" hides meaningful distinctions. Keep them parallel.

## Migration Plan

1. Ship registry + tools + catalog (backwards-compat default: plugins without a `skillPlugins` entry load normally).
2. Document the operator flow for flipping a plugin lazy (config change + restart + enhancement migration runs).
3. Ship migration 018 which rewrites references. Runs on next boot after this change merges.
4. Operator migrates `marketingskills` (the canary) to lazy, measures baseline impact via the startup smoke.
5. If baseline impact matches design estimate (~15K drop), encourage flipping other heavy plugins.

Rollback: flip `lazyLoad: false` (or remove the entry). Plugin goes back to `--plugin-dir`; migration 018 need not be reverted (the rewritten references to `load_skill` will fail with "Unknown tool" if the tool is later removed entirely, but while both code paths coexist, operator can live with either shape).

## Open Questions

1. **Should the catalog block include skill counts per pack?** "marketing (32 skills)" vs. just "marketing". Pro: gives Claude a sense of pack size. Con: baseline bloat (trivial). → Lean yes, but pack descriptions can self-describe scope.
2. **Should `load_skill` return Frontmatter too, or just the body?** Returning frontmatter would let Claude see `description` + metadata. → Probably return the full file including frontmatter; parsing is trivial and Claude can ignore what it doesn't need.
3. **Should we add pack-level role-gating?** Even though general role-gating was rejected, per-pack might make sense — e.g., "only load marketing pack catalog for admin+". → Defer; operator can omit marketing from `skillPlugins` entirely if they don't want the catalog line at all. Catalog itself is negligible cost.
4. **Telemetry for skill-pack usage** — mirror `mcpAttachHistory` with `skillLoadHistory`? → Deferred to Impact but not required for spec. Nice-to-have for the same debug reasons.
