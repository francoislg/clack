import type { ClackSdk, ClackPlugin } from "../../plugins-sdk/sdk.js";
import { createGenerateImageTool, defaultGenerateImageDeps } from "./generateImage.js";
import { parseModelMap, setModelMap } from "./models.js";
import { GEMINI_IMAGE_USAGE_INSTRUCTION } from "./usageInstruction.js";

const MODELS_FILENAME = "models.json";

export const geminiImagePlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.registerDictionary({
    en: { "label.generate_image": "Generating an image — {prompt}" },
    fr: { "label.generate_image": "Génération d'une image — {prompt}" },
  });
  sdk.addInstruction("user", "usage", GEMINI_IMAGE_USAGE_INSTRUCTION);

  const reloadModels = async () => {
    setModelMap(parseModelMap(await sdk.readFile(MODELS_FILENAME)));
  };
  await reloadModels();
  sdk.watchFile(MODELS_FILENAME, () => {
    reloadModels().catch((err) => {
      sdk.logger.warn(`[gemini-image] failed to reload ${MODELS_FILENAME}: ${err}`);
    });
  });

  sdk.registerTool(
    "member",
    createGenerateImageTool(defaultGenerateImageDeps(() => sdk.getSlackClient())),
    sdk.t("label.generate_image"),
  );
};
