import React, { useEffect, useMemo, useRef, useState } from "react";
import { useActor } from "@xstate/react";
import { parseAsFloat, parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";
import s from "./filmroom.module.css";
import { AppCtx, useAppState } from "./shared";
import { DEFAULT_QUERY, FilmroomApp, OV, VIEWS, type View } from "../../lib/filmroom/app/app";
import { chordStep, keyMachine, valueForKey } from "../../lib/filmroom/keys/machine";
import { parseFilmSource } from "../../lib/filmroom/video/sources";
import { TopBar } from "./TopBar";
import { Viewport } from "./Viewport";
import { Inspector } from "./Inspector";
import { Timeline } from "./Timeline";
import { Tape } from "./Tape";
import { ShotMap } from "./ShotMap";
import { StatusBar } from "./StatusBar";
import { Palette } from "./Palette";
import { Help, IntegrityReport } from "./Overlays";

const urlKeys = {
  q: parseAsString.withDefault(DEFAULT_QUERY),
  g: parseAsString,
  a: parseAsInteger,
  p: parseAsInteger,
  f: parseAsInteger,
  v: parseAsStringLiteral(VIEWS).withDefault("tl"),
  ov: parseAsInteger.withDefault(OV.hud | OV.telemetry | OV.tags),
  pre: parseAsFloat.withDefault(6),
  post: parseAsFloat.withDefault(4),
  film: parseAsString,
};

export default function Workbench() {
  const app = useMemo(() => new FilmroomApp(""), []);
  const [, setUrl] = useQueryStates(urlKeys, { history: "replace", throttleMs: 120 });
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    // Read the shared state straight from location: on a statically exported page the router's query is empty
    // until after hydration, and booting on defaults would overwrite the link being opened.
    const sp = new URLSearchParams(window.location.search);
    const get = <T,>(k: keyof typeof urlKeys, fallback: T): T => {
      const raw = sp.get(k);
      if (raw === null) return fallback;
      const v = (urlKeys[k] as { parse: (s: string) => unknown }).parse(raw);
      return (v ?? fallback) as T;
    };
    void app.load({
      query: get("q", DEFAULT_QUERY),
      view: get<View>("v", "tl"),
      overlays: get("ov", OV.hud | OV.telemetry | OV.tags),
      pre: get("pre", 6),
      post: get("post", 4),
      game: get<string | null>("g", null),
      action: get<number | null>("a", null),
      frame: get<number | null>("f", null),
      films: get<string | null>("film", null),
    });
    return () => app.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app]);

  return (
    <AppCtx.Provider value={app}>
      <Shell setUrl={setUrl} />
    </AppCtx.Provider>
  );
}

type SetUrl = ReturnType<typeof useQueryStates<typeof urlKeys>>[1];

function Shell({ setUrl }: { setUrl: SetUrl }) {
  const app = (React.useContext(AppCtx) as FilmroomApp)!;
  const st = useAppState();
  const [snap, send, actor] = useActor(keyMachine);
  const [panel, setPanel] = useState<null | "palette" | "help" | "report">(null);
  const [paletteSeed, setPaletteSeed] = useState("");
  const filmInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const queryRef = useRef<{ focus: () => void; blur: () => void } | null>(null);

  // Mirror machine state into the app (status bar, chord HUD).
  useEffect(() => {
    const step = chordStep(snap.value);
    const mode = typeof snap.value === "string" ? snap.value : "chord";
    if (mode !== app.state.mode || step !== app.state.chordStep || snap.context.draft !== app.state.draft)
      app.set({ mode, chordStep: step, draft: snap.context.draft });
  }, [snap, app]);

  // Commit a finished chord.
  const lastCommitted = useRef<object | null>(null);
  useEffect(() => {
    const c = snap.context.committed;
    if (c && c !== lastCommitted.current && snap.value === "browse") {
      lastCommitted.current = c;
      const t = app.stamp(c);
      app.toast(t ? `stamped ${Object.values(c).join(" · ")}  [${t.tIn.toFixed(2)}s, ${t.tOut.toFixed(2)}s]` : "nothing to stamp");
    }
  }, [snap, app]);

  // App state → URL (deterministic, replace-history).
  const frame = useRef<number | null>(null);
  useEffect(() => {
    if (!st.ready) return;
    const row = app.row;
    const g = row >= 0 ? app.store.meta.games[app.store.p.game[row]] : null;
    void setUrl({
      q: st.query,
      g: g?.id ?? null,
      a: row >= 0 ? app.store.p.action[row] : null,
      p: row >= 0 && g ? app.store.p.poss[row] - g.firstPoss : null,
      v: st.view,
      ov: st.overlays,
      pre: st.pre,
      post: st.post,
      film: app.filmsParam() || null,
    });
  }, [st.ready, st.query, st.cursor, st.view, st.overlays, st.pre, st.post, st.result, st.films, app, setUrl]);
  // Frame goes to the URL only when the playhead rests (paused / stepped), never at 60 Hz.
  useEffect(
    () =>
      app.subscribeFrame((f) => {
        // Film view frames are relative to the free-running film, not to a play's t₀: never share them as a play frame.
        if (f.playing || f.rel === frame.current || app.state.filmView) return;
        frame.current = f.rel;
        void setUrl({ f: f.rel });
      }),
    [app, setUrl],
  );

  // Panels ↔ machine.
  useEffect(() => {
    if (snap.value === "palette") setPanel("palette");
    else if (snap.value === "help") setPanel("help");
    else if (panel === "palette" || panel === "help") setPanel(null);
    if (snap.value === "query") queryRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.value]);

  // Drop a game recording anywhere on the workbench: it becomes film for the current play's game.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv)$/i.test(f.name));
      if (!file || app.row < 0) return;
      e.preventDefault();
      const g = app.gameOfRow(app.row);
      app.openFilm(file, g.id);
      app.toast(`film loaded for ${g.date} · F for film view, S at a play's t₀ syncs the game`);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [app]);

  // ── global key router ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!app.state.ready) return;
      const mode = actor.getSnapshot().value;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (mode === "palette") send({ type: "CLOSE" });
        else {
          if (mode === "query") queryRef.current?.blur();
          setPaletteSeed("");
          send({ type: "PALETTE" });
        }
        return;
      }
      if (panel === "report") {
        if (e.key === "Escape" || e.key === "q") setPanel(null);
        e.preventDefault();
        return;
      }
      if (mode === "browse" && e.key === "R" && e.shiftKey) {
        e.preventDefault();
        setPanel("report");
        return;
      }
      if (mode === "query" || mode === "palette") return; // their inputs own the keyboard
      if (mode === "help") {
        const el = document.querySelector<HTMLElement>("[data-scroll=help]");
        const by = { ArrowDown: 40, ArrowUp: -40, j: 40, k: -40, PageDown: 400, PageUp: -400, " ": 400 }[e.key];
        if (by && el) el.scrollBy({ top: by });
        else if (e.key === "Escape" || e.key === "?" || e.key === "q") send({ type: "CLOSE" });
        e.preventDefault();
        return;
      }
      const step = chordStep(mode);
      if (step) {
        e.preventDefault();
        if (e.key === "Escape") send({ type: "CLOSE" });
        else if (e.key === "Enter") send({ type: "COMMIT" });
        else if (e.key === "Backspace") send({ type: "BACK" });
        else if (e.key === " " || e.key === "-") send({ type: "SKIP" });
        else {
          const v = valueForKey(step, e.key);
          if (v) send({ type: "PICK", value: v });
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        app.toast(app.undoTag() ? "tag undone" : "nothing to undo");
        return;
      }
      if (mod) return;
      const reel = app.reel;
      const f = app.frame;
      const handled = () => e.preventDefault();
      switch (e.key) {
        case "/":
          handled();
          send({ type: "QUERY" });
          break;
        case "?":
          handled();
          send({ type: "HELP" });
          break;
        case "j":
        case "J":
          handled();
          reel?.shuttle(-1);
          break;
        case "k":
        case "K":
          handled();
          reel?.pause();
          break;
        case "l":
        case "L":
          handled();
          reel?.shuttle(1);
          break;
        case " ":
          handled();
          reel?.toggle();
          break;
        case ",":
          handled();
          reel?.step(-1);
          break;
        case ".":
          handled();
          reel?.step(1);
          break;
        case "<":
          handled();
          reel?.step(-10);
          break;
        case ">":
          handled();
          reel?.step(10);
          break;
        case "[":
          handled();
          if (app.state.filmView) app.filmViewStep(-1);
          else reel?.prev();
          break;
        case "]":
          handled();
          if (app.state.filmView) app.filmViewStep(1);
          else reel?.next();
          break;
        case "f":
        case "F": {
          handled();
          if (app.state.filmView) {
            app.exitFilmView();
            app.toast("film view off · pinned plays now play as clips");
          } else {
            const name = app.enterFilmView();
            app.toast(
              name
                ? `film view · ${name} · find the play, S pins it and moves to the next`
                : "No film for this game yet. Paste a YouTube or video link in ⌘K, or drop a recording here",
            );
          }
          break;
        }
        case "s":
        case "S": {
          handled();
          const r = app.syncHere();
          app.toast(r ?? "Nothing to pin: open a play first");
          break;
        }
        case "w":
        case "W": {
          handled();
          const row = app.row;
          if (row >= 0) window.open(`https://www.nba.com/game/${app.gameOfRow(row).id.padStart(10, "0")}/play-by-play`, "_blank", "noopener");
          break;
        }
        case "{":
        case "}": {
          handled();
          const rows = app.state.result?.rows;
          if (!rows || !rows.length) break;
          const gameOf = (i: number) => app.store.p.game[rows[i]];
          const cur = gameOf(app.state.cursor);
          let i = app.state.cursor;
          if (e.key === "}") {
            while (i < rows.length - 1 && gameOf(i) === cur) i++;
          } else {
            while (i > 0 && gameOf(i - 1) === cur) i--;
            if (i === app.state.cursor && i > 0) {
              const prevGame = gameOf(i - 1);
              i--;
              while (i > 0 && gameOf(i - 1) === prevGame) i--;
            }
          }
          app.goto(i);
          break;
        }
        case "Home":
          handled();
          app.goto(0);
          break;
        case "End":
          handled();
          app.goto((app.state.result?.rows.length ?? 1) - 1);
          break;
        case "Enter":
          handled();
          if (f) reel?.seekRel(f.from);
          reel?.play();
          break;
        case "0":
          handled();
          reel?.seekRel(0);
          break;
        case "v":
        case "V": {
          handled();
          const i = VIEWS.indexOf(app.state.view);
          app.set({ view: VIEWS[(i + (e.shiftKey ? VIEWS.length - 1 : 1)) % VIEWS.length] });
          break;
        }
        case "t":
          handled();
          send({ type: "CHORD" });
          break;
        case "T": {
          handled();
          const last = app.state.lastTag;
          if (!last) app.toast("no previous stamp to repeat");
          else {
            const t = app.stamp(last);
            if (t) app.toast(`repeated ${Object.values(last).join(" · ")}`);
          }
          break;
        }
        case "i":
        case "I":
          handled();
          if (f) app.set({ marks: { ...app.state.marks, in: f.sec } });
          break;
        case "o":
          handled();
          if (f) app.set({ marks: { ...app.state.marks, out: f.sec } });
          break;
        case "x":
        case "X":
          handled();
          app.set({ marks: { in: null, out: null } });
          break;
        case "u":
        case "U":
          handled();
          app.toast(app.undoTag() ? "tag undone" : "nothing to undo");
          break;
        case "Backspace":
          if (e.shiftKey) {
            handled();
            app.toast(app.deleteTagAtPlayhead() ? "tag deleted" : "no analyst tag under the playhead");
          }
          break;
        case "y":
        case "Y":
          handled();
          void copyUrl(app);
          break;
        case "A": {
          handled();
          const r = app.syncHere();
          app.toast(r ?? "nothing to pin");
          break;
        }
        case "h":
        case "H":
          handled();
          app.set({ overlays: app.state.overlays ^ OV.hud });
          break;
        case "m":
        case "M":
          handled();
          app.set({ overlays: app.state.overlays ^ OV.telemetry });
          break;
        case "z":
        case "Z":
          handled();
          app.set({ overlays: app.state.overlays ^ OV.zones });
          break;
        case "g":
        case "G":
          handled();
          setPaletteSeed("game ");
          send({ type: "PALETTE" });
          break;
        case "O":
          handled();
          filmInput.current?.click();
          break;
        case "Escape":
          if (app.state.marks.in !== null || app.state.marks.out !== null) app.set({ marks: { in: null, out: null } });
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app, actor, send, panel]);

  const runCommand = (id: string) => {
    send({ type: "CLOSE" });
    const reel = app.reel;
    switch (id) {
      case "help":
        setTimeout(() => send({ type: "HELP" }), 0);
        break;
      case "report":
        setPanel("report");
        break;
      case "film":
        filmInput.current?.click();
        break;
      case "export":
        exportTags(app);
        break;
      case "import":
        importInput.current?.click();
        break;
      case "fixture":
        app.setShowFixture(!app.state.showFixture);
        app.toast(app.state.showFixture ? "fixture tags shown" : "fixture tags hidden");
        break;
      case "copy":
        void copyUrl(app);
        break;
      case "pre+":
        app.set({ pre: Math.min(11, app.state.pre + 1) });
        reel?.refresh();
        break;
      case "pre-":
        app.set({ pre: Math.max(1, app.state.pre - 1) });
        reel?.refresh();
        break;
      case "post+":
        app.set({ post: Math.min(11, app.state.post + 1) });
        reel?.refresh();
        break;
      case "post-":
        app.set({ post: Math.max(1, app.state.post - 1) });
        reel?.refresh();
        break;
      case "view:tl":
      case "view:tape":
      case "view:map":
        app.set({ view: id.slice(5) as View });
        break;
      case "film-view":
        if (app.state.filmView) app.exitFilmView();
        else app.toast(app.enterFilmView() ? "film view · S pins the play on screen" : "no film for this game");
        break;
      case "official": {
        const row = app.row;
        if (row >= 0 && !confirmReplaceFilm(app, app.gameOfRow(row).id)) break;
        if (row >= 0 && app.attachOfficial(app.gameOfRow(row).id)) {
          app.enterFilmView();
          app.toast("official NBA film attached · find a play, S pins it");
        }
        break;
      }
      case "film-cut":
      case "film-continuous": {
        const row = app.row;
        if (row >= 0) app.setFilmMode(app.gameOfRow(row).id, id === "film-cut" ? "cut" : "continuous");
        app.toast(id === "film-cut" ? "edited film: only pinned plays get clips" : "continuous film: one pin syncs the game");
        break;
      }
      case "film-detach": {
        const row = app.row;
        if (row < 0) break;
        const g = app.gameOfRow(row);
        const pins = app.pinnedCount(g.id);
        if (pins && !window.confirm(`Detach the film from ${g.date}? Its ${pins} pinned ${pins === 1 ? "play" : "plays"} will be deleted.`)) break;
        app.detachFilm(g.id);
        app.toast("Film detached");
        break;
      }
      case "nba":
        if (app.row >= 0) window.open(`https://www.nba.com/game/${app.gameOfRow(app.row).id.padStart(10, "0")}/play-by-play`, "_blank", "noopener");
        break;
      case "clear-tags":
        if (window.confirm(`Delete all ${app.state.tags.length} of your tags in this browser?`)) app.importTags([]);
        break;
    }
  };

  if (st.error)
    return (
      <div className={s.loading} role="alert">
        Couldn&apos;t load the film room data ({st.error}). Check your connection and reload the page.
      </div>
    );

  return (
    <div className={s.root} data-view={st.view}>
      {!st.ready && (
        <div className={s.loading}>
          <span>loading 82 games · 19,059 plays</span>
        </div>
      )}
      {st.ready && (
        <>
          <TopBar queryRef={queryRef} onClose={() => send({ type: "CLOSE" })} onFocus={() => actor.getSnapshot().value !== "query" && send({ type: "QUERY" })} />
          <Viewport />
          <Inspector />
          <div className={s.lower}>{st.view === "tl" ? <Timeline /> : st.view === "tape" ? <Tape /> : <ShotMap />}</div>
          <StatusBar />
          {panel === "palette" && (
            <Palette
              seed={paletteSeed}
              onClose={() => send({ type: "CLOSE" })}
              onCommand={runCommand}
              onQuery={() => send({ type: "CLOSE" })}
              onFilm={(url) => {
                send({ type: "CLOSE" });
                const row = app.row;
                if (row < 0) return;
                if (!confirmReplaceFilm(app, app.gameOfRow(row).id, url)) return;
                const msg = app.attachFilm(url, app.gameOfRow(row).id);
                const failed = msg.startsWith("Paste");
                app.toast(msg, failed ? "error" : "info");
                if (!failed) app.enterFilmView();
              }}
            />
          )}
          {panel === "help" && <Help onClose={() => send({ type: "CLOSE" })} />}
          {panel === "report" && <IntegrityReport onClose={() => setPanel(null)} />}
          {/* One live region for the session; its content changes, so every message is announced. */}
          <div className={s.live} role="status" aria-live="polite">
            {st.toast && (
              <div key={st.toast.id} className={s.toast} data-tone={st.toast.tone}>
                {st.toast.text}
              </div>
            )}
          </div>
        </>
      )}
      <input
        ref={filmInput}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          const row = app.row;
          if (file && row >= 0) {
            const g = app.store.meta.games[app.store.p.game[row]];
            app.openFilm(file, g.id);
            app.toast(`film loaded for ${g.date} · F for film view, S at a play's t₀ syncs the game`);
          }
          e.target.value = "";
        }}
      />
      <input
        ref={importInput}
        type="file"
        accept="application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file) {
            try {
              const j = JSON.parse(await file.text());
              const list = Array.isArray(j) ? j : j.tags;
              app.importTags(list ?? []);
              app.toast(`imported ${list?.length ?? 0} tags`);
            } catch {
              app.toast("not a tag file");
            }
          }
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Replacing a game's film drops its pins: ask first, naming what goes. */
function confirmReplaceFilm(app: FilmroomApp, game: string, nextUrl?: string): boolean {
  const film = app.films.get(game);
  const pins = app.pinnedCount(game);
  if (!film || !pins) return true;
  if (nextUrl && parseFilmSource(nextUrl)?.url === film.url) return true;
  return window.confirm(`Replace the film for this game? Its ${pins} pinned ${pins === 1 ? "play" : "plays"} will be deleted.`);
}

async function copyUrl(app: FilmroomApp) {
  try {
    await navigator.clipboard.writeText(location.href);
    app.toast("link copied — query, play and frame");
  } catch {
    app.toast(location.href);
  }
}

function exportTags(app: FilmroomApp) {
  const blob = new Blob([JSON.stringify({ version: 1, exported: new Date().toISOString(), tags: app.state.tags }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `filmroom-tags-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  app.toast(`exported ${app.state.tags.length} tags`);
}
