## ADDED Requirements

### Requirement: Generate an image from a text prompt

The `gemini-image` plugin SHALL register a member-gated tool `generate_image` on its always-on default server that produces an original image from a text prompt by calling the Google Gemini image API.

#### Scenario: Successful text-to-image generation

- **WHEN** Claude calls `generate_image` with a non-empty `prompt` and no input image
- **THEN** the plugin calls the Gemini API with the model resolved from the `quality` tier and returns the generated image bytes through the configured `deliver` channel

#### Scenario: Empty prompt rejected

- **WHEN** Claude calls `generate_image` with an empty or whitespace-only `prompt` and no input image
- **THEN** the tool returns a structured error envelope and does not call the Gemini API

### Requirement: Edit an existing image

The `generate_image` tool SHALL accept an input image reference (an uploaded Slack image) plus a text instruction and return an edited image produced by an edit-capable Gemini model.

#### Scenario: Successful image edit

- **WHEN** Claude calls `generate_image` with a `prompt` (the edit instruction) and an `input_image` reference to a Slack-uploaded image
- **THEN** the plugin fetches the source image's bytes using the bot token, sends them with the instruction to the edit-capable model, and returns the edited image through the configured `deliver` channel

#### Scenario: Unfetchable input image

- **WHEN** the `input_image` reference cannot be resolved to image bytes (missing file, non-image, or fetch failure)
- **THEN** the tool returns a structured error envelope explaining the input could not be loaded, and does not call the Gemini API

### Requirement: High-level model tiers

Model selection SHALL be exposed only as a high-level `quality` enum (`fast`, `best`); raw Gemini model IDs SHALL NOT appear in the tool's argument schema. The tier→model mapping SHALL be plugin configuration that an administrator can change without code changes, and the edit path SHALL resolve to an edit-capable model.

#### Scenario: Tier maps to a model

- **WHEN** `generate_image` is called with `quality: "best"`
- **THEN** the plugin resolves it to the configured "best" model ID and Claude never observes the raw model ID

#### Scenario: Default tier

- **WHEN** `generate_image` is called without a `quality` argument
- **THEN** the plugin uses the `fast` tier as the default

#### Scenario: Admin repoints a tier

- **WHEN** an administrator edits the tier→model mapping configuration
- **THEN** subsequent calls resolve tiers to the new model IDs without a code change or full restart

### Requirement: Configurable delivery

The tool SHALL accept a `deliver` argument with values `upload`, `data`, or `both`, defaulting to `upload`, that controls where the generated image lands. Because the plugin tool is registered globally and has no per-session channel context, `upload` and `both` SHALL take an explicit `channel` argument (and optional `thread_ts`) naming the destination; `data` SHALL ignore them.

#### Scenario: Upload delivery

- **WHEN** `generate_image` is called with `deliver: "upload"` (or no `deliver` argument) and a `channel`
- **THEN** the plugin posts the image to that channel (threaded under `thread_ts` when given) via `files.uploadV2` with a neutral filename and returns a text envelope containing the file reference (id and permalink)

#### Scenario: Upload requested without a resolvable channel

- **WHEN** `generate_image` is called with `deliver: "upload"` or `"both"` but no `channel` (e.g. a DM or channelless context where no channel ID is available)
- **THEN** the tool returns a structured error instructing the caller to supply a `channel` or use `deliver: "data"`, and does not post to Slack

#### Scenario: Data delivery

- **WHEN** `generate_image` is called with `deliver: "data"`
- **THEN** the plugin returns the image inline to Claude as a multimodal `{ type: "image", data, mimeType }` content block and does not post to Slack

#### Scenario: Both delivery

- **WHEN** `generate_image` is called with `deliver: "both"`
- **THEN** the plugin posts the image to Slack AND returns the image bytes inline to Claude

### Requirement: AI-generated provenance is unambiguous

The tool's description and its result envelope SHALL state unambiguously that the image is AI-GENERATED and is not a photograph of any real subject, and SHALL NOT return the image-search contract's `media`/license/attribution/`subjectId` metadata block.

#### Scenario: Result marks the image as generated

- **WHEN** `generate_image` returns a successful result
- **THEN** the result envelope identifies the image as AI-generated and omits any `license`, `attribution`, or `subjectId` metadata

#### Scenario: Not discoverable as a trivia image source

- **WHEN** the trivia visual-research subflow scans available tools for image sources by description
- **THEN** `generate_image` is not matched as a real-subject image source, because its description identifies it as a generator of AI-generated images

### Requirement: Graceful degradation without an API key

The plugin SHALL load `GEMINI_API_KEY` from the environment and SHALL degrade gracefully when it is absent.

#### Scenario: Missing API key

- **WHEN** `generate_image` is called and `GEMINI_API_KEY` is not set
- **THEN** the tool returns a clear error envelope instructing an admin to set `GEMINI_API_KEY` in `data/auth/.env`, and the plugin's presence does not break bot startup or other plugins
