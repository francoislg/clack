export const GEMINI_IMAGE_USAGE_INSTRUCTION = `# Image generation (gemini-image)

You have access to \`mcp__gemini-image__generate_image\` — it creates a brand-new, AI-GENERATED image from a text prompt, or edits an existing image.

## What it is (and is not)

Every image it returns is SYNTHETIC — invented by an image model. It is **not** a photograph, **not** a real screenshot or document, and **not** a real depiction of any actual person, place, brand, or event. Never present its output as real or factual, and never use it as a source/reference image. It carries no license or attribution because it has no real-world source.

## When to use it

Use it when someone explicitly wants an image MADE: an illustration, a concept, a meme-style picture, a diagram sketch, or an edit of an image they uploaded. Do not use it to answer factual questions or to stand in for a real photo.

## Generating vs editing

- **Generate**: pass \`prompt\` describing what to create.
- **Edit (image-to-image)**: also pass \`input_image_url\` — the \`url_private\` of an image the user uploaded (or any image URL). \`prompt\` becomes the edit instruction (e.g. "make the sky purple").

## Quality

\`quality: "fast"\` (default) is quick and cheap and fine for most things. \`quality: "best"\` is higher fidelity and better at text-inside-the-image and complex prompts.

## Delivery — how the user actually sees it

- \`deliver: "upload"\` (default) posts the image into Slack. You MUST pass \`channel\` — use the Channel ID from your context. The result gives you \`{ fileId, permalink }\`.
- \`deliver: "data"\` returns the image inline so YOU can inspect it, but does NOT show it to the user. Use this only when you need to look at the result yourself (e.g. before editing again).
- \`deliver: "both"\` posts AND returns inline.

In a DM or any context where you don't have a Channel ID, \`upload\` won't work — there is no channel to post to. Tell the user you can't post images there, or use \`deliver: "data"\` to inspect.

The uploaded file's \`permalink\` is auth-gated — do NOT paste it into an \`image\` block's \`image_url\` (it won't render). The upload itself already makes the image visible in the channel; you don't need to re-embed it.
`;
