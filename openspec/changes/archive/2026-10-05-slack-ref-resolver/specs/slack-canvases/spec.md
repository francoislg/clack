## MODIFIED Requirements

### Requirement: Canvas reference parsing

`read_canvas` and `edit_canvas` SHALL resolve their canvas argument through the Slack reference resolver and act on the canvas file id it yields. A Slack reference of another kind SHALL return an error naming its kind and its reader tool, without a canvas call. A value that is no Slack reference SHALL be refused without a Slack call.

#### Scenario: Canvas URL

- **WHEN** the canvas argument is `https://acme.slack.com/docs/T0123/F0456ABC`
- **THEN** the tool acts on `F0456ABC`

#### Scenario: A message permalink

- **WHEN** the canvas argument is a message permalink
- **THEN** the tool returns an error saying it is a Slack message and to use `fetch_slack_message`
- **AND** it makes no Slack call

#### Scenario: Not a Slack reference

- **WHEN** the canvas argument is `hello`
- **THEN** the tool returns an error and makes no Slack call
