## Purpose

The `gemini-image` plugin integrates Google Gemini's image generation and editing capabilities into the Clack bot, allowing users to generate original images from text prompts and edit existing images with AI-assisted instructions.

## Requirements

### Requirement: Generate an image from a text prompt

The `gemini-image` plugin SHALL register a member-gated tool `generate_image` on its always-on default server that produces an original image from a text prompt by calling the Google Gemini image API.

#### Scenario: Successful text-to-image generation

- **WHEN** Claude calls `generate_image` with a non-empty `prompt` and no input image
- **THEN** the plugin calls the Gemini API with the model resolved from the `quality` tier, stores the generated image unshared in Slack, and returns its file handle (see *Stored unshared delivery*)

#### Scenario: Empty prompt rejected

- **WHEN** Claude calls `generate_image` with an empty or whitespace-only `prompt` and no input image
- **THEN** the tool returns a structured error envelope and does not call the Gemini API

### Requirement: Edit an existing image

The `generate_image` tool SHALL accept an input image reference (an uploaded Slack image, a `permalink` from a prior `generate_image` call, or any image URL) plus a text instruction and return an edited image produced by an edit-capable Gemini model.

#### Scenario: Successful image edit

- **WHEN** Claude calls `generate_image` with a `prompt` (the edit instruction) and an `input_image_url` reference to a Slack-hosted image (including a prior result's `permalink`) or any image URL
- **THEN** the plugin fetches the source image's bytes using the bot token, sends them with the instruction to the edit-capable model, stores the edited image unshared in Slack, and returns its file handle (see *Stored unshared delivery*)

#### Scenario: Unfetchable input image

- **WHEN** the `input_image_url` reference cannot be resolved to image bytes (missing file, non-image, or fetch failure)
- **THEN** the tool returns a structured error envelope explaining the input could not be loaded, and does not call the Gemini API

### Requirement: Stored unshared delivery

The `generate_image` tool SHALL deliver its result by uploading the image to Slack **unshared** — via `files.uploadV2` with no `channel_id`, so the file is owned by the bot and posted to no channel — and SHALL return a text envelope containing the file handle `{ fileId, permalink }`. The tool SHALL NOT accept a `deliver`, `channel`, or `thread_ts` argument, SHALL NOT post the image to any channel, and SHALL NOT return the image bytes inline. Because delivery never targets a channel, the tool behaves identically in DMs, channels, and channelless runs.

#### Scenario: Image stored and handle returned

- **WHEN** `generate_image` completes a generation or edit and Slack is connected
- **THEN** the plugin uploads the image to Slack with no `channel_id` and a neutral filename, and returns a text envelope containing `fileId` and `permalink`
- **AND** the result contains no inline image content block

#### Scenario: Storage requires a Slack connection

- **WHEN** `generate_image` is invoked while Slack is not connected
- **THEN** the tool returns a structured error stating the image cannot be stored, and does not call the Gemini API

#### Scenario: Storage failure surfaces a clean error

- **WHEN** the image is generated but the unshared upload to Slack fails
- **THEN** the tool returns a structured error reporting that storing the image failed

#### Scenario: Rendering the stored image is the caller's responsibility

- **WHEN** Claude has a `fileId` from a successful `generate_image` call and wants the user to see the image
- **THEN** Claude renders it by emitting a curated `image` block with `slack_file: { id: <fileId> }` in `submit_response` (or a `post_to` / `deliver_to` message), per the `clack-tool-response` image-source rules

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
