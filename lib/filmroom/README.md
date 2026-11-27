# Film Room

A keyboard-first possession film room and shot-review workbench, at `/filmroom`. It boots straight into the
reel: 82 Warriors games from 2023-24, 16,506 possessions and 19,059 plays (every FGA, turnover and free-throw trip by
either team), each carrying a verified 10-man floor.

```
raw NBA feeds ──▶ ingest (Node) ──▶ possession + lineup FSM ──▶ reconciliation ──▶ bundle (static) ──▶ workbench (browser)
cdn liveData       sources.ts        fsm.ts, arbitrate.ts        reconcile.ts       format.ts, bundle.ts   engine/, video/, app/
playbyplayv3
shotchartdetail
videoeventsasset
boxscoretraditionalv3
```

## Data

**Sources.** The ingest reads the official feeds in their native shapes: cdn.nba.com liveData `playbyplay`,
stats.nba.com `playbyplayv3`, `shotchartdetail`, `videoeventsasset` URLs, and `boxscoretraditionalv3`. There are two
interchangeable paths into the same `RawGame` type. `--source live` hits the endpoints directly (it also pulls
`boxscore`, `gamerotation` and per-event `videoeventsasset`). NBA's edge refuses datacenter IPs, so in CI or a cloud
container the default path reads season CSV mirrors of those same feeds instead (shufinskiy/nba_data,
NocturneBear/NBA-Data-2010-2024).

**Possessions** (`ingest/fsm.ts`) follow pbpstats' rules. A possession ends on:
- a made FG, unless an and-one trip follows;
- the last made free throw of a trip (technical trips never change possession; flagrant, clear-path,
  away-from-play and transition-take trips are retained);
- a defensive rebound (dead-ball rebounds between free throws are skipped);
- a turnover, a held ball recovered by the defense, or the end of the period.

Offensive rebounds keep the possession.

**Lineups.** A player started a period if he records any on-court action before his first substitution, or if his
first substitution is "out". A player who plays a whole period without touching the box score leaves no evidence; that
slot is resolved against official minutes. Substitutions are applied in official order, including those between free
throws.

**Arbitration** (`ingest/arbitrate.ts`). The cdn snapshot is taken near the buzzer, and the stat crew keeps editing
afterwards. Where `playbyplayv3` and the shot chart agree against the snapshot (a re-credited steal, a two changed to
a three), the corrected value wins. When a substitution was logged at the wrong stoppage, the unique window that makes
both players' minutes and plus-minus exact is applied. All 5 corrections are logged in the bundle.

**Zones** (`core/court.ts`) are computed from tenth-of-a-foot `(x, y)` and rim polar geometry: restricted area
r < 4 ft, corner below the y = 8.75 ft break, top arc |θ| < 18°, and so on. The NBA labels are used only as a test: the
classifier agrees with NBA's basic zone and above-break side on all 218,701 shots of the 2023-24 season.

## Accounting invariant

`npm run filmroom:ingest` recounts everything and compares it with sources that never went through the parser:

| Check | Checked | Mismatches |
|---|---:|---:|
| player box: PTS FGM FGA 3PM 3PA FTM FTA AST STL BLK TOV | 23,727 | 0 |
| player floor seconds vs box minutes (to the second) | 2,157 | 0 |
| FGA vs shotchartdetail (event, shooter, make, value) | 14,930 | 0 |
| final score = box team points = Σ possession points + technical FTs | 328 | 0 |
| 10-man floor integrity (starters, subs, every actor on the floor, 5v5) | 46,558 | 0 |
| possession structure (alternation, attribution) | 35,483 | 0 |
| *supplementary:* plus-minus vs box | 1,774 | 4 |
| *supplementary:* shot (x, y), cdn vs shot chart | 14,930 | 18 |
| *supplementary:* possessions vs pbpstats (it omits final-seconds possessions) | 16,335 | 11 |

The 4 plus-minus residuals are technical free throws around substitutions. NBA's own box credits the foul-time floor
in some games and the free-throw-time floor in others. The (x, y) residuals are corner threes for which the shot chart
reports a placeholder (±223, 2). GameRotation stints are checked on the live path; that endpoint refuses cloud IPs,
so in this repo floor time is reconciled against box minutes instead.

## Query language

```
shooter:curry shot:3pt zone:right_wing action:pindown closeouts:2+ lineup:+green opp.div:pacific q:3 result:make ast:true
```

- **Grammar.** A hand-written lexer feeds a Pratt parser (`engine/dsl.ts`): juxtaposition is AND, `OR`/`|` join,
  `-`/`NOT` negate, parentheses group, commas OR values within a field. Values take `>= <= > <`, ranges `a..b`, `2+`,
  and signed players `+green -looney`.
- **Canonical form.** Every AST prints to one canonical string, which is what the URL stores.
- **Fields.** 41 fields across who, shot, context, lineup, tactical and film. `?` in the app lists them all.
- **Name resolution.** Surnames resolve to the Warriors player first (`curry` is Stephen, `green` is Draymond),
  with a note naming the alternatives.
- **Tactical terms.** Tactical terms in one AND bind to the same tag window: `action:pindown closeouts:2+` means one
  stamped window that is both, not a pindown tag next to some other 2-closeout tag.

**Engine** (`engine/query.ts`, `engine/bitset.ts`). Facets are dense bitsets built once at load, which is what a
Roaring bitmap would choose for most facets at this cardinality. A query is bitset algebra plus at most one pass over a
typed column per numeric range. The golden query runs in 0.2–0.7 ms, and a 10× replica of the season (190k plays) stays
under 50 ms. DuckDB-WASM was not used: it would add a ~30 MB WASM download to answer queries that already finish in
under a millisecond. Autocomplete counts every suggestion live against the rest of the query.

**Bundle** (`core/format.ts`). Plays and possessions are stored as a gzipped columnar binary (535 KB) that decodes
into zero-copy typed-array views. Per-game event tapes load on demand.

## Film

**Reel** (`video/reel.ts`).
- **Ring of elements.** Three stacked `<video>` elements: active, next and previous. Standby elements are loaded and
  pre-seeked to their in-point while the active clip plays, so a clip change is an opacity swap of an element that
  already holds a decoded frame.
- **No blank frames.** An element is never revealed without a frame.
- **Frame identity.** Frames come from `requestVideoFrameCallback`'s presented `mediaTime`.
- **Stepping.** Steps land mid-frame so rounding can't slip to a neighbour.
- **Shuttle.** J/K/L shuttles at 1/2/4/8×; reverse is driven by seeks, with one in flight at a time.

Every clip is addressed relative to its sync anchor t₀ (the shot, turnover or whistle), with configurable pre- and
post-roll.

**Why there are no NBA clips.** Since October 2026 the NBA serves one 869,898-byte "VIDEO NOT AVAILABLE" bumper (same ETag) for every `videos.nba.com/nba/pbp/media/*` path, real or invented. `videoeventsasset` also returns blank URLs (swar/nba_api#762). NBA.com's own player delivers even free clips through MediaKind with OAuth entitlements. The ingest detects all of this and records it per play, and the app does not reach around NBA's access control.

**Sources** (`video/sources.ts`), in order of preference:
1. **NBA pbp clip**, when the ingest has verified the URL serves real footage. None currently do.
2. **Attached film**: real footage you bring, per game.
   - Paste a YouTube link (official NBA uploads embed through YouTube's public IFrame API; `video/youtube.ts` presents the player as a media element) or any https MP4/WebM link in ⌘K, drop a recording on the workbench, or press ⇧O.
   - *Continuous* film (one unbroken broadcast) syncs the whole game from one pin, because every play carries its event's wall-clock time.
   - *Edited* film (highlight packages, which cut timeouts and reviews) needs one pin per play.
   - The film-room data has a catalog (`data/films.json`) of official NBA uploads. It currently holds the Kings vs Warriors In-Season Tournament ending (Nov 28, 2023), verified by oEmbed as the NBA channel's upload. ⌘K → "Real NBA film" opens it.
3. **Proxy film**: six 29.97 fps VP9 clips with each frame's index burned in as a 16-bit barcode, under a telemetry overlay that replays the possession's real events against the playhead.

**Pinning (tap-sync).** Press `F` for film view, where the game's film plays freely and `[`/`]` pick the play. `S` pins the frame on screen as that play's t₀ and moves to the next play while the film keeps rolling. Press `F` again and pinned plays play as clips from the real film. Films and pins are written into the share link (`film=`), so a link you send plays real footage for whoever opens it. Local files are the exception, because they exist only on your disk. `W` opens the game on NBA.com.

## Tagging

Press `I`/`O` to mark the window, then `T` to start a chord: action › coverage › closeouts › closeout › contest › read.
Each step takes a mnemonic letter or a digit 1–9. `T p d 2 ⏎` stamps pindown · drop · 2+ closeouts.

- `⇧T` repeats the last stamp on the next clip; `U` undoes.
- Chords run through an XState machine (`keys/machine.ts`).
- Tags are stored as `(possession_id, t_in, t_out)` seconds from the play's t₀, frame-quantised, in `localStorage`,
  with JSON export and import.

The golden fixture (`public/filmroom-assets/data/annotations.fixture.json`, from `scripts/filmroom/golden.ts`) contains
**test labels, not film-verified reads**. It has two positives for the 10-constraint query and seven decoys that each
fail exactly one constraint, including one play whose two tags would satisfy `action:pindown closeouts:2+` only if
their properties were combined across windows.

## URL

`?q=…&g=<game>&a=<action>&p=<possession>&f=<frame from t₀>&v=tl|tape|map&ov=<overlay bitmask>&pre=&post=`. These are
written with nuqs, replacing history. The frame is written only when the playhead rests. Opening a link restores the
query, the play, the exact frame and the view.

## Run

```bash
npm run filmroom:ingest      # fetch mirrors → parse → reconcile → bundle (add --reconcile-only, --source live --games …)
npm run filmroom:golden      # regenerate the golden fixture
npm run filmroom:proxies     # regenerate proxy film (ffmpeg)
npm test                     # zones vs 218,701 NBA labels, FSM + reconciliation, DSL, golden query, 10× perf budget
npm run build && npm run filmroom:serve &
npm run filmroom:e2e         # keyboard-only acceptance against the static export (needs playwright)
```

The e2e suite checks the following and is currently 18/18:
- the golden query returns exactly its two positives;
- filtering takes under 50 ms;
- every frame step matches the barcode decoded from the video (±0);
- clip transitions take a median of 23–35 ms with no blank frame;
- the JKL shuttle works;
- chord tagging works and new tags are immediately queryable;
- all three views render;
- local film syncs;
- film attached by URL from another origin pins the on-screen frame and replays from it (frames read back from compositor screenshots);
- the share link restores that film and its pins in a fresh browser;
- a shared URL restores the exact frame;
- CLS is 0 and there are no page errors.
