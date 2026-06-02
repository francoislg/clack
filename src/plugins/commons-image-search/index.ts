import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { createFindSubjectTool } from "./findSubject.js";

export const commonsImageSearchPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.registerDictionary({
    en: { "label.find_subject": "Searching Wikimedia — {query}" },
    fr: { "label.find_subject": "Recherche Wikimédia — {query}" },
  });

  // Registered on the plugin's always-on default server, so the tool resolves to
  // `mcp__commons-image-search__find_subject` (the SDK keeps the hyphenated server name verbatim)
  // and is available to trivia's scheduled-run prompt without an `attach_integration` step.
  // Trivia discovers it by the tool's DESCRIPTION, not its name. No API key, no config required.
  sdk.registerTool("member", createFindSubjectTool(), sdk.t("label.find_subject"));
};
