import React, { useEffect, useMemo, useRef } from "react";
import s from "./filmroom.module.css";
import { CourtLines, useApp, useAppState } from "./shared";
import { ZONES, ZONE_LABEL } from "../../lib/filmroom/core/court";
import { KIND } from "../../lib/filmroom/core/format";

// Court frame → viewBox: x −250..250, y −47.5..422.5 (basket at top). The canvas draws the dots (thousands of
// marks), the SVG draws the lines and the selected shot, both from the same transform.
const VB = { x: -262, y: -60, w: 524, h: 494 };

export function ShotMap() {
  const app = useApp();
  const st = useAppState();
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const rows = st.result?.rows;
  const { p } = app.store;
  const sel = app.row;

  const zoneStats = useMemo(() => {
    const z = ZONES.map(() => ({ a: 0, m: 0, pts: 0 }));
    let a = 0;
    let m = 0;
    if (rows)
      for (const r of rows) {
        if (p.kind[r] !== KIND.fga || p.zone[r] === 255) continue;
        const k = z[p.zone[r]];
        k.a++;
        a++;
        if (p.made[r]) {
          k.m++;
          m++;
          k.pts += p.value[r];
        }
      }
    return { z, a, m };
  }, [rows, p]);

  useEffect(() => {
    const c = canvas.current;
    const b = box.current;
    if (!c || !b || !rows) return;
    const draw = () => {
      const rect = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
      const ctx = c.getContext("2d")!;
      const scale = Math.min(rect.width / VB.w, rect.height / VB.h);
      const ox = (rect.width - VB.w * scale) / 2;
      const oy = (rect.height - VB.h * scale) / 2;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox - VB.x * scale), dpr * (oy - VB.y * scale));
      ctx.clearRect(VB.x, VB.y, VB.w, VB.h);
      const r = rows.length > 2000 ? 3.2 : 4.5;
      // Misses as rings under makes as discs: shape carries outcome as well as colour.
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = "rgba(235,98,99,0.75)";
      for (const i of rows) {
        if (p.kind[i] !== KIND.fga || p.made[i]) continue;
        ctx.beginPath();
        ctx.arc(p.x[i], p.y[i], r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(0,168,136,0.85)";
      for (const i of rows) {
        if (p.kind[i] !== KIND.fga || !p.made[i]) continue;
        ctx.beginPath();
        ctx.arc(p.x[i], p.y[i], r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(b);
    return () => ro.disconnect();
  }, [rows, p]);

  const best = Math.max(0.0001, ...zoneStats.z.map((z) => (z.a ? z.pts / z.a : 0)));
  const selZone = sel >= 0 && p.zone[sel] !== 255 ? p.zone[sel] : -1;
  return (
    <div className={s.map} data-testid="shotmap">
      <div ref={box} className={s.mapCourt}>
        <canvas ref={canvas} />
        <svg viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} preserveAspectRatio="xMidYMid meet">
          <CourtLines />
          {sel >= 0 && p.kind[sel] === KIND.fga && (
            <g>
              <circle cx={p.x[sel]} cy={p.y[sel]} r={11} fill="none" stroke="var(--accent)" strokeWidth={2} />
              <line x1={p.x[sel]} y1={p.y[sel] + 11} x2={p.x[sel]} y2={p.y[sel] + 26} stroke="var(--accent)" strokeWidth={1.5} />
            </g>
          )}
        </svg>
        <div className="mono faint" style={{ position: "absolute", left: 12, bottom: 8, fontSize: 10, display: "flex", gap: 12 }}>
          <span>
            <span className="make">●</span> make
          </span>
          <span>
            <span className="miss">○</span> miss
          </span>
          <span>
            <span className="acc">◯</span> current
          </span>
        </div>
      </div>
      <div className={s.zoneTable}>
        <div className={s.zrow} data-head="true">
          <span>Zone</span>
          <span style={{ textAlign: "right" }}>FGM</span>
          <span style={{ textAlign: "right" }}>FGA</span>
          <span style={{ textAlign: "right" }}>FG%</span>
          <span>Pts/shot</span>
        </div>
        {ZONES.map((z, i) => {
          const k = zoneStats.z[i];
          if (!k.a) return null;
          const pps = k.pts / k.a;
          return (
            <div key={z} className={s.zrow} data-on={i === selZone}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--sans)" }}>{ZONE_LABEL[z]}</span>
              <span style={{ textAlign: "right" }}>{k.m}</span>
              <span style={{ textAlign: "right" }}>{k.a}</span>
              <span style={{ textAlign: "right" }}>{((k.m / k.a) * 100).toFixed(1)}</span>
              <span style={{ display: "grid", gridTemplateColumns: "28px 1fr", gap: 6, alignItems: "center" }}>
                <span>{pps.toFixed(2)}</span>
                <span className={s.zbar}>
                  <i style={{ width: `${(pps / best) * 100}%` }} />
                </span>
              </span>
            </div>
          );
        })}
        <div className={s.zrow} style={{ marginTop: 4, borderTop: "1px solid var(--hair)", color: "var(--text)" }}>
          <span style={{ fontFamily: "var(--sans)" }}>All</span>
          <span style={{ textAlign: "right" }}>{zoneStats.m}</span>
          <span style={{ textAlign: "right" }}>{zoneStats.a}</span>
          <span style={{ textAlign: "right" }}>{zoneStats.a ? ((zoneStats.m / zoneStats.a) * 100).toFixed(1) : "—"}</span>
          <span />
        </div>
      </div>
    </div>
  );
}
