export const GEMINI_IMAGE_USAGE_INSTRUCTION = `# Image generation (gemini-image)

You have access to \`mcp__gemini-image__generate_image\` — it creates a brand-new, AI-GENERATED image from a text prompt, or edits an existing image.

## What it is (and is not)

Every image it returns is SYNTHETIC — invented by an image model. It is **not** a photograph, **not** a real screenshot or document, and **not** a real depiction of any actual person, place, brand, or event. Never present its output as real or factual, and never use it as a source/reference image. It carries no license or attribution because it has no real-world source.

## When to use it

Use it when someone explicitly wants an image MADE: an illustration, a concept, a meme-style picture, a diagram sketch, or an edit of an image they uploaded. Do not use it to answer factual questions or to stand in for a real photo.

## Generating vs editing

- **Generate**: pass \`prompt\` describing what to create.
- **Edit (image-to-image)**: also pass \`input_image_url\` — the \`url_private\`/\`permalink\` of an image the user uploaded, a \`permalink\` from an earlier \`generate_image\` call, or any image URL. \`prompt\` becomes the edit instruction (e.g. "make the sky purple").

## Quality

\`quality: "fast"\` (default) is quick and cheap and fine for most things. \`quality: "best"\` is higher fidelity and better at text-inside-the-image and complex prompts.

## Delivery — store, then show it yourself

The tool does NOT post the image anywhere. It STORES it in Slack (unshared, owned by the bot) and returns \`{ fileId, permalink }\`. You decide what to do with that handle — it works the same in DMs, channels, and channelless runs (no \`channel\` needed).

**To show the image to the user**, put an \`image\` block in your \`submit_response\` (or any \`post_to\`/\`deliver_to\` message) referencing the stored file by id:

\`\`\`json
{ "type": "image", "slack_file": { "id": "<fileId from the result>" }, "alt_text": "a short description" }
\`\`\`

Reference the file via \`slack_file\` (with the \`fileId\`), NOT the \`image_url\` field — \`image_url\` is only for public URLs, and the stored file's \`permalink\` is auth-gated so Slack can't fetch it there. One image block renders one image; include it wherever you want the user to see it.

## Refining before you show

Because nothing is posted until you emit the image block, you can generate, then \`generate_image\` again with \`input_image_url\` set to the previous \`permalink\` to refine, and only show the final pick. A single user request should result in ONE image shown unless they ask for several.
`;
