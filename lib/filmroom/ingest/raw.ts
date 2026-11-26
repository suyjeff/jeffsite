// Raw NBA primitives, in the shapes the official feeds publish them. The ingest normalises every source — a live
// fetch from cdn.nba.com / stats.nba.com, or a CSV mirror of the same feeds — into these types before any
// derivation runs, so the possession machine never sees a source-specific quirk.

/** cdn.nba.com liveData `playbyplay_{gameId}.json` → `game.actions[]`. */
export interface CdnAction {
  actionNumber: number;
  orderNumber: number;
  clock: string; // ISO-8601 duration, "PT11M43.00S"
  timeActual: string; // wall-clock UTC
  period: number;
  periodType: string;
  actionType: string;
  subType: string;
  descriptor: string;
  qualifiers: string[];
  personId: number;
  personIdsFilter: number[];
  teamId: number;
  teamTricode: string;
  possession: number;
  scoreHome: number;
  scoreAway: number;
  isFieldGoal: boolean;
  xLegacy: number | null;
  yLegacy: number | null;
  shotDistance: number | null;
  shotResult: string;
  shotActionNumber: number | null;
  assistPersonId: number | null;
  blockPersonId: number | null;
  stealPersonId: number | null;
  foulDrawnPersonId: number | null;
  pointsTotal: number | null;
  assistTotal: number | null;
  description: string;
  area: string;
  areaDetail: string;
  side: string;
}

/** stats.nba.com `boxscoretraditionalv3` player row (the cdn liveData boxscore carries the same fields). */
export interface BoxPlayer {
  gameId: string;
  teamId: number;
  personId: number;
  name: string;
  /** Seconds played, parsed from "MM:SS". */
  seconds: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  pts: number;
  plusMinus: number;
}

/** stats.nba.com `shotchartdetail` row. */
export interface ShotChartRow {
  gameId: string;
  eventId: number;
  personId: number;
  teamId: number;
  period: number;
  locX: number;
  locY: number;
  made: boolean;
  value: 2 | 3;
  zoneBasic: string;
  zoneArea: string;
}

/** stats.nba.com `videoeventsasset` resolution for one event. */
export interface VideoAsset {
  gameId: string;
  actionNumber: number;
  url: string;
}

/** stats.nba.com `gamerotation` stint (tenths of a second of game time elapsed). */
export interface RotationStint {
  teamId: number;
  personId: number;
  inTime: number;
  outTime: number;
}

/** pbpstats-style possession summary from an independent parser, for cross-checking possession counts. */
export interface RefPossession {
  gameId: string;
  period: number;
  offenseTri: string;
  start: string;
  end: string;
}

/** stats.nba.com `playbyplayv3` action — the post-game-corrected feed, used to arbitrate the cdn snapshot. */
export interface V3Action {
  actionNumber: number;
  period: number;
  clock: string;
  teamId: number;
  personId: number;
  isFieldGoal: boolean;
  shotValue: number;
  shotResult: string;
  actionType: string;
  description: string;
  x: number;
  y: number;
}

export interface RawGame {
  gameId: string;
  date: string;
  homeTeamId: number;
  awayTeamId: number;
  actions: CdnAction[];
  box: BoxPlayer[];
  shots: ShotChartRow[];
  video: VideoAsset[];
  rotation?: RotationStint[];
  v3?: V3Action[];
  refPossessions?: RefPossession[];
}

/** "PT11M43.00S" → seconds remaining in the period (tenth precision). */
export function parseClock(clock: string): number {
  const m = /PT(\d+)M([\d.]+)S/.exec(clock);
  if (!m) return 0;
  return Math.round((Number(m[1]) * 60 + Number(m[2])) * 10) / 10;
}

export function periodLength(period: number): number {
  return period <= 4 ? 720 : 300;
}

/** Seconds elapsed from tip-off to the start of `period`. */
export function periodStartElapsed(period: number): number {
  return period <= 4 ? (period - 1) * 720 : 2880 + (period - 5) * 300;
}
