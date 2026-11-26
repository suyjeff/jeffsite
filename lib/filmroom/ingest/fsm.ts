// Deterministic possession + lineup parser (modelled on pbpstats' rules) over cdn.nba.com liveData actions.
//
// Possessions — the offense keeps the ball until one of:
//   made FG (unless an and-one trip follows: then the trip's last free throw ends it) · made final free throw of a
//   trip (technical trips never change possession; flagrant / clear-path / away-from-play / transition-take trips
//   are followed by the same team inbounding, so they don't either) · defensive rebound (dead-ball "rebounds"
//   between free throws are bookkeeping and are skipped) · turnover · held-ball jump recovered by the defense ·
//   end of period. Offensive rebounds keep the possession and reset the shot clock to 14.
//
// Lineups — period starters are inferred from evidence: a player who records any on-court action (shot, rebound,
// assist, steal, block, foul drawn or committed) before his first substitution of the period, or whose first
// substitution of the period is "out", started it. A player who played an entire period without touching the
// box score leaves no evidence; those slots are resolved afterwards against the official minutes (a starter with
// no substitution plays the whole period, so his box seconds must cover it). Substitutions are applied in
// official order, including those made between free throws, so every event carries its exact 10-man floor.

import { classifyZone, type Zone } from "../core/court";
import type { BoxPlayer, CdnAction, RawGame } from "./raw";
import { arbitrate, type Correction } from "./arbitrate";
import { parseClock, periodLength, periodStartElapsed } from "./raw";

export type StartType = "period_start" | "made_fg" | "made_ft" | "dreb" | "live_tov" | "dead_tov" | "jump_ball" | "dead_ball";
export type EndType = "made_fg" | "made_ft" | "dreb" | "tov" | "jump_ball" | "period_end" | "dead_ball";

export interface ParsedEvent {
  i: number; // index in ordered actions
  n: number; // actionNumber
  period: number;
  clock: number; // seconds remaining in period
  elapsed: number; // seconds since tip-off
  wall: number; // ms since the first action's timeActual
  type: string;
  sub: string;
  descriptor: string;
  qualifiers: string[];
  teamId: number;
  personId: number;
  desc: string;
  scoreHome: number;
  scoreAway: number;
  poss: number; // possession index or -1
  /** [home five, away five] after this event's substitutions (substitution events carry the post-sub floor). */
  floor: [number[], number[]];
}

export interface ParsedPossession {
  id: number;
  period: number;
  offense: number; // teamId
  defense: number;
  startClock: number;
  endClock: number;
  startType: StartType;
  endType: EndType;
  firstEvent: number;
  lastEvent: number;
  points: number;
  /** Score margin for the offense when the possession began. */
  margin: number;
}

export type PlayKind = "fga" | "tov" | "ft";

export interface ParsedPlay {
  id: number;
  kind: PlayKind;
  event: number; // anchor event index (t0)
  actionNumber: number;
  poss: number;
  period: number;
  clock: number;
  elapsed: number;
  wall: number;
  offense: number;
  defense: number;
  actor: number; // shooter / turnover player / free-throw shooter (0 = team)
  assist: number;
  block: number;
  steal: number;
  fouler: number; // FT trips: defender who committed the foul
  value: 0 | 1 | 2 | 3;
  made: boolean;
  points: number;
  attempts: number; // FT trip attempts
  x: number;
  y: number;
  dist: number;
  zone: Zone | null;
  shotType: string; // Layup / Jump Shot / DUNK / Hook / turnover subtype / FT trip type
  descriptor: string;
  qualifiers: string[];
  and1: boolean;
  secondChance: boolean;
  margin: number; // offense score − defense score before the play
  possSeconds: number; // seconds into the possession when the play happened
  offFloor: number[];
  defFloor: number[];
  desc: string;
}

export interface LineupIssue {
  period: number;
  teamId: number;
  kind: "starter_overflow" | "starter_underflow" | "actor_off_floor" | "floor_size" | "sub_in_on_floor" | "sub_out_off_floor";
  detail: string;
}

export interface ParsedGame {
  gameId: string;
  date: string;
  homeTeamId: number;
  awayTeamId: number;
  events: ParsedEvent[];
  possessions: ParsedPossession[];
  plays: ParsedPlay[];
  starters: Record<number, [number[], number[]]>; // period → [home, away]
  floorSeconds: Map<number, number>;
  plusMinus: Map<number, number>;
  issues: LineupIssue[];
  /** Agreement between our offense and the feed's own `possession` field on shot/turnover/FT rows. */
  possessionFieldAgreement: { checked: number; agreed: number };
  startResolution: { period: number; teamId: number; personId: number; via: "minutes" }[];
  corrections: Correction[];
}

const NON_EVIDENCE = new Set(["substitution", "timeout", "ejection", "period", "game", "instantreplay", "stoppage"]);
const RETAINED_FT = new Set(["flagrant", "clear-path", "away-from-play", "transition take"]);

function isTechnicalFt(a: CdnAction): boolean {
  return a.actionType === "freethrow" && /technical/i.test(a.descriptor + " " + a.subType);
}
function isTechnicalFoul(a: CdnAction): boolean {
  return a.actionType === "foul" && (a.subType === "technical" || /technical|double-technical/i.test(a.descriptor));
}
function ftIndex(a: CdnAction): [number, number] {
  const m = /(\d) of (\d)/.exec(a.subType);
  return m ? [Number(m[1]), Number(m[2])] : [1, 1];
}

export function orderActions(actions: CdnAction[]): CdnAction[] {
  return [...actions].sort((a, b) => a.orderNumber - b.orderNumber || a.actionNumber - b.actionNumber);
}

// ───────────────────────────── lineups ─────────────────────────────

function inferStarters(acts: CdnAction[], teamOf: Map<number, number>, teamId: number): Set<number> {
  const firstSub = new Map<number, "in" | "out">();
  const evidence = new Set<number>();
  for (const a of acts) {
    if (a.actionType === "substitution") {
      if (teamOf.get(a.personId) === teamId && !firstSub.has(a.personId)) {
        firstSub.set(a.personId, a.subType === "out" ? "out" : "in");
      }
      continue;
    }
    if (NON_EVIDENCE.has(a.actionType) || isTechnicalFoul(a)) continue;
    const people = new Set<number>([a.personId, ...a.personIdsFilter]);
    for (const k of ["assistPersonId", "blockPersonId", "stealPersonId", "foulDrawnPersonId"] as const) {
      const v = a[k];
      if (v) people.add(v);
    }
    for (const p of people) {
      if (!p || teamOf.get(p) !== teamId) continue;
      if (!firstSub.has(p)) evidence.add(p);
    }
  }
  const starters = new Set<number>();
  for (const p of evidence) starters.add(p);
  for (const [p, kind] of firstSub) if (kind === "out") starters.add(p);
  return starters;
}

// ───────────────────────────── parse ─────────────────────────────

export function parseGame(raw: RawGame): ParsedGame {
  const { actions: acts, corrections } = arbitrate(raw, orderActions(raw.actions));
  const teamOf = new Map<number, number>();
  for (const b of raw.box) teamOf.set(b.personId, b.teamId);
  const home = raw.homeTeamId;
  const away = raw.awayTeamId;
  const other = (t: number) => (t === home ? away : home);
  const periods = [...new Set(acts.map((a) => a.period))].sort((a, b) => a - b);
  const issues: LineupIssue[] = [];

  // ── starters with evidence ──
  const starters: Record<number, [number[], number[]]> = {};
  const unresolved: { period: number; teamId: number; need: number }[] = [];
  for (const p of periods) {
    const pa = acts.filter((a) => a.period === p);
    const pair: [number[], number[]] = [[], []];
    [home, away].forEach((t, side) => {
      const s = inferStarters(pa, teamOf, t);
      if (s.size > 5) issues.push({ period: p, teamId: t, kind: "starter_overflow", detail: [...s].join(",") });
      pair[side] = [...s].slice(0, 5);
      if (s.size < 5) unresolved.push({ period: p, teamId: t, need: 5 - s.size });
    });
    starters[p] = pair;
  }

  // ── resolve silent full-period starters against official minutes ──
  const startResolution: ParsedGame["startResolution"] = [];
  if (unresolved.length) {
    // Seconds each player is already credited with given the partial lineups.
    const partial = simulate(acts, periods, starters, home, away, teamOf, []).floorSeconds;
    const boxSec = new Map(raw.box.map((b) => [b.personId, b.seconds]));
    const subbedIn = (p: number, period: number) =>
      acts.some((a) => a.period === period && a.actionType === "substitution" && a.personId === p);
    for (const u of unresolved) {
      const side = u.teamId === home ? 0 : 1;
      const len = periodLength(u.period);
      const cands = raw.box
        .filter((b) => b.teamId === u.teamId && !starters[u.period][side].includes(b.personId) && !subbedIn(b.personId, u.period))
        .map((b) => ({ id: b.personId, residual: (boxSec.get(b.personId) ?? 0) - (partial.get(b.personId) ?? 0) }))
        .filter((c) => c.residual >= len - 1)
        .sort((a, b) => b.residual - a.residual);
      for (const c of cands.slice(0, u.need)) {
        starters[u.period][side].push(c.id);
        partial.set(c.id, (partial.get(c.id) ?? 0) + len);
        startResolution.push({ period: u.period, teamId: u.teamId, personId: c.id, via: "minutes" });
      }
      if (starters[u.period][side].length < 5)
        issues.push({ period: u.period, teamId: u.teamId, kind: "starter_underflow", detail: starters[u.period][side].join(",") });
    }
  }

  let sim = simulate(acts, periods, starters, home, away, teamOf, issues);

  // ── substitution repair ──
  // Box minutes and plus-minus come from the league's rotation record. When the feed drops or mislabels a
  // substitution, two teammates are off by ±d seconds: A was really on the bench, and B on the floor, for a window
  // of length d. Search windows whose ends are both substitution stoppages (a sub or timeout at that clock), where
  // our parse has A on and B off throughout and A records nothing. A window is applied only if it makes the team's
  // minutes exact, keeps the floor 5-on-5 with every actor on it, and matches both players' plus-minus; it must be
  // the unique such window. Accepted repairs are logged as corrections.
  const boxSec = new Map(raw.box.map((b) => [b.personId, b.seconds]));
  const boxPm = new Map(raw.box.map((b) => [b.personId, b.plusMinus]));
  for (const t of [home, away]) {
    const side = t === home ? 0 : 1;
    const resid = raw.box
      .filter((b) => b.teamId === t)
      .map((b) => ({ id: b.personId, d: (sim.floorSeconds.get(b.personId) ?? 0) - b.seconds }))
      .filter((r) => Math.abs(r.d) >= 1);
    for (const A of resid.filter((r) => r.d > 0)) {
      const B = resid.find((r) => r.d < 0 && Math.abs(A.d + r.d) < 1.5);
      if (!B) continue;
      const found: { acts: CdnAction[]; desc: string }[] = [];
      for (const period of periods) {
        const idx = acts.map((x, i) => i).filter((i) => acts[i].period === period);
        const stoppages = [...new Set(idx.filter((i) => acts[i].actionType === "substitution" || acts[i].actionType === "timeout").map((i) => parseClock(acts[i].clock)))];
        for (const c1 of stoppages)
          for (const c2 of stoppages) {
            if (Math.abs(c1 - c2 - A.d) >= 1) continue;
            // Actions strictly after the c1 stoppage and through the c2 stoppage's live play.
            const lastAt = (c: number) => idx.filter((i) => parseClock(acts[i].clock) === c).pop()!;
            const firstAt = (c: number) => idx.find((i) => parseClock(acts[i].clock) === c)!;
            const from = lastAt(c1);
            const to = firstAt(c2);
            const inside = idx.filter((i) => i > from && i < to);
            if (!inside.every((i) => sim.floors[i][side].includes(A.id) && !sim.floors[i][side].includes(B.id))) continue;
            if (inside.some((i) => acts[i].personId === A.id || acts[i].personIdsFilter.includes(A.id))) continue;
            const trialActs = acts.slice();
            // At c2: if A is subbed out there anyway, that row was B (mislabelled); otherwise B goes back for A.
            const outA = idx.find((i) => parseClock(acts[i].clock) === c2 && acts[i].actionType === "substitution" && acts[i].subType === "out" && acts[i].personId === A.id);
            const sub = (person: number, kind: "in" | "out", at: CdnAction): CdnAction => ({
              ...at,
              actionNumber: 0,
              actionType: "substitution",
              subType: kind,
              qualifiers: [],
              personId: person,
              personIdsFilter: [person],
              teamId: t,
              description: `SUB ${kind}: (repaired) ${person}`,
            });
            let ins2: CdnAction[] = [];
            if (outA !== undefined) trialActs[outA] = { ...acts[outA], personId: B.id, personIdsFilter: [B.id], description: acts[outA].description + " (relabelled)" };
            const lastC2 = lastAt(c2);
            if (outA === undefined) ins2 = [sub(B.id, "out", acts[lastC2]), sub(A.id, "in", acts[lastC2])];
            trialActs.splice(lastC2 + 1, 0, ...ins2);
            trialActs.splice(from + 1, 0, sub(A.id, "out", acts[from]), sub(B.id, "in", acts[from]));
            const trial: LineupIssue[] = [];
            const r = simulate(trialActs, periods, starters, home, away, teamOf, trial);
            if (trial.length) continue;
            const exact = raw.box.filter((b) => b.teamId === t).every((b) => {
              if ((b.personId === A.id || b.personId === B.id) && (r.plusMinus.get(b.personId) ?? 0) !== boxPm.get(b.personId)) return false;
              return b.personId !== A.id && b.personId !== B.id ? true : Math.abs((r.floorSeconds.get(b.personId) ?? 0) - (boxSec.get(b.personId) ?? 0)) < 1;
            });
            if (exact) found.push({ acts: trialActs, desc: `P${period} ${c1}s→${c2}s ${A.id} off / ${B.id} on${outA !== undefined ? " (sub-out relabelled)" : ""}` });
          }
      }
      if (found.length === 1) {
        acts.splice(0, acts.length, ...found[0].acts);
        corrections.push({ actionNumber: 0, field: "substitution.window", from: "feed", to: found[0].desc, source: "box minutes" });
        issues.length = 0;
        sim = simulate(acts, periods, starters, home, away, teamOf, issues);
      }
    }
  }

  const t0 = Date.parse(acts[0]?.timeActual ?? "") || 0;

  // ── events ──
  const events: ParsedEvent[] = acts.map((a, i) => ({
    i,
    n: a.actionNumber,
    period: a.period,
    clock: parseClock(a.clock),
    elapsed: periodStartElapsed(a.period) + periodLength(a.period) - parseClock(a.clock),
    wall: (Date.parse(a.timeActual) || t0) - t0,
    type: a.actionType,
    sub: a.subType,
    descriptor: a.descriptor,
    qualifiers: a.qualifiers,
    teamId: a.teamId,
    personId: a.personId,
    desc: a.description,
    scoreHome: a.scoreHome,
    scoreAway: a.scoreAway,
    poss: -1,
    floor: sim.floors[i],
  }));

  // ── possessions ──
  const possessions: ParsedPossession[] = [];
  let cur: ParsedPossession | null = null;
  let lastHome = 0;
  let lastAway = 0;
  let lastMissedNonFinalFt = false;
  const agreement = { checked: 0, agreed: 0 };

  const open = (team: number, clock: number, type: StartType, i: number, period: number) => {
    const margin = team === home ? lastHome - lastAway : lastAway - lastHome;
    cur = {
      id: possessions.length,
      period,
      offense: team,
      defense: other(team),
      startClock: clock,
      endClock: clock,
      startType: type,
      endType: "period_end",
      firstEvent: i,
      lastEvent: i,
      points: 0,
      margin,
    };
    possessions.push(cur);
  };
  const close = (clock: number, type: EndType, i: number) => {
    if (!cur) return;
    cur.endClock = clock;
    cur.endType = type;
    cur.lastEvent = i;
    cur = null;
  };
  const ensure = (team: number, clock: number, i: number, period: number) => {
    if (!team) return;
    if (!cur) {
      // First possession-defining action of a period with no tip: the period-start possession.
      const prevInPeriod = possessions.length && possessions[possessions.length - 1].period === period;
      open(team, prevInPeriod ? clock : periodLength(period), prevInPeriod ? "dead_tov" : "period_start", i, period);
    } else if (cur.offense !== team) {
      // The feed implies the other team has the ball without a recorded transition (e.g. a loose-ball foul by the
      // offense sending the defense to the line). Close before this event so it belongs to the new possession.
      const prevClock = i > 0 && acts[i - 1].period === period ? parseClock(acts[i - 1].clock) : clock;
      close(prevClock, "dead_ball", Math.max(cur.firstEvent, i - 1));
      open(team, prevClock, "dead_ball", i, period);
    }
  };

  const andOneFollows = (i: number): boolean => {
    const a = acts[i];
    for (let j = i + 1; j < acts.length; j++) {
      const b = acts[j];
      if (b.period !== a.period || parseClock(b.clock) !== parseClock(a.clock)) return false;
      if (b.isFieldGoal || b.actionType === "turnover" || (b.actionType === "rebound" && !b.qualifiers.includes("deadball"))) return false;
      if (b.actionType === "freethrow" && !isTechnicalFt(b) && b.teamId === a.teamId && b.subType === "1 of 1") return !RETAINED_FT.has(b.descriptor);
      if (b.actionType === "freethrow" && !isTechnicalFt(b) && b.teamId === a.teamId) return false;
    }
    return false;
  };

  let pendingAndOne = false;
  // Events that belong to the acting team's previous possession even though the ball has already changed hands
  // (a turnover logged after the stoppage that flipped it; an away-from-play trip awarded after a basket).
  const forcedPoss = new Map<number, number>();
  const lastOf = (team: number, period: number) => {
    for (let k = possessions.length - 1; k >= 0; k--) {
      if (possessions[k].period !== period) return -1;
      if (possessions[k].offense === team) return k;
    }
    return -1;
  };
  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    const clock = parseClock(a.clock);
    const period = a.period;
    switch (a.actionType) {
      case "period":
        if (a.subType === "start") {
          if (cur) close(clock, "period_end", i);
          pendingAndOne = false;
          lastMissedNonFinalFt = false;
        } else if (a.subType === "end") {
          if (cur) close(0, "period_end", i);
        }
        break;
      case "jumpball": {
        if (a.subType !== "recovered" || !a.teamId) break;
        if (!cur) {
          const first = !(possessions.length && possessions[possessions.length - 1].period === period);
          open(a.teamId, first ? periodLength(period) : clock, first ? "period_start" : "jump_ball", i, period);
        }
        else if ((cur as ParsedPossession).offense !== a.teamId) {
          close(clock, "jump_ball", i);
          open(a.teamId, clock, "jump_ball", i, period);
        }
        break;
      }
      case "2pt":
      case "3pt": {
        ensure(a.teamId, clock, i, period);
        agreement.checked++;
        if (a.possession === a.teamId) agreement.agreed++;
        if (a.shotResult === "Made") {
          if (andOneFollows(i)) pendingAndOne = true;
          else {
            close(clock, "made_fg", i);
            open(other(a.teamId), clock, "made_fg", i, period);
          }
        }
        lastMissedNonFinalFt = false;
        break;
      }
      case "freethrow": {
        if (isTechnicalFt(a)) break;
        // Away-from-play / flagrant trips can be awarded to the team that just scored; they don't hand it the ball.
        if (RETAINED_FT.has(a.descriptor) && cur && (cur as ParsedPossession).offense !== a.teamId) {
          const k = lastOf(a.teamId, period);
          if (k >= 0) forcedPoss.set(i, k);
          break;
        }
        ensure(a.teamId, clock, i, period);
        agreement.checked++;
        if (a.possession === a.teamId) agreement.agreed++;
        const [k, m] = ftIndex(a);
        const made = a.shotResult === "Made" || (!/MISS/.test(a.description) && a.shotResult !== "Missed");
        if (k === m) {
          pendingAndOne = false;
          lastMissedNonFinalFt = false;
          if (RETAINED_FT.has(a.descriptor)) break;
          if (made) {
            close(clock, "made_ft", i);
            open(other(a.teamId), clock, "made_ft", i, period);
          }
        } else {
          lastMissedNonFinalFt = !made;
        }
        break;
      }
      case "rebound": {
        if (a.qualifiers.includes("deadball") && lastMissedNonFinalFt) {
          lastMissedNonFinalFt = false;
          break;
        }
        lastMissedNonFinalFt = false;
        if (!a.teamId) break;
        if (a.subType === "offensive") {
          ensure(a.teamId, clock, i, period);
        } else if (a.subType === "defensive") {
          if (!cur) open(a.teamId, clock, "dreb", i, period);
          else if ((cur as ParsedPossession).offense !== a.teamId) {
            close(clock, "dreb", i);
            open(a.teamId, clock, "dreb", i, period);
          }
        }
        break;
      }
      case "turnover": {
        if (!a.teamId) break;
        // A turnover logged after a held-ball/stoppage that already handed the ball over (same clock) is the
        // previous possession's ending, recorded late — the ball doesn't change hands twice.
        if (cur && (cur as ParsedPossession).offense !== a.teamId && (cur as ParsedPossession).startClock === clock) {
          const k = lastOf(a.teamId, period);
          if (k >= 0) forcedPoss.set(i, k);
          break;
        }
        // A held ball "recovered" by one team, followed by the other team's turnover before the recovering team does
        // anything, means the recovery was the other team's: fold the phantom possession back into the previous one.
        if (cur && (cur as ParsedPossession).offense !== a.teamId && (cur as ParsedPossession).startType === "jump_ball") {
          const c = cur as ParsedPossession;
          const acted = acts.slice(c.firstEvent + 1, i).some((b) => b.teamId === c.offense && (b.isFieldGoal || b.actionType === "freethrow" || b.actionType === "turnover"));
          const prev = possessions[possessions.length - 2];
          if (!acted && prev && prev.offense === a.teamId && prev.period === period) {
            possessions.pop();
            cur = prev;
          }
        }
        ensure(a.teamId, clock, i, period);
        agreement.checked++;
        if (a.possession === a.teamId) agreement.agreed++;
        const live = acts.slice(i + 1, i + 4).some((b) => b.actionType === "steal" && parseClock(b.clock) === clock) || !!a.stealPersonId;
        close(clock, "tov", i);
        open(other(a.teamId), clock, live ? "live_tov" : "dead_tov", i, period);
        pendingAndOne = false;
        break;
      }
      default:
        break;
    }
    if (cur) {
      (cur as ParsedPossession).lastEvent = i;
      (cur as ParsedPossession).endClock = clock;
    }
    if (a.scoreHome >= lastHome) lastHome = a.scoreHome;
    if (a.scoreAway >= lastAway) lastAway = a.scoreAway;
  }

  // Attach possession index to events.
  for (const p of possessions) for (let i = p.firstEvent; i <= p.lastEvent; i++) if (events[i].poss === -1 || events[i].type !== "period") events[i].poss = p.id;
  // An event that closes one possession and opens the next (made FG) belongs to the closing one.
  for (let k = 1; k < possessions.length; k++) {
    const p = possessions[k];
    const prev = possessions[k - 1];
    if (p.firstEvent === prev.lastEvent) events[p.firstEvent].poss = prev.id;
  }
  for (const [i, k] of forcedPoss) events[i].poss = k;

  // Possession points: every score change inside the possession by its offense, technical free throws excluded
  // (they are scored on someone else's possession and don't belong to either offense's efficiency).
  {
    let h = 0;
    let w = 0;
    for (let i = 0; i < acts.length; i++) {
      const a = acts[i];
      const dh = a.scoreHome - h;
      const dw = a.scoreAway - w;
      h = Math.max(h, a.scoreHome);
      w = Math.max(w, a.scoreAway);
      if (dh <= 0 && dw <= 0) continue;
      if (isTechnicalFt(a)) continue;
      const p = possessions[events[i].poss];
      if (!p) continue;
      const scorer = dh > 0 ? home : away;
      if (p.offense === scorer) p.points += dh > 0 ? dh : dw;
    }
  }

  const plays = extractPlays(acts, events, possessions, home, away);

  return {
    gameId: raw.gameId,
    date: raw.date,
    homeTeamId: home,
    awayTeamId: away,
    events,
    possessions,
    plays,
    starters,
    floorSeconds: sim.floorSeconds,
    plusMinus: sim.plusMinus,
    issues,
    possessionFieldAgreement: agreement,
    startResolution,
    corrections,
  };
}

// ───────────────────────────── floor simulation ─────────────────────────────

function simulate(
  acts: CdnAction[],
  periods: number[],
  starters: Record<number, [number[], number[]]>,
  home: number,
  away: number,
  teamOf: Map<number, number>,
  issues: LineupIssue[],
) {
  const floorSeconds = new Map<number, number>();
  const plusMinus = new Map<number, number>();
  const floors: [number[], number[]][] = new Array(acts.length);
  const credit = (m: Map<number, number>, id: number, v: number) => m.set(id, (m.get(id) ?? 0) + v);
  let floor: [Set<number>, Set<number>] = [new Set(), new Set()];
  let lastClock = 0;
  let curPeriod = 0;
  let lastHome = 0;
  let lastAway = 0;
  type Snap = { clock: number; period: number; floor: [Set<number>, Set<number>] };
  let foulFloor: Snap | null = null;
  let techFloor: Snap | null = null;
  const side = (t: number): number => (t === home ? 0 : t === away ? 1 : -1);
  const elapse = (to: number) => {
    const d = Math.round((lastClock - to) * 10) / 10;
    if (d > 0) for (const s of floor) for (const p of s) credit(floorSeconds, p, d);
    lastClock = to;
  };

  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    if (a.period !== curPeriod) {
      if (curPeriod) elapse(0);
      curPeriod = a.period;
      const st = starters[a.period] ?? [[], []];
      floor = [new Set(st[0]), new Set(st[1])];
      lastClock = periodLength(a.period);
    }
    const clock = parseClock(a.clock);
    elapse(Math.min(clock, lastClock));
    if (a.actionType === "substitution") {
      const s = side(a.teamId || teamOf.get(a.personId) || 0);
      if (s >= 0) {
        if (a.subType === "out") {
          if (!floor[s].has(a.personId)) issues.push({ period: a.period, teamId: a.teamId, kind: "sub_out_off_floor", detail: `${a.actionNumber}:${a.personId}` });
          floor[s].delete(a.personId);
        } else {
          if (floor[s].has(a.personId)) issues.push({ period: a.period, teamId: a.teamId, kind: "sub_in_on_floor", detail: `${a.actionNumber}:${a.personId}` });
          floor[s].add(a.personId);
        }
      }
    } else if (issues !== undefined && !NON_EVIDENCE.has(a.actionType) && !isTechnicalFoul(a) && a.personId) {
      const s = side(teamOf.get(a.personId) ?? 0);
      if (s >= 0 && !floor[s].has(a.personId) && a.actionType !== "freethrow")
        issues.push({ period: a.period, teamId: a.teamId, kind: "actor_off_floor", detail: `${a.actionNumber}:${a.personId}` });
    }
    // Plus-minus: points go to the ten on the floor when they're scored — except free throws, which the NBA
    // credits to the ten on the floor when the foul was committed (substitutions between attempts don't move them).
    // (Technical free throws likewise go to the floor at the technical, even when an ejection empties it first.)
    if (a.actionType === "foul") {
      const snap = { clock: parseClock(a.clock), period: a.period, floor: [new Set(floor[0]), new Set(floor[1])] as [Set<number>, Set<number>] };
      if (isTechnicalFoul(a)) techFloor = snap;
      else foulFloor = snap;
    }
    const dh = a.scoreHome - lastHome;
    const da = a.scoreAway - lastAway;
    if (dh || da) {
      const net = dh - da;
      const src = a.actionType === "freethrow" ? (isTechnicalFt(a) ? techFloor : foulFloor) : null;
      // A replacement shooter (the fouled player was hurt or ejected) wasn't on the floor at the foul; the NBA then
      // credits the attempts to the floor as it stands.
      const shooterSide = a.teamId === home ? 0 : 1;
      const ftFloor =
        src && src.period === a.period && src.clock === parseClock(a.clock) && (isTechnicalFt(a) || src.floor[shooterSide].has(a.personId))
          ? src.floor
          : floor;
      for (const p of ftFloor[0]) credit(plusMinus, p, net);
      for (const p of ftFloor[1]) credit(plusMinus, p, -net);
      lastHome = a.scoreHome;
      lastAway = a.scoreAway;
    }
    floors[i] = [[...floor[0]], [...floor[1]]];
    if (a.actionType !== "substitution" && issues.length < 5000 && (floor[0].size !== 5 || floor[1].size !== 5) && a.actionType !== "period") {
      // A floor that isn't 5-on-5 between paired subs is expected only on the substitution rows themselves.
      const next = acts[i + 1];
      if (!next || next.actionType !== "substitution")
        issues.push({ period: a.period, teamId: 0, kind: "floor_size", detail: `${a.actionNumber}:${floor[0].size}v${floor[1].size}` });
    }
  }
  elapse(0);
  void periods;
  return { floorSeconds, plusMinus, floors };
}

// ───────────────────────────── plays ─────────────────────────────

function extractPlays(acts: CdnAction[], events: ParsedEvent[], possessions: ParsedPossession[], home: number, away: number): ParsedPlay[] {
  const plays: ParsedPlay[] = [];
  const offFloor = (e: ParsedEvent, team: number) => (team === home ? e.floor[0] : e.floor[1]);
  const scoreBefore = (i: number) => {
    // Score before the action = score of the previous action.
    const prev = i > 0 ? acts[i - 1] : null;
    return prev ? [prev.scoreHome, prev.scoreAway] : [0, 0];
  };
  const marginFor = (i: number, team: number) => {
    const [h, a] = scoreBefore(i);
    return team === home ? h - a : a - h;
  };
  const base = (i: number, kind: PlayKind, team: number): ParsedPlay => {
    const a = acts[i];
    const e = events[i];
    const poss = possessions[e.poss] ?? null;
    const defense = team === home ? away : home;
    return {
      id: 0,
      kind,
      event: i,
      actionNumber: a.actionNumber,
      poss: e.poss,
      period: a.period,
      clock: e.clock,
      elapsed: e.elapsed,
      wall: e.wall,
      offense: team,
      defense,
      actor: a.personId,
      assist: 0,
      block: 0,
      steal: 0,
      fouler: 0,
      value: 0,
      made: false,
      points: 0,
      attempts: 0,
      x: 0,
      y: 0,
      dist: 0,
      zone: null,
      shotType: a.subType,
      descriptor: a.descriptor,
      qualifiers: a.qualifiers,
      and1: false,
      secondChance: a.qualifiers.includes("2ndchance"),
      margin: marginFor(i, team),
      possSeconds: poss ? Math.round((poss.startClock - e.clock) * 10) / 10 : 0,
      offFloor: offFloor(e, team),
      defFloor: offFloor(e, defense),
      desc: a.description,
    };
  };

  for (let i = 0; i < acts.length; i++) {
    const a = acts[i];
    if (a.isFieldGoal && (a.actionType === "2pt" || a.actionType === "3pt")) {
      const p = base(i, "fga", a.teamId);
      p.value = a.actionType === "3pt" ? 3 : 2;
      p.made = a.shotResult === "Made";
      p.points = p.made ? p.value : 0;
      p.assist = a.assistPersonId ?? 0;
      p.block = 0;
      p.x = a.xLegacy ?? 0;
      p.y = a.yLegacy ?? 0;
      p.dist = a.shotDistance ?? Math.round(Math.hypot(p.x, p.y)) / 10;
      p.zone = classifyZone(p.x, p.y, p.value as 2 | 3);
      {
        const b = acts.slice(i + 1, i + 3).find((x) => x.actionType === "block" && parseClock(x.clock) === p.clock);
        p.block = b ? b.personId : (a.blockPersonId ?? 0);
      }
      plays.push(p);
    } else if (a.actionType === "turnover" && a.teamId) {
      const p = base(i, "tov", a.teamId);
      {
        const s = acts.slice(i + 1, i + 4).find((x) => x.actionType === "steal" && parseClock(x.clock) === p.clock);
        p.steal = s ? s.personId : (a.stealPersonId ?? 0);
      }
      plays.push(p);
    } else if (a.actionType === "freethrow" && !isTechnicalFt(a)) {
      const [k] = ftIndex(a);
      if (k !== 1) continue; // anchor the trip on its first attempt
      const p = base(i, "ft", a.teamId);
      const trip: CdnAction[] = [];
      const [, m] = ftIndex(a);
      for (let j = i; j < acts.length && trip.length < m; j++) {
        const b = acts[j];
        if (b.actionType === "freethrow" && !isTechnicalFt(b) && b.personId === a.personId && parseClock(b.clock) === p.clock) trip.push(b);
      }
      p.attempts = m;
      p.value = 1;
      p.points = trip.filter((b) => b.shotResult === "Made" || (!/MISS/.test(b.description) && b.shotResult !== "Missed")).length;
      p.made = p.points > 0;
      p.shotType = m === 1 ? "1 of 1" : `${m} shots`;
      // The foul that sent him: nearest preceding foul at this clock drawn by the shooter.
      for (let j = i - 1; j >= 0 && j >= i - 12; j--) {
        const b = acts[j];
        if (b.actionType === "foul" && parseClock(b.clock) === p.clock && (b.foulDrawnPersonId === a.personId || b.personIdsFilter.includes(a.personId))) {
          p.fouler = b.personId;
          break;
        }
      }
      // And-one trips belong to the made FG just before them.
      if (m === 1) {
        for (let k2 = plays.length - 1; k2 >= 0 && k2 >= plays.length - 6; k2--) {
          const q = plays[k2];
          if (q.kind === "fga" && q.made && q.actor === a.personId && q.clock === p.clock && q.period === p.period) {
            q.and1 = true;
            p.and1 = true;
            break;
          }
        }
      }
      plays.push(p);
    }
  }
  plays.forEach((p, k) => (p.id = k));
  return plays;
}

export type { BoxPlayer };
