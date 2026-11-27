// Film-room application controller: data loading, query execution, reel/clip state, tags, per-game detail.
// React reads it through useSyncExternalStore; frame-rate state (playhead) has its own channel so 60 Hz updates
// never re-render the workbench — the playhead and frame counters subscribe and write the DOM directly.

import { decodeBundle, type Store } from "../engine/store";
import { Engine, type QueryResult } from "../engine/query";
import type { BundleMeta, GameDetail } from "../core/format";
import type { Tag } from "../tags/ontology";
import { ReelController, type FrameState } from "../video/reel";
import { FILM_FPS, clipFor, decodeFilms, encodeFilms, filmTime, parseFilmSource, type FilmAnchor, type FilmMode, type LocalFilm, type SourceContext } from "../video/sources";
import type { Draft } from "../keys/machine";

export type View = "tl" | "tape" | "map";
export const VIEWS: View[] = ["tl", "tape", "map"];
export const OV = { hud: 1, telemetry: 2, tags: 4, zones: 8 } as const;

export interface FixtureFile {
  query: string;
  positives: string[];
  roles: Record<string, string>;
  tags: Tag[];
}

export interface AppState {
  ready: boolean;
  error: string | null;
  loadMs: number;
  query: string;
  result: QueryResult | null;
  cursor: number;
  view: View;
  overlays: number;
  pre: number;
  post: number;
  mode: string;
  chordStep: string | null;
  draft: Draft;
  marks: { in: number | null; out: number | null };
  tags: Tag[];
  showFixture: boolean;
  toast: { text: string; id: number } | null;
  details: number; // bumps when a game detail arrives
  lastTag: Draft | null;
  films: number; // bumps when the film map or its anchors change
  /** Film view: the game's film plays freely (to find and pin plays) instead of per-play clips. */
  filmView: { game: string; media: number } | null;
}

const TAG_KEY = "filmroom.tags.v1";
const FILM_KEY = "filmroom.films.v1";

export const DEFAULT_QUERY = "shooter:curry shot:3pt opp.div:pacific";

async function gunzipIfNeeded(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const b = new Uint8Array(buf, 0, 2);
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  return new Response(stream).arrayBuffer();
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLocal(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or blocked: tags stay in memory for this session */
  }
}

export class FilmroomApp {
  state: AppState = {
    ready: false,
    error: null,
    loadMs: 0,
    query: DEFAULT_QUERY,
    result: null,
    cursor: 0,
    view: "tl",
    overlays: OV.hud | OV.telemetry | OV.tags,
    pre: 6,
    post: 4,
    mode: "browse",
    chordStep: null,
    draft: {},
    marks: { in: null, out: null },
    tags: [],
    showFixture: true,
    toast: null,
    details: 0,
    lastTag: null,
    films: 0,
    filmView: null,
  };
  store!: Store;
  engine!: Engine;
  fixture: FixtureFile | null = null;
  frame: FrameState | null = null;
  reel: ReelController | null = null;
  details = new Map<string, GameDetail>();
  private pendingDetails = new Map<string, Promise<GameDetail | null>>();
  films = new Map<string, LocalFilm>();
  anchors = new Map<string, number>();
  private savedAnchors = new Map<string, FilmAnchor[]>();
  /** Official NBA uploads known to cover a game (data/films.json), offered when no film is attached. */
  catalog = new Map<string, LocalFilm & { title: string; note?: string }>();
  private listeners = new Set<() => void>();
  private frameListeners = new Set<(f: FrameState) => void>();
  private undo: string[] = [];
  private toastTimer = 0;
  /** Reference roster for binary lineup vectors: the focus team's ten most-used players. */
  roster: number[] = [];

  constructor(private base = "") {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;
  subscribeFrame(fn: (f: FrameState) => void): () => void {
    this.frameListeners.add(fn);
    return () => {
      this.frameListeners.delete(fn);
    };
  }
  set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  async load(
    init: Partial<Pick<AppState, "query" | "view" | "overlays" | "pre" | "post">> & { game?: string | null; action?: number | null; frame?: number | null; films?: string | null },
  ) {
    const t0 = performance.now();
    try {
      const [meta, bin, fixture, catalog] = await Promise.all([
        fetch(`${this.base}/filmroom-assets/data/meta.json`).then((r) => r.json() as Promise<BundleMeta>),
        fetch(`${this.base}/filmroom-assets/data/plays.bin.gz`).then((r) => r.arrayBuffer()).then(gunzipIfNeeded),
        fetch(`${this.base}/filmroom-assets/data/annotations.fixture.json`).then((r) => (r.ok ? (r.json() as Promise<FixtureFile>) : null)).catch(() => null),
        fetch(`${this.base}/filmroom-assets/data/films.json`)
          .then((r) => (r.ok ? (r.json() as Promise<{ films: (LocalFilm & { title: string; note?: string })[] }>) : { films: [] }))
          .catch(() => ({ films: [] })),
      ]);
      for (const f of catalog.films) this.catalog.set(f.game, { ...f, official: true });
      this.store = decodeBundle(bin, meta);
      this.engine = new Engine(this.store);
      this.fixture = fixture;
      this.roster = this.computeRoster();
      const tags = readLocal<Tag[]>(TAG_KEY, []);
      // Saved films: URL and YouTube films come back whole; a file's object URL dies with the page, so only its anchors
      // are kept and a re-opened file re-syncs at once. A shared link's films override what this browser had.
      for (const f of readLocal<LocalFilm[]>(FILM_KEY, [])) {
        if (!f || !f.game || !Array.isArray(f.anchors)) continue;
        if ((f.kind === "url" || f.kind === "youtube") && f.url) this.films.set(f.game, { ...f, fps: f.fps || FILM_FPS, mode: f.mode ?? "continuous" });
        else this.savedAnchors.set(f.game, f.anchors);
      }
      if (init.films) for (const f of decodeFilms(init.films)) this.films.set(f.game, f);
      const { game: _g, action: _a, frame: _f, films: _films, ...stateInit } = init;
      this.state = { ...this.state, ...stateInit, tags };
      this.applyTags();
      this.runQuery(this.state.query, { keepCursor: false });
      // Restore the shared play/frame.
      let cursor = 0;
      if (init.game && init.action != null) {
        const g = this.store.gameIndex.get(init.game);
        const row = g === undefined ? -1 : this.store.rowOf(g, init.action);
        const idx = row < 0 ? -1 : this.indexOfRow(row);
        if (idx >= 0) cursor = idx;
      }
      this.set({ ready: true, loadMs: performance.now() - t0, cursor });
      this.pendingRestore = { cursor, frame: init.frame ?? null };
    } catch (e) {
      this.set({ error: e instanceof Error ? e.message : String(e) });
    }
  }
  private pendingRestore: { cursor: number; frame: number | null } | null = null;

  private computeRoster(): number[] {
    const focus = this.store.meta.focusTeam;
    const counts = new Map<number, number>();
    const { floor, p } = this.store;
    for (let i = 0; i < this.store.n; i++) {
      const side = p.off[i] === focus ? 0 : p.def[i] === focus ? 5 : -1;
      if (side < 0) continue;
      for (let k = 0; k < 5; k++) {
        const id = floor[i * 10 + side + k];
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id]) => id);
  }

  // ── reel ──
  attachReel(host: HTMLElement) {
    this.reel?.destroy();
    this.reel = new ReelController(
      host,
      (i) => this.clipAt(i),
      () => this.state.result?.rows.length ?? 0,
      (f) => {
        this.frame = f;
        for (const l of this.frameListeners) l(f);
      },
      (i) => {
        if (i !== this.state.cursor) this.set({ cursor: i, marks: { in: null, out: null } });
        void this.ensureDetail(this.rowAt(i));
        void this.ensureDetail(this.rowAt(i + 1));
      },
    );
    const r = this.pendingRestore;
    this.pendingRestore = null;
    if (this.state.result?.rows.length) {
      const fps = 30000 / 1001;
      void this.reel.goto(r?.cursor ?? this.state.cursor, { rel: r?.frame != null ? r.frame / fps : undefined });
    }
  }

  sourceContext(): SourceContext {
    return {
      store: this.store,
      pre: this.state.pre,
      post: this.state.post,
      films: this.films,
      anchors: this.anchors,
      base: this.base,
      filmView: this.state.filmView,
      nbaUrl: (game, action) => {
        const d = this.details.get(game);
        const u = d?.video[action];
        return u && !u.startsWith("retired:") ? u : null;
      },
    };
  }
  clipAt(i: number) {
    const row = this.rowAt(i);
    return row < 0 ? null : clipFor(this.sourceContext(), row);
  }
  rowAt(i: number): number {
    const rows = this.state.result?.rows;
    if (!rows || i < 0 || i >= rows.length) return -1;
    return rows[i];
  }
  get row(): number {
    return this.rowAt(this.state.cursor);
  }
  indexOfRow(row: number): number {
    const rows = this.state.result?.rows;
    if (!rows) return -1;
    // rows ascend: binary search
    let lo = 0;
    let hi = rows.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (rows[m] === row) return m;
      if (rows[m] < row) lo = m + 1;
      else hi = m - 1;
    }
    return -1;
  }

  // ── query ──
  runQuery(q: string, opts: { keepCursor?: boolean } = { keepCursor: true }) {
    const prevRow = this.row;
    const result = this.engine.run(q);
    let cursor = 0;
    if (opts.keepCursor && prevRow >= 0) {
      const rows = result.rows;
      // Stay on the same play if it survived; else the first play at or after it.
      let lo = 0;
      let hi = rows.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (rows[m] < prevRow) lo = m + 1;
        else hi = m;
      }
      cursor = Math.min(lo, Math.max(0, rows.length - 1));
    }
    this.set({ query: q, result, cursor });
    if (this.reel) {
      this.reel.refresh();
      if (result.rows.length) void this.reel.goto(cursor, { play: false });
    }
  }

  goto(i: number) {
    if (!this.reel) return;
    void this.reel.goto(i);
  }

  // ── detail ──
  ensureDetail(row: number): Promise<GameDetail | null> {
    if (row < 0) return Promise.resolve(null);
    const id = this.store.meta.games[this.store.p.game[row]].id;
    const have = this.details.get(id);
    if (have) return Promise.resolve(have);
    let p = this.pendingDetails.get(id);
    if (!p) {
      p = fetch(`${this.base}/filmroom-assets/data/games/${id}.json`)
        .then((r) => (r.ok ? (r.json() as Promise<GameDetail>) : null))
        .then((d) => {
          if (d) {
            this.details.set(id, d);
            this.set({ details: this.state.details + 1 });
          }
          return d;
        })
        .catch(() => null);
      this.pendingDetails.set(id, p);
    }
    return p;
  }

  // ── tags ──
  allTags(): Tag[] {
    return [...(this.state.showFixture && this.fixture ? this.fixture.tags : []), ...this.state.tags];
  }
  private applyTags() {
    this.engine.setTags(this.allTags());
  }
  tagsForRow(row: number): Tag[] {
    if (row < 0) return [];
    const g = this.store.meta.games[this.store.p.game[row]].id;
    const a = this.store.p.action[row];
    return this.allTags().filter((t) => t.game === g && t.action === a);
  }
  stamp(draft: Draft): Tag | null {
    const row = this.row;
    const f = this.frame;
    if (row < 0 || !f || !Object.keys(draft).length) return null;
    const fps = f.fps;
    const q = (s: number) => Math.round(s * fps) / fps;
    const m = this.state.marks;
    let tIn = m.in ?? Math.max(f.from, -4);
    let tOut = m.out ?? (m.in !== null ? Math.max(m.in + 1, f.sec) : 0);
    if (tOut < tIn) [tIn, tOut] = [tOut, tIn];
    const g = this.store.meta.games[this.store.p.game[row]];
    const tag: Tag = {
      id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      game: g.id,
      action: this.store.p.action[row],
      possession: `${g.id}:${this.store.p.poss[row] - g.firstPoss}`,
      tIn: q(tIn),
      tOut: q(tOut),
      ...draft,
      author: "analyst",
      source: "analyst",
      created: Date.now(),
    };
    const tags = [...this.state.tags, tag];
    this.undo.push(tag.id);
    writeLocal(TAG_KEY, tags);
    this.set({ tags, lastTag: draft, marks: { in: null, out: null } });
    this.applyTags();
    this.rerun();
    return tag;
  }
  undoTag(): boolean {
    const id = this.undo.pop() ?? this.state.tags[this.state.tags.length - 1]?.id;
    if (!id) return false;
    const tags = this.state.tags.filter((t) => t.id !== id);
    writeLocal(TAG_KEY, tags);
    this.set({ tags });
    this.applyTags();
    this.rerun();
    return true;
  }
  deleteTagAtPlayhead(): boolean {
    const f = this.frame;
    const here = this.tagsForRow(this.row).filter((t) => t.source === "analyst" && f && f.sec >= t.tIn - 1e-6 && f.sec <= t.tOut + 1e-6);
    const victim = here[here.length - 1];
    if (!victim) return false;
    const tags = this.state.tags.filter((t) => t.id !== victim.id);
    writeLocal(TAG_KEY, tags);
    this.set({ tags });
    this.applyTags();
    this.rerun();
    return true;
  }
  importTags(list: Tag[]) {
    const have = new Set(this.state.tags.map((t) => t.id));
    const tags = [...this.state.tags, ...list.filter((t) => t && t.id && !have.has(t.id)).map((t) => ({ ...t, source: "analyst" as const }))];
    writeLocal(TAG_KEY, tags);
    this.set({ tags });
    this.applyTags();
    this.rerun();
  }
  setShowFixture(v: boolean) {
    this.set({ showFixture: v });
    this.applyTags();
    this.rerun();
  }
  /** Re-run the current query after tag changes without moving the reel off the current play. */
  private rerun() {
    const prevRow = this.row;
    const result = this.engine.run(this.state.query);
    const idx = prevRow >= 0 ? this.binIndex(result.rows, prevRow) : -1;
    this.set({ result, cursor: idx >= 0 ? idx : Math.min(this.state.cursor, Math.max(0, result.rows.length - 1)) });
    this.reel?.refresh();
  }
  private binIndex(rows: Uint32Array, row: number) {
    let lo = 0;
    let hi = rows.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (rows[m] === row) return m;
      if (rows[m] < row) lo = m + 1;
      else hi = m - 1;
    }
    return -1;
  }

  // ── film ──
  gameOfRow(row: number) {
    return this.store.meta.games[this.store.p.game[row]];
  }
  private filmChanged() {
    this.persistFilms();
    this.set({ films: this.state.films + 1 });
    this.reel?.refresh();
  }
  openFilm(file: File, game: string) {
    const url = URL.createObjectURL(file);
    const prev = this.films.get(game);
    const anchors = prev?.kind === "file" ? prev.anchors : this.savedAnchors.get(game) ?? [{ wall: 0, media: 0, provisional: true }];
    this.films.set(game, { game, kind: "file", url, name: file.name, fps: FILM_FPS, mode: prev?.mode ?? "continuous", anchors });
    this.filmChanged();
    if (this.state.filmView?.game === game) this.enterFilmView(0);
  }
  /** Attach film from a pasted YouTube link or media URL. */
  attachFilm(input: string, game: string): string {
    const src = parseFilmSource(input);
    if (!src) return "not a YouTube link or an http(s) media URL";
    const prev = this.films.get(game);
    const sameSource = prev && prev.url === src.url;
    this.films.set(game, { game, kind: src.kind, url: src.url, name: src.name, fps: FILM_FPS, mode: sameSource ? prev.mode : src.mode, anchors: sameSource ? prev.anchors : [] });
    this.filmChanged();
    return `${src.kind === "youtube" ? "YouTube" : "film"} attached · ${src.mode === "cut" ? "F to find plays, S to pin each" : "S at a play's t₀ syncs the game"}`;
  }
  attachOfficial(game: string): boolean {
    const c = this.catalog.get(game);
    if (!c) return false;
    const prev = this.films.get(game);
    if (prev?.url === c.url) return true;
    this.films.set(game, { game, kind: c.kind, url: c.url, name: c.title, fps: c.fps || FILM_FPS, mode: c.mode, anchors: c.anchors ?? [], official: true });
    this.filmChanged();
    return true;
  }
  detachFilm(game: string) {
    if (this.state.filmView?.game === game) this.set({ filmView: null });
    this.films.delete(game);
    this.savedAnchors.delete(game);
    this.filmChanged();
    if (this.reel) void this.reel.goto(this.state.cursor);
  }
  setFilmMode(game: string, mode: FilmMode) {
    const f = this.films.get(game);
    if (!f) return;
    f.mode = mode;
    this.filmChanged();
  }
  /** Pinned plays for a game's film, for the inspector and status. */
  pinnedCount(game: string): number {
    return this.films.get(game)?.anchors.filter((a) => !a.provisional).length ?? 0;
  }
  isPinned(row: number): boolean {
    const f = this.films.get(this.gameOfRow(row).id);
    return !!f && f.anchors.some((a) => !a.provisional && Math.abs(a.wall - this.store.p.wall[row]) <= 1);
  }
  /** Can the attached film place this play (so its clip is real footage)? */
  filmPlaces(row: number): boolean {
    const f = this.films.get(this.gameOfRow(row).id);
    return !!f && filmTime(f, this.store.p.wall[row]) !== null;
  }

  /** Film view on: the game's film plays freely from `media` (default: where the current play sits, or 0). */
  enterFilmView(media?: number) {
    const row = this.row;
    if (row < 0) return "no play selected";
    const g = this.gameOfRow(row).id;
    if (!this.films.get(g) && !this.attachOfficial(g)) return null;
    const film = this.films.get(g)!;
    const start = media ?? filmTime(film, this.store.p.wall[row]) ?? film.anchors.filter((a) => !a.provisional).slice(-1)[0]?.media ?? 0;
    this.set({ filmView: { game: g, media: Math.max(0, start) } });
    this.reel?.refresh();
    void this.reel?.goto(this.state.cursor, { rel: 0 });
    return film.name;
  }
  exitFilmView() {
    if (!this.state.filmView) return;
    this.set({ filmView: null });
    this.reel?.refresh();
    void this.reel?.goto(this.state.cursor);
  }
  /** In film view, move the play cursor without touching the film: pick which play the next S pins. */
  filmViewStep(d: number) {
    const rows = this.state.result?.rows;
    const fv = this.state.filmView;
    if (!rows || !fv) return;
    let i = this.state.cursor + d;
    while (i >= 0 && i < rows.length && this.gameOfRow(rows[i]).id !== fv.game) i += d;
    if (i >= 0 && i < rows.length) this.set({ cursor: i });
  }
  /**
   * Pin: the frame on screen is the current play's t₀. In film view this is tap-sync — pin, then move to the next
   * play of the same game while the film keeps rolling. On a clip it re-anchors that clip.
   */
  syncHere(): string | null {
    const f = this.frame;
    const row = this.row;
    if (!f || row < 0 || !this.reel?.current) return null;
    const c = this.reel.current;
    const media = f.frame / f.fps;
    const g = this.gameOfRow(row).id;
    const film = this.films.get(g);
    if (film && (this.state.filmView || c.kind === "local" || c.kind === "youtube")) {
      const wall = this.store.p.wall[row];
      film.anchors = [...film.anchors.filter((a) => Math.abs(a.wall - wall) > 1 && !a.provisional), { wall, media }].sort((a, b) => a.wall - b.wall);
      this.filmChanged();
      const pinned = film.anchors.length;
      if (this.state.filmView) {
        const before = this.state.cursor;
        this.filmViewStep(1);
        if (this.state.cursor === before) return `pinned ${pinned} · t₀ ${media.toFixed(2)}s · that was the last play of this game in the reel`;
        return `pinned ${pinned} · t₀ ${media.toFixed(2)}s · next: ${this.store.meta.players[this.store.p.actor[this.row]]?.short ?? "team"}`;
      }
      void this.reel.goto(this.state.cursor, { rel: 0 });
      return `pinned ${pinned} · t₀ ${media.toFixed(2)}s`;
    }
    this.anchors.set(c.key, media);
    this.reel.refresh();
    void this.reel.goto(this.state.cursor, { rel: 0 });
    return `t₀ re-anchored to frame ${f.frame}`;
  }
  /** Kept for the e2e/keyboard path that predates tap-sync. */
  anchorHere(): string | null {
    return this.syncHere();
  }
  filmsParam(): string {
    return encodeFilms(this.films.values());
  }
  private persistFilms() {
    for (const f of this.films.values()) if (f.kind === "file") this.savedAnchors.set(f.game, f.anchors);
    const out: Omit<LocalFilm, "url">[] & { url?: string }[] = [];
    for (const f of this.films.values()) out.push(f.kind === "file" ? { ...f, url: "" } : f);
    for (const [game, anchors] of this.savedAnchors) if (!this.films.has(game)) out.push({ game, kind: "file", name: "", fps: FILM_FPS, mode: "continuous", anchors, url: "" } as LocalFilm);
    writeLocal(FILM_KEY, out);
  }

  toast(text: string) {
    window.clearTimeout(this.toastTimer);
    this.set({ toast: { text, id: Date.now() } });
    this.toastTimer = window.setTimeout(() => this.set({ toast: null }), 1600);
  }

  destroy() {
    this.reel?.destroy();
    this.reel = null;
  }
}
