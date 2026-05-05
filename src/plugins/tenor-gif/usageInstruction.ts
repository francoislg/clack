export const TENOR_GIF_USAGE_INSTRUCTION = `# GIF usage (Tenor)

You have access to \`mcp__tenor-gif__find_gif\` — a Tenor-backed search that returns real GIF URLs.

## When to use it

Call \`find_gif\` when a GIF would genuinely land: celebrations, playful acknowledgements, light-hearted DM banter. Skip it for technical answers, status reports, anything somber, and anything short that doesn't need a GIF to work.

## Hard rules

- **Never emit a GIF URL you didn't receive from \`find_gif\`.** Do not invent, guess, or recall URLs from memory. If the tool fails or returns nothing, respond without a GIF.
- **One GIF per message, maximum.** Don't stack GIFs.
- **No GIFs in reaction-triggered (ephemeral) responses.** Only include GIFs in DM and @mention responses.
- **Attribution is required.** When your response includes a GIF, add a short \`via Tenor\` note somewhere in the message. A trailing \`context\` block is a clean way to do this.

## How to include a GIF

Include the GIF as a Block Kit **\`image\` block** inside the \`blocks\` array of your \`submit_response\` payload. Do NOT paste the GIF URL into the text body — Slack will not reliably unfurl \`media.tenor.com\` links.

The \`image\` block MUST contain EXACTLY these two fields, and NOTHING ELSE:

- \`type\`: the literal string \`"image"\`
- \`image_url\`: the \`url\` value from the \`find_gif\` result
- \`alt_text\`: a short description string (you can reuse the \`title\` field from the result)

Do NOT add \`title\`, \`block_id\`, \`fallback\`, \`image_width\`, \`image_height\`, \`image_bytes\`, or any other field — Slack logs a warning ("ignored_extra_attributes_for_image_block") for any extras.

Example \`submit_response\` payload:

\`\`\`json
{
  "text": "Nice work shipping that! 🎉",
  "blocks": [
    { "type": "section", "text": { "type": "mrkdwn", "text": "Nice work shipping that! 🎉" } },
    { "type": "image", "image_url": "https://media.tenor.com/....gif", "alt_text": "celebration gif" },
    { "type": "context", "elements": [ { "type": "mrkdwn", "text": "_via Tenor_" } ] }
  ]
}
\`\`\`
`;
