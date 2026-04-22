import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { createFindGifTool } from "./findGif.js";
import { GIF_USAGE_INSTRUCTION } from "./usageInstruction.js";

export const gifPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.addInstruction("user", "usage", GIF_USAGE_INSTRUCTION);

  sdk.registerTool("member", createFindGifTool(), "Finding a GIF — {query}");
};
