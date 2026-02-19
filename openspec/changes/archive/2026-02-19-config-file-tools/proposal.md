## Why

The `propose_config_update` tool requires Claude to output the entire file content for every update, even when the admin only wants to add a single line. This is fragile — Claude can hallucinate, drop sections, or produce inconsistent content. Most config edits are additions ("add this rule"), not rewrites. Additionally, Claude has no tool to read the current file content before proposing changes, so it operates blind (inferring content from its system prompt).

## What Changes

- Add a `read_config_file` MCP tool (admin/owner only) that returns the current content of an instruction file
- Modify `propose_config_update` to support an `operation` parameter: `"append"` (default) or `"replace"`
- When `operation` is `"append"`, the tool reads the current file and appends the new content — Claude only provides the addition
- When `operation` is `"replace"`, the tool behaves like today (full replacement) — used for removals where Claude must reconstruct the file
- Remove the existing first-override seeding logic (lines 38-44) since append handles this case naturally

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `clack-tools`: Add `read_config_file` tool to the admin tool set
- `config-update-via-chat`: Add `operation` parameter to `propose_config_update`, change default behavior to append

## Impact

- `src/tools/query/readConfigFile.ts` — new tool file
- `src/tools/actions/proposeConfigUpdate.ts` — add `operation` param, rework content assembly logic
- `src/tools/server.ts` — register `read_config_file` in admin block
- `data/default_configuration/admin_instructions.md` — update guidance for append-by-default behavior
