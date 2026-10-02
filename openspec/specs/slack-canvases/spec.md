# slack-canvases Specification

## Purpose

TBD - created by archiving change slack-canvases. Update Purpose after archive.

## Requirements

### Requirement: Canvases config gate

The config SHALL accept an optional top-level `canvases` block `{ mode, writeRole? }` where `mode` is one of `"off"`, `"read"`, `"write"` and `writeRole` is one of `"member"`, `"dev"`, `"admin"`, `"owner"` (default `"dev"`). The block SHALL be validated fail-fast: a wrong-typed value, an unknown mode or role, or an unknown key SHALL stop config loading with an error naming the key. An absent block SHALL behave as `mode: "off"`.

#### Scenario: Absent block

- **WHEN** the config has no `canvases` key
- **THEN** no canvas tool is registered and no canvas scope is required

#### Scenario: Invalid mode

- **WHEN** `canvases.mode` is `"edit"`
- **THEN** config loading fails with an error naming `canvases.mode` and listing the supported values

#### Scenario: Unknown key

- **WHEN** the `canvases` block contains `enabled: true`
- **THEN** config loading fails with an error naming the unknown key

### Requirement: Canvas tool registration by mode

In `read` mode the tool server SHALL register `read_canvas` for every role when a Slack client is present. In `write` mode it SHALL also register `create_canvas` and `edit_canvas` for roles that meet `canvases.writeRole`. In `off` and `read` modes no canvas write tool SHALL be registered. No tool SHALL delete a canvas or change canvas access other than the share described for `create_canvas`.

#### Scenario: Read mode

- **WHEN** `canvases.mode` is `"read"` and an owner runs a query session
- **THEN** `read_canvas` is available
- **AND** `create_canvas` and `edit_canvas` are not

#### Scenario: Write mode below threshold

- **WHEN** `canvases.mode` is `"write"`, `writeRole` is `"dev"` and a member runs a query session
- **THEN** `read_canvas` is available
- **AND** `create_canvas` and `edit_canvas` are not

#### Scenario: Write mode at threshold

- **WHEN** `canvases.mode` is `"write"` and a dev runs a query session
- **THEN** `read_canvas`, `create_canvas` and `edit_canvas` are available

#### Scenario: Off

- **WHEN** `canvases.mode` is `"off"`
- **THEN** no canvas tool is registered

### Requirement: Canvas reference parsing

`read_canvas` and `edit_canvas` SHALL accept a canvas file id or a Slack canvas URL and SHALL resolve it to the canvas file id. Any other value SHALL be refused without a Slack call.

#### Scenario: Canvas URL

- **WHEN** the canvas argument is `https://acme.slack.com/docs/T0123/F0456ABC`
- **THEN** the tool acts on `F0456ABC`

#### Scenario: Not a canvas reference

- **WHEN** the canvas argument is a message permalink
- **THEN** the tool returns an error and makes no Slack call

### Requirement: Requester access before every canvas call

Every canvas tool acting on an existing canvas SHALL run the requester file-access check before any canvas API call and SHALL refuse with the file-access-denied message when it denies. `edit_canvas` SHALL also refuse without calling Slack when the check reports the bot's access as `read`.

#### Scenario: Requester cannot see the canvas

- **WHEN** a member asks Clack to read a canvas shared only to a private channel they are not in
- **THEN** `read_canvas` returns the file-access-denied message
- **AND** `canvases.getContent` is not called

#### Scenario: Edit denied to a requester who cannot see the canvas

- **WHEN** a dev asks Clack to edit a canvas shared only to a private channel they are not in
- **THEN** `edit_canvas` returns the file-access-denied message
- **AND** neither `canvases.sections.lookup` nor `canvases.edit` is called

#### Scenario: Bot has read-only access

- **WHEN** the access check allows the requester and reports the bot's access as `read`
- **THEN** `edit_canvas` returns an error saying Clack can only read that canvas
- **AND** `canvases.edit` is not called

### Requirement: Reading a canvas

`read_canvas` SHALL return the canvas content as markdown from `canvases.getContent`. Content longer than 100,000 characters SHALL be truncated to that length with a note saying it was truncated.

#### Scenario: Read

- **WHEN** the requester may see the canvas
- **THEN** the tool returns its markdown

#### Scenario: Oversized canvas

- **WHEN** the canvas markdown is 150,000 characters
- **THEN** the tool returns the first 100,000 characters and a truncation note

### Requirement: Creating a canvas

`create_canvas` SHALL create a standalone canvas from a title and markdown. When the session channel is not a DM or group DM, it SHALL share the canvas with that channel at read access. It SHALL record a session access grant for the new canvas, and SHALL return the canvas id and permalink. A failed share SHALL NOT fail the tool; the result SHALL carry a warning instead.

#### Scenario: Created in a channel thread

- **WHEN** a dev asks for a canvas in a channel thread
- **THEN** the canvas is created, shared to that channel at read access, granted to the session
- **AND** the result carries its id and permalink

#### Scenario: Created in a DM

- **WHEN** a dev asks for a canvas in a DM
- **THEN** the canvas is created and granted to the session
- **AND** no channel share is attempted

#### Scenario: Created in a group DM

- **WHEN** a dev asks for a canvas in a group DM
- **THEN** the canvas is created and granted to the session
- **AND** no channel share is attempted

#### Scenario: Share fails

- **WHEN** the channel share returns an error
- **THEN** the result carries the canvas id, its permalink and a warning naming the failure

### Requirement: Editing a canvas

`edit_canvas` SHALL apply exactly one operation per call. `insert_after`, `insert_before`, `delete` and section `replace` SHALL locate their section by `anchor_text` through `canvases.sections.lookup`; zero matches or more than one match SHALL be refused without editing. `insert_at_start` and `insert_at_end` SHALL take markdown and no anchor. `rename` SHALL take a title. A call whose arguments do not fit its operation (an `anchor_text` on `insert_at_start`, `insert_at_end` or `rename`; a missing `anchor_text` on `insert_after`, `insert_before` or `delete`; missing markdown or title) SHALL be refused without a Slack call. `replace` without `anchor_text` SHALL replace the whole canvas and SHALL be allowed only when the canvas was created by Clack's bot user; an unknown creator SHALL be treated as not Clack.

The requester's own edit permission on the canvas is not checked (Slack exposes no per-user access level): the gate for an edit is the `writeRole` threshold, the requester being able to see the canvas, and the bot being able to write it.

#### Scenario: Section insert

- **WHEN** `edit_canvas` is called with `insert_after`, an `anchor_text` matching exactly one section and markdown
- **THEN** one `canvases.edit` call inserts the markdown after that section

#### Scenario: Ambiguous anchor

- **WHEN** `anchor_text` matches three sections
- **THEN** the tool returns an error asking for more specific text
- **AND** `canvases.edit` is not called

#### Scenario: Missing anchor

- **WHEN** `anchor_text` matches no section
- **THEN** the tool returns an error telling Claude to read the canvas and use text from it

#### Scenario: Whole replace on a human's canvas

- **WHEN** `replace` without `anchor_text` targets a canvas a person created
- **THEN** the tool returns an error and does not edit

#### Scenario: Whole replace with unknown creator

- **WHEN** `replace` without `anchor_text` targets a canvas whose creator is not reported
- **THEN** the tool returns an error and does not edit

#### Scenario: Arguments do not fit the operation

- **WHEN** `edit_canvas` is called with `insert_at_end` and an `anchor_text`
- **THEN** the tool returns an error and makes no Slack call

#### Scenario: Whole replace on a Clack canvas

- **WHEN** `replace` without `anchor_text` targets a canvas Clack created
- **THEN** the canvas content is replaced

### Requirement: Canvas error reporting

Canvas tools SHALL translate Slack errors into Claude-facing messages that name the remedy: a missing scope SHALL say the manifest must be re-uploaded and the app reinstalled; a free-plan error SHALL say canvases need a paid plan; not-found, access, editing-locked, too-large and rate-limit errors SHALL each have their own message. Any other error SHALL be reported with Slack's error code. A file id that is not a canvas is reported through the same path, with whatever error Slack returns for it.

#### Scenario: Unmapped error

- **WHEN** a canvas call fails with `internal_error`
- **THEN** the tool error names the canvas operation and `internal_error`

#### Scenario: Stale token

- **WHEN** a canvas call fails with `missing_scope`
- **THEN** the tool error says the Slack app manifest must be re-uploaded and the app reinstalled

#### Scenario: Free plan

- **WHEN** `canvases.create` fails with `free_teams_cannot_create_standalone_canvases`
- **THEN** the tool error says canvases need a paid Slack plan
