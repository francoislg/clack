# slack-ref-resolver Specification

## Purpose

One way to resolve internal Slack references (file ids, file, List and canvas URLs, message permalinks, and attachments): parse them, classify them through one kind table with a catch-all, keep them in one registry per run, list them in the prompt by kind, and have every reader resolve its argument and redirect a reference of another kind.

## Requirements

### Requirement: Internal Slack references are parsed in one place

The system SHALL recognize internal Slack references with one parser, used by every caller that reads a reference from text or from a tool argument. It SHALL recognize:

- a bare file id matching the strict file-id pattern on word boundaries;
- a Slack URL whose path is `/files/<user>/<F…>`, `/lists/<team>/<F…>`, `/docs/<team>/<F…>` or `/canvas/<F…>`;
- a message permalink `/archives/<C…>/p<ts>`, with an optional `thread_ts` query.

Inside Slack's `<url|label>` markup, the parser SHALL read the URL. A List URL's `record_id` query SHALL be kept as the item id.

#### Scenario: Bare file id in a DM

- **WHEN** the message text is `F09SBU6D3FV`
- **THEN** the parser yields one file reference with id `F09SBU6D3FV`

#### Scenario: List URL in Slack link markup

- **WHEN** the text contains `<https://acme.slack.com/lists/T0123/F0456ABC?record_id=Rec789|Groceries>`
- **THEN** the parser yields one file reference with id `F0456ABC` and item id `Rec789`

#### Scenario: Message permalink

- **WHEN** the text contains `https://acme.slack.com/archives/C123/p1700000000123456?thread_ts=1700000000.000100`
- **THEN** the parser yields one message reference with channel `C123`, message ts `1700000000.123456`, and thread ts `1700000000.000100`

#### Scenario: Words that only look like ids

- **WHEN** the text contains `FAQ` or `F1` inside a word
- **THEN** the parser yields no reference

#### Scenario: Duplicates and the per-input cap

- **WHEN** one input references the same file twice and 12 distinct files in total
- **THEN** the duplicate collapses into one reference
- **AND** only the first 10 distinct references are resolved, and the rest are dropped with a log line

### Requirement: References are classified by a kind table with a catch-all

The system SHALL classify every resolved reference by the first matching entry of one ordered kind table. Each entry SHALL declare how it matches, which tool reads it, and whether it must be opened before answering. The table SHALL contain, in order: `message`, `list`, `canvas`, `image`, `document`, and a catch-all `file` that matches every file. A kind whose reader tool is not registered under the live config SHALL be skipped, so the reference falls to the next match.

#### Scenario: A List is classified as a List

- **WHEN** a file's `filetype` is `list` and `lists.mode` is `read`
- **THEN** the reference's kind is `list` and its reader is `read_list`

#### Scenario: Lists disabled

- **WHEN** a file's `filetype` is `list` and `lists.mode` is `off`
- **THEN** the reference's kind is `file` and its reader is `view_slack_file`

#### Scenario: Canvases disabled

- **WHEN** a file's `filetype` is `quip` and `canvases.mode` is `off`
- **THEN** the reference's kind is `file` and its reader is `view_slack_file`

#### Scenario: Images and documents

- **WHEN** a file's mimetype is `image/png`, or `application/pdf`, or `text/plain`
- **THEN** its kind is `image` or `document` respectively, its reader is `view_slack_file`, and it must be opened before answering

#### Scenario: An unknown Slack object type

- **WHEN** a file's `filetype` and mimetype match no dedicated kind, and its `pretty_type` is `Workflow`
- **THEN** its kind is `file`, its label is `Workflow`, and its reader is `view_slack_file`

#### Scenario: An unknown type without a Slack label

- **WHEN** a file's `filetype` and mimetype match no dedicated kind, and it has no `pretty_type`
- **THEN** its kind is `file` and its label is its mimetype

### Requirement: File facts come from the access check

The system SHALL obtain a file's type, name, size and download URL from the same `files.info` call that `checkFileAccess` makes. An allowance SHALL return those facts with the verdict. A denial SHALL return only the reason. Files taken from a message's `files[]` SHALL use the facts already on the message, without a call.

#### Scenario: A file id in text the requester can see

- **WHEN** the text contains a file id and `checkFileAccess` allows it
- **THEN** exactly one `files.info` call is made for that file in that run
- **AND** the reference carries the file's kind, name and size

#### Scenario: A file id in text the requester cannot see

- **WHEN** `checkFileAccess` denies a file id found in text
- **THEN** the reference is registered as inaccessible, with no name, type or size
- **AND** no tool returns that file's contents or metadata

#### Scenario: An attached file

- **WHEN** the trigger message's `files[]` contains a file
- **THEN** it is classified from the attached facts, with no `files.info` call

#### Scenario: A file attached to a fetched message

- **WHEN** `fetch_channel_messages` returns a message whose `files[]` contains an image
- **THEN** the image is registered from its attached facts, with no `files.info` call

### Requirement: One registry of referenced items per run

The system SHALL keep one registry of resolved references per run, keyed by id. At the start of a run it SHALL be filled from three sources:

- the **current message**: the message that started this run, i.e. the trigger on a session's first run, or the follow-up reply on a later run. Its text and attachments are used.
- the session's original trigger message;
- every thread-context message.

During the run it SHALL also be filled from every message queued onto the run, and from every message that `fetch_slack_message` or `fetch_channel_messages` returns. Each reference SHALL record whether it came from the current message. When more than one source yields the same id, the reference SHALL be marked as from the current message if any of those sources is the current message. Scheduled triggers SHALL resolve only their attachments, not their prompt text.

#### Scenario: A follow-up reply names a List

- **WHEN** a later run starts from the reply "Can you read this list: F0BSE12AF7Z" in an existing DM thread
- **THEN** List `F0BSE12AF7Z` is in that run's registry, marked as named in the current message

#### Scenario: A canvas link whose attachment arrives late

- **WHEN** the message event that starts a run carries the text `F09SBU6D3FV` but no `files[]` (Slack unfurls the canvas link after the event)
- **THEN** the text reference is resolved through `files.info` and the canvas is in the registry with reader `read_canvas`

#### Scenario: A file attached to a message queued onto a live run

- **WHEN** a user sends a message with an image while a run is still answering in that thread
- **THEN** the image is added to the live run's registry, marked as named in the current message
- **AND** the text pushed into the run names it

#### Scenario: Reference only in the original trigger

- **WHEN** a List link was in the session's original trigger message, and the current run starts from a later follow-up that names nothing
- **THEN** the List is in the registry, marked as not named in the current message

#### Scenario: Reference in thread context

- **WHEN** an earlier message in the thread contains a List URL
- **THEN** the List is in the registry when the run starts

#### Scenario: Reference in a fetched message

- **WHEN** `fetch_channel_messages` returns a message whose text contains a canvas URL
- **THEN** the canvas is added to the registry
- **AND** the tool result lists it in that message's `files` entry with its kind and reader

#### Scenario: Cron prompt text

- **WHEN** a scheduled job's prompt contains an example file id
- **THEN** that id is not resolved

#### Scenario: Scheduled trigger attachment

- **WHEN** a scheduled run's trigger carries an attached file
- **THEN** that file is in the run's registry

#### Scenario: The same file in the current message and earlier

- **WHEN** an image attached to an earlier message is also named in the current message
- **THEN** it is registered once, marked as named in the current message

### Requirement: Referenced items are listed in the prompt by kind

The system SHALL include a REFERENCED SLACK ITEMS section when the registry holds any reference at the start of the run. Each line SHALL give the kind's label, the item's name, its id, and its reader tool. Items that are too large or inaccessible SHALL keep their own notices. Items named in or attached to the current message SHALL be listed first, under a "named in this message" heading; the remaining items SHALL follow under "earlier in the conversation". The section SHALL instruct Claude to open every current-message item whose kind must be opened before answering. Every other item, including a must-open item from earlier in the conversation, SHALL be read only when the question needs it.

#### Scenario: A follow-up names a List while the thread holds an earlier canvas

- **WHEN** a thread's first message attached a canvas, and the current reply asks "Can you read this list: F0BSE12AF7Z"
- **THEN** the List is listed first under "named in this message" with `read_list`
- **AND** the canvas is listed under "earlier in the conversation" with `read_canvas`
- **AND** neither is required to be opened before answering

#### Scenario: An image attached to an earlier message

- **WHEN** an image was attached to an earlier message in the thread and the current message attaches nothing
- **THEN** the image is listed under "earlier in the conversation" and is not required to be opened

#### Scenario: A List and an image in the same message

- **WHEN** the trigger references a List and attaches an image
- **THEN** the section lists the List with `read_list` and the image with `view_slack_file`
- **AND** only the image is required to be opened before answering

#### Scenario: No references

- **WHEN** the registry is empty at the start of the run
- **THEN** the prompt has no REFERENCED SLACK ITEMS section

### Requirement: Readers resolve their argument and redirect the wrong kind

`view_slack_file`, `read_list`, `get_list_item`, `read_canvas`, `edit_canvas` and `fetch_slack_message` SHALL resolve their reference argument through the same resolver. For `view_slack_file` and `fetch_slack_message`, a registered reference SHALL be used without a call. The List and canvas tools SHALL still run the requester's access check on every call; a registered reference only supplies its kind. An unregistered reference SHALL be resolved with the requester's access check and then registered. A reference of another kind SHALL return an error that names the kind and the tool to use instead.

#### Scenario: A List id passed to view_slack_file

- **WHEN** `view_slack_file` is called with the id of a Slack List
- **THEN** it returns an error saying the id is a Slack List and to use `read_list`

#### Scenario: A registered canvas is still access-checked

- **WHEN** `read_canvas` is called with a canvas id already in the registry
- **THEN** it runs the requester's access check before `canvases.getContent`

#### Scenario: An image id passed to read_canvas

- **WHEN** `read_canvas` is called with the id of an image
- **THEN** it returns an error saying the id is an image and to use `view_slack_file`
- **AND** it makes no canvas content call

#### Scenario: An unregistered file the requester can see

- **WHEN** `view_slack_file` is called with a file id that is not in the registry, and the requester can see the file
- **THEN** the file is resolved, registered and opened

#### Scenario: An unregistered file the requester cannot see

- **WHEN** a reader is called with a file id the requester cannot see
- **THEN** it returns the existing access-denied message and makes no download or content call
