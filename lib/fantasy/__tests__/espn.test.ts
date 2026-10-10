import { describe, expect, it } from 'vitest'
import {
  convertEspnLeague,
  espnRosterPositions,
  espnScoring,
  espnTeamChoices,
  buildEspnIndex,
  matchEspnPlayer,
  slotStarters,
  trimEspnLeague,
  trimEspnWeek,
  type EspnRawLeague,
} from '../espn'
import type { PlayerMap, TrimmedPlayer } from '../types'

// A two-team ESPN league in the v3 API's shape (view=mSettings, mTeam, mRoster, mMatchup, mStatus, mDraftDetail),
// cut down to the fields the adapter reads. Written to the documented shape, not captured from a live league.

const tp = (id: string, name: string, pos: string, team: string | null, espnId?: string): TrimmedPlayer => ({
  id,
  name,
  pos,
  fpos: [pos],
  team,
  status: 'Active',
  injury: null,
  age: 26,
  exp: 4,
  ...(espnId ? { espnId } : {}),
})

const players: PlayerMap = {
  '4046': tp('4046', 'Patrick Mahomes', 'QB', 'KC', '3139477'),
  '4866': tp('4866', 'Saquon Barkley', 'RB', 'PHI', '3929630'),
  // No ESPN id on Sleeper's side: these match on name.
  '9509': tp('9509', 'Bijan Robinson', 'RB', 'ATL'),
  '6794': tp('6794', 'Justin Jefferson', 'WR', 'MIN'),
  '7564': tp('7564', "Ja'Marr Chase", 'WR', 'CIN'),
  '9999': tp('9999', 'Mike Williams', 'WR', 'PIT'),
  '9998': tp('9998', 'Mike Williams', 'WR', 'NYJ'),
  '5844': tp('5844', 'T.J. Hockenson', 'TE', 'MIN'),
  '4227': tp('4227', 'Taysom Hill', 'TE', 'NO'),
  '1433': tp('1433', 'Brandon Aubrey', 'K', 'DAL'),
  '4984': tp('4984', 'Josh Allen', 'QB', 'BUF', '3918298'),
  KC: tp('KC', 'Kansas City Chiefs', 'DEF', 'KC'),
  PHI: tp('PHI', 'Philadelphia Eagles', 'DEF', 'PHI'),
}

const pl = (id: number, fullName: string, defaultPositionId: number, proTeamId: number) => ({ id, fullName, defaultPositionId, proTeamId })
const entry = (playerId: number, lineupSlotId: number, player: ReturnType<typeof pl>, appliedStatTotal?: number) => ({
  playerId,
  lineupSlotId,
  playerPoolEntry: { id: playerId, ...(appliedStatTotal != null ? { appliedStatTotal } : {}), player },
})

const P = {
  mahomes: pl(3139477, 'Patrick Mahomes', 1, 12),
  barkley: pl(3929630, 'Saquon Barkley', 2, 21),
  bijan: pl(4430807, 'Bijan Robinson', 2, 1),
  jefferson: pl(4262921, 'Justin Jefferson', 3, 16),
  chase: pl(4362628, "Ja'Marr Chase", 3, 4),
  williams: pl(4000001, 'Mike Williams Jr.', 3, 23),
  hockenson: pl(4036133, 'T.J. Hockenson', 4, 16),
  hill: pl(16336, 'Taysom Hill', 1, 18),
  aubrey: pl(4689936, 'Brandon Aubrey', 5, 6),
  allen: pl(3918298, 'Josh Allen', 1, 2),
  chiefs: pl(-16012, 'Chiefs D/ST', 16, 12),
  eagles: pl(-16021, 'Eagles D/ST', 16, 21),
  ghost: pl(4999999, 'Nobody Known', 3, 7),
}

const raw: EspnRawLeague = {
  id: 123456,
  seasonId: 2026,
  scoringPeriodId: 3,
  status: { currentMatchupPeriod: 3, latestScoringPeriod: 3, finalScoringPeriod: 17, firstScoringPeriod: 1, isActive: true, previousSeasons: [2025] },
  settings: {
    name: 'Office League',
    size: 2,
    rosterSettings: { lineupSlotCounts: { '0': 1, '2': 2, '4': 2, '6': 1, '23': 1, '16': 1, '17': 1, '20': 2, '21': 1, '7': 0, '19': 1 } },
    scoringSettings: {
      scoringType: 'H2H_POINTS',
      scoringItems: [
        { statId: 3, points: 0.04 },
        { statId: 4, points: 4 },
        { statId: 20, points: -2 },
        { statId: 24, points: 0.1 },
        { statId: 25, points: 6 },
        { statId: 42, points: 0.1 },
        { statId: 43, points: 6 },
        { statId: 53, points: 1, pointsOverrides: { '6': 1.5 } },
        { statId: 72, points: -2 },
        { statId: 74, points: 5 },
        { statId: 77, points: 4 },
        { statId: 80, points: 3 },
        { statId: 85, points: -1 },
        { statId: 86, points: 1 },
        { statId: 89, points: 5 },
        { statId: 92, points: 1 },
        { statId: 121, points: 0 },
        { statId: 95, points: 2 },
        { statId: 99, points: 1 },
        { statId: 103, points: 6 },
        { statId: 17, points: 2 },
        { statId: 18, points: 5 },
        { statId: 155, points: 3 },
      ],
    },
    scheduleSettings: { matchupPeriodCount: 14, playoffTeamCount: 2, playoffMatchupPeriodLength: 1, matchupPeriods: { '1': [1], '2': [2], '3': [3], '15': [15] } },
    acquisitionSettings: { isUsingAcquisitionBudget: true, acquisitionBudget: 100, minimumBid: 0 },
    draftSettings: { type: 'SNAKE', keeperCount: 0 },
  },
  members: [
    { id: '{AAA}', displayName: 'jdoe', firstName: 'Jane', lastName: 'Doe' },
    { id: '{BBB}', firstName: 'Sam', lastName: 'Roe' },
  ],
  teams: [
    {
      id: 1,
      abbrev: 'JD',
      location: 'Gridiron',
      nickname: 'Gurus',
      logo: 'https://g.espncdn.com/lm-static/logo-packs/core/1.svg',
      owners: ['{AAA}'],
      primaryOwner: '{AAA}',
      record: { overall: { wins: 2, losses: 0, ties: 0, pointsFor: 251.36, pointsAgainst: 200.5 } },
      transactionCounter: { acquisitionBudgetSpent: 12 },
      roster: {
        entries: [
          entry(3139477, 0, P.mahomes),
          entry(3929630, 2, P.barkley),
          entry(4430807, 2, P.bijan),
          entry(4262921, 4, P.jefferson),
          entry(4036133, 6, P.hockenson),
          entry(4000001, 23, P.williams),
          entry(-16012, 16, P.chiefs),
          entry(4689936, 17, P.aubrey),
          entry(16336, 20, P.hill),
          entry(4999999, 21, P.ghost),
        ],
      },
    },
    {
      id: 2,
      name: 'Roe Rage',
      abbrev: 'RR',
      owners: ['{BBB}'],
      primaryOwner: '{BBB}',
      record: { overall: { wins: 0, losses: 2, ties: 0, pointsFor: 200.5, pointsAgainst: 251.36 } },
      roster: { entries: [entry(3918298, 0, P.allen), entry(4362628, 4, P.chase), entry(-16021, 16, P.eagles)] },
    },
  ],
  schedule: [
    { id: 1, matchupPeriodId: 1, home: { teamId: 1, totalPoints: 120.12 }, away: { teamId: 2, totalPoints: 99.5 }, winner: 'HOME' },
    { id: 2, matchupPeriodId: 2, home: { teamId: 2, totalPoints: 101 }, away: { teamId: 1, totalPoints: 131.24 }, winner: 'AWAY' },
    { id: 3, matchupPeriodId: 3, home: { teamId: 1, totalPoints: 0 }, away: { teamId: 2, totalPoints: 0 }, winner: 'UNDECIDED' },
    { id: 4, matchupPeriodId: 15, home: { teamId: 1, totalPoints: 0 }, away: { teamId: 2, totalPoints: 0 }, winner: 'UNDECIDED' },
  ],
  draftDetail: {
    drafted: true,
    picks: [
      { overallPickNumber: 1, playerId: 3918298, teamId: 2 },
      { overallPickNumber: 2, playerId: 3139477, teamId: 1 },
    ],
  },
}

// view=mMatchupScore&scoringPeriodId=1: that week's lineups with points, plus mTransactions2.
const week1: EspnRawLeague = {
  id: 123456,
  seasonId: 2026,
  schedule: [
    {
      matchupPeriodId: 1,
      home: {
        teamId: 1,
        totalPoints: 120.12,
        rosterForCurrentScoringPeriod: {
          entries: [entry(3139477, 0, P.mahomes, 24.5), entry(3929630, 2, P.barkley, 18.2), entry(-16012, 16, P.chiefs, 9), entry(16336, 20, P.hill, 4.1)],
        },
      },
      away: {
        teamId: 2,
        totalPoints: 99.5,
        rosterForCurrentScoringPeriod: {
          entries: [
            // No appliedStatTotal on this one: the points come from the per-week stat line.
            { playerId: 3918298, lineupSlotId: 0, playerPoolEntry: { player: { ...P.allen, stats: [{ scoringPeriodId: 1, statSourceId: 1, appliedTotal: 22 }, { scoringPeriodId: 1, statSourceId: 0, statSplitTypeId: 1, appliedTotal: 30.06 }] } } },
          ],
        },
      },
    },
    { matchupPeriodId: 2, home: { teamId: 2, totalPoints: 101 }, away: { teamId: 1, totalPoints: 131.24 } },
  ],
  transactions: [
    { id: 't1', type: 'WAIVER', status: 'EXECUTED', scoringPeriodId: 1, processDate: 1000, bidAmount: 12, items: [{ playerId: 3929630, type: 'ADD', fromTeamId: 0, toTeamId: 1 }, { playerId: 16336, type: 'DROP', fromTeamId: 1, toTeamId: 0 }] },
    { id: 't2', type: 'WAIVER', status: 'FAILED_INVALIDPLAYERSOURCE', scoringPeriodId: 1, bidAmount: 30, items: [{ playerId: 4262921, type: 'ADD', toTeamId: 2 }] },
    { id: 't3', type: 'TRADE_ACCEPT', status: 'EXECUTED', scoringPeriodId: 1, processDate: 2000, items: [{ playerId: 3139477, type: 'TRADE', fromTeamId: 2, toTeamId: 1 }, { playerId: 3918298, type: 'TRADE', fromTeamId: 1, toTeamId: 2 }] },
    { id: 't4', type: 'TRADE_UPHOLD', status: 'EXECUTED', scoringPeriodId: 1, processDate: 2100, items: [{ playerId: 3918298, type: 'TRADE', fromTeamId: 1, toTeamId: 2 }, { playerId: 3139477, type: 'TRADE', fromTeamId: 2, toTeamId: 1 }] },
    { id: 't5', type: 'ROSTER', status: 'EXECUTED', scoringPeriodId: 1, items: [{ playerId: 3139477, type: 'LINEUP', fromTeamId: 1, toTeamId: 1 }] },
  ],
}

describe('ESPN lineup slots', () => {
  it('maps slot counts to Sleeper roster positions in Sleeper order', () => {
    const { positions, unsupported } = espnRosterPositions(raw.settings!.rosterSettings!.lineupSlotCounts!)
    expect(positions).toEqual(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'IR'])
    expect(unsupported).toEqual(['HC×1'])
  })

  it('reads superflex and the two-position flexes', () => {
    expect(espnRosterPositions({ '7': 1, '3': 1, '5': 1, '0': 1 }).positions).toEqual(['QB', 'WRRB_FLEX', 'REC_FLEX', 'SUPER_FLEX'])
  })

  it('places a lineup into starting slots, empty ones as 0', () => {
    const positions = ['QB', 'RB', 'RB', 'FLEX', 'K', 'BN']
    expect(slotStarters(positions, [{ id: 'a', slot: 2 }, { id: 'q', slot: 0 }, { id: 'f', slot: 23 }, { id: 'b', slot: 20 }])).toEqual(['q', 'a', '0', 'f', '0'])
  })
})

describe('ESPN scoring', () => {
  const { scoring, unmapped, notes } = espnScoring(raw.settings!.scoringSettings!.scoringItems!)

  it('maps the standard rules to Sleeper keys', () => {
    expect(scoring).toMatchObject({ pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec_yd: 0.1, rec_td: 6, rec: 1, fum_lost: -2 })
    expect(scoring).toMatchObject({ fgm_50_59: 5, fgm_60p: 5, fgm_40_49: 4, fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgmiss: -1, xpm: 1 })
    expect(scoring).toMatchObject({ pts_allow_0: 5, pts_allow_14_20: 1, int: 2, sack: 1, def_td: 6 })
  })

  it('turns a per-position reception override into Sleeper’s TE bonus', () => {
    expect(scoring.bonus_rec_te).toBe(0.5)
  })

  it('splits ESPN’s exclusive yardage-game ranges into Sleeper’s stacked thresholds', () => {
    expect(scoring.bonus_pass_yd_300).toBe(2)
    expect(scoring.bonus_pass_yd_400).toBe(3)
  })

  it('reports rules with no Sleeper stat and merged ranges that disagree', () => {
    expect(unmapped).toEqual([155])
    expect(notes.some((n) => n.includes('pts_allow_14_20'))).toBe(true)
  })

  it('scores "every 25 yards" rules per yard', () => {
    expect(espnScoring([{ statId: 8, points: 1 }]).scoring.pass_yd).toBe(0.04)
  })
})

describe('ESPN player ids', () => {
  const ix = buildEspnIndex(players)
  const m = (p: (typeof P)[keyof typeof P]) => matchEspnPlayer(ix, { pid: p.id, name: p.fullName, pos: p.defaultPositionId, team: p.proTeamId })

  it('uses the ESPN id Sleeper records', () => {
    expect(m(P.mahomes)).toBe('4046')
  })
  it('falls back to name and position, ignoring punctuation and suffixes', () => {
    expect(m(P.bijan)).toBe('9509')
    expect(m(P.chase)).toBe('7564')
    expect(m(P.hockenson)).toBe('5844')
  })
  it('breaks a shared name on the NFL team', () => {
    expect(m(P.williams)).toBe('9999')
  })
  it('matches on team when the listed position differs', () => {
    expect(m(P.hill)).toBe('4227')
  })
  it('maps team defenses to Sleeper team ids', () => {
    expect(m(P.chiefs)).toBe('KC')
    expect(m(P.eagles)).toBe('PHI')
  })
  it('gives up rather than guess', () => {
    expect(m(P.ghost)).toBeNull()
  })
})

describe('ESPN league conversion', () => {
  const league = trimEspnLeague(raw)
  const out = convertEspnLeague(league, [trimEspnWeek(week1, 1)], players)

  it('builds the league settings', () => {
    expect(out.league.league_id).toBe('espn:123456')
    expect(out.league.season).toBe('2026')
    expect(out.league.status).toBe('in_season')
    expect(out.league.settings).toMatchObject({ start_week: 1, playoff_week_start: 15, playoff_teams: 2, last_scored_leg: 2, waiver_type: 2, waiver_budget: 100 })
  })

  it('makes one user per team, named for the team, with its logo', () => {
    expect(out.users.map((u) => [u.user_id, u.display_name, u.metadata?.team_name])).toEqual([
      ['espn-team:1', 'jdoe', 'Gridiron Gurus'],
      ['espn-team:2', 'Sam Roe', 'Roe Rage'],
    ])
    expect(out.users[0].metadata?.avatar).toMatch(/^https:/)
    expect(out.users[1].metadata?.avatar).toBeUndefined()
    expect(espnTeamChoices(league).map((t) => t.name)).toEqual(['Gridiron Gurus', 'Roe Rage'])
  })

  it('builds rosters in Sleeper ids with starters in slot order and IR as reserve', () => {
    const r = out.rosters[0]
    expect(r.roster_id).toBe(1)
    expect(r.owner_id).toBe('espn-team:1')
    expect(r.starters).toEqual(['4046', '4866', '9509', '6794', '0', '5844', '9999', '1433', 'KC'])
    expect(r.players).toContain('4227')
    expect(r.players).not.toContain(undefined)
    expect(r.reserve).toEqual([])
    expect(r.settings).toMatchObject({ wins: 2, losses: 0, fpts: 251, fpts_decimal: 36, waiver_budget_used: 12 })
  })

  it('reports players it could not match', () => {
    expect(out.warnings.some((w) => /1 ESPN player\(s\).*Nobody Known/.test(w))).toBe(true)
    expect(out.warnings.some((w) => w.includes('HC×1'))).toBe(true)
  })

  it('pairs every week of the schedule, with team scores', () => {
    expect(out.matchupsByWeek[2].map((m) => [m.roster_id, m.matchup_id, m.points])).toEqual([
      [2, 1, 101],
      [1, 1, 131.24],
    ])
    expect(out.matchupsByWeek[3].every((m) => m.points === 0 && m.players === null)).toBe(true)
    expect(out.matchupsByWeek[15]).toHaveLength(2)
  })

  it('reads lineups and player points for weeks it has', () => {
    const [home, away] = out.matchupsByWeek[1]
    expect(home.points).toBe(120.12)
    expect(home.starters?.slice(0, 2)).toEqual(['4046', '4866'])
    expect(home.starters).toContain('KC')
    expect(home.players_points).toEqual({ '4046': 24.5, '4866': 18.2, KC: 9, '4227': 4.1 })
    expect(away.players_points).toEqual({ '4984': 30.06 })
  })

  it('reads executed moves once, trades included, in Sleeper form', () => {
    expect(out.transactions).toHaveLength(2)
    const [waiver, trade] = out.transactions
    expect(waiver).toMatchObject({ type: 'waiver', leg: 1, bid: 12, adds: { '4866': 1 }, drops: { '4227': 1 } })
    expect(trade).toMatchObject({ type: 'trade', adds: { '4046': 1, '4984': 2 }, drops: { '4046': 2, '4984': 1 } })
    expect(trade.roster_ids.sort()).toEqual([1, 2])
  })

  it('reads the draft order', () => {
    expect(out.draft).toMatchObject({ type: 'snake', picks: 2, rank: { '4984': 1, '4046': 2 } })
  })
})
