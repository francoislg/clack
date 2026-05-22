/**
 * Translates Clack's single opt-in `suppressUnfurls` boolean into Slack's two
 * `chat.postMessage` parameters. Every Clack send path that wants to honor the
 * opt-in spreads this helper's output into its postMessage args — keeping the
 * translation in exactly one place.
 *
 * When `suppressUnfurls` is `true`, both `unfurl_links` and `unfurl_media` are
 * set to `false`. When `false`, `undefined`, or absent, the helper returns an
 * empty object so the caller does NOT send either key — preserving Slack's
 * default unfurling behavior unchanged.
 */
export interface UnfurlOptionsResult {
  unfurl_links?: false;
  unfurl_media?: false;
}

export function unfurlOptions(suppressUnfurls: boolean | undefined): UnfurlOptionsResult {
  return suppressUnfurls ? { unfurl_links: false, unfurl_media: false } : {};
}
