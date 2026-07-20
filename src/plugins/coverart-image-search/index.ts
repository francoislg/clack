import type { ClackSdk, ClackPlugin } from "../../plugins-sdk/sdk.js";
import { createFindAlbumTool } from "./findAlbum.js";

export const coverartImageSearchPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.registerDictionary({
    en: { "label.find_album": "Searching album covers — {query}" },
    fr: { "label.find_album": "Recherche de pochettes d'album — {query}" },
  });

  // Registered on the plugin's always-on default server, so the tool resolves to
  // `mcp__coverart-image-search__find_album` (the SDK keeps the hyphenated server name verbatim)
  // and is available to trivia's scheduled-run prompt without an `attach_integration` step.
  // Trivia discovers it by the tool's DESCRIPTION, not its name. No API key, no config required.
  sdk.registerTool("member", createFindAlbumTool(), sdk.t("label.find_album"));
};
