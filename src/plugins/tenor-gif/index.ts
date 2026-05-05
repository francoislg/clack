import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { createFindGifTool } from "./findGif.js";
import { TENOR_GIF_USAGE_INSTRUCTION } from "./usageInstruction.js";

export const tenorGifPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.addInstruction("user", "usage", TENOR_GIF_USAGE_INSTRUCTION);

  sdk.registerTool("member", createFindGifTool(), "Finding a GIF — {query}");
};
