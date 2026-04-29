## MODIFIED Requirements

### Requirement: Topic File Discovery in Home Tab

The system SHALL surface topic files in instruction-file listings alongside baseline files. The Home Tab MAY use any representation it chooses; MCP tools SHALL expose topic files via semantic fields (`role`, `topic`, `file`) rather than embedded path-prefixed strings, so the listing output is directly usable as input to `read_config_file` and `propose_config_update`.

#### Scenario: MCP listing exposes topic files under semantic fields

- **GIVEN** `data/configuration/user/topics/metabase/metabase.md` exists
- **WHEN** the `list_config_files` MCP tool is called
- **THEN** the response surfaces a topic group under the `user` role with `topic: "metabase"` and a `files` array containing `{ file: "metabase.md", status: "customized" }`
- **AND** the listing entry can be passed back into `read_config_file` and `propose_config_update` as `{ role: "user", topic: "metabase", file: "metabase.md" }` without further transformation

#### Scenario: Home Tab listing includes topic files

- **GIVEN** `data/configuration/user/topics/metabase/metabase.md` exists
- **WHEN** the Home Tab instruction-file picker is rendered
- **THEN** the file is editable through the same UI flow as baseline files
- **AND** the Home Tab MAY display topic files using whichever representation best fits the UI (e.g., grouped under a topic header, or rendered with a topic-prefixed label)
