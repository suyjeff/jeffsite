import React, { useEffect, useMemo, useRef, useState } from "react";
import s from "./filmroom.module.css";
import { tri, useApp, useAppState } from "./shared";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

const SAVED: [string, string][] = [
  ["Acceptance: 10-constraint golden query", ""],
  ["Curry catch-and-shoot threes off Draymond", "shooter:curry shot:3pt ast:green result:make"],
  ["Clutch: last 2:00, within 5, GSW offense", "side:off q:4 clock:<2:00 margin:-5..5 type:fga"],
  ["Opponent corner threes vs GSW", "side:def shot:3pt zone:corner_3"],
  ["Draymond-less minutes, GSW defense at the rim", "side:def lineup:-green zone:restricted_area"],
  ["Live-ball turnovers that became fast breaks", "side:off fastbreak:true fromtov:true"],
  ["Second-chance threes", "second:true shot:3pt side:off"],
  ["Podziemski + Kuminga lineups, paint attempts", "lineup:+podziemski,+kuminga side:off paint:true"],
  ["Pullup threes from the top of the arc", "shot:pullup zone:top_arc_3"],
  ["Anything I have tagged", "tagged:true"],
];

export function Palette({ seed, onClose, onCommand, onQuery }: { seed: string; onClose: () => void; onCommand: (id: string) => void; onQuery: () => void }) {
  const app = useApp();
  const st = useAppState();
  const [q, setQ] = useState(seed);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const items: Item[] = useMemo(() => {
    const focus = app.store.meta.focusTeam;
    const list: Item[] = [];
    const runQ = (query: string) => () => {
      app.runQuery(query, { keepCursor: false });
      onQuery();
    };
    SAVED.forEach(([label, query]) => {
      const qq = query || app.fixture?.query || "";
      list.push({ id: `q:${label}`, group: "Queries", label, hint: qq, run: runQ(qq) });
    });
    const cmds: [string, string, string][] = [
      ["help", "Keyboard map", "?"],
      ["report", "Integrity report · reconciliation vs official box scores", ""],
      ["copy", "Copy shareable link (query · play · frame · view)", "Y"],
      ["view:tl", "View: NLE timeline", "V"],
      ["view:tape", "View: PBP tape", "V"],
      ["view:map", "View: shot map", "V"],
      ["film", "Open game film for this game… (then Shift+A at t₀ to sync)", "⇧O"],
      ["export", "Export my tags (JSON)", ""],
      ["import", "Import tags (JSON)", ""],
      ["fixture", `${st.showFixture ? "Hide" : "Show"} golden fixture tags`, ""],
      ["pre+", `Pre-roll +1s (now ${st.pre}s)`, ""],
      ["pre-", `Pre-roll −1s (now ${st.pre}s)`, ""],
      ["post+", `Post-roll +1s (now ${st.post}s)`, ""],
      ["post-", `Post-roll −1s (now ${st.post}s)`, ""],
      ["clear-tags", "Delete all my tags", ""],
    ];
    for (const [id, label, hint] of cmds) list.push({ id, group: "Commands", label, hint, run: () => onCommand(id) });
    // Slate: every game, switchable by date, opponent or score.
    app.store.meta.games.forEach((g) => {
      const opp = g.home === focus ? g.away : g.home;
      const home = g.home === focus;
      const gsw = home ? g.homeScore : g.awayScore;
      const them = home ? g.awayScore : g.homeScore;
      const label = `game ${g.date} ${home ? "vs" : "@"} ${tri(opp)}  ${gsw > them ? "W" : "L"} ${gsw}–${them}`;
      list.push({
        id: `g:${g.id}`,
        group: "Slate",
        label,
        hint: `${g.playCount} plays`,
        run: () => {
          const base = app.state.query.replace(/\s*-?(game|g|date):\S+/g, "").trim();
          runQ(`${base} game:${g.date}`.trim())();
        },
      });
    });
    return list;
  }, [app, st.showFixture, st.pre, st.post, onCommand, onQuery]);

  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const gameMode = words[0] === "game" || words[0] === "g";
    return items.filter((it) => {
      if (gameMode && it.group !== "Slate") return false;
      const hay = `${it.label} ${it.hint ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [q, items]);

  useEffect(() => setSel(0), [q]);
  const visible = filtered.slice(Math.max(0, sel - 10), Math.max(0, sel - 10) + 14);
  const offset = Math.max(0, sel - 10);

  return (
    <div className={s.scrim} onMouseDown={onClose} data-testid="palette">
      <div className={s.palette} onMouseDown={(e) => e.stopPropagation()}>
        <div className={s.palInput}>
          <span className="acc mono">⌘K</span>
          <input
            ref={input}
            value={q}
            spellCheck={false}
            placeholder="query, command, or game date/opponent…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((v) => Math.min(filtered.length - 1, v + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((v) => Math.max(0, v - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const it = filtered[sel];
                if (it) it.run();
                else if (q.includes(":")) {
                  app.runQuery(q, { keepCursor: false });
                  onQuery();
                }
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <span className="mono faint" style={{ fontSize: 10 }}>
            {filtered.length}
          </span>
        </div>
        <div className={s.palList}>
          {visible.map((it, i) => {
            const idx = i + offset;
            const head = idx === 0 || filtered[idx - 1].group !== it.group;
            return (
              <React.Fragment key={it.id}>
                {head && <div className={`${s.palGroup} label`}>{it.group}</div>}
                <div className={s.palRow} data-on={idx === sel}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} className={it.group === "Slate" ? "mono" : ""}>
                    {it.label}
                  </span>
                  <small style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>{it.hint}</small>
                </div>
              </React.Fragment>
            );
          })}
          {!filtered.length && <div className={s.palRow}>{q.includes(":") ? "⏎ run as query" : "no match"}</div>}
        </div>
      </div>
    </div>
  );
}
