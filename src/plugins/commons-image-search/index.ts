import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { createFindSubjectTool } from "./findSubject.js";

export const commonsImageSearchPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.registerDictionary({
    en: { "label.find_subject": "Searching Wikimedia — {query}" },
    fr: { "label.find_subject": "Recherche Wikimédia — {query}" },
  });

  // Registered on the plugin's always-on default server, so the tool resolves to
  // `mcp__commons_image_search__find_subject` and is available to trivia's scheduled-run
  // prompt without an `attach_integration` step. No API key, no config required.
  sdk.registerTool("member", createFindSubjectTool(), sdk.t("label.find_subject"));
};
