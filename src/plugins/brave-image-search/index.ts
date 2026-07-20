import type { ClackSdk, ClackPlugin } from "../../plugins-sdk/sdk.js";
import { createFindImageTool } from "./findImage.js";

export const braveImageSearchPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.registerDictionary({
    en: { "label.find_image": "Searching Brave Images — {query}" },
    fr: { "label.find_image": "Recherche d'images Brave — {query}" },
  });

  // Registered on the plugin's always-on default server, so the tool resolves to
  // `mcp__brave-image-search__find_image` (the SDK keeps the hyphenated server name verbatim)
  // and is available to trivia's scheduled-run prompt without an `attach_integration` step.
  // Trivia discovers it by the tool's DESCRIPTION, not its name. Loads even when BRAVE_API_KEY is
  // unset — the tool then returns `keyMissing` on every call so trivia's visual subflow silently moves on.
  sdk.registerTool("member", createFindImageTool(), sdk.t("label.find_image"));
};
