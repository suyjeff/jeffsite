import React from "react";
import s from "./filmroom.module.css";
import { useApp, useAppState, useFrame } from "./shared";
import { DIMS } from "../../lib/filmroom/tags/ontology";

const HINTS: Record<string, [string, string][]> = {
  browse: [
    ["/", "query"],
    ["⌘K", "palette"],
    ["J K L", "shuttle"],
    [", .", "frame"],
    ["[ ]", "clip"],
    ["I O", "mark"],
    ["T", "tag"],
    ["V", "view"],
    ["Y", "copy link"],
    ["?", "keys"],
  ],
  query: [
    ["Tab", "complete"],
    ["⏎", "apply"],
    ["Esc", "film"],
  ],
  palette: [
    ["↑↓", "choose"],
    ["⏎", "run"],
    ["Esc", "close"],
  ],
  help: [["Esc", "close"]],
};

export function StatusBar() {
  const app = useApp();
  const st = useAppState();
  const f = useFrame();
  const mode = st.mode;
  const step = st.chordStep;
  const dim = step ? DIMS.find((d) => d.key === step) : null;
  const hints = step ? [["letter/1-9", dim?.label.toLowerCase() ?? ""], ["Space", "skip"], ["⌫", "back"], ["⏎", "stamp"], ["Esc", "cancel"]] : HINTS[mode] ?? HINTS.browse;
  const games = app.store?.meta.games ?? [];
  const ok = games.filter((g) => g.integrity === 0b111111).length;
  return (
    <div className={s.status} data-testid="status">
      <span className={s.mode} data-mode={step ? "chord" : mode} data-testid="mode">
        {step ? `CHORD › ${dim?.label.toUpperCase()}` : mode.toUpperCase()}
      </span>
      <span className={s.hints}>
        {hints.map(([k, v]) => (
          <span key={k + v}>
            <span className="kbd">{k}</span>
            {v}
          </span>
        ))}
      </span>
      <span className={s.metrics}>
        <span className="acc" style={{ width: "16ch" }}>
          {st.marks.in !== null || st.marks.out !== null ? `[${st.marks.in?.toFixed(2) ?? "…"}, ${st.marks.out?.toFixed(2) ?? "…"}]` : ""}
        </span>
        <span style={{ width: "14ch" }}>
          filter <b data-testid="filter-ms">{st.result?.ms.toFixed(2) ?? "—"}ms</b>
        </span>
        <span style={{ width: "11ch" }}>
          xfer <b>{f?.xferMs != null ? `${f.xferMs.toFixed(0)}ms` : "—"}</b>
        </span>
        <span style={{ width: "11ch" }}>
          frame <b style={{ color: f?.exact ? "var(--text)" : undefined }} title={f?.exact ? "presented frame (rVFC)" : "estimated from currentTime"}>
            {f ? f.frame : "—"}
          </b>
        </span>
        <span style={{ width: "15ch" }} title="games passing every required reconciliation check">
          integrity{" "}
          <b className={ok === games.length ? "make" : "miss"}>
            {ok}/{games.length}
          </b>
        </span>
        <span style={{ width: "13ch" }}>
          tags <b>{st.tags.length}</b>
          {st.showFixture && app.fixture ? <span className="faint">+{app.fixture.tags.length}fx</span> : null}
        </span>
        <span style={{ width: "12ch" }}>
          roll <b>
            −{st.pre}/+{st.post}s
          </b>
        </span>
      </span>
    </div>
  );
}
