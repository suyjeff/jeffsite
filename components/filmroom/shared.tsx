import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { AppState, FilmroomApp } from "../../lib/filmroom/app/app";
import type { FrameState } from "../../lib/filmroom/video/reel";
import { TEAMS } from "../../lib/filmroom/core/teams";
import { ZONES, ZONE_LABEL } from "../../lib/filmroom/core/court";
import { KIND_NAME } from "../../lib/filmroom/core/format";
import { fmtClock, periodLabel } from "../../lib/filmroom/engine/store";

export const AppCtx = createContext<FilmroomApp | null>(null);
export const useApp = () => useContext(AppCtx)!;

export function useAppState(): AppState {
  const app = useApp();
  return useSyncExternalStore(app.subscribe, app.getState, app.getState);
}

/** Frame state at React speed — use only where a re-render per presented frame is acceptable (small leaves). */
export function useFrame(): FrameState | null {
  const app = useApp();
  const [f, setF] = useState<FrameState | null>(app.frame);
  useEffect(() => app.subscribeFrame(setF), [app]);
  return f;
}

export const tri = (i: number) => TEAMS[i]?.tri ?? "—";
export { fmtClock, periodLabel };

export function fmtSec(s: number, digits = 2): string {
  const sign = s < 0 ? "−" : "+";
  return `${sign}${Math.abs(s).toFixed(digits)}s`;
}

export function playInfo(app: FilmroomApp, row: number) {
  const { p, meta } = app.store;
  const g = meta.games[p.game[row]];
  const kind = KIND_NAME[p.kind[row]];
  const made = p.made[row] === 1;
  const actor = meta.players[p.actor[row]];
  const assist = meta.players[p.assist[row]];
  const zone = p.zone[row] === 255 ? null : ZONES[p.zone[row]];
  const shotType = meta.shotTypes[p.shotType[row]] ?? "";
  const descriptor = meta.descriptors[p.descriptor[row]] ?? "";
  const outcome = kind === "tov" ? "tov" : kind === "ft" ? "ft" : made ? "make" : "miss";
  let what: string;
  if (kind === "fga") what = `${p.dist[row]}′ ${p.value[row]}PT ${[descriptor, shotType.toLowerCase()].filter(Boolean).join(" ")}`;
  else if (kind === "tov") what = `TOV ${shotType.toLowerCase()}${descriptor ? ` · ${descriptor}` : ""}`;
  else what = `FT ${p.points[row]}/${p.attempts[row]}`;
  return {
    g,
    kind,
    made,
    outcome,
    actor,
    assist,
    zone,
    zoneLabel: zone ? ZONE_LABEL[zone] : "",
    what,
    clock: fmtClock(p.clock[row]),
    period: periodLabel(p.period[row]),
    off: p.off[row],
    def: p.def[row],
    margin: p.margin[row],
  };
}

export const OUTCOME_VAR: Record<string, string> = { make: "var(--make)", miss: "var(--miss)", tov: "var(--tov)", ft: "var(--ft)" };
/** Shape carries the outcome as well as colour: filled make, open miss, square turnover, FT trip. */
export const OUTCOME_GLYPH: Record<string, string> = { make: "●", miss: "○", tov: "■", ft: "FT" };
export const OUTCOME_WORD: Record<string, string> = { make: "make", miss: "miss", tov: "turnover", ft: "free throws" };

/** True when the reader asked for reduced motion (read once per render; the setting rarely changes mid-session). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Categorical action colours (validated dark palette, fixed order); actions past eight fold into neutral. */
const ACTION_COLORS: Record<string, string> = {
  pnr: "#338ced",
  pindown: "#e76624",
  flare: "#00a888",
  ghost: "#d28e05",
  spain_pnr: "#e24d8b",
  dho: "#0aac23",
  stagger: "#9887ef",
  split_cut: "#eb6263",
};
export const actionColor = (a?: string) => (a && ACTION_COLORS[a]) || "#8a929c";

/** Half court in the shot-chart frame (tenths of a foot, rim at origin, +y toward half court). Basket at top. */
export function CourtLines({ stroke = "#252a31", sw = 1.6 }: { stroke?: string; sw?: number }) {
  return (
    <g fill="none" stroke={stroke} strokeWidth={sw}>
      <rect x={-250} y={-47.5} width={500} height={470} />
      <rect x={-80} y={-47.5} width={160} height={190} />
      <rect x={-60} y={-47.5} width={120} height={190} />
      <path d="M -60 142.5 A 60 60 0 0 0 60 142.5" />
      <path d="M -60 142.5 A 60 60 0 0 1 60 142.5" strokeDasharray="6 6" />
      <path d="M -40 0 A 40 40 0 0 0 40 0" />
      <line x1={-30} y1={-7.5} x2={30} y2={-7.5} />
      <circle cx={0} cy={0} r={7.5} />
      <line x1={-220} y1={-47.5} x2={-220} y2={92.5} />
      <line x1={220} y1={-47.5} x2={220} y2={92.5} />
      <path d="M -220 92.5 A 237.5 237.5 0 0 0 220 92.5" />
      <path d="M -60 422.5 A 60 60 0 0 1 60 422.5" />
    </g>
  );
}
