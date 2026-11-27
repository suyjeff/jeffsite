// Which film plays for a play row, and where its t₀ sits in that film.
//
//   1. NBA pbp clip (videoeventsasset manifest) — only when the ingest verified the URL still serves real footage.
//      Since October 2026 the NBA serves one "VIDEO NOT AVAILABLE" bumper for every pbp path and the manifest
//      endpoint returns blank URLs; its video now plays only inside NBA.com's authenticated (League Pass) player.
//   2. Attached film — real footage the analyst brings: a full-game recording (file or URL) or an official upload on
//      YouTube. "continuous" film is one unbroken broadcast: every play carries its event's wall-clock time (cdn
//      `timeActual`), so one sync anchor places the whole game and more anchors make the map piecewise-linear.
//      "cut" film (highlight packages, edited endings) jumps over dead time, so only plays pinned with their own
//      anchor have a clip.
//   3. Proxy film — frame-counted stand-in so the reel, stepping and tagging work on any play.

import { VIDEO } from "../core/format";
import type { Store } from "../engine/store";
import type { Clip } from "./reel";
import { youTubeId } from "./youtube";

export const NBA_FPS = 30000 / 1001;
export const PROXY_FPS = 30000 / 1001;
export const PROXY_T0 = 360 / PROXY_FPS; // frame 360
export const PROXY_LEN = 720 / PROXY_FPS;
export const PROXY_COUNT = 6;
/** Where the event sits in an NBA pbp clip by default; analysts re-anchor per clip with Shift+A. */
export const NBA_T0_DEFAULT = 9.0;
/** Frame rate assumed for film whose rate the browser doesn't expose (YouTube, most uploads). */
export const FILM_FPS = 30;

export interface FilmAnchor {
  wall: number; // tenths of a second since the game's first action
  media: number; // seconds in the film
  /** The default "film starts at tip-off" guess; the first real anchor replaces it. */
  provisional?: boolean;
}

export type FilmKind = "file" | "url" | "youtube";
export type FilmMode = "continuous" | "cut";

export interface LocalFilm {
  game: string;
  kind: FilmKind;
  /** Playable source: object URL (file), media URL, or "yt:<id>". */
  url: string;
  name: string;
  fps: number;
  mode: FilmMode;
  anchors: FilmAnchor[];
  /** From the official-film catalog (an NBA upload), not attached by the analyst. */
  official?: boolean;
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
  /** Film view: the attached film plays freely from this media time, for finding and pinning plays. */
  filmView: { game: string; media: number } | null;
}

/** Map a play's wall-clock time onto the film; null when this film can't place the play. */
export function filmTime(film: LocalFilm, wall: number): number | null {
  const real = film.anchors.filter((a) => !a.provisional);
  if (film.mode === "cut") {
    // Edited film: only plays with their own anchor (within a tenth of a second of wall time) have a place.
    const hit = real.find((a) => Math.abs(a.wall - wall) <= 1);
    return hit ? hit.media : null;
  }
  const list = real.length ? real : film.anchors;
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a.wall - b.wall);
  let a = sorted[0];
  for (const x of sorted) if (x.wall <= wall) a = x;
  const t = a.media + (wall - a.wall) / 10;
  // Before the recording starts: this play isn't on the film (the end is checked by the player, which knows it).
  return t >= 0 ? t : null;
}

/** Parse what an analyst pastes: a YouTube link/id, or a direct media URL. */
export function parseFilmSource(input: string): { kind: FilmKind; url: string; mode: FilmMode; name: string } | null {
  const s = input.trim();
  const yt = youTubeId(s);
  if (yt) return { kind: "youtube", url: `yt:${yt}`, mode: "cut", name: `YouTube ${yt}` };
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return { kind: "url", url: u.toString(), mode: "continuous", name: decodeURIComponent(u.pathname.split("/").pop() || u.hostname) };
  } catch {
    return null;
  }
}

export function clipFor(ctx: SourceContext, row: number): Clip {
  const { store } = ctx;
  const g = store.meta.games[store.p.game[row]];
  const action = store.p.action[row];
  const key = `${g.id}:${action}`;
  const film = ctx.films.get(g.id);
  if (film && ctx.filmView && ctx.filmView.game === g.id) {
    // Free film view: one stable clip for the whole game, so moving between plays doesn't reload or reseek.
    const t0 = ctx.filmView.media;
    return { key: `${g.id}@filmview`, src: film.url, kind: film.kind === "youtube" ? "youtube" : "local", fps: film.fps, t0, from: -t0, to: 6 * 3600 };
  }
  if (film) {
    const t = filmTime(film, store.p.wall[row]);
    if (t !== null) {
      const kind = film.kind === "youtube" ? "youtube" : "local";
      return { key: `${key}@${kind}`, src: film.url, kind, fps: film.fps, t0: ctx.anchors.get(`${key}@${kind}`) ?? t, from: Math.max(-t, -ctx.pre), to: ctx.post };
    }
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

// ── share-link encoding ──
// film=<game>~<kind>~<mode>~<src>~<wall:media,…>;… — files are local to one browser and never encoded.

export function encodeFilms(films: Iterable<LocalFilm>): string {
  const parts: string[] = [];
  for (const f of films) {
    if (f.kind === "file") continue;
    const anchors = f.anchors
      .filter((a) => !a.provisional)
      .map((a) => `${a.wall}:${a.media.toFixed(3)}`)
      .join(",");
    parts.push([f.game, f.kind === "youtube" ? "y" : "u", f.mode === "cut" ? "x" : "c", encodeURIComponent(f.url.replace(/^yt:/, "")).replace(/~/g, "%7E"), anchors].join("~"));
  }
  return parts.join(";");
}

export function decodeFilms(s: string): LocalFilm[] {
  const out: LocalFilm[] = [];
  for (const part of s.split(";")) {
    const [game, k, m, src, anchors = ""] = part.split("~");
    if (!game || !src || !/^\d+$/.test(game)) continue;
    const kind: FilmKind = k === "y" ? "youtube" : "url";
    let url = decodeURIComponent(src);
    if (kind === "youtube") {
      if (!/^[\w-]{11}$/.test(url)) continue;
      url = `yt:${url}`;
    } else if (!/^https?:\/\//.test(url)) continue;
    out.push({
      game,
      kind,
      url,
      name: kind === "youtube" ? `YouTube ${url.slice(3)}` : url.split("/").pop() ?? url,
      fps: FILM_FPS,
      mode: m === "x" ? "cut" : "continuous",
      anchors: anchors
        .split(",")
        .filter(Boolean)
        .map((a) => a.split(":").map(Number))
        .filter(([w, md]) => Number.isFinite(w) && Number.isFinite(md))
        .map(([wall, media]) => ({ wall, media })),
    });
  }
  return out;
}
