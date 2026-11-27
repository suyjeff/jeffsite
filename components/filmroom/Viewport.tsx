import React, { useEffect, useMemo, useRef } from "react";
import s from "./filmroom.module.css";
import { CourtLines, OUTCOME_VAR, fmtSec, playInfo, tri, useApp, useAppState, useFrame } from "./shared";
import { OV } from "../../lib/filmroom/app/app";
import type { GameDetail } from "../../lib/filmroom/core/format";

export function Viewport() {
  const app = useApp();
  const st = useAppState();
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (stage.current) app.attachReel(stage.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app]);
  const empty = !st.result?.rows.length;
  return (
    <div className={s.view} data-testid="viewport">
      <div ref={stage} className={s.stage} />
      {empty && (
        <div className={s.telemetry} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="mono dim">no plays match · / to edit the query</span>
        </div>
      )}
      {!empty && st.overlays & OV.telemetry ? <Telemetry /> : null}
      {!empty && <FilmNotice />}
      {!empty && st.overlays & OV.hud ? <Hud /> : null}
    </div>
  );
}

function Hud() {
  const app = useApp();
  const st = useAppState();
  const f = useFrame();
  const n = st.result?.rows.length ?? 0;
  const row = app.row;
  if (row < 0) return null;
  const info = playInfo(app, row);
  const kind = f?.kind ?? "proxy";
  const rate = f?.rate ?? 0;
  return (
    <div className={s.hud}>
      <div className={s.hudTL}>
        <span className={s.chip} data-testid="clip-index">
          {String(st.cursor + 1).padStart(String(n).length, "0")}/{n}
        </span>
        <span className={s.chip} data-tone={kind === "proxy" ? "dim" : "acc"} data-testid="film-badge">
          {st.filmView ? "FILM VIEW" : kind === "nba" ? "NBA CLIP" : kind === "youtube" ? "YOUTUBE" : kind === "local" ? "GAME FILM" : "PROXY FILM"}
        </span>
        {f?.buffering && (
          <span className={s.chip} data-tone="miss">
            BUFFERING
          </span>
        )}
      </div>
      <div className={s.hudTR}>
        <span className={s.chip} style={{ minWidth: "17ch" }} data-testid="hud-rel">
          t−t₀ {f ? fmtSec(f.sec, 3) : "—"}
        </span>
        <span className={s.chip} style={{ minWidth: "15ch" }} data-testid="hud-frame" data-exact={f?.exact ? "1" : "0"}>
          F {f ? String(f.frame).padStart(4, "0") : "----"} {f && f.rel >= 0 ? "+" : "−"}
          {f ? String(Math.abs(f.rel)).padStart(3, "0") : "000"}
        </span>
      </div>
      <div className={s.hudBL}>
        <span className={s.chip}>
          {info.period} {info.clock}
        </span>
        <span className={s.chip} style={{ color: OUTCOME_VAR[info.outcome] }}>
          {info.actor?.short || tri(info.off)} · {info.what}
        </span>
      </div>
      <div className={s.hudBR}>
        <span className={s.chip} style={{ minWidth: "6ch" }} data-tone={rate === 0 ? "dim" : "acc"} data-testid="hud-rate">
          {rate === 0 ? "❚❚" : rate > 0 ? `▶ ${rate}×` : `◀ ${-rate}×`}
        </span>
        <span className={s.chip} style={{ minWidth: "11ch" }} data-tone="dim">
          {f ? `${f.fps.toFixed(2)} fps` : ""}
        </span>
        <span className={s.chip} style={{ minWidth: "14ch" }} data-tone="dim" data-testid="hud-xfer">
          xfer {f?.xferMs != null ? `${f.xferMs.toFixed(0)}ms` : "—"}
        </span>
      </div>
    </div>
  );
}

/**
 * One line, bottom-centre, saying what the picture is and the one key that gets real footage. Over proxy film it
 * names why there is no NBA clip; in film view it says how pinning works; on real film it says how many plays are
 * pinned. Never more than one sentence and one key.
 */
function FilmNotice() {
  const app = useApp();
  const st = useAppState();
  const f = useFrame();
  const row = app.row;
  if (row < 0 || !f?.kind) return null;
  const g = app.gameOfRow(row);
  const film = app.films.get(g.id);
  const official = app.catalog.get(g.id);
  let text: React.ReactNode = null;
  if (st.filmView) {
    text = (
      <>
        Film view · find this play&apos;s release, <span className="kbd">S</span> pins it and moves to the next · <span className="kbd">F</span> back to clips
      </>
    );
  } else if (f.kind === "proxy") {
    if (film)
      text = (
        <>
          {film.mode === "cut" ? "This play isn't pinned to the film yet" : "Film attached but not synced"} · <span className="kbd">F</span> film view, then <span className="kbd">S</span> at the release
        </>
      );
    else if (official)
      text = (
        <>
          Official NBA film covers this game · <span className="kbd">F</span> to watch and pin plays
        </>
      );
    else
      text = (
        <>
          NBA stopped serving play clips in Oct 2026 · paste a film link in <span className="kbd">⌘K</span>, drop a recording, or <span className="kbd">W</span> NBA.com
        </>
      );
  }
  void st.films;
  if (!text) return null;
  return (
    <div className={s.notice} data-testid="film-notice">
      {text}
    </div>
  );
}

interface Tick {
  rel: number;
  label: string;
  inPoss: boolean;
}

/** Every event whose wall-clock time falls in the clip window (subs and period markers aside). */
function useWindowEvents(detail: GameDetail | undefined, row: number, from: number, to: number): Tick[] {
  const app = useApp();
  return useMemo(() => {
    if (!detail || row < 0) return [];
    const poss = app.store.p.poss[row];
    const wall = app.store.p.wall[row];
    const out: Tick[] = [];
    for (let i = 0; i < detail.n.length; i++) {
      const rel = (detail.wall[i] - wall) / 10;
      if (rel < from - 0.5 || rel > to) continue;
      const t = detail.types[detail.type[i]];
      if (t.startsWith("substitution") || t.startsWith("period") || t.startsWith("game")) continue;
      out.push({ rel, label: detail.desc[i], inPoss: detail.poss[i] === poss });
    }
    return out;
  }, [detail, row, app, from, to]);
}

function Telemetry() {
  const app = useApp();
  const st = useAppState();
  const f = useFrame();
  const row = app.row;
  const g = row >= 0 ? app.store.meta.games[app.store.p.game[row]] : null;
  const detail = g ? app.details.get(g.id) : undefined;
  void st.details;
  const ticks = useWindowEvents(detail, row, -st.pre, st.post);
  if (row < 0 || !f || !f.kind) return null;
  // Over real film the telemetry shrinks to a corner court; over proxy film it is the picture.
  const proxy = f.kind === "proxy";
  const info = playInfo(app, row);
  const x = app.store.p.x[row];
  const y = app.store.p.y[row];
  const shown = f.sec >= -0.05;
  const isShot = info.kind === "fga";
  if (!proxy) {
    return (
      <div key="corner" style={{ position: "absolute", right: 8, bottom: 36, width: 160, height: 150, zIndex: 3, opacity: 0.9 }}>
        <svg viewBox="-260 -60 520 300" style={{ width: "100%", height: "100%", background: "rgba(9,10,12,.7)", border: "1px solid var(--hair-2)", borderRadius: 3 }}>
          <CourtLines sw={3} />
          {isShot && <circle cx={x} cy={y} r={11} fill={info.made ? OUTCOME_VAR.make : "none"} stroke={OUTCOME_VAR[info.outcome]} strokeWidth={4} />}
        </svg>
      </div>
    );
  }
  return (
    <div key="full" className={s.telemetry}>
      <div className={s.teleCourt}>
        <div className={s.teleHead}>
          <span>
            {tri(info.off)} <span className="faint">▸</span> {tri(info.def)}
          </span>
          <span>
            {info.period} {info.clock}
          </span>
          <span className="dim">
            margin {info.margin > 0 ? "+" : ""}
            {info.margin}
          </span>
          <span style={{ color: OUTCOME_VAR[info.outcome] }}>{info.actor?.short ?? tri(info.off)} · {info.what}</span>
        </div>
        <svg viewBox="-262 -58 524 360" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="fr-fade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0.72" stopColor="#000" stopOpacity="0" />
              <stop offset="1" stopColor="#000" stopOpacity="1" />
            </linearGradient>
          </defs>
          <CourtLines />
          <rect x={-262} y={-58} width={524} height={360} fill="url(#fr-fade)" />
          {isShot && (
            <g style={{ transition: "opacity 120ms", opacity: shown ? 1 : 0.22 }}>
              <line x1={0} y1={0} x2={x} y2={y} stroke="#3a4048" strokeDasharray="4 6" strokeWidth={1.5} />
              <circle cx={x} cy={y} r={9} fill={info.made ? OUTCOME_VAR.make : "#090A0C"} stroke={OUTCOME_VAR[info.outcome]} strokeWidth={3} />
              {shown && f.sec < 1.2 && <circle cx={x} cy={y} r={9 + f.sec * 26} fill="none" stroke={OUTCOME_VAR[info.outcome]} strokeWidth={1.5} opacity={Math.max(0, 1 - f.sec / 1.2)} />}
            </g>
          )}
        </svg>
        {isShot && (
          <div className={s.teleFoot}>
            {info.zoneLabel} · {app.store.p.dist[row]}′ · ({x}, {y})
          </div>
        )}
      </div>
      <div className={s.ticker}>
        <span className="label" style={{ marginBottom: 4 }}>
          Events · wall-clock from t₀
        </span>
        {!detail && <span className="faint mono">loading events…</span>}
        {ticks.map((t, i) => {
          const next = ticks[i + 1];
          const state = f.sec < t.rel - 0.05 ? "future" : next && f.sec >= next.rel - 0.05 ? "past" : "now";
          return (
            <div key={i} className={s.tick} data-state={state} data-out={!t.inPoss}>
              <span>{fmtSec(t.rel, 1)}</span>
              <span>{t.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
