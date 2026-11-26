// Client bundle format, shared by the ingest writer and the browser reader.
//
// plays.bin(.gz): "FRB1" · u32 header length · header JSON · columns. Every column is a typed array aligned to
// 4 bytes, so the reader maps it with zero parsing: `new Int16Array(buffer, offset, n)`. ~19k plays × 64 bytes.

export const MAGIC = "FRB1";

export type ColType = "u8" | "i8" | "u16" | "i16" | "u32";
export const COL_BYTES: Record<ColType, number> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4 };

export const PLAY_COLUMNS = [
  ["game", "u8"],
  ["poss", "u32"], // global possession index
  ["kind", "u8"], // 0 fga · 1 tov · 2 ft
  ["period", "u8"],
  ["clock", "u16"], // tenths of a second remaining in the period
  ["elapsed", "u16"], // tenths since tip-off
  ["wall", "u32"], // tenths of a second of wall-clock since the game's first action (film sync)
  ["action", "u16"], // NBA actionNumber (GAME_EVENT_ID)
  ["off", "u8"], // team index (TEAMS order)
  ["def", "u8"],
  ["actor", "u16"], // player index, 0 = none/team
  ["assist", "u16"],
  ["block", "u16"],
  ["steal", "u16"],
  ["fouler", "u16"],
  ["value", "u8"], // 1 FT trip · 2 · 3
  ["made", "u8"],
  ["points", "u8"],
  ["attempts", "u8"],
  ["x", "i16"], // tenths of a foot, rim at origin
  ["y", "i16"],
  ["dist", "u8"], // feet
  ["zone", "u8"], // ZONES index, 255 = none
  ["shotType", "u8"], // dictionary index (Layup, Jump Shot, DUNK, Hook, turnover subtype…)
  ["descriptor", "u8"], // dictionary index (pullup, step back, driving…)
  ["quals", "u8"], // QUAL bits
  ["flags", "u8"], // FLAG bits
  ["margin", "i8"], // offense score margin before the play
  ["possSec", "u16"], // tenths of a second into the possession
  ["video", "u8"], // VIDEO status
  ["o0", "u16"],
  ["o1", "u16"],
  ["o2", "u16"],
  ["o3", "u16"],
  ["o4", "u16"],
  ["d0", "u16"],
  ["d1", "u16"],
  ["d2", "u16"],
  ["d3", "u16"],
  ["d4", "u16"],
] as const satisfies readonly (readonly [string, ColType])[];

export const POSS_COLUMNS = [
  ["game", "u8"],
  ["period", "u8"],
  ["off", "u8"],
  ["def", "u8"],
  ["start", "u16"], // tenths remaining
  ["end", "u16"],
  ["startType", "u8"],
  ["endType", "u8"],
  ["points", "u8"],
  ["margin", "i8"],
  ["firstPlay", "u32"],
  ["playCount", "u8"],
] as const satisfies readonly (readonly [string, ColType])[];

export type PlayCol = (typeof PLAY_COLUMNS)[number][0];
export type PossCol = (typeof POSS_COLUMNS)[number][0];

export const KIND = { fga: 0, tov: 1, ft: 2 } as const;
export const KIND_NAME = ["fga", "tov", "ft"] as const;

export const QUAL = { fastbreak: 1, "2ndchance": 2, fromturnover: 4, pointsinthepaint: 8 } as const;
export const FLAG = { and1: 1, blocked: 2, technical: 4 } as const;
export const VIDEO = { none: 0, live: 1, retired: 2, unknown: 3 } as const;

export const START_TYPES = ["period_start", "made_fg", "made_ft", "dreb", "live_tov", "dead_tov", "jump_ball", "dead_ball"] as const;
export const END_TYPES = ["made_fg", "made_ft", "dreb", "tov", "jump_ball", "period_end", "dead_ball"] as const;

export interface ColumnRef {
  name: string;
  type: ColType;
  offset: number;
}

export interface BundleHeader {
  version: 1;
  plays: number;
  possessions: number;
  playColumns: ColumnRef[];
  possColumns: ColumnRef[];
  bytes: number;
}

export interface GameMeta {
  id: string;
  date: string;
  home: number; // team index
  away: number;
  homeScore: number;
  awayScore: number;
  periods: number;
  firstPlay: number;
  playCount: number;
  firstPoss: number;
  possCount: number;
  /** One bit per required reconciliation check, in `checks` order: 1 = passed. */
  integrity: number;
  corrections: number;
  videoLive: number;
  videoRetired: number;
  /** ISO wall-clock of the first action, for syncing full-game film. */
  t0: string;
}

export interface PlayerMeta {
  id: number;
  name: string;
  short: string; // "S. Curry"
  last: string;
  slug: string; // "stephen-curry"
  team: number; // team index of the team he appears for most in this bundle
  plays: number;
}

export interface BundleMeta {
  version: 1;
  generated: string;
  season: string;
  focusTeam: number;
  source: string;
  games: GameMeta[];
  players: PlayerMeta[]; // index 0 = none
  shotTypes: string[];
  descriptors: string[];
  checks: { name: string; source: string; required: boolean; checked: number; mismatches: number }[];
  totals: { plays: number; possessions: number; events: number; corrections: number };
}

/** Per-game detail (games/<id>.json): the full event tape with floors, loaded on demand. */
export interface GameDetail {
  id: string;
  /** Column-major event arrays. */
  n: number[];
  period: number[];
  clock: number[]; // tenths
  wall: number[]; // tenths
  type: number[]; // index into types
  team: number[]; // team index or 255
  person: number[]; // player index
  sh: number[];
  sa: number[];
  poss: number[]; // global possession index or -1
  floor: number[]; // index into floors
  desc: string[];
  types: string[];
  floors: number[][]; // 10 player indexes: home five, away five
  video: Record<string, string>; // actionNumber → mp4 url
  corrections: { actionNumber: number; field: string; from: string; to: string; source: string }[];
  checks: { name: string; source: string; required: boolean; checked: number; mismatches: string[] }[];
}

export function alignedLayout(columns: readonly (readonly [string, ColType])[], rows: number, start: number): { refs: ColumnRef[]; end: number } {
  let off = start;
  const refs: ColumnRef[] = [];
  for (const [name, type] of columns) {
    off = Math.ceil(off / 4) * 4;
    refs.push({ name, type, offset: off });
    off += rows * COL_BYTES[type];
  }
  return { refs, end: Math.ceil(off / 4) * 4 };
}
