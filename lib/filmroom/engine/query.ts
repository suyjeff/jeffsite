// Query engine: field registry, value resolution, facet bitmaps, AST → bitset compiler, and autocomplete with
// live result counts. Facets are built once on load (a few ms); every query after that is bitset algebra plus, for
// numeric ranges, a single pass over one typed column.

import { Bitset } from "./bitset";
import { parse, print, terms, type Diagnostic, type Node, type Token, type Value, LINEUP_FIELDS } from "./dsl";
import type { Store } from "./store";
import { KIND, QUAL, FLAG, VIDEO, START_TYPES } from "../core/format";
import { TEAMS, DIVISIONS, CONFERENCES } from "../core/teams";
import { ZONES, zoneMatches } from "../core/court";
import { DIMS, DIM_BY_FIELD, type Tag } from "../tags/ontology";

export interface FieldInfo {
  name: string;
  aliases: string[];
  doc: string;
  example: string;
  group: "who" | "shot" | "context" | "lineup" | "tactical" | "film";
}

export const FIELDS: FieldInfo[] = [
  { name: "shooter", aliases: ["s"], doc: "Shooter on a field goal or free-throw trip", example: "shooter:curry", group: "who" },
  { name: "player", aliases: ["p", "by", "actor"], doc: "Player who made the play (shot, turnover, trip)", example: "player:green", group: "who" },
  { name: "ast", aliases: ["assist", "assisted"], doc: "Assisted (true/false) or by whom", example: "ast:true", group: "who" },
  { name: "stl", aliases: ["steal"], doc: "Stolen (true/false) or by whom", example: "stl:true", group: "who" },
  { name: "blk", aliases: ["block", "blocked"], doc: "Blocked (true/false) or by whom", example: "blk:true", group: "who" },
  { name: "fouler", aliases: ["foul"], doc: "Defender whose foul sent the trip", example: "fouler:james", group: "who" },
  { name: "shot", aliases: ["st"], doc: "3pt, 2pt, fg, ft, dunk, layup, jumper, hook, pullup, stepback…", example: "shot:3pt", group: "shot" },
  { name: "result", aliases: ["r", "res"], doc: "make or miss", example: "result:make", group: "shot" },
  { name: "zone", aliases: ["z"], doc: "Court zone family: right_wing, corner_3, nail, elbow, restricted_area…", example: "zone:right_wing", group: "shot" },
  { name: "dist", aliases: ["d", "ft"], doc: "Shot distance in feet", example: "dist:>=28", group: "shot" },
  { name: "pts", aliases: ["points"], doc: "Points on the play", example: "pts:>=3", group: "shot" },
  { name: "type", aliases: ["kind"], doc: "fga, tov or ft", example: "type:tov", group: "shot" },
  { name: "tov", aliases: ["turnover"], doc: "Turnover type: bad_pass, lost_ball, traveling, offensive_foul…", example: "tov:bad_pass", group: "shot" },
  { name: "and1", aliases: [], doc: "And-one", example: "and1:true", group: "shot" },
  { name: "q", aliases: ["period", "qtr"], doc: "Period: 1–4, ot, ranges", example: "q:3", group: "context" },
  { name: "clock", aliases: ["c", "time"], doc: "Time left in the period (m:ss)", example: "clock:<2:00", group: "context" },
  { name: "margin", aliases: ["m", "diff"], doc: "Offense's score margin before the play", example: "margin:-5..5", group: "context" },
  { name: "off", aliases: ["team", "o"], doc: "Team on offense", example: "off:gsw", group: "context" },
  { name: "def", aliases: ["defense"], doc: "Team on defense", example: "def:lal", group: "context" },
  { name: "opp", aliases: ["vs", "opponent"], doc: "Golden State's opponent", example: "opp:phx", group: "context" },
  { name: "opp.div", aliases: ["div", "division"], doc: "Opponent's division", example: "opp.div:pacific", group: "context" },
  { name: "opp.conf", aliases: ["conf", "conference"], doc: "Opponent's conference", example: "opp.conf:east", group: "context" },
  { name: "side", aliases: [], doc: "Golden State on off(ense) or def(ense)", example: "side:off", group: "context" },
  { name: "venue", aliases: ["at", "loc"], doc: "Golden State home or away", example: "venue:home", group: "context" },
  { name: "game", aliases: ["g"], doc: "Game id or date (YYYY-MM-DD), ranges allowed", example: "game:2024-02-22", group: "context" },
  { name: "date", aliases: [], doc: "Game date range", example: "date:2024-01-01..2024-02-01", group: "context" },
  { name: "second", aliases: ["2nd", "putback", "oreb"], doc: "Second-chance play (after an offensive rebound)", example: "second:true", group: "context" },
  { name: "fastbreak", aliases: ["fb", "trans"], doc: "Fast-break play", example: "fastbreak:true", group: "context" },
  { name: "fromtov", aliases: ["offtov"], doc: "Play off a turnover", example: "fromtov:true", group: "context" },
  { name: "paint", aliases: [], doc: "Points-in-the-paint attempt", example: "paint:true", group: "context" },
  { name: "poss.start", aliases: ["start"], doc: "How the possession began: dreb, made, tov, steal, period, jump", example: "poss.start:steal", group: "context" },
  { name: "poss.sec", aliases: ["psec"], doc: "Seconds into the possession", example: "poss.sec:<8", group: "context" },
  { name: "lineup", aliases: ["with", "oncourt", "on"], doc: "On (+) or off (−) the floor; values combine with AND", example: "lineup:+green,-looney", group: "lineup" },
  { name: "action", aliases: ["act", "a"], doc: "Tagged screen/trigger action", example: "action:pindown", group: "tactical" },
  { name: "cov", aliases: ["coverage"], doc: "Tagged defensive coverage", example: "cov:drop", group: "tactical" },
  { name: "closeouts", aliases: ["co"], doc: "Tagged closeout count (0, 1, 2+)", example: "closeouts:2+", group: "tactical" },
  { name: "closeout", aliases: ["cot"], doc: "Tagged closeout type: short, flyby, stunt", example: "closeout:flyby", group: "tactical" },
  { name: "contest", aliases: [], doc: "Tagged contest level: open, light, tight", example: "contest:tight", group: "tactical" },
  { name: "read", aliases: ["rq"], doc: "Tagged read quality: good, late, wrong", example: "read:good", group: "tactical" },
  { name: "tagged", aliases: ["tags"], doc: "Has any tactical tag", example: "tagged:true", group: "tactical" },
  { name: "film", aliases: ["video"], doc: "NBA clip status: live, retired, none", example: "film:live", group: "film" },
];

const TACTICAL = new Set(["action", "cov", "closeouts", "closeout", "contest", "read"]);

const FIELD_BY_NAME = new Map<string, FieldInfo>();
for (const f of FIELDS) {
  FIELD_BY_NAME.set(f.name, f);
  for (const a of f.aliases) FIELD_BY_NAME.set(a, f);
}
export const canonicalField = (name: string) => FIELD_BY_NAME.get(name.toLowerCase())?.name ?? null;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[._'’-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const TRUE = new Set(["true", "yes", "y", "1", "t"]);
const FALSE = new Set(["false", "no", "n", "0", "f"]);

export interface QueryResult {
  ast: Node | null;
  canonical: string;
  tokens: Token[];
  diagnostics: Diagnostic[];
  notes: Diagnostic[];
  bits: Bitset;
  rows: Uint32Array;
  ms: number;
}

export interface Suggestion {
  label: string;
  insert: string;
  detail: string;
  count: number | null;
  kind: "field" | "value" | "player" | "team" | "tactic" | "zone";
  replace: [number, number];
}

export class Engine {
  readonly n: number;
  private all: Bitset;
  private eq = new Map<string, Map<number, Bitset>>();
  private tagBits = new Map<string, Bitset>();
  private tagged: Bitset;
  private tags: { tag: Tag; row: number }[] = [];
  private focus: number;
  private oppOfGame: number[];
  playerNames: { idx: number; keys: string[]; focus: boolean; plays: number }[];

  constructor(readonly store: Store) {
    this.n = store.n;
    this.all = Bitset.full(this.n);
    this.tagged = new Bitset(this.n);
    this.focus = store.meta.focusTeam;
    this.oppOfGame = store.meta.games.map((g) => (g.home === this.focus ? g.away : g.home));
    this.playerNames = store.meta.players.map((p, idx) => {
      const keys = idx === 0 ? [] : [norm(p.name), norm(p.last), norm(p.slug), norm(p.short), String(p.id)];
      return { idx, keys, focus: p.team === this.focus, plays: p.plays };
    });
    this.buildFacets();
  }

  private facet(name: string): Map<number, Bitset> {
    let m = this.eq.get(name);
    if (!m) {
      m = new Map();
      this.eq.set(name, m);
    }
    return m;
  }
  private add(name: string, key: number, row: number) {
    const m = this.facet(name);
    let b = m.get(key);
    if (!b) {
      b = new Bitset(this.n);
      m.set(key, b);
    }
    b.set(row);
  }
  get(name: string, key: number): Bitset {
    return this.eq.get(name)?.get(key) ?? new Bitset(this.n);
  }

  private buildFacets() {
    const { p, floor } = this.store;
    for (let i = 0; i < this.n; i++) {
      this.add("actor", p.actor[i], i);
      this.add("assist", p.assist[i], i);
      this.add("block", p.block[i], i);
      this.add("steal", p.steal[i], i);
      this.add("fouler", p.fouler[i], i);
      this.add("kind", p.kind[i], i);
      this.add("value", p.value[i], i);
      this.add("made", p.made[i], i);
      this.add("zone", p.zone[i], i);
      this.add("period", p.period[i], i);
      this.add("off", p.off[i], i);
      this.add("def", p.def[i], i);
      this.add("game", p.game[i], i);
      this.add("opp", this.oppOfGame[p.game[i]], i);
      this.add("shotType", p.shotType[i], i);
      this.add("descriptor", p.descriptor[i], i);
      this.add("video", p.video[i], i);
      for (const [, bit] of Object.entries(QUAL)) if (p.quals[i] & bit) this.add("qual", bit, i);
      for (const [, bit] of Object.entries(FLAG)) if (p.flags[i] & bit) this.add("flag", bit, i);
      this.add("possStart", this.store.s.startType[p.poss[i]], i);
      for (let k = 0; k < 10; k++) this.add("floor", floor[i * 10 + k], i);
    }
  }

  // ── tags ──
  setTags(tags: Tag[]) {
    this.tagBits.clear();
    this.tagged = new Bitset(this.n);
    this.tags = [];
    for (const t of tags) {
      const g = this.store.gameIndex.get(t.game);
      if (g === undefined) continue;
      const row = this.store.rowOf(g, t.action);
      if (row < 0) continue;
      this.tags.push({ tag: t, row });
      this.tagged.set(row);
      for (const d of DIMS) {
        const v = t[d.key];
        if (v === undefined) continue;
        const key = `${d.field}:${v}`;
        let b = this.tagBits.get(key);
        if (!b) this.tagBits.set(key, (b = new Bitset(this.n)));
        b.set(row);
      }
    }
  }

  // ── resolution ──
  resolvePlayers(q: string): number[] {
    const k = norm(q);
    if (!k) return [];
    const score = (p: (typeof this.playerNames)[number]) => {
      if (p.keys.some((x) => x === k)) return 3;
      if (p.keys[0] && p.keys[0].split(" ").includes(k)) return 2;
      if (p.keys.some((x) => x.startsWith(k))) return 1;
      return 0;
    };
    const hits = this.playerNames.filter((p) => p.idx > 0).map((p) => ({ p, s: score(p) })).filter((h) => h.s > 0);
    if (!hits.length) return [];
    const best = Math.max(...hits.map((h) => h.s));
    return hits
      .filter((h) => h.s === best)
      .sort((a, b) => Number(b.p.focus) - Number(a.p.focus) || b.p.plays - a.p.plays)
      .map((h) => h.p.idx);
  }

  resolveTeam(q: string): number {
    const k = norm(q);
    return TEAMS.findIndex((t) => t.tri.toLowerCase() === k || norm(t.name) === k || norm(t.city) === k || norm(`${t.city} ${t.name}`) === k);
  }

  // ── compile ──
  private numeric(col: ArrayLike<number>, values: Value[], parse: (s: string) => number | null, diag: (m: string) => void, scale = 1): Bitset {
    const out = new Bitset(this.n);
    for (const v of values) {
      const a = parse(v.v);
      const b = v.v2 !== undefined ? parse(v.v2) : null;
      if (a === null || (v.op === "range" && b === null)) {
        diag(`not a number: ${v.v}`);
        continue;
      }
      const A = a * scale;
      const B = (b ?? 0) * scale;
      const lo = Math.min(A, B);
      const hi = Math.max(A, B);
      for (let i = 0; i < this.n; i++) {
        const x = col[i];
        let ok = false;
        switch (v.op) {
          case "eq":
            ok = x === A;
            break;
          case "gt":
            ok = x > A;
            break;
          case "ge":
            ok = x >= A;
            break;
          case "lt":
            ok = x < A;
            break;
          case "le":
            ok = x <= A;
            break;
          case "range":
            ok = x >= lo && x <= hi;
            break;
        }
        if (ok) out.set(i);
      }
    }
    return out;
  }

  private bool(v: Value): boolean | null {
    const s = v.v.toLowerCase();
    if (TRUE.has(s)) return true;
    if (FALSE.has(s)) return false;
    return null;
  }

  private orValues(values: Value[], one: (v: Value) => Bitset | null, diag: (m: string) => void, field: string): Bitset {
    let out = new Bitset(this.n);
    for (const v of values) {
      const b = one(v);
      if (!b) diag(`${field}: unknown value "${v.v}"`);
      else out = out.or(b);
    }
    return out;
  }

  private playerFacet(facet: string, values: Value[], diag: (m: string) => void, note: (m: string) => void, field: string, restrict?: Bitset): Bitset {
    const out = this.orValues(
      values,
      (v) => {
        const b = this.bool(v);
        if (b !== null) {
          const none = this.get(facet, 0);
          return b ? this.all.andNot(none) : none;
        }
        const hits = this.resolvePlayers(v.v);
        if (!hits.length) return null;
        if (hits.length > 1) note(`${v.v} → ${this.store.meta.players[hits[0]].name} (also ${hits.slice(1, 3).map((h) => this.store.meta.players[h].name).join(", ")})`);
        return this.get(facet, hits[0]);
      },
      diag,
      field,
    );
    return restrict ? out.and(restrict) : out;
  }

  compileTerm(field: string, values: Value[], diag: (m: string) => void, note: (m: string) => void): Bitset {
    const f = canonicalField(field);
    const { p } = this.store;
    if (!f) {
      diag(`unknown field "${field}"`);
      return this.all;
    }
    const shotOrFt = this.get("kind", KIND.fga).or(this.get("kind", KIND.ft));
    const flagField = (bits: Bitset) =>
      this.orValues(values, (v) => {
        const b = this.bool(v);
        return b === null ? null : b ? bits : this.all.andNot(bits);
      }, diag, f);
    switch (f) {
      case "shooter":
        return this.playerFacet("actor", values, diag, note, f, shotOrFt);
      case "player":
        return this.playerFacet("actor", values, diag, note, f);
      case "ast":
        return this.playerFacet("assist", values, diag, note, f, this.get("made", 1).and(this.get("kind", KIND.fga)));
      case "stl":
        return this.playerFacet("steal", values, diag, note, f, this.get("kind", KIND.tov));
      case "blk":
        return this.playerFacet("block", values, diag, note, f, this.get("kind", KIND.fga));
      case "fouler":
        return this.playerFacet("fouler", values, diag, note, f, this.get("kind", KIND.ft));
      case "shot":
        return this.orValues(values, (v) => this.shotValue(v.v), diag, f);
      case "result":
        return this.orValues(values, (v) => {
          const s = v.v.toLowerCase();
          if (/^(make|made|makes|hit|1|true)$/.test(s)) return this.get("made", 1).and(shotOrFt);
          if (/^(miss|missed|misses|0|false)$/.test(s)) return this.get("made", 0).and(shotOrFt);
          return null;
        }, diag, f);
      case "zone":
        return this.orValues(values, (v) => {
          const q = v.v.toLowerCase().replace(/-/g, "_");
          let b = new Bitset(this.n);
          let any = false;
          ZONES.forEach((z, i) => {
            if (zoneMatches(q, z)) {
              any = true;
              b = b.or(this.get("zone", i));
            }
          });
          return any ? b : null;
        }, diag, f);
      case "dist":
        return this.numeric(p.dist, values, num, diag).and(this.get("kind", KIND.fga));
      case "pts":
        return this.numeric(p.points, values, num, diag);
      case "type":
        return this.orValues(values, (v) => {
          const s = v.v.toLowerCase();
          if (s === "fga" || s === "shot" || s === "fg") return this.get("kind", KIND.fga);
          if (s === "tov" || s === "turnover") return this.get("kind", KIND.tov);
          if (s === "ft" || s === "trip") return this.get("kind", KIND.ft);
          return null;
        }, diag, f);
      case "tov":
        return this.orValues(values, (v) => {
          const b = this.bool(v);
          if (b !== null) return b ? this.get("kind", KIND.tov) : this.all.andNot(this.get("kind", KIND.tov));
          const q = norm(v.v);
          let out = new Bitset(this.n);
          let any = false;
          this.store.meta.shotTypes.forEach((t, i) => {
            if (norm(t) === q || norm(t).replace(/ /g, "") === q.replace(/ /g, "")) {
              any = true;
              out = out.or(this.get("shotType", i));
            }
          });
          this.store.meta.descriptors.forEach((t, i) => {
            if (t && norm(t) === q) {
              any = true;
              out = out.or(this.get("descriptor", i));
            }
          });
          return any ? out.and(this.get("kind", KIND.tov)) : null;
        }, diag, f);
      case "and1":
        return flagField(this.get("flag", FLAG.and1));
      case "q":
        return this.orValues(values, (v) => {
          const s = v.v.toLowerCase();
          if (s === "ot") return this.numeric(p.period, [{ op: "ge", v: "5" }], num, diag);
          const n = num(s.replace(/^q/, ""));
          if (n === null) return null;
          return this.numeric(p.period, [{ ...v, v: String(n), v2: v.v2?.replace(/^q/i, "") }], num, diag);
        }, diag, f);
      case "clock":
        return this.numeric(p.clock, values, clockSec, diag, 10);
      case "margin":
        return this.numeric(p.margin, values, num, diag);
      case "off":
      case "def":
      case "opp":
        return this.orValues(values, (v) => {
          const t = this.resolveTeam(v.v);
          return t < 0 ? null : this.get(f, t);
        }, diag, f);
      case "opp.div":
      case "opp.conf":
        return this.orValues(values, (v) => {
          const s = v.v.toLowerCase();
          const list = f === "opp.div" ? (DIVISIONS as readonly string[]) : (CONFERENCES as readonly string[]);
          if (!list.includes(s)) return null;
          let out = new Bitset(this.n);
          TEAMS.forEach((t, i) => {
            if ((f === "opp.div" ? t.div : t.conf) === s) out = out.or(this.get("opp", i));
          });
          return out;
        }, diag, f);
      case "side":
        return this.orValues(values, (v) => {
          const s = v.v.toLowerCase();
          if (s.startsWith("o")) return this.get("off", this.focus);
          if (s.startsWith("d")) return this.get("def", this.focus);
          return null;
        }, diag, f);
      case "venue":
        return this.orValues(values, (v) => {
          const s = v.v.toLowerCase();
          const home = s === "home" || s === "h";
          if (!home && s !== "away" && s !== "a" && s !== "road") return null;
          let out = new Bitset(this.n);
          this.store.meta.games.forEach((g, gi) => {
            if ((g.home === this.focus) === home) out = out.or(this.get("game", gi));
          });
          return out;
        }, diag, f);
      case "game":
      case "date":
        return this.orValues(values, (v) => this.gameValue(v), diag, f);
      case "second":
        return flagField(this.get("qual", QUAL["2ndchance"]));
      case "fastbreak":
        return flagField(this.get("qual", QUAL.fastbreak));
      case "fromtov":
        return flagField(this.get("qual", QUAL.fromturnover));
      case "paint":
        return flagField(this.get("qual", QUAL.pointsinthepaint));
      case "poss.start":
        return this.orValues(values, (v) => {
          const s = v.v.toLowerCase();
          const map: Record<string, string[]> = {
            dreb: ["dreb"],
            rebound: ["dreb"],
            made: ["made_fg", "made_ft"],
            make: ["made_fg", "made_ft"],
            made_fg: ["made_fg"],
            made_ft: ["made_ft"],
            tov: ["live_tov", "dead_tov"],
            steal: ["live_tov"],
            live_tov: ["live_tov"],
            dead_tov: ["dead_tov"],
            period: ["period_start"],
            jump: ["jump_ball"],
            dead: ["dead_ball", "dead_tov"],
          };
          const keys = map[s];
          if (!keys) return null;
          let out = new Bitset(this.n);
          for (const k of keys) out = out.or(this.get("possStart", START_TYPES.indexOf(k as never)));
          return out;
        }, diag, f);
      case "poss.sec":
        return this.numeric(p.possSec, values, num, diag, 10);
      case "lineup": {
        let out = this.all;
        for (const v of values) {
          const hits = this.resolvePlayers(v.v);
          if (!hits.length) {
            diag(`lineup: unknown player "${v.v}"`);
            continue;
          }
          if (hits.length > 1) note(`${v.v} → ${this.store.meta.players[hits[0]].name}`);
          const on = this.get("floor", hits[0]);
          out = v.sign === "-" ? out.andNot(on) : out.and(on);
        }
        return out;
      }
      case "tagged":
        return flagField(this.tagged);
      case "action":
      case "cov":
      case "closeout":
      case "contest":
      case "read":
      case "closeouts": {
        const dim = DIM_BY_FIELD.get(f)!;
        return this.orValues(values, (v) => {
          if (f === "closeouts") {
            const n = num(v.v);
            if (n === null) return null;
            let out = new Bitset(this.n);
            for (const c of dim.values) {
              const x = Number(c);
              const ok =
                v.op === "eq" ? (n >= 2 ? x >= 2 : x === n) : v.op === "ge" ? x >= n : v.op === "gt" ? x > n : v.op === "le" ? x <= n : v.op === "lt" ? x < n : x >= n && x <= Number(v.v2);
              if (ok) out = out.or(this.tagBits.get(`${f}:${c}`) ?? new Bitset(this.n));
            }
            return out;
          }
          const s = v.v.toLowerCase().replace(/-/g, "_");
          if (!(dim.values as readonly string[]).includes(s)) return null;
          return this.tagBits.get(`${f}:${s}`) ?? new Bitset(this.n);
        }, diag, f);
      }
      case "film":
        return this.orValues(values, (v) => {
          const s = v.v.toLowerCase();
          const k = (VIDEO as Record<string, number>)[s];
          return k === undefined ? null : this.get("video", k);
        }, diag, f);
    }
    diag(`unhandled field ${f}`);
    return this.all;
  }

  private shotValue(raw: string): Bitset | null {
    const s = raw.toLowerCase().replace(/[-_]/g, " ").trim();
    const fga = this.get("kind", KIND.fga);
    if (s === "3pt" || s === "3" || s === "three" || s === "3pa") return this.get("value", 3).and(fga);
    if (s === "2pt" || s === "2" || s === "two") return this.get("value", 2).and(fga);
    if (s === "fg" || s === "fga") return fga;
    if (s === "ft" || s === "fta") return this.get("kind", KIND.ft);
    const alias: Record<string, string> = { jumper: "jump shot", stepback: "step back", floater: "floating", lob: "alley oop", oop: "alley oop", putback: "putback", tip: "tip" };
    const q = alias[s] ?? s;
    let out = new Bitset(this.n);
    let any = false;
    this.store.meta.shotTypes.forEach((t, i) => {
      if (norm(t) === q) {
        any = true;
        out = out.or(this.get("shotType", i));
      }
    });
    this.store.meta.descriptors.forEach((t, i) => {
      if (!t) return;
      const words = ` ${norm(t)} `;
      if (words.includes(` ${q} `)) {
        any = true;
        out = out.or(this.get("descriptor", i));
      }
    });
    return any ? out.and(fga) : null;
  }

  private gameValue(v: Value): Bitset | null {
    const games = this.store.meta.games;
    const keyOf = (s: string): number | string | null => {
      if (/^00?2\d{7}$/.test(s)) return String(Number(s));
      if (/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return s;
      return null;
    };
    const a = keyOf(v.v);
    if (a === null) return null;
    let out = new Bitset(this.n);
    let any = false;
    games.forEach((g, gi) => {
      let ok: boolean;
      if (v.op === "range") {
        const b = keyOf(v.v2 ?? "");
        if (b === null) return;
        ok = typeof a === "string" && /-/.test(a) ? g.date >= a && g.date <= String(b) + (String(b).length === 7 ? "-99" : "") : g.id >= String(a) && g.id <= String(b);
      } else if (typeof a === "string" && a.includes("-")) {
        const d = g.date;
        ok = v.op === "eq" ? d.startsWith(a) : v.op === "ge" ? d >= a : v.op === "gt" ? d > a : v.op === "le" ? d <= a : d < a;
      } else ok = g.id === a;
      if (ok) {
        any = true;
        out = out.or(this.get("game", gi));
      }
    });
    return any || v.op !== "eq" ? out : null;
  }

  private bare(word: string, sign: "+" | undefined, diag: (m: string) => void, note: (m: string) => void): Bitset {
    if (sign === "+") return this.compileTerm("lineup", [{ op: "eq", v: word, sign: "+" }], diag, note);
    const w = word.toLowerCase();
    // q3 / ot
    if (/^q[1-4]$/.test(w)) return this.compileTerm("q", [{ op: "eq", v: w.slice(1) }], diag, note);
    if (w === "ot") return this.compileTerm("q", [{ op: "eq", v: "ot" }], diag, note);
    if (/^(make|made|miss|missed)$/.test(w)) return this.compileTerm("result", [{ op: "eq", v: w }], diag, note);
    const s = this.shotValue(w);
    if (s && /^(3pt|2pt|ft|fg|dunk|layup|jumper|hook|pullup|stepback|floater|putback|tip|fadeaway|alley.?oop)$/.test(w)) return s;
    for (const d of DIMS) if ((d.values as readonly string[]).includes(w) && d.field !== "closeouts") return this.compileTerm(d.field, [{ op: "eq", v: w }], diag, note);
    if (ZONES.some((z) => zoneMatches(w, z)) && /[a-z]/.test(w)) return this.compileTerm("zone", [{ op: "eq", v: w }], diag, note);
    if ((DIVISIONS as readonly string[]).includes(w)) return this.compileTerm("opp.div", [{ op: "eq", v: w }], diag, note);
    const team = this.resolveTeam(w);
    if (team >= 0) return this.get("off", team).or(this.get("def", team));
    const players = this.resolvePlayers(w);
    if (players.length) {
      if (players.length > 1) note(`${w} → ${this.store.meta.players[players[0]].name}`);
      return this.get("actor", players[0]);
    }
    diag(`no field, player, team or tactic called "${word}"`);
    return this.all;
  }

  /** Does one tag satisfy a tactical term? */
  private tagSatisfies(t: Tag, field: string, values: Value[]): boolean {
    const dim = DIM_BY_FIELD.get(field)!;
    const v0 = t[dim.key];
    if (v0 === undefined) return false;
    return values.some((v) => {
      if (field === "closeouts") {
        const x = Number(v0);
        const n = Number(v.v);
        if (!Number.isFinite(n)) return false;
        switch (v.op) {
          case "eq":
            return n >= 2 ? x >= 2 : x === n;
          case "ge":
            return x >= n;
          case "gt":
            return x > n;
          case "le":
            return x <= n;
          case "lt":
            return x < n;
          case "range":
            return x >= n && x <= Number(v.v2);
        }
      }
      return v0 === v.v.toLowerCase().replace(/-/g, "_");
    });
  }

  /**
   * Tactical terms joined by AND bind to one tag: `action:pindown closeouts:2+` finds plays where a single stamped
   * window is both a pindown and drew 2+ closeouts — not a pindown tag beside some other 2-closeout tag.
   */
  private jointTactical(group: (Node & { t: "term" })[]): Bitset {
    const out = new Bitset(this.n);
    const fields = group.map((g) => ({ f: canonicalField(g.field)!, values: g.values }));
    for (const { tag, row } of this.tags) if (fields.every(({ f, values }) => this.tagSatisfies(tag, f, values))) out.set(row);
    return out;
  }

  compile(n: Node | null, diag: (m: string, span?: [number, number]) => void, note: (m: string, span?: [number, number]) => void): Bitset {
    if (!n) return this.all;
    switch (n.t) {
      case "and": {
        let out = this.all;
        const tactical = n.a.filter((c): c is Node & { t: "term" } => c.t === "term" && TACTICAL.has(canonicalField(c.field) ?? ""));
        if (tactical.length > 1) out = out.and(this.jointTactical(tactical));
        for (const c of n.a) if (!(tactical.length > 1 && tactical.includes(c as never))) out = out.and(this.compile(c, diag, note));
        return out;
      }
      case "or": {
        let out = new Bitset(this.n);
        for (const c of n.a) out = out.or(this.compile(c, diag, note));
        return out;
      }
      case "not":
        return this.compile(n.a, diag, note).not();
      case "term":
        return this.compileTerm(n.field, n.values, (m) => diag(m, n.span), (m) => note(m, n.span));
      case "bare":
        return this.bare(n.word, n.sign, (m) => diag(m, n.span), (m) => note(m, n.span));
    }
  }

  run(src: string): QueryResult {
    const t0 = performance.now();
    const { ast, tokens, diagnostics } = parse(src);
    const notes: Diagnostic[] = [];
    const bits = this.compile(
      ast,
      (m, span) => diagnostics.push({ start: span?.[0] ?? 0, end: span?.[1] ?? src.length, message: m }),
      (m, span) => notes.push({ start: span?.[0] ?? 0, end: span?.[1] ?? src.length, message: m }),
    );
    const rows = bits.toArray();
    return { ast, canonical: print(ast), tokens, diagnostics, notes, bits, rows, ms: performance.now() - t0 };
  }

  /** Bits for the query with one character range removed (the token being edited). */
  private baseWithout(src: string, start: number, end: number): Bitset {
    const rest = src.slice(0, start) + " " + src.slice(end);
    const { ast } = parse(rest);
    return this.compile(ast, () => {}, () => {});
  }

  suggest(src: string, cursor: number, limit = 12): Suggestion[] {
    // Find the whitespace-delimited word under the cursor.
    let s = cursor;
    while (s > 0 && !/[\s()]/.test(src[s - 1])) s--;
    let e = cursor;
    while (e < src.length && !/[\s()]/.test(src[e])) e++;
    let word = src.slice(s, cursor);
    let neg = "";
    if (word.startsWith("-") || word.startsWith("!")) {
      neg = word[0];
      word = word.slice(1);
    }
    const base = this.baseWithout(src, s, e);
    const out: Suggestion[] = [];
    const colon = word.indexOf(":");
    const countOf = (b: Bitset | null) => (b ? (neg ? base.andCount(b.not()) : base.andCount(b)) : null);

    if (colon < 0) {
      const w = word.toLowerCase();
      if (w.startsWith("+")) {
        for (const idx of this.playerCandidates(w.slice(1), 8)) {
          const pl = this.store.meta.players[idx];
          out.push({ label: `+${this.handle(idx)}`, insert: `lineup:+${this.handle(idx)}`, detail: `${pl.name} on floor`, count: base.andCount(this.get("floor", idx)), kind: "player", replace: [s, e] });
        }
        return out;
      }
      for (const f of FIELDS) {
        if (!w || f.name.startsWith(w) || f.aliases.some((a) => a.startsWith(w)))
          out.push({ label: `${f.name}:`, insert: `${neg}${f.name}:`, detail: f.doc, count: null, kind: "field", replace: [s, e] });
      }
      if (w.length >= 2) {
        for (const idx of this.playerCandidates(w, 5)) {
          const pl = this.store.meta.players[idx];
          const key = this.handle(idx);
          out.push({ label: `shooter:${key}`, insert: `${neg}shooter:${key}`, detail: pl.name, count: countOf(this.get("actor", idx)), kind: "player", replace: [s, e] });
        }
        for (const d of DIMS)
          for (const v of d.values)
            if (v.startsWith(w) && d.field !== "closeouts")
              out.push({ label: `${d.field}:${v}`, insert: `${neg}${d.field}:${v}`, detail: `${d.label} · ${d.names[v as never]}`, count: countOf(this.tagBits.get(`${d.field}:${v}`) ?? new Bitset(this.n)), kind: "tactic", replace: [s, e] });
      }
      return rank(out, w).slice(0, limit);
    }

    const field = canonicalField(word.slice(0, colon));
    const rawVal = word.slice(colon + 1);
    const lastSep = Math.max(rawVal.lastIndexOf(","), rawVal.lastIndexOf("|"));
    const prefixVals = rawVal.slice(0, lastSep + 1);
    let partial = rawVal.slice(lastSep + 1);
    let sign = "";
    if (field === "lineup" && (partial.startsWith("+") || partial.startsWith("-"))) {
      sign = partial[0];
      partial = partial.slice(1);
    }
    const head = `${neg}${word.slice(0, colon + 1)}${prefixVals}${sign}`;
    if (!field) return [];
    const push = (val: string, detail: string, bits: Bitset | null, kind: Suggestion["kind"] = "value") =>
      out.push({ label: val, insert: head + val, detail, count: field === "lineup" ? (bits ? (sign === "-" ? base.andCount(bits.not()) : base.andCount(bits)) : null) : countOf(bits), kind, replace: [s, e] });
    const p = partial.toLowerCase();
    const values = this.valuesFor(field, p);
    for (const v of values) push(v.value, v.detail, v.bits, v.kind);
    return rank(out, p, true).slice(0, limit);
  }

  /** The shortest handle that resolves back to this player: last name, else the full slug. */
  handle(idx: number): string {
    const pl = this.store.meta.players[idx];
    const last = shortKey(pl);
    return this.resolvePlayers(last)[0] === idx ? last : pl.slug.replace(/-/g, "_");
  }

  private playerCandidates(prefix: string, limit: number): number[] {
    const k = norm(prefix);
    if (!k) return [];
    return this.playerNames
      .filter((p) => p.idx > 0 && p.keys.some((x) => x.startsWith(k) || x.split(" ").some((part) => part.startsWith(k))))
      .sort((a, b) => Number(b.focus) - Number(a.focus) || b.plays - a.plays)
      .slice(0, limit)
      .map((p) => p.idx);
  }

  valuesFor(field: string, p: string): { value: string; detail: string; bits: Bitset | null; kind: Suggestion["kind"] }[] {
    const out: { value: string; detail: string; bits: Bitset | null; kind: Suggestion["kind"] }[] = [];
    const meta = this.store.meta;
    const matchP = (s: string) => !p || s.toLowerCase().startsWith(p) || s.toLowerCase().split(/[_\s]/).some((x) => x.startsWith(p));
    const playerField = (facet: string, extra?: Bitset) => {
      for (const idx of this.playerCandidates(p || "", 10).concat(p ? [] : [])) {
        const pl = meta.players[idx];
        const b = this.get(facet, idx);
        out.push({ value: this.handle(idx), detail: pl.name, bits: extra ? b.and(extra) : b, kind: "player" });
      }
    };
    switch (field) {
      case "shooter":
      case "player":
        if (!p) {
          // Most frequent shooters on the focus team first.
          meta.players
            .map((pl, idx) => ({ pl, idx }))
            .filter(({ pl, idx }) => idx > 0 && pl.team === this.focus)
            .slice(0, 10)
            .forEach(({ pl, idx }) => out.push({ value: this.handle(idx), detail: pl.name, bits: this.get("actor", idx), kind: "player" }));
        } else playerField("actor");
        break;
      case "ast":
      case "stl":
      case "blk":
      case "fouler": {
        const facet = { ast: "assist", stl: "steal", blk: "block", fouler: "fouler" }[field]!;
        for (const b of ["true", "false"]) if (matchP(b)) out.push({ value: b, detail: b === "true" ? "yes" : "no", bits: this.compileTerm(field, [{ op: "eq", v: b }], () => {}, () => {}), kind: "value" });
        if (p) playerField(facet);
        else
          meta.players
            .map((pl, idx) => ({ pl, idx }))
            .filter(({ pl, idx }) => idx > 0 && pl.team === this.focus)
            .slice(0, 8)
            .forEach(({ pl, idx }) => out.push({ value: this.handle(idx), detail: pl.name, bits: this.get(facet, idx), kind: "player" }));
        break;
      }
      case "lineup":
        if (!p)
          meta.players
            .map((pl, idx) => ({ pl, idx }))
            .filter(({ pl, idx }) => idx > 0 && pl.team === this.focus)
            .slice(0, 12)
            .forEach(({ pl, idx }) => out.push({ value: this.handle(idx), detail: pl.name, bits: this.get("floor", idx), kind: "player" }));
        else
          for (const idx of this.playerCandidates(p, 10)) {
            const pl = meta.players[idx];
            out.push({ value: this.handle(idx), detail: pl.name, bits: this.get("floor", idx), kind: "player" });
          }
        break;
      case "zone":
        for (const fam of ZONE_FAMILIES) if (matchP(fam)) out.push({ value: fam, detail: ZONES.filter((z) => zoneMatches(fam, z)).length > 1 ? "family" : "zone", bits: this.compileTerm("zone", [{ op: "eq", v: fam }], () => {}, () => {}), kind: "zone" });
        break;
      case "shot":
        for (const v of ["3pt", "2pt", "fg", "ft", "dunk", "layup", "jumper", "hook", "pullup", "stepback", "floater", "fadeaway", "driving", "cutting", "putback", "tip", "alley_oop", "turnaround"])
          if (matchP(v)) out.push({ value: v, detail: "shot", bits: this.shotValue(v), kind: "value" });
        break;
      case "result":
        for (const v of ["make", "miss"]) if (matchP(v)) out.push({ value: v, detail: "", bits: this.compileTerm("result", [{ op: "eq", v }], () => {}, () => {}), kind: "value" });
        break;
      case "type":
        for (const v of ["fga", "tov", "ft"]) if (matchP(v)) out.push({ value: v, detail: "", bits: this.compileTerm("type", [{ op: "eq", v }], () => {}, () => {}), kind: "value" });
        break;
      case "tov":
        for (const t of new Set(this.tovTypes())) if (matchP(t)) out.push({ value: t, detail: "turnover", bits: this.compileTerm("tov", [{ op: "eq", v: t }], () => {}, () => {}), kind: "value" });
        break;
      case "q":
        for (const v of ["1", "2", "3", "4", "ot"]) if (matchP(v)) out.push({ value: v, detail: v === "ot" ? "overtime" : `quarter ${v}`, bits: this.compileTerm("q", [{ op: "eq", v }], () => {}, () => {}), kind: "value" });
        break;
      case "clock":
        for (const v of ["<2:00", "<5:00", "<0:24", ">6:00"]) out.push({ value: v, detail: "time left", bits: this.compileTerm("clock", [{ op: v.startsWith("<") ? "lt" : "gt", v: v.slice(1) }], () => {}, () => {}), kind: "value" });
        break;
      case "margin":
        for (const v of ["-5..5", "<0", ">0", ">=10", "<=-10"]) out.push({ value: v, detail: "offense margin", bits: null, kind: "value" });
        break;
      case "dist":
        for (const v of [">=28", "<4", "10..16", "24..27"]) out.push({ value: v, detail: "feet", bits: null, kind: "value" });
        break;
      case "off":
      case "def":
      case "opp":
        TEAMS.forEach((t, i) => {
          if (matchP(t.tri) || matchP(t.name)) {
            const b = this.get(field, i);
            if (b.count()) out.push({ value: t.tri.toLowerCase(), detail: `${t.city} ${t.name}`, bits: b, kind: "team" });
          }
        });
        break;
      case "opp.div":
        for (const d of DIVISIONS) if (matchP(d)) out.push({ value: d, detail: TEAMS.filter((t) => t.div === d).map((t) => t.tri).join(" "), bits: this.compileTerm("opp.div", [{ op: "eq", v: d }], () => {}, () => {}), kind: "value" });
        break;
      case "opp.conf":
        for (const d of CONFERENCES) if (matchP(d)) out.push({ value: d, detail: "", bits: this.compileTerm("opp.conf", [{ op: "eq", v: d }], () => {}, () => {}), kind: "value" });
        break;
      case "side":
        for (const v of ["off", "def"]) if (matchP(v)) out.push({ value: v, detail: v === "off" ? "Golden State offense" : "Golden State defense", bits: this.compileTerm("side", [{ op: "eq", v }], () => {}, () => {}), kind: "value" });
        break;
      case "venue":
        for (const v of ["home", "away"]) if (matchP(v)) out.push({ value: v, detail: "", bits: this.compileTerm("venue", [{ op: "eq", v }], () => {}, () => {}), kind: "value" });
        break;
      case "game":
      case "date":
        meta.games.forEach((g, gi) => {
          const opp = TEAMS[g.home === this.focus ? g.away : g.home];
          const label = `${g.date} ${g.home === this.focus ? "vs" : "@"} ${opp.tri}`;
          if (!p || g.date.startsWith(p) || g.id.startsWith(p) || opp.tri.toLowerCase().startsWith(p)) out.push({ value: g.date, detail: label, bits: this.get("game", gi), kind: "value" });
        });
        break;
      case "poss.start":
        for (const v of ["dreb", "made", "tov", "steal", "period", "jump", "dead"]) if (matchP(v)) out.push({ value: v, detail: "possession start", bits: this.compileTerm("poss.start", [{ op: "eq", v }], () => {}, () => {}), kind: "value" });
        break;
      case "poss.sec":
        for (const v of ["<8", "8..16", ">=18"]) out.push({ value: v, detail: "seconds into possession", bits: null, kind: "value" });
        break;
      case "film":
        for (const v of ["live", "retired", "none"]) if (matchP(v)) out.push({ value: v, detail: "NBA clip", bits: this.get("video", (VIDEO as Record<string, number>)[v]), kind: "value" });
        break;
      case "closeouts":
        for (const v of ["0", "1", "2+"]) out.push({ value: v, detail: "closeouts", bits: this.compileTerm("closeouts", [v === "2+" ? { op: "ge", v: "2" } : { op: "eq", v }], () => {}, () => {}), kind: "tactic" });
        break;
      case "and1":
      case "second":
      case "fastbreak":
      case "fromtov":
      case "paint":
      case "tagged":
        for (const v of ["true", "false"]) if (matchP(v)) out.push({ value: v, detail: "", bits: this.compileTerm(field, [{ op: "eq", v }], () => {}, () => {}), kind: "value" });
        break;
      default: {
        const dim = DIM_BY_FIELD.get(field);
        if (dim) for (const v of dim.values) if (matchP(v)) out.push({ value: v, detail: dim.names[v as never], bits: this.tagBits.get(`${field}:${v}`) ?? new Bitset(this.n), kind: "tactic" });
      }
    }
    return out;
  }

  private tovTypes(): string[] {
    const out: string[] = [];
    const tov = this.get("kind", KIND.tov);
    this.store.meta.shotTypes.forEach((t, i) => {
      if (this.get("shotType", i).andCount(tov) > 0) out.push(t.toLowerCase().replace(/[\s-]+/g, "_"));
    });
    return out;
  }
}

export const ZONE_FAMILIES = [
  "right_wing",
  "left_wing",
  "corner_3",
  "wing_3",
  "wing",
  "corner",
  "elbow",
  "short_corner",
  "mid",
  "3",
  "right",
  "left",
  "top",
  ...ZONES,
].filter((v, i, a) => a.indexOf(v) === i);

function num(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function clockSec(s: string): number | null {
  const m = /^(\d+):(\d{1,2}(?:\.\d)?)$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return num(s);
}

/** The shortest unambiguous handle for a player in queries: last name, or first-last when shared. */
export function shortKey(pl: { name: string; last: string; slug: string }): string {
  return pl.last.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function rank(list: Suggestion[], w: string, keepOrder = false): Suggestion[] {
  if (keepOrder) return list;
  const score = (s: Suggestion) => {
    const l = s.label.toLowerCase();
    return (l.startsWith(w) ? 0 : 1) + (s.kind === "field" ? 0 : 0.5) - (s.count ?? 0) / 1e6;
  };
  return [...list].sort((a, b) => score(a) - score(b));
}

export { LINEUP_FIELDS, terms, print };
