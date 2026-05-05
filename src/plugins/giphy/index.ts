import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { createFindGifTool } from "./findGif.js";
import { GIPHY_USAGE_INSTRUCTION } from "./usageInstruction.js";

export const giphyPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.addInstruction("user", "usage", GIPHY_USAGE_INSTRUCTION);

  sdk.registerTool("member", createFindGifTool(), "Finding a GIF — {query}");
};
