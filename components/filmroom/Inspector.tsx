import React from "react";
import s from "./filmroom.module.css";
import { OUTCOME_VAR, actionColor, playInfo, tri, useApp, useAppState } from "./shared";
import { TEAMS } from "../../lib/filmroom/core/teams";
import { END_TYPES, START_TYPES } from "../../lib/filmroom/core/format";
import { fmtClock } from "../../lib/filmroom/engine/store";
import { DIMS, tagSummary } from "../../lib/filmroom/tags/ontology";
import { STEP_LIST } from "../../lib/filmroom/keys/machine";

export function Inspector() {
  const app = useApp();
  const st = useAppState();
  const row = app.row;
  if (row < 0) return <aside className={s.insp} />;
  const { p, s: poss, meta, floor } = app.store;
  const info = playInfo(app, row);
  const g = info.g;
  const home = TEAMS[g.home];
  const away = TEAMS[g.away];
  const pi = p.poss[row];
  const detail = app.details.get(g.id);
  void st.details;
  const descIdx = detail ? detail.n.indexOf(p.action[row]) : -1;
  const desc = descIdx >= 0 ? detail!.desc[descIdx] : info.what;
  const score = descIdx >= 0 ? `${detail!.sa[descIdx]}–${detail!.sh[descIdx]}` : "";
  const tags = app.tagsForRow(row);
  const offFive = Array.from(floor.subarray(row * 10, row * 10 + 5));
  const defFive = Array.from(floor.subarray(row * 10 + 5, row * 10 + 10));
  const focusOnOff = p.off[row] === meta.focusTeam;
  const focusFive = focusOnOff ? offFive : defFive;
  const roster = app.roster;
  const bits = roster.map((id) => (focusFive.includes(id) ? 1 : 0));
  const possStart = START_TYPES[poss.startType[pi]] ?? "";
  const possEnd = END_TYPES[poss.endType[pi]] ?? "";
  const dur = (poss.start[pi] - poss.end[pi]) / 10;
  const actor = p.actor[row];
  const assist = p.assist[row];

  return (
    <aside className={s.insp} data-testid="inspector">
      {st.chordStep && <ChordHud />}
      <section className={s.sec}>
        <div className={s.matchup}>
          {away.name} <em>at</em> {home.name}
        </div>
        <div className="mono dim" style={{ marginTop: 4, fontSize: 11 }}>
          {g.date} · {tri(g.away)} {g.awayScore} – {g.homeScore} {tri(g.home)} · {g.id.padStart(10, "0")}
        </div>
      </section>

      <section className={s.sec}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span className={s.big}>
            {info.period} {info.clock}
          </span>
          <span className="mono dim">{score}</span>
          <span className="mono" style={{ marginLeft: "auto", color: OUTCOME_VAR[info.outcome] }}>
            {info.outcome.toUpperCase()}
          </span>
        </div>
        <div className={s.desc}>{desc}</div>
        <div className={s.kv}>
          <span>Offense</span>
          <span className="mono">
            {tri(info.off)} <span className="faint">margin</span> {info.margin > 0 ? "+" : ""}
            {info.margin}
          </span>
          {info.kind === "fga" && (
            <>
              <span>Shot</span>
              <span className="mono">
                {info.zone} <span className="faint">·</span> ({p.x[row]}, {p.y[row]}) <span className="faint">·</span> {p.dist[row]}′
              </span>
            </>
          )}
          <span>Event</span>
          <span className="mono">
            #{p.action[row]} <span className="faint">· {(p.possSec[row] / 10).toFixed(1)}s into poss</span>
          </span>
        </div>
      </section>

      <section className={s.sec}>
        <span className="label">Possession {pi - g.firstPoss + 1}</span>
        <div className={s.kv} style={{ marginTop: 4 }}>
          <span>Span</span>
          <span className="mono">
            {fmtClock(poss.start[pi])} → {fmtClock(poss.end[pi])} <span className="faint">({dur.toFixed(1)}s)</span>
          </span>
          <span>Start/end</span>
          <span className="mono">
            {possStart.replace(/_/g, " ")} → {possEnd.replace(/_/g, " ")}
          </span>
          <span>Points</span>
          <span className="mono">
            {poss.points[pi]} <span className="faint">· {poss.playCount[pi]} plays</span>
          </span>
        </div>
      </section>

      <section className={s.sec}>
        <span className="label">Floor · 10-man, verified</span>
        <div className={s.floor}>
          <span className="faint mono">{tri(p.off[row])}</span>
          <Five ids={offFive} actor={actor} assist={assist} />
          <span className="faint mono">{tri(p.def[row])}</span>
          <Five ids={defFive} actor={0} assist={0} />
        </div>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "28px 1fr", gap: 8, alignItems: "center" }}>
          <span className="faint mono" style={{ fontSize: 10 }}>
            {tri(meta.focusTeam)}
          </span>
          <span className={s.bits} title={roster.map((id, i) => `${bits[i]} ${meta.players[id].short}`).join("\n")} data-testid="lineup-bits">
            {bits.map((b, i) => (b ? <b key={i}>1</b> : <i key={i}>0</i>))}
            <span className="faint" style={{ marginLeft: 8, letterSpacing: 0, fontFamily: "var(--sans)", fontSize: 10 }}>
              {roster.map((id) => meta.players[id].last.slice(0, 2)).join(" ")}
            </span>
          </span>
        </div>
      </section>

      <section className={s.sec}>
        <span className="label">Tactical tags · {tags.length}</span>
        {tags.length === 0 && (
          <div className="faint" style={{ marginTop: 4 }}>
            <span className="kbd">T</span> to stamp · <span className="kbd">I</span>/<span className="kbd">O</span> mark the window first
          </div>
        )}
        {tags.map((t) => (
          <div key={t.id} className={s.tagRow}>
            <span className={s.swatch} style={{ background: actionColor(t.act) }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {tagSummary(t)} <span className="faint">
                [{t.tIn.toFixed(2)}, {t.tOut.toFixed(2)}]
              </span>
            </span>
            <span className={s.badge} data-tone={t.source}>
              {t.source}
            </span>
          </div>
        ))}
        {tags.some((t) => t.source === "fixture") && (
          <div className="faint" style={{ marginTop: 8, fontSize: 11 }}>
            Fixture tags exercise the query engine; this season&apos;s clips are retired, so they are not film-verified reads.
          </div>
        )}
      </section>

      <section className={s.sec} style={{ borderBottom: 0 }}>
        <span className="label">Integrity · {g.id}</span>
        <div className="mono" style={{ marginTop: 4, fontSize: 11 }} title="bits, high to low: possessions · floor · score · chart · minutes · box">
          <span className={g.integrity === 0b111111 ? "make" : "miss"}>{g.integrity.toString(2).padStart(6, "0")}</span>
          <span className="faint"> poss·floor·score·chart·min·box</span>
          {g.corrections > 0 && <span className="dim"> · {g.corrections} feed corrections</span>}
        </div>
      </section>
    </aside>
  );
}

function Five({ ids, actor, assist }: { ids: number[]; actor: number; assist: number }) {
  const app = useApp();
  return (
    <span className={s.five}>
      {ids.map((id) => (
        <span key={id} data-me={id === actor} data-ast={id === assist}>
          {app.store.meta.players[id]?.short ?? "?"}
        </span>
      ))}
    </span>
  );
}

function ChordHud() {
  const st = useAppState();
  const step = st.chordStep;
  const idx = STEP_LIST.indexOf(step as never);
  const dim = DIMS[idx];
  return (
    <div className={s.chord} data-testid="chord">
      <div className={s.chordSteps}>
        {DIMS.map((d, i) => (
          <span key={d.key} data-state={i < idx ? "done" : i === idx ? "now" : "todo"}>
            {d.label}
            {st.draft[d.key as keyof typeof st.draft] ? `:${st.draft[d.key as keyof typeof st.draft]}` : ""}
          </span>
        ))}
      </div>
      {dim && (
        <div className={s.chordGrid}>
          {dim.values.map((v, i) => (
            <div key={v}>
              <span className="kbd">{dim.key === "co" ? v : dim.keys[i]}</span>
              <span className="faint mono" style={{ width: 10 }}>
                {dim.key === "co" ? "" : i < 9 ? i + 1 : ""}
              </span>
              <span>{dim.names[v as never]}</span>
            </div>
          ))}
        </div>
      )}
      <div className="faint" style={{ marginTop: 8, fontSize: 11 }}>
        <span className="kbd">Space</span> skip · <span className="kbd">⌫</span> back · <span className="kbd">⏎</span> stamp · <span className="kbd">Esc</span> cancel
      </div>
    </div>
  );
}
