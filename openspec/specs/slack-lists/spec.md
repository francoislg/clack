# slack-lists Specification

## Purpose

Read, add to, update, delete items of, and create Slack Lists on a requester's behalf, behind `config.lists.mode`, with requester access checked before every List call.

## Requirements

### Requirement: Lists config gate

The config SHALL accept an optional top-level `lists` block `{ mode, writeRole? }` where `mode` is one of `"off"`, `"read"`, `"write"` and `writeRole` is one of `"member"`, `"dev"`, `"admin"`, `"owner"` (default `"dev"`). The block SHALL be validated fail-fast: a wrong-typed value, an unknown mode or role, or an unknown key SHALL stop config loading with an error naming the key. An absent block SHALL behave as `mode: "off"`.

#### Scenario: Absent block

- **WHEN** the config has no `lists` key
- **THEN** no List tool is registered and no List scope is required

#### Scenario: Invalid mode

- **WHEN** `lists.mode` is `"edit"`
- **THEN** config loading fails with an error naming `lists.mode` and listing the supported values

#### Scenario: Invalid role

- **WHEN** `lists.writeRole` is `"guest"`
- **THEN** config loading fails with an error naming `lists.writeRole` and listing the supported roles

#### Scenario: Unknown key

- **WHEN** the `lists` block contains `enabled: true`
- **THEN** config loading fails with an error naming the unknown key

### Requirement: List tool registration by mode

In `read` mode the tool server SHALL register `read_list` and `get_list_item` for every role when a Slack client is present. In `write` mode it SHALL also register `add_list_items`, `update_list_items`, `delete_list_items` and `create_list` for roles that meet `lists.writeRole`. In `off` and `read` modes no List write tool SHALL be registered. No tool SHALL delete a List, rename it, change its columns, or change List access other than the share described for `create_list`.

#### Scenario: Read mode

- **WHEN** `lists.mode` is `"read"` and an owner runs a query session
- **THEN** `read_list` and `get_list_item` are available
- **AND** no List write tool is

#### Scenario: Write mode below threshold

- **WHEN** `lists.mode` is `"write"`, `writeRole` is `"dev"` and a member runs a query session
- **THEN** `read_list` and `get_list_item` are available
- **AND** no List write tool is

#### Scenario: Write mode at threshold

- **WHEN** `lists.mode` is `"write"` and a dev runs a query session
- **THEN** all six List tools are available

#### Scenario: Off

- **WHEN** `lists.mode` is `"off"`
- **THEN** no List tool is registered

### Requirement: List reference parsing

Every List tool acting on an existing List SHALL accept a List file id or a Slack List URL and SHALL resolve it to the List file id. A URL carrying a `record_id` SHALL also yield that item id. A Slack reference of another kind (a canvas, an image, another file, or a message permalink) SHALL return an error naming its kind and its reader tool, e.g. "is a Slack canvas: use read_canvas"; a file id SHALL learn its kind through a lookup that runs the requester access check. A value that is no Slack reference SHALL be refused without a Slack call.

#### Scenario: List URL

- **WHEN** the list argument is `https://acme.slack.com/lists/T0123/F0456ABC`
- **THEN** the tool acts on `F0456ABC`

#### Scenario: Item URL

- **WHEN** `get_list_item` is given `https://acme.slack.com/lists/T0123/F0456ABC?record_id=Rec789` and no item id
- **THEN** it reads item `Rec789` of List `F0456ABC`

#### Scenario: Not a List reference

- **WHEN** the list argument is a message permalink
- **THEN** the tool returns an error saying it is a Slack message and naming `fetch_slack_message`
- **AND** makes no Slack call

#### Scenario: No Slack reference

- **WHEN** the list argument is a value that is no Slack reference, such as `hello world`
- **THEN** the tool refuses it with an error and makes no Slack call

#### Scenario: Canvas id passed to read_list

- **WHEN** `read_list` is given the file id of a Slack canvas the requester can see
- **THEN** it returns an error saying the id is a Slack canvas and to use `read_canvas`
- **AND** `slackLists.items.list` is not called

### Requirement: Requester access before every List call

Every List tool acting on an existing List SHALL run the requester file-access check before any List API call and SHALL refuse with the file-access-denied message when it denies. Every write tool SHALL also refuse without calling a List API when the check reports the bot's access as `read`.

#### Scenario: Requester cannot see the List

- **WHEN** a member asks Clack to read a List shared only to a private channel they are not in
- **THEN** `read_list` returns the file-access-denied message
- **AND** `slackLists.items.list` is not called

#### Scenario: Write denied to a requester who cannot see the List

- **WHEN** a dev asks Clack to add an item to a List shared only to a private channel they are not in
- **THEN** `add_list_items` returns the file-access-denied message
- **AND** `slackLists.items.create` is not called

#### Scenario: Bot has read-only access

- **WHEN** the access check allows the requester and reports the bot's access as `read`
- **THEN** `add_list_items` returns an error saying Clack can only read that List
- **AND** `slackLists.items.create` is not called

### Requirement: Reading a List

`read_list` SHALL return the List's title, its columns (name, type, and option labels for select columns) and one page of items, each with its id and its cells keyed by column name. Select cells SHALL be rendered as option labels. A cell of a type the translation does not model SHALL be rendered from Slack's plain-text value. The page size SHALL default to 50 and be capped at 100, and the result SHALL carry the next cursor when more items exist. The page SHALL hold the List's active items, or its archived items when the caller asks for them. A result longer than 100,000 characters SHALL be cut at an item boundary with a note saying so. `get_list_item` SHALL return one item in the same rendering, taking the item id from its argument or from the URL's `record_id`; with neither it SHALL return an error without a Slack call.

#### Scenario: Read

- **WHEN** the requester may see a List with a `Status` select column and an `Owner` user column
- **THEN** `read_list` returns both columns with the `Status` option labels
- **AND** each item shows `Status` as a label and `Owner` as user ids

#### Scenario: More items

- **WHEN** the List holds more items than the page size
- **THEN** the result carries a cursor that returns the next page

#### Scenario: Unmodelled cell type

- **WHEN** an item has a cell in a `vote` column
- **THEN** the cell is rendered from Slack's plain-text value

#### Scenario: Archived items

- **WHEN** `read_list` is called with `archived: true`
- **THEN** the page holds the List's archived items and no active item

#### Scenario: Oversized result

- **WHEN** a page of items serializes to more than 100,000 characters
- **THEN** the result is cut at an item boundary with a note telling Claude to page with a smaller limit

#### Scenario: Get one item

- **WHEN** `get_list_item` is given a List id and an item id
- **THEN** it returns that item's cells keyed by column name

#### Scenario: No item id given

- **WHEN** `get_list_item` is given a List reference with no item id and no `record_id`
- **THEN** the tool returns an error and makes no Slack call

### Requirement: Cell translation

Write tools SHALL take cells as `{ column, value }` pairs and SHALL resolve each against the List's schema. A column SHALL be matched by name, case-insensitively, then by key. The value SHALL be coerced to the column's cell type: plain text for text columns, option label or value for select columns, `YYYY-MM-DD` for date columns, user ids or user mentions for user columns, channel ids or channel mentions for channel columns, numbers, booleans, ratings within the column's maximum, emails, phone numbers and link URLs. An unknown column, an ambiguous column, an unknown select option, a value that cannot be coerced, or a column type that cannot be written SHALL be a problem. When any problem exists the tool SHALL write nothing and SHALL return every problem.

#### Scenario: Select by label

- **WHEN** `Status` is set to `"Done"` and the column has an option labelled `Done`
- **THEN** the cell sent to Slack carries that option's value

#### Scenario: User mention

- **WHEN** `Owner` is set to `"<@U0123>"`
- **THEN** the cell sent to Slack is a user cell with `U0123`

#### Scenario: Unknown column

- **WHEN** a pair names a column the List does not have
- **THEN** the tool returns an error listing the List's column names
- **AND** no item is created or updated

#### Scenario: Ambiguous column

- **WHEN** a pair names a column that matches two columns of the List
- **THEN** the tool returns an error listing the List's column names
- **AND** no item is created or updated

#### Scenario: Unknown option

- **WHEN** `Status` is set to `"Shipped"` and no such option exists
- **THEN** the tool returns an error listing the column's option labels

#### Scenario: Read-only column type

- **WHEN** a pair targets an attachment column
- **THEN** the tool returns an error naming the column and its type

#### Scenario: Several problems

- **WHEN** one call has an unknown column and an invalid date
- **THEN** the error names both and nothing is written

### Requirement: Adding items

`add_list_items` SHALL create up to 20 items per call, one Slack call per item, after translating every item. A Slack failure SHALL stop the remaining creations, and the result SHALL name the items created and the item that failed.

#### Scenario: Add

- **WHEN** a dev adds two valid items
- **THEN** two items are created and the result carries their ids

#### Scenario: Failure mid-batch

- **WHEN** the second of three creations fails
- **THEN** the third is not attempted
- **AND** the result names the first item's id and the failure of the second

#### Scenario: Too many items

- **WHEN** a call carries 21 items
- **THEN** it is refused without a Slack call

### Requirement: Updating items

`update_list_items` SHALL set cells on existing items from `{ item_id, fields }` entries in one Slack call. A call totalling more than 100 cells SHALL be refused without a Slack call.

#### Scenario: Update

- **WHEN** a dev sets `Status` on two items
- **THEN** one `slackLists.items.update` call carries both cells

#### Scenario: Too many cells

- **WHEN** a call totals 101 cells
- **THEN** it is refused without a Slack call

### Requirement: Deleting items with confirmation

`delete_list_items` SHALL NOT delete anything itself. After the requester file-access check and the bot-access check, it SHALL stage a deletion of up to 50 items of one List, shown to the user as a confirm button, and SHALL return each item's title so the response names what will be deleted. An item id that is not in the List SHALL be refused without staging. A call naming more than 50 items SHALL be refused without staging. The deletion SHALL run only when a user clicks the button, SHALL never be auto-executed, and SHALL run only when the clicking user meets `lists.writeRole` and passes the requester file-access check.

#### Scenario: Staged

- **WHEN** a dev asks Clack to delete three items
- **THEN** the tool returns the three items' titles and the response carries a confirm button
- **AND** `slackLists.items.deleteMultiple` has not been called

#### Scenario: Unknown item

- **WHEN** one of the item ids is not in the List
- **THEN** the tool returns an error naming that id
- **AND** nothing is staged

#### Scenario: Marked for automatic execution

- **WHEN** the response marks the deletion action as automatic
- **THEN** the confirm button is still shown and nothing is deleted before a click

#### Scenario: Confirmed

- **WHEN** that dev clicks the button
- **THEN** the three items are deleted

#### Scenario: Clicked by someone below the threshold

- **WHEN** a member clicks the button and `writeRole` is `"dev"`
- **THEN** nothing is deleted and the member is told they cannot confirm it

#### Scenario: Clicked by someone who cannot see the List

- **WHEN** a dev clicks the button and fails the requester file-access check
- **THEN** nothing is deleted and the dev is told they cannot access that List

#### Scenario: Too many items to delete

- **WHEN** a call names 51 items
- **THEN** it is refused and nothing is staged

#### Scenario: Bot cannot write while staging

- **WHEN** the access check reports the bot's access as `read`
- **THEN** `delete_list_items` returns an error saying Clack can only read that List
- **AND** nothing is staged

### Requirement: Creating a List

`create_list` SHALL create a List from a name, an optional description, column definitions and an optional todo mode. The first column SHALL be a text column and SHALL be the primary column. Column types SHALL be limited to the writable types, and column names SHALL be unique, case-insensitively. When the session channel is not a DM or group DM, the tool SHALL share the List with that channel at write access. It SHALL record a session access grant for the new List, and SHALL return the List id and permalink. A failed share SHALL NOT fail the tool; the result SHALL carry a warning instead. The tool SHALL NOT transfer ownership or grant access to individual users.

#### Scenario: Created in a channel thread

- **WHEN** a dev asks for a List in a channel thread
- **THEN** the List is created, shared to that channel at write access, granted to the session
- **AND** the result carries its id and permalink

#### Scenario: Created in a DM

- **WHEN** a dev asks for a List in a DM
- **THEN** the List is created and granted to the session
- **AND** no share is attempted

#### Scenario: Share fails

- **WHEN** the channel share returns an error
- **THEN** the result carries the List id, its permalink and a warning naming the failure

#### Scenario: First column is not text

- **WHEN** the first column is a select column
- **THEN** the tool returns an error and creates nothing

#### Scenario: Duplicate column names

- **WHEN** two columns are named `Status` and `status`
- **THEN** the tool returns an error and creates nothing

#### Scenario: Created in a group DM

- **WHEN** a dev asks for a List in a group DM
- **THEN** the List is created and granted to the session
- **AND** no share is attempted

### Requirement: List error reporting

List tools SHALL translate Slack errors into Claude-facing messages that name the remedy: a missing scope SHALL say the manifest must be re-uploaded and the app reinstalled; a plan error SHALL say Lists need a paid plan; not-found, access, invalid-argument and rate-limit errors SHALL each have their own message. Any other error SHALL be reported with Slack's error code.

#### Scenario: Free plan

- **WHEN** a List call fails with a paid-plan-required error
- **THEN** the tool error says Lists need a paid Slack plan

#### Scenario: Unmapped error

- **WHEN** a List call fails with `internal_error`
- **THEN** the tool error names the List operation and `internal_error`

#### Scenario: Stale token

- **WHEN** a List call fails with `missing_scope`
- **THEN** the tool error says the Slack app manifest must be re-uploaded and the app reinstalled

#### Scenario: Rate limited

- **WHEN** a List call fails with `ratelimited`
- **THEN** the tool error says to retry later with fewer items
