---
name: migrate-skill-pack
description: >
  Turn a bare SKILL.md folder under data/skill-plugins/ into a properly-structured,
  lazy-loaded Claude Code skill pack and deploy it to the Clack GCE VM. Use when
  someone drops a skill folder into data/skill-plugins/ (e.g. applauz-insurance) and
  wants it "supported", "lazy-loaded", "registered", or "deployed" like an existing
  pack (e.g. applauz-policies) — or says the pack "isn't showing up" / "Claude can't
  find the skill". Trigger on "migrate the skill pack", "make this skill lazy-loaded",
  "register this skill pack", "deploy this skill to the VM".
---

# Migrate a bare skill folder into a lazy-loaded, deployed skill pack

**Input**: the name of the pack directory under `data/skill-plugins/<pack>/` that needs
migrating (e.g. `applauz-insurance`). If not given, ask which pack.

## Why this is needed

`src/skillPlugins.ts` → `discoverSkillPluginInfo()` scans `data/skill-plugins/*` and
**skips any directory without a `.claude-plugin/plugin.json` or
`.claude-plugin/marketplace.json` manifest** (`if (!manifestPath) continue`). A folder
that is just `SKILL.md` + `references/` at the top level is invisible to the SDK —
neither eager nor lazy. A valid pack needs:

```
<pack>/
├── .claude-plugin/
│   └── marketplace.json         ← makes the pack discoverable (REQUIRED)
└── skills/
    └── <skill-name>/            ← skill dir name should match SKILL.md frontmatter `name`
        ├── SKILL.md
        └── references/…         ← moves with SKILL.md; keeps relative paths valid
```

"Lazy-loaded" additionally requires a `config.json` → `skillPlugins["<pack>"]` registry
entry with `lazyLoad: true` and a `description`. Lazy packs are **excluded** from the
SDK session-start plugin set; Claude discovers them from the AVAILABLE SKILL PACKS
catalog (built from the registry `description`) and loads a skill on demand via
`load_skill("<pack>", "<skill>")`. Without the registry entry the pack loads *eagerly*
(frontmatter burned into every session).

Use `data/skill-plugins/applauz-policies` as the reference implementation to mirror.

## Steps

Do these in order. Use **relative paths**. The pack files are gitignored (under `data/`),
so plain `mv` is fine — no `git mv` needed.

### 1. Inspect the current layout

```
ls -la data/skill-plugins/<pack>/
ls -la data/skill-plugins/<pack>/.claude-plugin 2>/dev/null   # likely missing
head -6 data/skill-plugins/<pack>/SKILL.md                     # get frontmatter `name`
```

The frontmatter `name` is the skill name; the target skill dir is
`skills/<name>/`. Confirm any `references/…` paths in SKILL.md are **relative** (they
should be) so they survive the move.

### 2. Restructure into pack layout

```
base=data/skill-plugins/<pack>
mkdir -p "$base/skills/<name>" "$base/.claude-plugin"
mv "$base/SKILL.md" "$base/skills/<name>/SKILL.md"
mv "$base/references" "$base/skills/<name>/references"
```

### 3. Add the manifest

Create `<base>/.claude-plugin/marketplace.json`, mirroring
`data/skill-plugins/applauz-policies/.claude-plugin/marketplace.json`. Fill in the
pack name, descriptions, and the `skills` path:

```json
{
  "name": "<pack>",
  "owner": { "name": "Applauz" },
  "metadata": {
    "description": "<one-line pack summary>",
    "version": "1.0.0"
  },
  "plugins": [
    {
      "name": "<pack>",
      "description": "<what this pack answers>",
      "source": "./",
      "strict": false,
      "skills": ["./skills/<name>"]
    }
  ]
}
```

### 4. Register it lazy in config.json

Add to `data/config.json` → `skillPlugins` (mirror the `applauz-policies` entry). The
`description` is what Claude reads in the AVAILABLE SKILL PACKS catalog to decide when to
`load_skill`, so make it trigger-rich (list the concrete question types):

```json
"<pack>": {
  "lazyLoad": true,
  "description": "<trigger-rich description: what topics/questions this pack answers>"
}
```

### 5. Rewrite broken skill references (only if any exist)

If any `data/configuration/{role}/**/*.md` instruction file references the skill via
`Skill("<name>")` or prose ("use the <name> skill"), rewrite to
`load_skill("<pack>", "<name>")` — lazy packs are not registered as `Skill()` targets.
This mirrors migration `018-lazy-skill-references`. For a brand-new pack with no
instruction references, this step is a no-op.

### 6. Validate

```
node -e "JSON.parse(require('fs').readFileSync('data/config.json','utf8')); console.log('config ok')"
node -e "JSON.parse(require('fs').readFileSync('data/skill-plugins/<pack>/.claude-plugin/marketplace.json','utf8')); console.log('manifest ok')"
```

### 7. Deploy to the GCE VM

The pack lives under `data/` (gitignored, VM-persistent) — it does **not** ship in the
Docker image. It reaches the VM via `scripts/gce-push-config.sh`, driven by the
`data/.deploy-include` manifest.

**a.** Add the pack path to `data/.deploy-include` (once per pack, so future pushes are
declarative):

```
data/skill-plugins/<pack>
```

**b.** Before pushing, check local↔VM divergence on the manifest paths — the script's
non-interactive guard aborts on ANY diff, and `config.json`/`mcp.json` often differ only
by `—` vs literal `—` JSON encoding (cosmetic, same string). Confirm the only *real*
delta is your intended change, then it's safe to `--force`:

```
source scripts/gce-common.sh
tmp=$(mktemp -d)
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet \
  --command="sudo tar -C '$DATA_MOUNT_POINT' -cf - data/config.json data/mcp.json 2>/dev/null" 2>/dev/null | tar -C "$tmp" -xf -
# Normalize unicode escapes so only real content diffs show:
python3 -c "import json;print(json.dumps(json.load(open('data/config.json')),ensure_ascii=False,sort_keys=True,indent=2))" > "$tmp/l.json"
python3 -c "import json;print(json.dumps(json.load(open('$tmp/data/config.json')),ensure_ascii=False,sort_keys=True,indent=2))" > "$tmp/v.json"
diff "$tmp/l.json" "$tmp/v.json"   # expect ONLY your new skillPlugins entry
rm -rf "$tmp"
```

If the only real diff is your change, push:

```
bash scripts/gce-push-config.sh --force
```

(Without `--force` the script aborts non-interactively on the cosmetic encoding diff.
Only use `--force` after you've confirmed divergence is cosmetic + your intended change —
otherwise reconcile the VM's version first, since `config.json`/`mcp.json` can be edited
from the bot's Home Tab.)

### 8. Verify on the VM

```
source scripts/gce-common.sh
gcloud compute ssh "$INSTANCE_NAME" --zone="$ZONE" --quiet --command="
  sudo ls '$DATA_MOUNT_POINT/data/skill-plugins/<pack>/.claude-plugin'
  sudo ls '$DATA_MOUNT_POINT/data/skill-plugins/<pack>/skills/<name>'
  sudo grep -c '<pack>' '$DATA_MOUNT_POINT/data/config.json'
  sudo stat -c '%u:%g %n' '$DATA_MOUNT_POINT/data/skill-plugins/<pack>'
"
```

Expect: `marketplace.json` present, `SKILL.md` + `references` present, config grep ≥ 1,
ownership `1001:1001` (the container user — `gce-push-config.sh` chowns pushed paths).

**No container restart needed.** `config.json` hot-reloads via the file watcher, and
`discoverSkillPluginInfo()` runs at each session start, so the next new session picks up
the pack and lazy-loads it. (A restart is only needed for `default_configuration`
changes, not skill packs.)

## Done when

- Local pack has `.claude-plugin/marketplace.json` + `skills/<name>/{SKILL.md,references}`.
- `config.json` has a `skillPlugins["<pack>"]` entry with `lazyLoad: true` + description.
- `data/.deploy-include` lists the pack path.
- VM shows the pack in correct layout, registry entry present, owned by `1001:1001`.
