// Accounting invariant. Everything the parser derives is re-counted and compared, per player and per team, with
// sources that did not go through the parser:
//
//   box   — official boxscoretraditionalv3: PTS, FGM/FGA, 3PM/3PA, FTM/FTA, AST, STL, BLK, TOV, minutes, +/-
//   chart — stats.nba.com shotchartdetail: every FGA by shooter with make flag and shot type
//   score — the final score in the feed
//   ref   — an independent possession parse (pbpstats), possessions per team
//   rot   — GameRotation stints, when the live path supplied them
//
// Box minutes are published to the second (MM:SS), so floor time is checked at that resolution: our tenth-second
// total must round to the published value (|Δ| < 1 s). Every other check is exact.

import type { ParsedGame } from "./fsm";
import type { RawGame } from "./raw";

export interface CheckResult {
  name: string;
  /** Required checks make up the accounting invariant; supplementary ones are reported, not enforced. */
  required: boolean;
  source: "box" | "chart" | "score" | "ref" | "rot" | "self";
  checked: number;
  mismatches: string[];
}

export interface GameReconciliation {
  gameId: string;
  checks: CheckResult[];
  ok: boolean;
}

const STAT_KEYS = ["pts", "fgm", "fga", "fg3m", "fg3a", "ftm", "fta", "ast", "stl", "blk", "tov"] as const;
type StatKey = (typeof STAT_KEYS)[number];

export function reconcileGame(raw: RawGame, g: ParsedGame): GameReconciliation {
  const checks: CheckResult[] = [];
  const derived = new Map<number, Record<StatKey, number>>();
  const row = (id: number) => {
    let r = derived.get(id);
    if (!r) {
      r = { pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, ast: 0, stl: 0, blk: 0, tov: 0 };
      derived.set(id, r);
    }
    return r;
  };

  // Re-count from the parsed plays (FGA / turnovers / FT trips) and the event stream (technical FTs, which carry
  // no play row but do count in the box).
  for (const p of g.plays) {
    if (p.kind === "fga") {
      const r = row(p.actor);
      r.fga++;
      if (p.value === 3) r.fg3a++;
      if (p.made) {
        r.fgm++;
        r.pts += p.value;
        if (p.value === 3) r.fg3m++;
        if (p.assist) row(p.assist).ast++;
      }
      if (p.block) row(p.block).blk++;
    } else if (p.kind === "tov") {
      if (p.actor) row(p.actor).tov++;
      if (p.steal) row(p.steal).stl++;
    } else if (p.kind === "ft") {
      const r = row(p.actor);
      r.fta += p.attempts;
      r.ftm += p.points;
      r.pts += p.points;
    }
  }
  for (const e of g.events) {
    if (e.type === "freethrow" && /technical/i.test(e.descriptor + " " + e.sub)) {
      const r = row(e.personId);
      r.fta++;
      if (!/MISS/.test(e.desc)) {
        r.ftm++;
        r.pts++;
      }
    }
  }

  // box
  const box: CheckResult = { required: true, name: "player box (PTS FGM FGA 3PM 3PA FTM FTA AST STL BLK TOV)", source: "box", checked: 0, mismatches: [] };
  for (const b of raw.box) {
    const d = derived.get(b.personId) ?? row(b.personId);
    for (const k of STAT_KEYS) {
      box.checked++;
      if (d[k] !== b[k]) box.mismatches.push(`${b.name} ${k}: parsed ${d[k]} vs box ${b[k]}`);
    }
  }
  checks.push(box);

  // minutes
  const min: CheckResult = { required: true, name: "player floor seconds vs box minutes", source: "box", checked: 0, mismatches: [] };
  for (const b of raw.box) {
    const s = g.floorSeconds.get(b.personId) ?? 0;
    min.checked++;
    if (Math.abs(s - b.seconds) >= 1) min.mismatches.push(`${b.name}: parsed ${s.toFixed(1)}s vs box ${b.seconds}s`);
  }
  checks.push(min);

  // plus-minus
  const pm: CheckResult = { required: false, name: "player plus-minus vs box", source: "box", checked: 0, mismatches: [] };
  for (const b of raw.box) {
    if (b.seconds === 0) continue;
    const v = g.plusMinus.get(b.personId) ?? 0;
    pm.checked++;
    if (v !== b.plusMinus) pm.mismatches.push(`${b.name}: parsed ${v} vs box ${b.plusMinus}`);
  }
  checks.push(pm);

  // shot chart
  const chart: CheckResult = { required: true, name: "FGA vs shotchartdetail (event id, shooter, make, value)", source: "chart", checked: 0, mismatches: [] };
  const xy: CheckResult = { required: false, name: "shot (x, y) agreement, cdn vs shotchartdetail", source: "chart", checked: 0, mismatches: [] };
  const fgaByAction = new Map(g.plays.filter((p) => p.kind === "fga").map((p) => [p.actionNumber, p]));
  for (const s of raw.shots) {
    chart.checked++;
    const p = fgaByAction.get(s.eventId);
    if (!p) chart.mismatches.push(`chart event ${s.eventId} missing from parse`);
    else if (p.actor !== s.personId || p.made !== s.made || p.value !== s.value)
      chart.mismatches.push(`event ${s.eventId}: parsed ${p.actor}/${p.made}/${p.value} vs chart ${s.personId}/${s.made}/${s.value}`);
    xy.checked++;
    if (p && (p.x !== s.locX || p.y !== s.locY)) xy.mismatches.push(`event ${s.eventId}: xy ${p.x},${p.y} vs chart ${s.locX},${s.locY}`);
  }
  if (fgaByAction.size !== raw.shots.length) chart.mismatches.push(`parsed ${fgaByAction.size} FGA vs chart ${raw.shots.length}`);
  checks.push(chart, xy);

  // score and possession points
  const last = g.events[g.events.length - 1];
  const sc: CheckResult = { required: true, name: "final score: box team points, possession points + technical FTs", source: "score", checked: 0, mismatches: [] };
  for (const [teamId, final] of [
    [g.homeTeamId, last.scoreHome],
    [g.awayTeamId, last.scoreAway],
  ] as const) {
    const boxPts = raw.box.filter((b) => b.teamId === teamId).reduce((s, b) => s + b.pts, 0);
    const possPts = g.possessions.filter((p) => p.offense === teamId).reduce((s, p) => s + p.points, 0);
    const techPts = g.events.filter(
      (e) => e.type === "freethrow" && /technical/i.test(e.descriptor + " " + e.sub) && e.teamId === teamId && !/MISS/.test(e.desc),
    ).length;
    sc.checked += 2;
    if (boxPts !== final) sc.mismatches.push(`team ${teamId}: box ${boxPts} vs feed ${final}`);
    if (possPts + techPts !== final) sc.mismatches.push(`team ${teamId}: possessions ${possPts} + tech ${techPts} vs ${final}`);
  }
  checks.push(sc);

  // floor integrity
  const fl: CheckResult = { required: true, name: "10-man floor integrity (starters, subs, actors on floor, 5v5)", source: "self", checked: g.events.length, mismatches: [] };
  for (const i of g.issues) fl.mismatches.push(`P${i.period} ${i.kind} ${i.detail}`);
  const gameSeconds = Math.max(...g.events.map((e) => e.elapsed));
  for (const t of [g.homeTeamId, g.awayTeamId]) {
    const total = raw.box.filter((b) => b.teamId === t).reduce((s, b) => s + (g.floorSeconds.get(b.personId) ?? 0), 0);
    fl.checked++;
    if (Math.abs(total - 5 * gameSeconds) > 0.05) fl.mismatches.push(`team ${t}: ${total.toFixed(1)} floor-seconds vs 5 × ${gameSeconds}`);
  }
  checks.push(fl);

  // possession structure
  const ps: CheckResult = { required: true, name: "possession structure (alternation, clock monotone, play attribution)", source: "self", checked: 0, mismatches: [] };
  for (let k = 1; k < g.possessions.length; k++) {
    const a = g.possessions[k - 1];
    const b = g.possessions[k];
    ps.checked++;
    if (a.period === b.period && a.offense === b.offense) ps.mismatches.push(`P${b.period} possessions ${a.id},${b.id} both ${b.offense}`);
    if (b.startClock > b.endClock === false && b.startClock < b.endClock) ps.mismatches.push(`possession ${b.id} runs backwards`);
  }
  for (const p of g.plays) {
    ps.checked++;
    const poss = g.possessions[p.poss];
    if (!poss) ps.mismatches.push(`play ${p.actionNumber} has no possession`);
    else if (poss.offense !== p.offense) ps.mismatches.push(`play ${p.actionNumber} (${p.kind}) by ${p.offense} in possession of ${poss.offense}`);
  }
  checks.push(ps);

  // reference possessions (independent parser; it omits possessions that begin in a period's final seconds)
  if (raw.refPossessions?.length) {
    const ref: CheckResult = { required: false, name: "possessions vs pbpstats (excl. final-seconds possessions it omits)", source: "ref", checked: 0, mismatches: [] };
    const tri = new Map<number, string>();
    for (const a of raw.actions) if (a.teamId) tri.set(a.teamId, a.teamTricode);
    const fmt = (c: number) => `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(Math.floor(c % 60)).padStart(2, "0")}`;
    const theirs = new Map<string, number>();
    for (const r of raw.refPossessions) {
      const k = `${r.period}|${r.offenseTri}|${r.start}`;
      theirs.set(k, (theirs.get(k) ?? 0) + 1);
    }
    for (const p of g.possessions) {
      if (p.startClock <= 3 && p.endType === "period_end") continue;
      ref.checked++;
      const k = `${p.period}|${tri.get(p.defense)}|${fmt(p.startClock)}`;
      if (theirs.get(k)) theirs.set(k, theirs.get(k)! - 1);
      else ref.mismatches.push(`P${p.period} ${tri.get(p.offense)} ${fmt(p.startClock)}-${fmt(p.endClock)} ${p.startType}>${p.endType} not in pbpstats`);
    }
    checks.push(ref);
  }

  // rotation stints (live path)
  if (raw.rotation?.length) {
    const rot: CheckResult = { required: true, name: "floor seconds vs GameRotation stints", source: "rot", checked: 0, mismatches: [] };
    const bySec = new Map<number, number>();
    for (const s of raw.rotation) bySec.set(s.personId, (bySec.get(s.personId) ?? 0) + (s.outTime - s.inTime) / 10);
    for (const [id, sec] of bySec) {
      rot.checked++;
      const ours = g.floorSeconds.get(id) ?? 0;
      if (Math.abs(ours - sec) > 0.05) rot.mismatches.push(`${id}: parsed ${ours.toFixed(1)} vs rotation ${sec.toFixed(1)}`);
    }
    checks.push(rot);
  }

  return { gameId: g.gameId, checks, ok: checks.every((c) => !c.required || c.mismatches.length === 0) };
}
