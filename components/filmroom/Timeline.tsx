import React, { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import s from "./filmroom.module.css";
import { OUTCOME_GLYPH, OUTCOME_VAR, actionColor, playInfo, tri, useApp, useAppState } from "./shared";
import { tagSummary } from "../../lib/filmroom/tags/ontology";

const CELL = 96;

export function Timeline() {
  return (
    <div className={s.nle} data-testid="timeline">
      <div className={s.trackLabel}>t − t₀</div>
      <ClipTracks />
      <div className={s.trackLabel} style={{ gridRow: 4, borderBottom: 0 }}>
        Reel
      </div>
      <ReelStrip />
    </div>
  );
}

/** Ruler + events + tags for the current clip, sharing one horizontal scale and one playhead. */
function ClipTracks() {
  const app = useApp();
  const st = useAppState();
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const row = app.row;
  const from = -st.pre;
  const to = st.post;
  const span = to - from;
  const xOf = (t: number) => ((t - from) / span) * width;

  // Playhead: direct transform writes from the frame channel, no React render per frame.
  useEffect(
    () =>
      app.subscribeFrame((f) => {
        if (head.current) head.current.style.transform = `translateX(${Math.max(0, Math.min(width, ((f.sec - from) / span) * width))}px)`;
      }),
    [app, width, from, span],
  );

  const g = row >= 0 ? app.store.meta.games[app.store.p.game[row]] : null;
  const detail = g ? app.details.get(g.id) : undefined;
  void st.details;
  const events = useMemo(() => {
    if (!detail || row < 0) return [];
    const poss = app.store.p.poss[row];
    const wall = app.store.p.wall[row];
    const out: { t: number; k: string; label: string }[] = [];
    for (let i = 0; i < detail.n.length; i++) {
      const rel = (detail.wall[i] - wall) / 10;
      if (rel < from || rel > to) continue;
      const type = detail.types[detail.type[i]];
      if (detail.poss[i] !== poss && !type.startsWith("substitution") && !type.startsWith("timeout")) continue;
      const d = detail.desc[i];
      const k = /^(2pt|3pt)/.test(type) ? (/MISS/.test(d) ? "miss" : "make") : type.startsWith("turnover") ? "tov" : type.startsWith("foul") ? "foul" : type.startsWith("substitution") ? "sub" : type.startsWith("freethrow") ? (/MISS/.test(d) ? "miss" : "make") : "other";
      const short = type.split("/")[0].replace("2pt", "2PT").replace("3pt", "3PT").replace("freethrow", "FT").replace("rebound", "REB").replace("turnover", "TOV").replace("substitution", "SUB").replace("timeout", "TO").replace("foul", "PF").replace("steal", "STL").replace("block", "BLK");
      out.push({ t: rel, k, label: short });
    }
    return out;
  }, [detail, row, app, from, to]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = Math.ceil(from); t <= Math.floor(to); t++) out.push(t);
    return out;
  }, [from, to]);

  const tags = st.overlays & 4 ? app.tagsForRow(row) : [];
  const m = st.marks;
  const info = row >= 0 ? playInfo(app, row) : null;

  return (
    <div ref={box} style={{ gridColumn: 2, gridRow: "1 / span 3", position: "relative" }}>
      <div className={`${s.track} ${s.ruler}`} style={{ height: 20 }}>
        {ticks.map((t) => (
          <span key={t} style={{ left: xOf(t) }} data-t0={t === 0}>
            {t === 0 ? "t₀" : t > 0 ? `+${t}` : `${t}`}
          </span>
        ))}
      </div>
      <div className={s.track} style={{ height: 28 }}>
        {events.map((e, i) => (
          <div key={i} className={s.evt} data-k={e.k} style={{ left: xOf(e.t) }} title={`${e.label} ${e.t.toFixed(1)}s`}>
            <i />
            {e.label}
          </div>
        ))}
        {info && !events.length && (
          <div className={s.evt} data-k={info.outcome} style={{ left: xOf(0) }}>
            <i />
            t₀
          </div>
        )}
      </div>
      <div className={s.track} style={{ height: 24 }}>
        {tags.map((t, i) => (
          <div
            key={t.id}
            className={s.span}
            data-src={t.source}
            style={{ left: xOf(t.tIn), width: Math.max(4, xOf(t.tOut) - xOf(t.tIn)), background: actionColor(t.act), top: 4 + (i % 2) * 2 }}
            title={tagSummary(t)}
          >
            {tagSummary(t)}
          </div>
        ))}
        {(m.in !== null || m.out !== null) && (
          <div className={s.mark} style={{ left: xOf(m.in ?? from), width: Math.max(2, xOf(m.out ?? (m.in !== null ? Math.max(m.in, 0) : to)) - xOf(m.in ?? from)) }} />
        )}
      </div>
      <div ref={head} className={s.playhead} style={{ height: 72 }} />
    </div>
  );
}

function ReelStrip() {
  const app = useApp();
  const st = useAppState();
  const scroller = useRef<HTMLDivElement>(null);
  const rows = st.result?.rows;
  const n = rows?.length ?? 0;
  const v = useVirtualizer({
    count: n,
    horizontal: true,
    getScrollElement: () => scroller.current,
    estimateSize: () => CELL,
    overscan: 8,
  });
  useEffect(() => {
    if (n) v.scrollToIndex(st.cursor, { align: "center" });
  }, [st.cursor, n, v]);
  const p = app.store.p;
  return (
    <div ref={scroller} className={s.reel} style={{ gridColumn: 2, gridRow: 4 }} data-testid="reel">
      <div style={{ width: v.getTotalSize(), height: "100%", position: "relative" }}>
        {v.getVirtualItems().map((it) => {
          const row = rows![it.index];
          const info = playInfo(app, row);
          const prev = it.index > 0 ? rows![it.index - 1] : -1;
          const gameBreak = prev < 0 || p.game[prev] !== p.game[row];
          const qBreak = !gameBreak && p.period[prev] !== p.period[row];
          const hasTag = st.overlays & 4 && app.tagsForRow(row).length > 0;
          return (
            <React.Fragment key={it.key}>
              {(gameBreak || qBreak) && (
                <>
                  <div className={s.breakLine} style={{ left: it.start - 2, background: gameBreak ? "var(--hair-2)" : "var(--hair)" }} />
                  {gameBreak && (
                    <div className={s.breakLabel} style={{ left: it.start + 2 }}>
                      {info.g.date.slice(5)} {info.g.home === app.store.meta.focusTeam ? "v" : "@"} {tri(info.g.home === app.store.meta.focusTeam ? info.g.away : info.g.home)}
                    </div>
                  )}
                </>
              )}
              <div
                className={s.cell}
                data-on={it.index === st.cursor}
                style={{ left: it.start + 2, ["--o" as string]: OUTCOME_VAR[info.outcome] }}
                onClick={() => app.goto(it.index)}
              >
                <div>
                  <span style={{ color: OUTCOME_VAR[info.outcome] }} title={info.outcome}>
                    {OUTCOME_GLYPH[info.outcome]}
                  </span>{" "}
                  <b>
                    {info.period} {info.clock}
                  </b>
                  {hasTag ? <span className="acc"> ◆</span> : null}
                </div>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{info.actor?.last ?? "team"}</div>
                <div className="faint" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {info.kind === "fga" ? `${p.value[row]}PT ${info.zone?.replace(/_/g, " ") ?? ""}` : info.what}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}


function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = React.useState(800);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}
