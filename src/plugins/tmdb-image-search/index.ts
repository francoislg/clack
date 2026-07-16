import type { ClackSdk, ClackPlugin } from "../sdk.js";
import { createFindMovieTool } from "./findMovie.js";
import { createFindTvTool } from "./findTv.js";
import { createFindPersonTool } from "./findPerson.js";

export const tmdbImageSearchPlugin: ClackPlugin = async (sdk: ClackSdk) => {
  sdk.registerDictionary({
    en: {
      "label.find_movie": "Searching TMDB movies — {query}",
      "label.find_tv": "Searching TMDB TV series — {query}",
      "label.find_person": "Searching TMDB people — {query}",
    },
    fr: {
      "label.find_movie": "Recherche de films TMDB — {query}",
      "label.find_tv": "Recherche de séries TMDB — {query}",
      "label.find_person": "Recherche de personnes TMDB — {query}",
    },
  });

  // Registered on the plugin's always-on default server, so the tools resolve to
  // `mcp__tmdb-image-search__find_movie` / `__find_tv` / `__find_person` (the SDK keeps the
  // hyphenated server name verbatim) and are available to trivia's scheduled-run prompt without
  // an `attach_integration` step. Trivia discovers them by each tool's DESCRIPTION, not its name.
  // Loads even when TMDB_READ_TOKEN is unset — the tools then return `keyMissing` on every call
  // so trivia's visual subflow silently moves on.
  sdk.registerTool("member", createFindMovieTool(), sdk.t("label.find_movie"));
  sdk.registerTool("member", createFindTvTool(), sdk.t("label.find_tv"));
  sdk.registerTool("member", createFindPersonTool(), sdk.t("label.find_person"));
};
