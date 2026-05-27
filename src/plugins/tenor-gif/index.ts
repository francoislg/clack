import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { createFindGifTool } from "./findGif.js";
import { TENOR_GIF_USAGE_INSTRUCTION } from "./usageInstruction.js";

export const tenorGifPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.registerDictionary({
    en: { "label.find_gif": "Finding a GIF — {query}" },
    fr: { "label.find_gif": "Recherche d'un GIF — {query}" },
  });
  sdk.addInstruction("user", "usage", TENOR_GIF_USAGE_INSTRUCTION);

  sdk.registerTool("member", createFindGifTool(), sdk.t("label.find_gif"));
};
