// Writes the client bundle: meta.json, plays.bin.gz (columnar), games/<id>.json, reconciliation.json.

import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { gzipSync } from "zlib";
import { TEAMS, TEAM_BY_ID } from "../core/teams";
import { ZONE_ID } from "../core/court";
import {
  COL_BYTES,
  END_TYPES,
  FLAG,
  KIND,
  MAGIC,
  PLAY_COLUMNS,
  POSS_COLUMNS,
  QUAL,
  START_TYPES,
  VIDEO,
  alignedLayout,
  type BundleHeader,
  type BundleMeta,
  type ColType,
  type GameDetail,
  type GameMeta,
  type PlayerMeta,
} from "../core/format";
import type { ParsedGame } from "./fsm";
import type { RawGame } from "./raw";
import type { GameReconciliation } from "./reconcile";
import type { VideoStatus } from "./video";

const teamIndex = (id: number) => TEAMS.findIndex((t) => t.id === id);

function writeColumn(view: DataView, type: ColType, offset: number, i: number, v: number) {
  const o = offset + i * COL_BYTES[type];
  switch (type) {
    case "u8":
      view.setUint8(o, Math.max(0, Math.min(255, v | 0)));
      break;
    case "i8":
      view.setInt8(o, Math.max(-128, Math.min(127, v | 0)));
      break;
    case "u16":
      view.setUint16(o, Math.max(0, Math.min(65535, Math.round(v))), true);
      break;
    case "i16":
      view.setInt16(o, Math.round(v), true);
      break;
    case "u32":
      view.setUint32(o, Math.max(0, Math.round(v)), true);
      break;
  }
}

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function writeBundle(
  outDir: string,
  raws: RawGame[],
  parsed: ParsedGame[],
  recs: GameReconciliation[],
  video: Map<string, { url: string; status: VideoStatus }>,
) {
  if (existsSync(join(outDir, "games"))) rmSync(join(outDir, "games"), { recursive: true });
  mkdirSync(join(outDir, "games"), { recursive: true });

  // ── players ──
  const names = new Map<number, string>();
  const teamCount = new Map<number, Map<number, number>>();
  for (const r of raws)
    for (const b of r.box) {
      names.set(b.personId, b.name);
      const m = teamCount.get(b.personId) ?? new Map();
      m.set(b.teamId, (m.get(b.teamId) ?? 0) + 1);
      teamCount.set(b.personId, m);
    }
  const playCount = new Map<number, number>();
  for (const g of parsed) for (const p of g.plays) playCount.set(p.actor, (playCount.get(p.actor) ?? 0) + 1);
  const playerIds = [...names.keys()].sort((a, b) => (playCount.get(b) ?? 0) - (playCount.get(a) ?? 0) || a - b);
  const pIdx = new Map<number, number>(playerIds.map((id, i) => [id, i + 1]));
  const pi = (id: number) => (id ? (pIdx.get(id) ?? 0) : 0);
  const players: PlayerMeta[] = [{ id: 0, name: "", short: "", last: "", slug: "", team: 255, plays: 0 }];
  for (const id of playerIds) {
    const name = names.get(id)!;
    const parts = name.split(" ");
    const lastName = parts.slice(1).join(" ") || name;
    const teams = [...(teamCount.get(id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]);
    players.push({
      id,
      name,
      short: `${parts[0][0]}. ${lastName}`,
      last: lastName,
      slug: slugify(name),
      team: teamIndex(teams[0]?.[0] ?? 0),
      plays: playCount.get(id) ?? 0,
    });
  }

  // ── dictionaries ──
  const shotTypes: string[] = [];
  const descriptors: string[] = [""];
  const dict = (arr: string[], s: string) => {
    let i = arr.indexOf(s);
    if (i < 0) {
      arr.push(s);
      i = arr.length - 1;
    }
    return i;
  };

  // ── columns ──
  const nPlays = parsed.reduce((s, g) => s + g.plays.length, 0);
  const nPoss = parsed.reduce((s, g) => s + g.possessions.length, 0);
  const play = alignedLayout(PLAY_COLUMNS, nPlays, 0);
  const poss = alignedLayout(POSS_COLUMNS, nPoss, play.end);
  const data = new ArrayBuffer(poss.end);
  const view = new DataView(data);
  const pcol = Object.fromEntries(play.refs.map((r) => [r.name, r]));
  const scol = Object.fromEntries(poss.refs.map((r) => [r.name, r]));
  const setP = (name: string, i: number, v: number) => writeColumn(view, pcol[name].type, pcol[name].offset, i, v);
  const setS = (name: string, i: number, v: number) => writeColumn(view, scol[name].type, scol[name].offset, i, v);

  const games: GameMeta[] = [];
  let pRow = 0;
  let sRow = 0;
  parsed.forEach((g, gi) => {
    const raw = raws[gi];
    const rec = recs[gi];
    const possBase = sRow;
    const firstPlay = pRow;
    // possessions
    const firstPlayOfPoss = new Map<number, number>();
    const countOfPoss = new Map<number, number>();
    g.plays.forEach((p, k) => {
      if (!firstPlayOfPoss.has(p.poss)) firstPlayOfPoss.set(p.poss, firstPlay + k);
      countOfPoss.set(p.poss, (countOfPoss.get(p.poss) ?? 0) + 1);
    });
    for (const s of g.possessions) {
      setS("game", sRow, gi);
      setS("period", sRow, s.period);
      setS("off", sRow, teamIndex(s.offense));
      setS("def", sRow, teamIndex(s.defense));
      setS("start", sRow, s.startClock * 10);
      setS("end", sRow, s.endClock * 10);
      setS("startType", sRow, START_TYPES.indexOf(s.startType));
      setS("endType", sRow, END_TYPES.indexOf(s.endType));
      setS("points", sRow, s.points);
      setS("margin", sRow, s.margin);
      setS("firstPlay", sRow, firstPlayOfPoss.get(s.id) ?? 0xffffffff);
      setS("playCount", sRow, countOfPoss.get(s.id) ?? 0);
      sRow++;
    }
    let live = 0;
    let retired = 0;
    for (const p of g.plays) {
      const i = pRow++;
      const v = video.get(`${g.gameId}:${p.actionNumber}`);
      const vs = !v ? VIDEO.none : v.status === "live" ? VIDEO.live : v.status === "retired" ? VIDEO.retired : VIDEO.unknown;
      if (vs === VIDEO.live) live++;
      if (vs === VIDEO.retired) retired++;
      setP("game", i, gi);
      setP("poss", i, possBase + p.poss);
      setP("kind", i, KIND[p.kind]);
      setP("period", i, p.period);
      setP("clock", i, p.clock * 10);
      setP("elapsed", i, p.elapsed * 10);
      setP("wall", i, p.wall / 100);
      setP("action", i, p.actionNumber);
      setP("off", i, teamIndex(p.offense));
      setP("def", i, teamIndex(p.defense));
      setP("actor", i, pi(p.actor));
      setP("assist", i, pi(p.assist));
      setP("block", i, pi(p.block));
      setP("steal", i, pi(p.steal));
      setP("fouler", i, pi(p.fouler));
      setP("value", i, p.value);
      setP("made", i, p.made ? 1 : 0);
      setP("points", i, p.points);
      setP("attempts", i, p.attempts);
      setP("x", i, p.x);
      setP("y", i, p.y);
      setP("dist", i, p.dist);
      setP("zone", i, p.zone ? ZONE_ID[p.zone] : 255);
      setP("shotType", i, dict(shotTypes, p.shotType));
      setP("descriptor", i, dict(descriptors, p.descriptor));
      let q = 0;
      for (const [k, bit] of Object.entries(QUAL)) if (p.qualifiers.includes(k)) q |= bit;
      setP("quals", i, q);
      setP("flags", i, (p.and1 ? FLAG.and1 : 0) | (p.block ? FLAG.blocked : 0));
      setP("margin", i, p.margin);
      setP("possSec", i, p.possSeconds * 10);
      setP("video", i, vs);
      const off = [...p.offFloor].map(pi).sort((a, b) => a - b);
      const def = [...p.defFloor].map(pi).sort((a, b) => a - b);
      for (let k = 0; k < 5; k++) {
        setP(`o${k}`, i, off[k] ?? 0);
        setP(`d${k}`, i, def[k] ?? 0);
      }
    }
    const last = g.events[g.events.length - 1];
    const required = rec.checks.filter((c) => c.required);
    games.push({
      id: g.gameId,
      date: raw.date,
      home: teamIndex(g.homeTeamId),
      away: teamIndex(g.awayTeamId),
      homeScore: last.scoreHome,
      awayScore: last.scoreAway,
      periods: Math.max(...g.events.map((e) => e.period)),
      firstPlay,
      playCount: g.plays.length,
      firstPoss: possBase,
      possCount: g.possessions.length,
      integrity: required.reduce((m, c, k) => m | ((c.mismatches.length === 0 ? 1 : 0) << k), 0),
      corrections: g.corrections.length,
      videoLive: live,
      videoRetired: retired,
      t0: raw.actions.reduce((m, a) => (a.timeActual && a.timeActual < m ? a.timeActual : m), "9999"),
    });

    // ── per-game detail ──
    const types: string[] = [];
    const floors: number[][] = [];
    const floorKey = new Map<string, number>();
    const d: GameDetail = {
      id: g.gameId,
      n: [],
      period: [],
      clock: [],
      wall: [],
      type: [],
      team: [],
      person: [],
      sh: [],
      sa: [],
      poss: [],
      floor: [],
      desc: [],
      types,
      floors,
      video: {},
      corrections: g.corrections,
      checks: rec.checks.map((c) => ({ ...c, mismatches: c.mismatches.slice(0, 50) })),
    };
    for (const e of g.events) {
      d.n.push(e.n);
      d.period.push(e.period);
      d.clock.push(Math.round(e.clock * 10));
      d.wall.push(Math.round(e.wall / 100));
      d.type.push(dict(types, e.sub ? `${e.type}/${e.sub}` : e.type));
      const ti = e.teamId ? teamIndex(e.teamId) : 255;
      d.team.push(ti < 0 ? 255 : ti);
      d.person.push(pi(e.personId));
      d.sh.push(e.scoreHome);
      d.sa.push(e.scoreAway);
      d.poss.push(e.poss >= 0 ? possBase + e.poss : -1);
      const fl = [...e.floor[0].map(pi).sort((a, b) => a - b), ...e.floor[1].map(pi).sort((a, b) => a - b)];
      const k = fl.join(",");
      let fi = floorKey.get(k);
      if (fi === undefined) {
        fi = floors.length;
        floors.push(fl);
        floorKey.set(k, fi);
      }
      d.floor.push(fi);
      d.desc.push(e.desc);
    }
    for (const v of raw.video) {
      const st = video.get(`${g.gameId}:${v.actionNumber}`);
      d.video[v.actionNumber] = st?.status === "retired" ? `retired:${v.url}` : v.url;
    }
    writeFileSync(join(outDir, "games", `${g.gameId}.json`), JSON.stringify(d));
  });

  // ── header + binary ──
  const header: BundleHeader = {
    version: 1,
    plays: nPlays,
    possessions: nPoss,
    playColumns: play.refs,
    possColumns: poss.refs,
    bytes: poss.end,
  };
  const hjson = Buffer.from(JSON.stringify(header), "utf8");
  const hlen = Math.ceil((8 + hjson.length) / 4) * 4 - 8;
  const out = Buffer.alloc(8 + hlen + data.byteLength, 0x20);
  out.write(MAGIC, 0, "ascii");
  out.writeUInt32LE(hlen, 4);
  hjson.copy(out, 8);
  Buffer.from(data).copy(out, 8 + hlen);
  writeFileSync(join(outDir, "plays.bin.gz"), gzipSync(out, { level: 9 }));

  // ── meta ──
  const checkTotals = new Map<string, BundleMeta["checks"][number]>();
  for (const r of recs)
    for (const c of r.checks) {
      const t = checkTotals.get(c.name) ?? { name: c.name, source: c.source, required: c.required, checked: 0, mismatches: 0 };
      t.checked += c.checked;
      t.mismatches += c.mismatches.length;
      checkTotals.set(c.name, t);
    }
  const meta: BundleMeta = {
    version: 1,
    generated: new Date().toISOString(),
    season: "2023-24",
    focusTeam: teamIndex(TEAM_BY_ID.get(1610612744)!.id),
    source: "cdn.nba.com liveData playbyplay · stats.nba.com playbyplayv3, shotchartdetail, videoeventsasset · boxscoretraditionalv3",
    games,
    players,
    shotTypes,
    descriptors,
    checks: [...checkTotals.values()],
    totals: {
      plays: nPlays,
      possessions: nPoss,
      events: parsed.reduce((s, g) => s + g.events.length, 0),
      corrections: parsed.reduce((s, g) => s + g.corrections.length, 0),
    },
  };
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta));
}
