import React, { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import s from "./filmroom.module.css";
import { OUTCOME_VAR, playInfo, tri, useApp, useAppState } from "./shared";
import { tagSummary } from "../../lib/filmroom/tags/ontology";

const ROW = 20;

export function Tape() {
  const app = useApp();
  const st = useAppState();
  const scroller = useRef<HTMLDivElement>(null);
  const rows = st.result?.rows;
  const n = rows?.length ?? 0;
  const v = useVirtualizer({ count: n, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 20, paddingStart: 24 });
  useEffect(() => {
    if (n) v.scrollToIndex(st.cursor, { align: "auto" });
  }, [st.cursor, n, v]);
  const { p, floor, meta } = app.store;
  const roster = app.roster;
  const focus = meta.focusTeam;
  return (
    <div ref={scroller} className={s.tape} data-testid="tape">
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        <div className={s.thead}>
          <span>#</span>
          <span>Date</span>
          <span>Opp</span>
          <span>Q</span>
          <span>Clock</span>
          <span>Off</span>
          <span>Mrg</span>
          <span>Player</span>
          <span>Play</span>
          <span>Zone</span>
          <span>x,y</span>
          <span>Res</span>
          <span title={roster.map((id) => meta.players[id].name).join(" · ")}>{tri(focus)} floor</span>
          <span>Tags</span>
        </div>
        {v.getVirtualItems().map((it) => {
          const row = rows![it.index];
          const info = playInfo(app, row);
          const prev = it.index > 0 ? rows![it.index - 1] : -1;
          const brk = prev >= 0 && p.game[prev] !== p.game[row];
          const side = p.off[row] === focus ? 0 : 5;
          const five = floor.subarray(row * 10 + side, row * 10 + side + 5);
          const bits = roster.map((id) => (five.includes(id) ? "1" : "0")).join("");
          const tags = st.overlays & 4 ? app.tagsForRow(row) : [];
          const opp = info.g.home === focus ? info.g.away : info.g.home;
          return (
            <div key={it.key} className={s.trow} data-on={it.index === st.cursor} data-break={brk} style={{ top: it.start, height: ROW }} onClick={() => app.goto(it.index)}>
              <span className="faint">{it.index + 1}</span>
              <span>{info.g.date.slice(2)}</span>
              <span>
                {info.g.home === focus ? "v" : "@"}
                {tri(opp)}
              </span>
              <span>{info.period}</span>
              <span>{info.clock}</span>
              <span className="faint">{tri(info.off)}</span>
              <span>{info.margin > 0 ? `+${info.margin}` : info.margin}</span>
              <span style={{ color: "var(--text)" }}>{info.actor?.short ?? "team"}</span>
              <span>
                {info.what}
                {info.assist?.short ? <span className="faint"> · ast {info.assist.short}</span> : null}
              </span>
              <span>{info.zone ?? ""}</span>
              <span className="faint">{info.kind === "fga" ? `${p.x[row]},${p.y[row]}` : ""}</span>
              <span style={{ color: OUTCOME_VAR[info.outcome] }}>{info.outcome === "make" ? "●" : info.outcome === "miss" ? "○" : info.outcome === "tov" ? "■" : "FT"}</span>
              <span className={s.bits}>
                {bits.split("").map((b, i) => (b === "1" ? <b key={i}>1</b> : <i key={i}>0</i>))}
              </span>
              <span className="acc">{tags.map(tagSummary).join(" | ")}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
