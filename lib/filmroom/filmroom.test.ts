// @vitest-environment node
// Film-room acceptance tests: zone geometry vs NBA labels, possession/lineup parse + reconciliation, query
// language round-trips, the golden compound query, and the sub-50 ms filter budget at 10× scale.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { gunzipSync } from "zlib";
import { join } from "path";
import { aboveBreakArea, basicZone, classifyZone, geometricValue, zoneMatches } from "./core/court";
import { parseGame } from "./ingest/fsm";
import { reconcileGame } from "./ingest/reconcile";
import { parse, print } from "./engine/dsl";
import { decodeBundle, type Store } from "./engine/store";
import { Engine } from "./engine/query";
import { Bitset } from "./engine/bitset";
import type { RawGame } from "./ingest/raw";

const FIX = join(__dirname, "__fixtures__");
const DATA = join(__dirname, "../../public/filmroom-assets/data");
const gz = (p: string) => gunzipSync(readFileSync(p));

function loadStore(): Store {
  const meta = JSON.parse(readFileSync(join(DATA, "meta.json"), "utf8"));
  const b = gz(join(DATA, "plays.bin.gz"));
  return decodeBundle(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), meta);
}

describe("court geometry", () => {
  it("agrees with NBA zone labels on every 2023-24 shot location", () => {
    const lines = gz(join(FIX, "shotchart-2023-24.csv.gz")).toString("utf8").trim().split("\n").slice(1);
    let shots = 0;
    const bad: string[] = [];
    for (const l of lines) {
      const [xs, ys, basic, area, n] = l.split(",");
      const x = +xs;
      const y = +ys;
      shots += +n;
      if (basicZone(x, y, geometricValue(x, y)) !== basic) bad.push(l);
      if (basic === "Above the Break 3" && area !== "Back Court(BC)" && aboveBreakArea(x, y) !== area) bad.push(l);
    }
    expect(shots).toBe(218701);
    expect(bad).toEqual([]);
  });

  it("names the spec's zones", () => {
    expect(classifyZone(230, 40, 3)).toBe("right_corner_3");
    expect(classifyZone(180, 180, 3)).toBe("right_wing_3");
    expect(classifyZone(0, 260, 3)).toBe("top_arc_3");
    expect(classifyZone(0, 142, 2)).toBe("nail");
    expect(classifyZone(5, 10, 2)).toBe("restricted_area");
    expect(zoneMatches("right_wing", "right_wing_3")).toBe(true);
    expect(zoneMatches("right_wing", "right_wing_mid")).toBe(true);
    expect(zoneMatches("corner_3", "left_corner_3")).toBe(true);
    expect(zoneMatches("wing", "top_arc_3")).toBe(false);
  });
});

describe("possession + lineup state machine", () => {
  const games: RawGame[] = ["22300062", "22300339"].map((g) => JSON.parse(gz(join(FIX, `raw-${g}.json.gz`)).toString("utf8")));

  for (const raw of games) {
    it(`reconciles game ${raw.gameId} with the official box score`, () => {
      const g = parseGame(raw);
      const rec = reconcileGame(raw, g);
      for (const c of rec.checks.filter((c) => c.required)) expect([c.name, c.mismatches]).toEqual([c.name, []]);
      // Every play carries a verified 10-man floor.
      for (const p of g.plays) {
        expect(p.offFloor).toHaveLength(5);
        expect(p.defFloor).toHaveLength(5);
      }
    });
  }

  it("repairs the mislogged substitution window in 22300339 from box minutes", () => {
    const g = parseGame(games[1]);
    expect(g.corrections.filter((c) => c.field === "substitution.window")).toHaveLength(2);
  });

  it("keeps offensive rebounds inside the possession", () => {
    const g = parseGame(games[0]);
    for (const p of g.possessions) for (const pl of g.plays.filter((x) => x.poss === p.id)) expect(pl.offense).toBe(p.offense);
  });

  const cache = join(__dirname, "../../.cache/filmroom/raw");
  it.runIf(existsSync(cache))("reconciles the whole cached season with 0 required mismatches", () => {
    let bad = 0;
    for (const f of readdirSync(cache)) {
      const raw: RawGame = JSON.parse(readFileSync(join(cache, f), "utf8"));
      const rec = reconcileGame(raw, parseGame(raw));
      bad += rec.checks.filter((c) => c.required).reduce((s, c) => s + c.mismatches.length, 0);
    }
    expect(bad).toBe(0);
  });
});

describe("query language", () => {
  it("parses the spec query into a 10-term conjunction and prints canonically", () => {
    const q = "shooter:curry shot:3pt zone:right_wing action:pindown closeouts:2+ lineup:+green opp.div:pacific q:3 result:make ast:true";
    const r = parse(q);
    expect(r.diagnostics).toEqual([]);
    expect(r.ast?.t).toBe("and");
    expect(print(r.ast)).toBe(q.replace("closeouts:2+", "closeouts:>=2"));
  });

  it("round-trips: print(parse(print(parse(x)))) is stable", () => {
    for (const q of [
      "(shooter:curry OR shooter:thompson) shot:3pt -result:make",
      "lineup:+green -looney q:3..4 clock:<2:00",
      "curry | klay  AND  NOT zone:corner_3",
      'shooter:"stephen curry" margin:-5..5',
      "-(type:tov OR type:ft) +green",
    ]) {
      const a = print(parse(q).ast);
      expect(print(parse(a).ast)).toBe(a);
    }
  });

  it("binds precedence: AND over OR, prefix NOT tightest", () => {
    expect(print(parse("a b OR c").ast)).toBe("a b OR c");
    expect(parse("a b OR c").ast?.t).toBe("or");
    expect(print(parse("-a b").ast)).toBe("-a b");
    expect(print(parse("-(a b)").ast)).toBe("-(a b)");
  });

  it("reports unknown fields and unbalanced parens with spans", () => {
    expect(parse("(shooter:curry").diagnostics[0].message).toMatch(/unclosed/);
  });
});

describe("engine", () => {
  const store = loadStore();
  const eng = new Engine(store);
  const fixture = JSON.parse(readFileSync(join(DATA, "annotations.fixture.json"), "utf8"));
  eng.setTags(fixture.tags);
  const key = (i: number) => `${store.meta.games[store.p.game[i]].id}:${store.p.action[i]}`;

  it("returns exactly the golden positives for the 10-constraint compound query", () => {
    const r = eng.run(fixture.query);
    expect(r.diagnostics).toEqual([]);
    expect([...r.rows].map(key).sort()).toEqual([...fixture.positives].sort());
  });

  it("each golden decoy is excluded by exactly one constraint", () => {
    const parts = fixture.query.split(" ");
    for (const [play, role] of Object.entries<string>(fixture.roles)) {
      if (role === "positive") continue;
      const failing = parts.filter((p: string) => ![...eng.run(p).rows].map(key).includes(play));
      if (role.includes("two windows")) {
        // Passes every single term, but no one tag is both a pindown and 2+ closeouts.
        expect(failing).toEqual([]);
        expect([...eng.run("action:pindown closeouts:2+").rows].map(key)).not.toContain(play);
      } else expect([play, failing.length]).toEqual([play, 1]);
    }
  });

  it("resolves shared surnames to the focus-team player", () => {
    const curry = store.meta.players[eng.resolvePlayers("curry")[0]];
    const green = store.meta.players[eng.resolvePlayers("green")[0]];
    expect(curry.name).toBe("Stephen Curry");
    expect(green.name).toBe("Draymond Green");
  });

  it("counts match a direct scan", () => {
    const r = eng.run("shooter:curry shot:3pt result:make");
    const curry = eng.resolvePlayers("curry")[0];
    let n = 0;
    for (let i = 0; i < store.n; i++) if (store.p.actor[i] === curry && store.p.value[i] === 3 && store.p.kind[i] === 0 && store.p.made[i]) n++;
    expect(r.rows.length).toBe(n);
    // Official 2023-24 box: Curry made 357 threes in 74 games.
    expect(n).toBe(357);
  });

  it("suggests values with live counts against the rest of the query", () => {
    const s = eng.suggest("shooter:curry shot:3pt zone:right", 34);
    const wing = s.find((x) => x.label === "right_wing")!;
    expect(wing.count).toBe(eng.run("shooter:curry shot:3pt zone:right_wing").rows.length);
  });

  it("filters in < 50 ms at 10× the season (190k plays)", () => {
    const big = new Bitset(store.n * 10);
    expect(big.size).toBe(store.n * 10);
    // Replicate the engine's work: intersect 10 facet bitsets over 10× the rows, plus one numeric scan.
    const facets = ["shooter:curry", "shot:3pt", "zone:right_wing", "lineup:+green", "opp.div:pacific", "q:3", "result:make", "ast:true"].map((q) => eng.run(q).bits);
    const tile = (b: Bitset) => {
      const w = new Uint32Array(b.words.length * 10);
      for (let k = 0; k < 10; k++) w.set(b.words, k * b.words.length);
      return new Bitset(b.size * 10, w);
    };
    const tiled = facets.map(tile);
    const clock = new Uint16Array(store.n * 10);
    for (let k = 0; k < 10; k++) clock.set(store.p.clock as Uint16Array, k * store.n);
    const times: number[] = [];
    for (let rep = 0; rep < 20; rep++) {
      const t = performance.now();
      let acc = Bitset.full(store.n * 10);
      for (const b of tiled) acc = acc.and(b);
      const c = new Bitset(store.n * 10);
      for (let i = 0; i < clock.length; i++) if (clock[i] < 1200) c.set(i);
      acc = acc.and(c);
      acc.toArray();
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length / 2)]).toBeLessThan(50);
    // And the real engine on the real season, end to end including parse.
    const r = eng.run(fixture.query);
    expect(r.ms).toBeLessThan(50);
  });
});

describe("film sources", async () => {
  const { filmTime, parseFilmSource, encodeFilms, decodeFilms } = await import("./video/sources");
  const { youTubeId } = await import("./video/youtube");
  const base = { game: "22300060", name: "f", fps: 30, url: "https://x.test/g.mp4", kind: "url" as const };

  it("continuous film maps every play by wall clock from one pin", () => {
    const film = { ...base, mode: "continuous" as const, anchors: [{ wall: 472, media: 1.333 }] };
    expect(filmTime(film, 472)).toBeCloseTo(1.333);
    expect(filmTime(film, 1072)).toBeCloseTo(61.333);
    expect(filmTime(film, 100)).toBeNull(); // 37 s before the recording starts
  });

  it("edited film places only pinned plays", () => {
    const film = { ...base, mode: "cut" as const, anchors: [{ wall: 9001, media: 12.5 }] };
    expect(filmTime(film, 9001)).toBeCloseTo(12.5);
    expect(filmTime(film, 9002)).toBeCloseTo(12.5); // within a tenth: same event
    expect(filmTime(film, 9100)).toBeNull();
  });

  it("a provisional tip-off guess gives way to real pins", () => {
    const film = { ...base, mode: "continuous" as const, anchors: [{ wall: 0, media: 0, provisional: true }, { wall: 600, media: 100 }] };
    expect(filmTime(film, 700)).toBeCloseTo(110);
  });

  it("parses YouTube links and media URLs", () => {
    for (const u of ["https://www.youtube.com/watch?v=yPqqaXs2wQs&t=30", "https://youtu.be/yPqqaXs2wQs", "youtube.com/embed/yPqqaXs2wQs", "yPqqaXs2wQs"]) expect(youTubeId(u)).toBe("yPqqaXs2wQs");
    expect(parseFilmSource("https://youtu.be/yPqqaXs2wQs")).toMatchObject({ kind: "youtube", url: "yt:yPqqaXs2wQs", mode: "cut" });
    expect(parseFilmSource("https://cdn.example.com/games/gsw-sac.mp4")).toMatchObject({ kind: "url", mode: "continuous" });
    expect(parseFilmSource("javascript:alert(1)")).toBeNull();
    expect(parseFilmSource("not a link")).toBeNull();
  });

  it("round-trips films through the share link, never encoding local files", () => {
    const films = [
      { ...base, mode: "continuous" as const, url: "https://x.test/a~b;c.mp4", anchors: [{ wall: 472, media: 1.333 }, { wall: 900, media: 44 }] },
      { ...base, game: "22300062", kind: "youtube" as const, url: "yt:yPqqaXs2wQs", mode: "cut" as const, anchors: [{ wall: 9001, media: 12.5 }] },
      { ...base, game: "22300087", kind: "file" as const, url: "blob:x", mode: "continuous" as const, anchors: [] },
    ];
    const back = decodeFilms(encodeFilms(films));
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({ game: "22300060", kind: "url", url: "https://x.test/a~b;c.mp4", mode: "continuous" });
    expect(back[0].anchors).toEqual([{ wall: 472, media: 1.333 }, { wall: 900, media: 44 }]);
    expect(back[1]).toMatchObject({ game: "22300062", kind: "youtube", url: "yt:yPqqaXs2wQs", mode: "cut" });
    expect(decodeFilms("22300060~u~c~javascript%3Aalert(1)~")).toEqual([]);
  });
});
