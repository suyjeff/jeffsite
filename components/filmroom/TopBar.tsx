import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import s from "./filmroom.module.css";
import { tri, useApp, useAppState } from "./shared";
import { parse } from "../../lib/filmroom/engine/dsl";
import type { Suggestion } from "../../lib/filmroom/engine/query";
import { VIEWS } from "../../lib/filmroom/app/app";

const VIEW_LABEL = { tl: "TIMELINE", tape: "TAPE", map: "SHOT MAP" } as const;

export function TopBar({
  queryRef,
  onClose,
  onFocus,
}: {
  queryRef: React.MutableRefObject<{ focus: () => void; blur: () => void } | null>;
  onClose: () => void;
  onFocus: () => void;
}) {
  const app = useApp();
  const st = useAppState();
  const row = app.row;
  const g = row >= 0 ? app.store.meta.games[app.store.p.game[row]] : null;
  const focus = app.store.meta.focusTeam;
  return (
    <div className={s.top}>
      <div className={s.brand}>
        FILM<b>/</b>ROOM
      </div>
      {g && (
        <div className={s.slate} title="Game · G to switch">
          <span>{g.date}</span>
          <span style={{ color: "var(--text)" }}>
            {tri(g.away)} {g.awayScore}–{g.homeScore} {tri(g.home)}
          </span>
          <span className="faint">{g.home === focus ? "home" : "away"}</span>
        </div>
      )}
      <QueryBar ref={queryRef} onClose={onClose} onFocus={onFocus} />
      <div className={s.count} data-testid="count">
        <b>{st.result?.rows.length.toLocaleString() ?? "—"}</b> plays · {st.result ? st.result.ms.toFixed(2) : "—"} ms
      </div>
      <div className={s.views} aria-label="View (V)">
        {VIEWS.map((v) => (
          <span key={v} data-on={st.view === v}>
            {VIEW_LABEL[v]}
          </span>
        ))}
      </div>
    </div>
  );
}

const QueryBar = React.forwardRef<{ focus: () => void; blur: () => void }, { onClose: () => void; onFocus: () => void }>(function QueryBar(
  { onClose, onFocus },
  ref,
) {
  const app = useApp();
  const st = useAppState();
  const [text, setText] = useState(st.query);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [sel, setSel] = useState(-1);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => {
      input.current?.focus();
      const n = input.current?.value.length ?? 0;
      input.current?.setSelectionRange(n, n);
    },
    blur: () => input.current?.blur(),
  }));

  // Keep in sync when the query changes from elsewhere (palette, URL).
  useEffect(() => {
    if (!focused) setText(st.query);
  }, [st.query, focused]);

  const parsed = useMemo(() => parse(text), [text]);
  const preview = useMemo(() => (focused && text !== st.query ? app.engine.run(text) : null), [focused, text, st.query, app]);
  const suggestions: Suggestion[] = useMemo(() => (focused && open ? app.engine.suggest(text, caret, 10) : []), [focused, open, text, caret, app]);

  const errSpans = (preview ?? st.result)?.diagnostics ?? parsed.diagnostics;

  const highlighted = useMemo(() => {
    const out: React.ReactNode[] = [];
    let at = 0;
    const toks = [...parsed.tokens].sort((a, b) => a.start - b.start);
    for (const t of toks) {
      if (t.start > at) out.push(text.slice(at, t.start));
      const err = errSpans.some((d) => d.start <= t.start && d.end >= t.end && d.end > d.start);
      out.push(
        <span key={t.start} className={`t-${t.kind}${err ? " t-err" : ""}`}>
          {text.slice(t.start, t.end)}
        </span>,
      );
      at = t.end;
    }
    if (at < text.length) out.push(text.slice(at));
    return out;
  }, [parsed, text, errSpans]);

  const accept = (sg: Suggestion) => {
    const [a, b] = sg.replace;
    const tail = sg.insert.endsWith(":") ? "" : " ";
    const next = text.slice(0, a) + sg.insert + tail + text.slice(b).replace(/^\s+/, "");
    const pos = a + sg.insert.length + tail.length;
    setText(next);
    setSel(-1);
    requestAnimationFrame(() => {
      input.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const apply = () => {
    app.runQuery(text.trim());
    setOpen(false);
    input.current?.blur();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setSel((v) => (v + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setSel((v) => (v <= 0 ? suggestions.length - 1 : v - 1));
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (suggestions.length) accept(suggestions[Math.max(0, sel)]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (sel >= 0 && suggestions[sel]) accept(suggestions[sel]);
      else apply();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (open && suggestions.length) setOpen(false);
      else {
        setText(st.query);
        input.current?.blur();
        onClose();
      }
    }
  };

  useEffect(() => {
    if (mirror.current && input.current) mirror.current.scrollLeft = input.current.scrollLeft;
  });

  const shown = preview ?? st.result;
  return (
    <div className={s.qwrap} data-focus={focused}>
      <div className={s.qbox} />
      <span className={s.qprompt}>›</span>
      <div ref={mirror} className={s.qmirror} aria-hidden>
        {highlighted}
      </div>
      <input
        ref={input}
        className={s.qinput}
        value={text}
        spellCheck={false}
        autoComplete="off"
        aria-label="Query (/)"
        placeholder="shooter:curry shot:3pt zone:right_wing lineup:+green q:3 …"
        data-testid="query"
        onFocus={() => {
          setFocused(true);
          setOpen(true);
          onFocus();
        }}
        onBlur={() => {
          setFocused(false);
          setOpen(false);
          setSel(-1);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setOpen(true);
          setSel(-1);
        }}
        onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollLeft = (e.target as HTMLInputElement).scrollLeft;
        }}
        onKeyDown={onKeyDown}
      />
      {focused && (suggestions.length > 0 || (shown && (shown.diagnostics.length || shown.notes.length))) && (
        <div className={s.suggest} data-testid="suggestions">
          {suggestions.map((sg, i) => (
            <div key={sg.label + i} className={s.sugRow} data-on={i === sel}>
              <span className={s.sugKind}>{KIND_GLYPH[sg.kind]}</span>
              <span className={s.sugLabel}>{sg.label}</span>
              <span className={s.sugDetail}>{sg.detail}</span>
              <span className={s.sugCount} data-zero={sg.count === 0}>
                {sg.count === null ? "" : sg.count.toLocaleString()}
              </span>
            </div>
          ))}
          {shown?.diagnostics.slice(0, 2).map((d, i) => (
            <div key={`d${i}`} className={s.diag}>
              ✗ {d.message}
            </div>
          ))}
          {shown?.notes.slice(0, 2).map((d, i) => (
            <div key={`n${i}`} className={s.diag} data-note="true">
              · {d.message}
            </div>
          ))}
          <div className={s.sugFoot}>
            <span>
              <span className="kbd">Tab</span> complete
            </span>
            <span>
              <span className="kbd">↑↓</span> choose
            </span>
            <span>
              <span className="kbd">⏎</span> apply
            </span>
            <span>
              <span className="kbd">Esc</span> back to film
            </span>
            {preview && (
              <span style={{ marginLeft: "auto", color: "var(--text)" }} className="mono">
                {preview.rows.length.toLocaleString()} plays · {preview.ms.toFixed(2)} ms
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

const KIND_GLYPH: Record<Suggestion["kind"], string> = { field: "ƒ", value: "=", player: "@", team: "#", tactic: "◆", zone: "◎" };
