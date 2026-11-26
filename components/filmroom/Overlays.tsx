import React from "react";
import s from "./filmroom.module.css";
import { useApp } from "./shared";
import { FIELDS } from "../../lib/filmroom/engine/query";

const KEYS: [string, [string, string][]][] = [
  [
    "Film",
    [
      ["Space", "play / pause"],
      ["J K L", "shuttle back · stop · forward (press again: 2× 4× 8×)"],
      [", .", "step one frame"],
      ["< >", "step ten frames"],
      ["0", "jump to t₀ (release / whistle)"],
      ["⏎", "replay clip from pre-roll"],
      ["[ ]", "previous / next clip"],
      ["{ }", "previous / next game in reel"],
      ["Home End", "first / last clip"],
      ["⇧A", "re-anchor t₀ to this frame"],
      ["⇧O", "open full-game film for this game"],
    ],
  ],
  [
    "Tagging",
    [
      ["I O", "mark window in / out"],
      ["X", "clear marks"],
      ["T", "chord: action › coverage › closeouts › closeout › contest › read"],
      ["a–z 1–9", "pick in chord (mnemonic or position)"],
      ["Space", "skip dimension"],
      ["⏎", "stamp now"],
      ["⇧T", "repeat last stamp on this clip"],
      ["U ⌘Z", "undo last stamp"],
      ["⇧⌫", "delete my tag under playhead"],
    ],
  ],
  [
    "Workbench",
    [
      ["/", "edit query"],
      ["⌘K", "command palette"],
      ["G", "switch game (slate)"],
      ["V ⇧V", "timeline · tape · shot map"],
      ["H", "toggle HUD"],
      ["M", "toggle telemetry overlay"],
      ["Y", "copy link (query · play · frame)"],
      ["?", "this sheet"],
    ],
  ],
];

export function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className={s.scrim} onMouseDown={onClose} data-testid="help">
      <div className={s.help} onMouseDown={(e) => e.stopPropagation()}>
        <div className={s.helpTitle}>Keys</div>
        <div className={s.helpCols}>
          {KEYS.map(([title, rows]) => (
            <div key={title}>
              <h4 className="label">{title}</h4>
              {rows.map(([k, v]) => (
                <div key={k + v} className={s.helpRow}>
                  <span>
                    {k.split(" ").map((x) => (
                      <span key={x} className="kbd">
                        {x}
                      </span>
                    ))}
                  </span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="label" style={{ margin: "20px 0 8px" }}>
          Query fields
        </div>
        <div className={s.helpCols}>
          {FIELDS.map((f) => (
            <div key={f.name} className={s.helpRow} style={{ gridTemplateColumns: "88px 1fr" }}>
              <span className="mono acc">{f.name}</span>
              <span>
                {f.doc} <span className="mono faint">{f.example}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="faint" style={{ marginTop: 16 }}>
          Terms juxtaposed are AND; <span className="mono">OR</span> / <span className="mono">|</span> join; <span className="mono">-</span> negates; parentheses group;
          commas OR values within a field. Tactical terms in one AND bind to the same tag window.
        </div>
      </div>
    </div>
  );
}

export function IntegrityReport({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const meta = app.store.meta;
  return (
    <div className={s.scrim} onMouseDown={onClose} data-testid="report">
      <div className={s.report} onMouseDown={(e) => e.stopPropagation()}>
        <div className={s.helpTitle}>Reconciliation</div>
        <div className="dim" style={{ marginBottom: 12, maxWidth: 720 }}>
          Every count the parser derives is recounted and compared with sources that never went through it: the official box score
          (boxscoretraditionalv3), the stats.nba.com shot chart, the feed&apos;s final score. Required checks form the accounting invariant;
          supplementary ones are reported. {meta.totals.corrections} feed corrections were applied where playbyplayv3 and the shot chart
          outvoted the cdn snapshot, or box minutes pinned a mislogged substitution.
        </div>
        <div className={s.repRow} style={{ color: "var(--faint)", fontFamily: "var(--sans)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          <span />
          <span>Check</span>
          <span>Source</span>
          <span style={{ textAlign: "right" }}>Checked</span>
          <span style={{ textAlign: "right" }}>Mismatch</span>
        </div>
        {meta.checks.map((c) => (
          <div key={c.name} className={s.repRow}>
            <span className={c.mismatches === 0 ? "make" : c.required ? "miss" : "dim"}>{c.mismatches === 0 ? "✓" : c.required ? "✗" : "·"}</span>
            <span style={{ fontFamily: "var(--sans)" }}>
              {c.name}
              {!c.required && <span className="faint"> (supplementary)</span>}
            </span>
            <span className="dim">{c.source}</span>
            <span style={{ textAlign: "right" }}>{c.checked.toLocaleString()}</span>
            <span style={{ textAlign: "right" }} className={c.mismatches ? "dim" : "make"}>
              {c.mismatches}
            </span>
          </div>
        ))}
        <div className="faint" style={{ marginTop: 12, maxWidth: 720 }}>
          Plus-minus residuals: technical free throws around substitutions, where the NBA&apos;s own box credits the foul-time floor in some
          games and the free-throw-time floor in others. (x, y) residuals: the shot chart reports a placeholder (±223, 2) for some corner
          threes the cdn feed locates. pbpstats omits possessions that begin in a period&apos;s final seconds; the residual is jump-ball and
          away-from-play sequencing.
        </div>
        <div className="faint mono" style={{ marginTop: 12, fontSize: 10 }}>
          {meta.games.length} games · {meta.totals.events.toLocaleString()} events · {meta.totals.possessions.toLocaleString()} possessions ·{" "}
          {meta.totals.plays.toLocaleString()} plays · built {meta.generated.slice(0, 10)} · Esc to close
        </div>
      </div>
    </div>
  );
}
