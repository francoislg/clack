import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { createFindGifTool } from "./findGif.js";
import { GIPHY_USAGE_INSTRUCTION } from "./usageInstruction.js";

export const giphyPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.registerDictionary({
    en: { "label.find_gif": "Finding a GIF — {query}" },
    fr: { "label.find_gif": "Recherche d'un GIF — {query}" },
  });
  sdk.addInstruction("user", "usage", GIPHY_USAGE_INSTRUCTION);

  sdk.registerTool("member", createFindGifTool(), sdk.t("label.find_gif"));
};
