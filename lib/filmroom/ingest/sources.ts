// Source adapters. Two interchangeable paths produce the same RawGame:
//
//  • live — the official endpoints (cdn.nba.com liveData playbyplay/boxscore, stats.nba.com playbyplayv3,
//    shotchartdetail, gamerotation, hustlestatsboxscore, videoeventsasset). NBA's edge refuses datacenter IPs, so
//    this path is for a workstation run (`--source live`).
//  • mirror — season CSV dumps of those same feeds (shufinskiy/nba_data: cdn.nba.com actions, shotchartdetail,
//    pbpstats possessions with their videoeventsasset URLs; NocturneBear: boxscoretraditionalv3 player rows).
//
// Everything downstream (possession machine, lineups, reconciliation) consumes RawGame only.

import type { BoxPlayer, CdnAction, RawGame, RotationStint, ShotChartRow, V3Action, VideoAsset } from "./raw";
import { readCsvObjects } from "./csv";

const num = (s: string | undefined): number | null => {
  if (s === undefined || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const ids = (s: string): number[] =>
  s
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0);

export function cdnActionFromRecord(r: Record<string, string>): CdnAction {
  return {
    actionNumber: Number(r.actionNumber),
    orderNumber: Number(r.orderNumber),
    clock: r.clock,
    timeActual: r.timeActual,
    period: Number(r.period),
    periodType: r.periodType,
    actionType: r.actionType,
    subType: r.subType,
    descriptor: r.descriptor,
    qualifiers: r.qualifiers ? r.qualifiers.split(",").map((q) => q.trim()).filter(Boolean) : [],
    personId: Number(r.personId) || 0,
    personIdsFilter: ids(r.personIdsFilter ?? ""),
    teamId: Number(r.teamId) || 0,
    teamTricode: r.teamTricode,
    possession: Number(r.possession) || 0,
    scoreHome: Number(r.scoreHome) || 0,
    scoreAway: Number(r.scoreAway) || 0,
    isFieldGoal: r.isFieldGoal === "1" || r.isFieldGoal === "TRUE" || r.isFieldGoal === "true",
    xLegacy: num(r.xLegacy),
    yLegacy: num(r.yLegacy),
    shotDistance: num(r.shotDistance),
    shotResult: r.shotResult ?? "",
    shotActionNumber: num(r.shotActionNumber),
    assistPersonId: num(r.assistPersonId),
    blockPersonId: num(r.blockPersonId),
    stealPersonId: num(r.stealPersonId),
    foulDrawnPersonId: num(r.foulDrawnPersonId),
    pointsTotal: num(r.pointsTotal),
    assistTotal: num(r.assistTotal),
    description: r.description ?? "",
    area: r.area ?? "",
    areaDetail: r.areaDetail ?? "",
    side: r.side ?? "",
  };
}

/** A live liveData action object → CdnAction (the JSON already has this shape; normalise optional fields). */
export function cdnActionFromJson(a: Record<string, unknown>): CdnAction {
  const s = (k: string) => (a[k] === undefined || a[k] === null ? "" : String(a[k]));
  const rec: Record<string, string> = {};
  for (const k of Object.keys(a)) rec[k] = s(k);
  rec.qualifiers = Array.isArray(a.qualifiers) ? (a.qualifiers as string[]).join(", ") : "";
  rec.personIdsFilter = Array.isArray(a.personIdsFilter) ? (a.personIdsFilter as number[]).join(", ") : "";
  return cdnActionFromRecord(rec);
}

const mmss = (s: string): number => {
  if (!s) return 0;
  const m = /^(\d+):(\d+)$/.exec(s.trim());
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const iso = /PT(\d+)M([\d.]+)S/.exec(s);
  if (iso) return Number(iso[1]) * 60 + Math.round(Number(iso[2]));
  return 0;
};

export function boxFromRecord(r: Record<string, string>): BoxPlayer {
  const n = (k: string) => Number(r[k]) || 0;
  return {
    gameId: String(Number(r.gameId)),
    teamId: n("teamId"),
    personId: n("personId"),
    name: r.personName,
    seconds: mmss(r.minutes),
    fgm: n("fieldGoalsMade"),
    fga: n("fieldGoalsAttempted"),
    fg3m: n("threePointersMade"),
    fg3a: n("threePointersAttempted"),
    ftm: n("freeThrowsMade"),
    fta: n("freeThrowsAttempted"),
    oreb: n("reboundsOffensive"),
    dreb: n("reboundsDefensive"),
    ast: n("assists"),
    stl: n("steals"),
    blk: n("blocks"),
    tov: n("turnovers"),
    pf: n("foulsPersonal"),
    pts: n("points"),
    plusMinus: n("plusMinusPoints"),
  };
}

export function shotFromRecord(r: Record<string, string>): ShotChartRow {
  return {
    gameId: String(Number(r.GAME_ID)),
    eventId: Number(r.GAME_EVENT_ID),
    personId: Number(r.PLAYER_ID),
    teamId: Number(r.TEAM_ID),
    period: Number(r.PERIOD),
    locX: Number(r.LOC_X),
    locY: Number(r.LOC_Y),
    made: r.SHOT_MADE_FLAG === "1",
    value: r.SHOT_TYPE.startsWith("3") ? 3 : 2,
    zoneBasic: r.SHOT_ZONE_BASIC,
    zoneArea: r.SHOT_ZONE_AREA,
  };
}

export function v3FromRecord(r: Record<string, string>): V3Action {
  return {
    actionNumber: Number(r.actionNumber),
    period: Number(r.period),
    clock: r.clock,
    teamId: Number(r.teamId) || 0,
    personId: Number(r.personId) || 0,
    isFieldGoal: r.isFieldGoal === "1",
    shotValue: Number(r.shotValue) || 0,
    shotResult: r.shotResult ?? "",
    actionType: r.actionType ?? "",
    description: r.description ?? "",
    x: Number(r.xLegacy) || 0,
    y: Number(r.yLegacy) || 0,
  };
}

export interface MirrorPaths {
  v3: string;
  cdn: string;
  shots: string;
  pbpstats: string;
  box: string[];
}

/** Load every game a team played from the season mirrors. */
export async function loadMirrorSeason(paths: MirrorPaths, teamTri: string): Promise<RawGame[]> {
  const games = new Map<string, RawGame>();
  const gameIds = new Set<string>();

  // Pass 1 over the box scores finds the team's games and both rosters.
  for (const file of paths.box) {
    for await (const r of readCsvObjects(file, (c, col) => c[col("season_year")] === "2023-24")) {
      const b = boxFromRecord(r);
      if (r.teamTricode === teamTri) gameIds.add(b.gameId);
      const g = games.get(b.gameId) ?? {
        gameId: b.gameId,
        date: r.game_date,
        homeTeamId: 0,
        awayTeamId: 0,
        actions: [],
        box: [],
        shots: [],
        video: [],
        refPossessions: [],
      };
      g.box.push(b);
      // "GSW vs. PHX" — the first team is home when the separator is "vs.", away when it is "@".
      const [a, sep] = r.matchup.split(" ");
      if (a === r.teamTricode) {
        if (sep === "vs.") g.homeTeamId = b.teamId;
        else g.awayTeamId = b.teamId;
      }
      games.set(b.gameId, g);
    }
  }
  for (const id of [...games.keys()]) if (!gameIds.has(id)) games.delete(id);

  for await (const r of readCsvObjects(paths.cdn, (c, col) => gameIds.has(String(Number(c[col("gameId")]))))) {
    games.get(String(Number(r.gameId)))!.actions.push(cdnActionFromRecord(r));
  }
  for await (const r of readCsvObjects(paths.v3, (c, col) => gameIds.has(String(Number(c[col("gameId")]))))) {
    const g = games.get(String(Number(r.gameId)))!;
    (g.v3 ??= []).push(v3FromRecord(r));
  }
  for await (const r of readCsvObjects(paths.shots, (c, col) => gameIds.has(String(Number(c[col("GAME_ID")]))))) {
    games.get(String(Number(r.GAME_ID)))!.shots.push(shotFromRecord(r));
  }
  // pbpstats rows: one per event, grouped by possession; the URL column is the videoeventsasset resolution.
  const seenVideo = new Set<string>();
  const seenPoss = new Set<string>();
  for await (const r of readCsvObjects(paths.pbpstats, (c, col) => gameIds.has(String(Number(c[col("GAMEID")]))))) {
    const g = games.get(String(Number(r.GAMEID)))!;
    if (r.URL) {
      const m = /\/(\d{10})\/(\d+)\//.exec(r.URL);
      if (m) {
        const key = `${g.gameId}:${m[2]}`;
        if (!seenVideo.has(key)) {
          seenVideo.add(key);
          g.video.push({ gameId: g.gameId, actionNumber: Number(m[2]), url: r.URL });
        }
      }
    }
    const pk = `${g.gameId}|${r.PERIOD}|${r.STARTTIME}|${r.ENDTIME}|${r.OPPONENT}|${r.EVENTS}`;
    if (!seenPoss.has(pk)) {
      seenPoss.add(pk);
      g.refPossessions!.push({ gameId: g.gameId, period: Number(r.PERIOD), offenseTri: r.OPPONENT, start: r.STARTTIME, end: r.ENDTIME });
    }
  }
  return [...games.values()].sort((a, b) => a.gameId.localeCompare(b.gameId));
}

// ───────────────────────── live endpoints (workstation path) ─────────────────────────

const STATS_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Accept: "application/json, text/plain, */*",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: STATS_HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

/** stats.nba.com resultSets → row objects. */
function resultSet(json: any, name?: string): Record<string, unknown>[] {
  const sets = json.resultSets ?? [json.resultSet];
  const set = name ? sets.find((s: any) => s.name === name) : sets[0];
  if (!set) return [];
  return set.rowSet.map((row: unknown[]) => Object.fromEntries(set.headers.map((h: string, i: number) => [h, row[i]])));
}

export async function loadLiveGame(gameId: string): Promise<RawGame> {
  const gid = gameId.padStart(10, "0");
  const pbp = await getJson(`https://cdn.nba.com/static/json/liveData/playbyplay/playbyplay_${gid}.json`);
  const boxJson = await getJson(`https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gid}.json`);
  const bg = boxJson.game;
  const box: BoxPlayer[] = [];
  for (const side of [bg.homeTeam, bg.awayTeam]) {
    for (const p of side.players) {
      const s = p.statistics;
      box.push({
        gameId,
        teamId: side.teamId,
        personId: p.personId,
        name: p.name,
        seconds: mmss(s.minutesCalculated ?? s.minutes),
        fgm: s.fieldGoalsMade,
        fga: s.fieldGoalsAttempted,
        fg3m: s.threePointersMade,
        fg3a: s.threePointersAttempted,
        ftm: s.freeThrowsMade,
        fta: s.freeThrowsAttempted,
        oreb: s.reboundsOffensive,
        dreb: s.reboundsDefensive,
        ast: s.assists,
        stl: s.steals,
        blk: s.blocks,
        tov: s.turnovers,
        pf: s.foulsPersonal,
        pts: s.points,
        plusMinus: s.plusMinusPoints,
      });
    }
  }
  const shotsJson = await getJson(
    `https://stats.nba.com/stats/shotchartdetail?GameID=${gid}&TeamID=0&PlayerID=0&ContextMeasure=FGA&Season=&SeasonType=&LeagueID=00&PlayerPosition=&DateFrom=&DateTo=&GameSegment=&LastNGames=0&Location=&Month=0&OpponentTeamID=0&Outcome=&Period=0&RookieYear=&SeasonSegment=&VsConference=&VsDivision=&AheadBehind=&ClutchTime=&PointDiff=&RangeType=0&StartPeriod=0&EndPeriod=0&StartRange=0&EndRange=0`,
  );
  const shots = resultSet(shotsJson, "Shot_Chart_Detail").map((r) =>
    shotFromRecord(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]))),
  );
  const rotJson = await getJson(`https://stats.nba.com/stats/gamerotation?GameID=${gid}&LeagueID=00`);
  const rotation: RotationStint[] = [...resultSet(rotJson, "HomeTeam"), ...resultSet(rotJson, "AwayTeam")].map((r) => ({
    teamId: Number(r.TEAM_ID),
    personId: Number(r.PERSON_ID),
    inTime: Number(r.IN_TIME_REAL),
    outTime: Number(r.OUT_TIME_REAL),
  }));
  const actions: CdnAction[] = pbp.game.actions.map(cdnActionFromJson);
  const v3Json = await getJson(`https://stats.nba.com/stats/playbyplayv3?GameID=${gid}&StartPeriod=0&EndPeriod=0`);
  const v3: V3Action[] = (v3Json.game?.actions ?? []).map((a: Record<string, unknown>) =>
    v3FromRecord(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]))),
  );
  const video: VideoAsset[] = [];
  for (const a of actions) {
    if (!a.isFieldGoal && a.actionType !== "turnover") continue;
    const v = await getJson(`https://stats.nba.com/stats/videoeventsasset?GameEventID=${a.actionNumber}&GameID=${gid}`).catch(() => null);
    const url = v?.resultSets?.Meta?.videoUrls?.[0]?.lurl ?? v?.resultSets?.Meta?.videoUrls?.[0]?.murl;
    if (url) video.push({ gameId, actionNumber: a.actionNumber, url });
  }
  return {
    gameId,
    date: bg.gameTimeUTC?.slice(0, 10) ?? "",
    homeTeamId: bg.homeTeam.teamId,
    awayTeamId: bg.awayTeam.teamId,
    actions,
    box,
    shots,
    video,
    rotation,
    v3,
  };
}
