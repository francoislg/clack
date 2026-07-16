import { createBackdropTool, type BackdropToolDeps } from "./backdropTool.js";
import {
  loadTmdbReadToken,
  searchTv,
  fetchTextlessBackdrops,
  fetchImageBytes,
  type TmdbTvResult,
} from "./tmdb.js";

const DESCRIPTION =
  "TMDB TV image search. Best for the TV Series category (incl. animated series — anime and " +
  "cartoons are TV on TMDB). Returns a textless scene still (backdrop) — never a title-bearing " +
  "poster — inline for you to inspect, plus title/license/attribution metadata. Pass the series " +
  "name as `query`.";

export type FindTvDeps = BackdropToolDeps<TmdbTvResult>;

export const defaultFindTvDeps: FindTvDeps = {
  loadToken: loadTmdbReadToken,
  search: searchTv,
  fetchTextlessBackdrops,
  fetchImageBytes,
};

export function createFindTvTool(deps: FindTvDeps = defaultFindTvDeps) {
  return createBackdropTool<TmdbTvResult>(
    {
      toolName: "find_tv",
      description: DESCRIPTION,
      querySchemaDescription: "TV series name, e.g. 'Game of Thrones'.",
      kind: "tv",
      subjectIdPrefix: "tmdb:tv-",
      titleOf: (result) => result.name,
    },
    deps,
  );
}
