// In-memory play store: zero-copy typed-array views over the decompressed bundle, plus lookups.

import { MAGIC, type BundleHeader, type BundleMeta, type ColType, type PlayCol, type PossCol } from "../core/format";
import { TEAMS } from "../core/teams";

type Typed = Uint8Array | Int8Array | Uint16Array | Int16Array | Uint32Array;
const VIEW: Record<ColType, (b: ArrayBuffer, off: number, n: number) => Typed> = {
  u8: (b, o, n) => new Uint8Array(b, o, n),
  i8: (b, o, n) => new Int8Array(b, o, n),
  u16: (b, o, n) => new Uint16Array(b, o, n),
  i16: (b, o, n) => new Int16Array(b, o, n),
  u32: (b, o, n) => new Uint32Array(b, o, n),
};

export interface Store {
  meta: BundleMeta;
  n: number;
  nPoss: number;
  p: Record<PlayCol, Typed>;
  s: Record<PossCol, Typed>;
  /** Offense and defense five per play, as player indexes (10 per row, offense first). */
  floor: Uint16Array;
  /** (game index, actionNumber) → play row. */
  rowOf(game: number, action: number): number;
  gameIndex: Map<string, number>;
}

export function decodeBundle(buffer: ArrayBuffer, meta: BundleMeta): Store {
  const head = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
  if (head !== MAGIC) throw new Error(`bad bundle magic ${head}`);
  const hlen = new DataView(buffer).getUint32(4, true);
  const header: BundleHeader = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, hlen)).trim());
  // Copy the column region so it starts 4-byte aligned regardless of where the decompressor put it.
  const base = 8 + hlen;
  const data = buffer.slice(base, base + header.bytes);
  const p = {} as Record<PlayCol, Typed>;
  for (const c of header.playColumns) p[c.name as PlayCol] = VIEW[c.type](data, c.offset, header.plays);
  const s = {} as Record<PossCol, Typed>;
  for (const c of header.possColumns) s[c.name as PossCol] = VIEW[c.type](data, c.offset, header.possessions);

  const n = header.plays;
  const floor = new Uint16Array(n * 10);
  const cols = ["o0", "o1", "o2", "o3", "o4", "d0", "d1", "d2", "d3", "d4"] as const;
  cols.forEach((c, k) => {
    const col = p[c];
    for (let i = 0; i < n; i++) floor[i * 10 + k] = col[i];
  });

  const byKey = new Map<number, number>();
  for (let i = 0; i < n; i++) byKey.set(p.game[i] * 65536 + p.action[i], i);
  const gameIndex = new Map(meta.games.map((g, i) => [g.id, i]));

  return {
    meta,
    n,
    nPoss: header.possessions,
    p,
    s,
    floor,
    rowOf: (g, a) => byKey.get(g * 65536 + a) ?? -1,
    gameIndex,
  };
}

export const teamTri = (i: number) => TEAMS[i]?.tri ?? "";

/** "Q3 4:31" style clock label from tenths. */
export function fmtClock(tenths: number): string {
  const s = tenths / 10;
  if (s < 60) return `0:${(Math.floor(s * 10) / 10).toFixed(1).padStart(4, "0")}`;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

export const periodLabel = (p: number) => (p <= 4 ? `Q${p}` : p === 5 ? "OT" : `${p - 4}OT`);
