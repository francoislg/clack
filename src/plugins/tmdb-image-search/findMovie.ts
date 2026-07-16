import { createBackdropTool, type BackdropToolDeps } from "./backdropTool.js";
import {
  loadTmdbReadToken,
  searchMovies,
  fetchTextlessBackdrops,
  fetchImageBytes,
  type TmdbMovieResult,
} from "./tmdb.js";

const DESCRIPTION =
  "TMDB movie image search. Best for the Movies category. Returns a textless scene still " +
  "(backdrop) — never a title-bearing poster — inline for you to inspect, plus " +
  "title/license/attribution metadata. Pass the movie title (with year if helpful, " +
  "e.g. 'Dune 2021') as `query`.";

export type FindMovieDeps = BackdropToolDeps<TmdbMovieResult>;

export const defaultFindMovieDeps: FindMovieDeps = {
  loadToken: loadTmdbReadToken,
  search: searchMovies,
  fetchTextlessBackdrops,
  fetchImageBytes,
};

export function createFindMovieTool(deps: FindMovieDeps = defaultFindMovieDeps) {
  return createBackdropTool<TmdbMovieResult>(
    {
      toolName: "find_movie",
      description: DESCRIPTION,
      querySchemaDescription: "Movie title, with year if helpful, e.g. 'Dune 2021'.",
      kind: "movie",
      subjectIdPrefix: "tmdb:m-",
      titleOf: (result) => result.title,
    },
    deps,
  );
}
