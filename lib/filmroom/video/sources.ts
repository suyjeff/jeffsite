// Which film plays for a play row, and where its t₀ sits in that film.
//
//   1. NBA pbp clip (videoeventsasset manifest) — only when the ingest verified the URL still serves the clip.
//   2. Local game film — a full-game recording the analyst opened. Every play carries the wall-clock time of its
//      event (cdn `timeActual`), so one sync anchor (this frame = this event) places every play in the game; more
//      anchors make the map piecewise-linear across breaks the recording skipped.
//   3. Proxy film — frame-counted stand-in so the reel, stepping and tagging work on any play.

import { VIDEO } from "../core/format";
import type { Store } from "../engine/store";
import type { Clip } from "./reel";

export const NBA_FPS = 30000 / 1001;
export const PROXY_FPS = 30000 / 1001;
export const PROXY_T0 = 360 / PROXY_FPS; // frame 360
export const PROXY_LEN = 720 / PROXY_FPS;
export const PROXY_COUNT = 6;
/** Where the event sits in an NBA pbp clip by default; analysts re-anchor per clip with Shift+A. */
export const NBA_T0_DEFAULT = 9.0;

export interface FilmAnchor {
  wall: number; // tenths of a second since the game's first action
  media: number; // seconds in the film
  /** The default "film starts at tip-off" guess; the first real anchor replaces it. */
  provisional?: boolean;
}

export interface LocalFilm {
  game: string;
  url: string;
  name: string;
  fps: number;
  anchors: FilmAnchor[];
}

export interface SourceContext {
  store: Store;
  pre: number;
  post: number;
  films: Map<string, LocalFilm>;
  /** game:action → mp4 url (from per-game detail, only for clips verified live). */
  nbaUrl: (game: string, action: number) => string | null;
  /** Per-clip t₀ overrides set by re-anchoring. */
  anchors: Map<string, number>;
  base: string;
}

export function filmTime(film: LocalFilm, wall: number): number | null {
  if (!film.anchors.length) return null;
  const sorted = [...film.anchors].sort((a, b) => a.wall - b.wall);
  let a = sorted[0];
  for (const x of sorted) if (x.wall <= wall) a = x;
  return a.media + (wall - a.wall) / 10;
}

export function clipFor(ctx: SourceContext, row: number): Clip {
  const { store } = ctx;
  const g = store.meta.games[store.p.game[row]];
  const action = store.p.action[row];
  const key = `${g.id}:${action}`;
  const film = ctx.films.get(g.id);
  if (film) {
    const t = filmTime(film, store.p.wall[row]);
    if (t !== null) return { key: `${key}@local`, src: film.url, kind: "local", fps: film.fps, t0: ctx.anchors.get(`${key}@local`) ?? t, from: -ctx.pre, to: ctx.post };
  }
  if (store.p.video[row] === VIDEO.live) {
    const url = ctx.nbaUrl(g.id, action);
    if (url) {
      const t0 = ctx.anchors.get(`${key}@nba`) ?? NBA_T0_DEFAULT;
      return { key: `${key}@nba`, src: url, kind: "nba", fps: NBA_FPS, t0, from: Math.max(-t0, -ctx.pre), to: Math.min(15 - t0, ctx.post) };
    }
  }
  return {
    key: `${key}@proxy`,
    src: `${ctx.base}/filmroom-assets/proxy/p${row % PROXY_COUNT}.webm`,
    kind: "proxy",
    fps: PROXY_FPS,
    t0: PROXY_T0,
    from: Math.max(-PROXY_T0 + 0.1, -ctx.pre),
    to: Math.min(PROXY_LEN - PROXY_T0 - 0.2, ctx.post),
  };
}
