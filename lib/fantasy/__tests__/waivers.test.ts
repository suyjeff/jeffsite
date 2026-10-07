import { describe, expect, it } from "vitest";
import { buildSchedule } from "../context";
import type { MarketWeek } from "../lines";
import type { PlayerMap } from "../types";
import {
  ALLOWED_PRIOR_GAMES,
  boomOdds,
  impliedTotals,
  kickerImpliedTotal,
  pointsAllowed,
  positionSpread,
  streamReasons,
  streamRows,
} from "../waivers";

const p = (id: string, pos: string, team: string) => ({
  id,
  name: id,
  pos,
  fpos: [pos],
  team,
  status: null,
  injury: null,
  age: null,
  exp: null,
});
const players: PlayerMap = {
  qa: p("qa", "QB", "AAA"),
  qa2: p("qa2", "QB", "AAA"),
  qb: p("qb", "QB", "BBB"),
  qc: p("qc", "QB", "CCC"),
  qd: p("qd", "QB", "DDD"),
  AAA: p("AAA", "DEF", "AAA"),
  BBB: p("BBB", "DEF", "BBB"),
  CCC: p("CCC", "DEF", "CCC"),
  DDD: p("DDD", "DEF", "DDD"),
  ka: p("ka", "K", "AAA"),
};
const schedule = buildSchedule([
  { week: 1, home: "AAA", away: "BBB" },
  { week: 1, home: "CCC", away: "DDD" },
  { week: 2, home: "AAA", away: "CCC" },
  { week: 2, home: "BBB", away: "DDD" },
]);

describe("pointsAllowed", () => {
  const weekPoints = {
    1: { qa: 30, qa2: 2, qb: 10, qc: 20, qd: 20, AAA: 12, BBB: 2 },
  };
  it("charges each quarterback to the defense he faced, top scorer per team", () => {
    const a = pointsAllowed(weekPoints, [1], players, schedule, "QB");
    // AAA's starter (30, not the backup's 2) counts against BBB.
    expect(a.BBB.ppg).toBe(30);
    expect(a.AAA.ppg).toBe(10);
    expect(a.BBB.rank).toBe(1);
    // One game is regressed toward the league average (20) with three games of prior.
    expect(a.BBB.index).toBeCloseTo(
      (30 + ALLOWED_PRIOR_GAMES * 20) / (1 + ALLOWED_PRIOR_GAMES) / 20,
    );
  });
  it("credits a defense score to the offense it faced", () => {
    const a = pointsAllowed(weekPoints, [1], players, schedule, "DEF");
    // AAA's defense scored 12 against BBB: BBB is the soft offense.
    expect(a.BBB.ppg).toBe(12);
    expect(a.AAA.ppg).toBe(2);
  });
  it("needs a schedule", () => {
    expect(pointsAllowed(weekPoints, [1], players, null, "QB")).toEqual({});
  });
});

describe("implied totals", () => {
  it("reads touchdowns off the extra-point line", () => {
    // 2.85 XP made ≈ 3 TDs; 2 FG → 18 + 2.85 + 6.
    expect(kickerImpliedTotal(2.85, 2)).toBeCloseTo(26.85);
  });
  it("takes the opponent defense projection, then the market where there is one", () => {
    const statLines = { BBB: { pts_allow: 24 }, AAA: { pts_allow: 18 } };
    const proj = impliedTotals({
      week: 1,
      schedule,
      statLines,
      market: null,
      players,
    });
    expect(proj.AAA).toEqual({ pts: 24, source: "projection" });
    expect(proj.BBB).toEqual({ pts: 18, source: "projection" });
    const market = {
      week: 1,
      byId: {
        ka: {
          props: [
            { stat: "extra_point_made", line: 2.5, pOver: 0.6, mean: 2.85 },
            { stat: "field_goal_made", line: 1.5, pOver: 0.6, mean: 2 },
          ],
        },
      },
    } as unknown as MarketWeek;
    const both = impliedTotals({
      week: 1,
      schedule,
      statLines,
      market,
      players,
    });
    expect(both.AAA.source).toBe("market");
    expect(both.AAA.pts).toBeCloseTo(26.85);
    // A market for another week is not this week's market.
    expect(
      impliedTotals({ week: 2, schedule, statLines, market, players }).AAA,
    ).toBeUndefined();
  });
});

describe("streaming", () => {
  it("turns a projection into odds of a starter-level week", () => {
    expect(boomOdds(10, 5, 10)).toBeCloseTo(0.5);
    expect(boomOdds(15, 5, 10)).toBeGreaterThan(0.8);
    expect(boomOdds(0, 5, 10)).toBe(0);
  });
  it("falls back to a typical spread before there is a sample", () => {
    expect(positionSpread({}, [], players, "QB", 18)).toBe(7.5);
  });
  it("lists free agents only, against your best at the position", () => {
    const horizon = [
      { week: 1, pts: { qa: 20, qb: 15, qc: 12, qd: 0 } },
      { week: 2, pts: { qa: 20, qb: 14, qc: 18, qd: 9 } },
    ];
    const { rows, mine } = streamRows({
      pos: "QB",
      week: 1,
      aheadWeeks: [1, 2],
      players,
      rosteredBy: { qa: 1 },
      myPlayers: ["qa"],
      horizon,
      schedule,
      totals: {},
      allowed: {},
      statLines: null,
      starter: 15,
      sd: 6,
      trending: [{ player_id: "qc", count: 900 }],
    });
    expect(mine).toEqual({ id: "qa", proj: 20 });
    // qa is rostered; qd has no projection this week.
    expect(rows.map((r) => r.id)).toEqual(["qb", "qc"]);
    expect(rows[0].vsMine).toBe(-5);
    expect(rows[1].ahead.map((w) => [w.week, w.opp, w.proj])).toEqual([
      [1, "DDD", 12],
      [2, "AAA", 18],
    ]);
    expect(streamReasons(rows[1], "QB")).toContain("home");
    expect(streamReasons(rows[1], "QB")).toContain("900 adds 24h");
  });
});
