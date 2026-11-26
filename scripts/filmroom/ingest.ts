// Film-room ingest: raw NBA feeds → possession/lineup parse → reconciliation → client bundle.
//
//   npx tsx scripts/filmroom/ingest.ts                 # mirror path (season CSV dumps of the official feeds)
//   npx tsx scripts/filmroom/ingest.ts --source live --games 0022300062,0022300077
//   npx tsx scripts/filmroom/ingest.ts --reconcile-only
//
// Mirror files are downloaded into .cache/filmroom (gitignored). The bundle lands in public/filmroom/data.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { loadLiveGame, loadMirrorSeason } from "../../lib/filmroom/ingest/sources";
import type { RawGame } from "../../lib/filmroom/ingest/raw";
import { parseGame } from "../../lib/filmroom/ingest/fsm";
import { reconcileGame, type GameReconciliation } from "../../lib/filmroom/ingest/reconcile";
import { writeBundle } from "../../lib/filmroom/ingest/bundle";
import { probeVideo } from "../../lib/filmroom/ingest/video";

const ROOT = join(__dirname, "../..");
const CACHE = join(ROOT, ".cache/filmroom");
const RAW = join(CACHE, "raw");
const OUT = join(ROOT, "public/filmroom/data");
const TEAM = "GSW";

const MIRROR = {
  cdn: ["shufinskiy/nba_data/main/datasets/cdnnba_2023.tar.xz", "cdnnba_2023.csv"],
  v3: ["shufinskiy/nba_data/main/datasets/nbastatsv3_2023.tar.xz", "nbastatsv3_2023.csv"],
  shots: ["shufinskiy/nba_data/main/datasets/shotdetail_2023.tar.xz", "shotdetail_2023.csv"],
  pbpstats: ["shufinskiy/nba_data/main/datasets/pbpstats_2023.tar.xz", "pbpstats_2023.csv"],
  box1: ["NocturneBear/NBA-Data-2010-2024/main/regular_season_box_scores_2010_2024_part_1.csv", "box1.csv"],
  box2: ["NocturneBear/NBA-Data-2010-2024/main/regular_season_box_scores_2010_2024_part_2.csv", "box2.csv"],
  box3: ["NocturneBear/NBA-Data-2010-2024/main/regular_season_box_scores_2010_2024_part_3.csv", "box3.csv"],
} as const;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function fetchMirror(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const [, [path, file]] of Object.entries(MIRROR)) {
    if (existsSync(join(dir, file))) continue;
    const url = `https://raw.githubusercontent.com/${path}`;
    console.log(`↓ ${url}`);
    const dest = join(dir, path.endsWith(".tar.xz") ? "tmp.tar.xz" : file);
    execFileSync("curl", ["-sSfL", "-o", dest, url]);
    if (path.endsWith(".tar.xz")) execFileSync("tar", ["-xJf", dest, "-C", dir]);
  }
}

async function loadRaw(): Promise<RawGame[]> {
  if (existsSync(RAW) && readdirSync(RAW).length && !flag("refresh")) {
    return readdirSync(RAW)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(RAW, f), "utf8")));
  }
  mkdirSync(RAW, { recursive: true });
  let games: RawGame[];
  if (arg("source") === "live") {
    const ids = (arg("games") ?? "").split(",").filter(Boolean);
    games = [];
    for (const id of ids) games.push(await loadLiveGame(String(Number(id))));
  } else {
    const dir = arg("mirror") ?? join(CACHE, "mirror");
    fetchMirror(dir);
    games = await loadMirrorSeason(
      {
        cdn: join(dir, MIRROR.cdn[1]),
        v3: join(dir, MIRROR.v3[1]),
        shots: join(dir, MIRROR.shots[1]),
        pbpstats: join(dir, MIRROR.pbpstats[1]),
        box: [join(dir, MIRROR.box1[1]), join(dir, MIRROR.box2[1]), join(dir, MIRROR.box3[1])],
      },
      TEAM,
    );
  }
  for (const g of games) writeFileSync(join(RAW, `${g.gameId}.json`), JSON.stringify(g));
  return games;
}

async function main() {
  const t0 = performance.now();
  const raws = await loadRaw();
  console.log(`raw: ${raws.length} games, ${raws.reduce((s, g) => s + g.actions.length, 0)} actions (${(performance.now() - t0).toFixed(0)} ms)`);
  const parsed = raws.map(parseGame);
  const recs: GameReconciliation[] = raws.map((r, i) => reconcileGame(r, parsed[i]));

  const totals = new Map<string, { checked: number; bad: number; source: string; required: boolean }>();
  for (const r of recs)
    for (const c of r.checks) {
      const t = totals.get(c.name) ?? { checked: 0, bad: 0, source: c.source, required: c.required };
      t.checked += c.checked;
      t.bad += c.mismatches.length;
      totals.set(c.name, t);
    }
  console.log("\nreconciliation");
  for (const [name, t] of totals)
    console.log(`  ${t.bad === 0 ? "✓" : t.required ? "✗" : "·"} ${t.required ? "" : "(supplementary) "}${name}: ${t.checked} checked, ${t.bad} mismatches`);
  console.log(`  corrections applied: ${parsed.reduce((s, g) => s + g.corrections.length, 0)}`);
  const bad = recs.filter((r) => !r.ok);
  for (const r of bad.slice(0, Number(arg("show") ?? 6))) {
    console.log(`\n  game ${r.gameId}`);
    for (const c of r.checks) if (c.required || flag("all")) for (const m of c.mismatches.slice(0, 8)) console.log(`    [${c.source}] ${m}`);
  }
  const agree = parsed.reduce((s, g) => [s[0] + g.possessionFieldAgreement.agreed, s[1] + g.possessionFieldAgreement.checked], [0, 0]);
  console.log(`\n  feed possession-field agreement: ${agree[0]}/${agree[1]}`);
  console.log(`  silent starters resolved from minutes: ${parsed.reduce((s, g) => s + g.startResolution.length, 0)}`);
  console.log(`  possessions ${parsed.reduce((s, g) => s + g.possessions.length, 0)}, plays ${parsed.reduce((s, g) => s + g.plays.length, 0)}`);
  if (flag("reconcile-only")) return;

  const video = await probeVideo(raws, join(CACHE, "video-probe.json"));
  writeBundle(OUT, raws, parsed, recs, video);
  console.log(`\nbundle → ${OUT} (${(performance.now() - t0).toFixed(0)} ms)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
