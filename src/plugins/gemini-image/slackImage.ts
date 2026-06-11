const MAX_REDIRECTS = 5;

export interface FetchedImage {
  data: string;
  mimeType: string;
}

/**
 * Download a Slack-hosted image (a `url_private`) as base64, manually following
 * redirects so the Authorization header survives Slack's cross-origin hops
 * (`fetch` strips it otherwise). Plain non-Slack URLs work too — the bot token
 * is simply ignored by the host.
 */
export async function downloadImageAsBase64(url: string, botToken: string): Promise<FetchedImage> {
  let currentUrl = url;
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const response = await fetch(currentUrl, {
      headers: { Authorization: `Bearer ${botToken}` },
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} without Location header`);
      currentUrl = location;
      continue;
    }
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new Error(`Expected an image but got content-type "${contentType || "unknown"}"`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return { data: buffer.toString("base64"), mimeType: contentType.split(";")[0] };
  }
  throw new Error("Too many redirects downloading image");
}
