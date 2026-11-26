// Golden tactical fixture for the compound-query acceptance test.
//
// The automated layer (shooter, shot value, zone, lineup, opponent division, quarter, result, assist) is real
// NBA data. The tactical tags below are FIXTURE labels written to exercise the engine — the 2023-24 clips they
// would be read from have been retired by the NBA — so they are marked source: "fixture" and the UI says so.
//
// Design: the two positives satisfy all 10 constraints. Every decoy fails exactly one, so each constraint is
// shown to carry weight, and one decoy carries two tags whose union (but no single tag) would satisfy
// `action:pindown closeouts:2+` — the case per-play tag semantics gets wrong.
//
//   npx tsx scripts/filmroom/golden.ts

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { gunzipSync } from "zlib";
import { decodeBundle } from "../../lib/filmroom/engine/store";
import type { Tag } from "../../lib/filmroom/tags/ontology";

const DATA = join(__dirname, "../../public/filmroom-assets/data");
const FPS = 30000 / 1001;
const f = (s: number) => Math.round(s * FPS) / FPS; // frame-quantised seconds from t₀

type Spec = { game: string; action: number; role: string; tags: Partial<Tag>[] };

export const GOLDEN_QUERY = "shooter:curry shot:3pt zone:right_wing action:pindown closeouts:2+ lineup:+green opp.div:pacific q:3 result:make ast:true";

const SPECS: Spec[] = [
  { game: "22300273", action: 346, role: "positive", tags: [{ act: "pindown", cov: "switch", co: "2", cot: "flyby", contest: "light", read: "good" }] },
  { game: "22300802", action: 442, role: "positive", tags: [{ act: "pindown", cov: "top_lock", co: "2", cot: "short", contest: "tight", read: "good" }] },
  {
    game: "22300789",
    action: 466,
    role: "decoy: tags split across two windows (pindown/1 closeout + flare/2 closeouts)",
    tags: [
      { act: "pindown", cov: "drop", co: "1", contest: "light" },
      { act: "flare", co: "2", cot: "flyby", contest: "open" },
    ],
  },
  { game: "22300062", action: 408, role: "decoy: Green off the floor", tags: [{ act: "pindown", co: "2", contest: "light" }] },
  { game: "22300650", action: 376, role: "decoy: right corner, not wing", tags: [{ act: "pindown", co: "2", contest: "light" }] },
  { game: "22300060", action: 716, role: "decoy: Q4", tags: [{ act: "pindown", co: "2", contest: "tight" }] },
  { game: "22300096", action: 357, role: "decoy: opponent outside the Pacific", tags: [{ act: "pindown", co: "2", contest: "light" }] },
  { game: "22300757", action: 396, role: "decoy: unassisted", tags: [{ act: "pindown", co: "2", contest: "open" }] },
  { game: "22300060", action: 420, role: "decoy: not Curry", tags: [{ act: "pindown", co: "2", contest: "light" }] },
];

function main() {
  const meta = JSON.parse(readFileSync(join(DATA, "meta.json"), "utf8"));
  const buf = gunzipSync(readFileSync(join(DATA, "plays.bin.gz")));
  const store = decodeBundle(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta);
  const tags: Tag[] = [];
  const roles: Record<string, string> = {};
  let k = 0;
  for (const s of SPECS) {
    const g = store.gameIndex.get(s.game)!;
    const row = store.rowOf(g, s.action);
    if (row < 0) throw new Error(`no play ${s.game}#${s.action}`);
    const possInGame = store.p.poss[row] - meta.games[g].firstPoss;
    roles[`${s.game}:${s.action}`] = s.role;
    s.tags.forEach((t, j) => {
      tags.push({
        id: `fx-${++k}`,
        game: s.game,
        action: s.action,
        possession: `${s.game}:${possInGame}`,
        tIn: f(-5.2 + j * 1.6),
        tOut: f(-0.6 + j * 0.3),
        author: "fixture",
        source: "fixture",
        created: Date.UTC(2026, 10, 26),
        ...t,
      } as Tag);
    });
  }
  writeFileSync(join(DATA, "annotations.fixture.json"), JSON.stringify({ query: GOLDEN_QUERY, positives: SPECS.filter((s) => s.role === "positive").map((s) => `${s.game}:${s.action}`), roles, tags }, null, 1));
  console.log(`${tags.length} fixture tags on ${SPECS.length} plays`);
}

if (require.main === module) main();
