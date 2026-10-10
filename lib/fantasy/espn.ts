// ESPN fantasy football leagues, read from ESPN's public v3 league API and
// turned into the Sleeper shapes the rest of the app reads. Everything past the
// league itself (players, stats, projections, schedule, lines) still comes from
// Sleeper, keyed by Sleeper player ids, so the work here is mapping: lineup
// slots, scoring rules, player ids, and the weekly schedule.
//
// Two things are not verified against a live league:
//  - The payload shapes follow ESPN's v3 API as community clients read it; the
//    unit tests use a fixture written to that shape, not a captured response.
//  - Whether a browser page on another site may read the API at all (CORS).
//    The requests are plain GETs with no custom headers, so no preflight is
//    sent; if ESPN still refuses the page, fetch rejects and the loader says so
//    in words a manager can act on.

import { cached, draftBoard } from './sleeper'
import type {
  DraftBoard,
  PlayerMap,
  SleeperLeague,
  SleeperMatchup,
  SleeperRoster,
  SleeperTransaction,
  SleeperUser,
  TrimmedPlayer,
} from './types'

export const ESPN_API = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/** ESPN league ids are short numbers and Sleeper's are 18 digits; the prefix keeps per-league storage apart anyway. */
export const espnLeagueKey = (id: string | number) => `espn:${id}`
/** One synthetic user per ESPN team: the app finds "your" team by user id. */
export const espnUserId = (teamId: number) => `espn-team:${teamId}`

// ---------- Errors ----------

export type EspnErrorKind = 'not-found' | 'private' | 'blocked' | 'http'

export class EspnError extends Error {
  kind: EspnErrorKind
  status: number
  constructor(kind: EspnErrorKind, status: number, message: string) {
    super(message)
    this.kind = kind
    this.status = status
  }
}

export const ESPN_PRIVATE_HELP =
  "ESPN private leagues need a login cookie the browser can't send from this site; a league manager can make it viewable to the public in League Settings."

const espnFetch = async (url: string, leagueId: string, season: string): Promise<unknown> => {
  let res: Response
  try {
    // No credentials and no custom headers: a simple request, so the browser sends no preflight.
    res = await fetch(url, { credentials: 'omit', headers: { accept: 'application/json' } })
  } catch {
    // A CORS refusal, a network filter and a dropped connection all look the same from here.
    throw new EspnError(
      'blocked',
      0,
      `Couldn't read league ${leagueId} from ESPN. Most often that means it's private (only public leagues work); otherwise ESPN or your network blocked the request.`,
    )
  }
  if (res.status === 401 || res.status === 403) throw new EspnError('private', res.status, `ESPN league ${leagueId} is private. ${ESPN_PRIVATE_HELP}`)
  if (res.status === 404)
    throw new EspnError('not-found', 404, `No ESPN league ${leagueId} for ${season}. Check the number after leagueId= in the address bar on fantasy.espn.com.`)
  if (!res.ok) throw new EspnError('http', res.status, `ESPN isn't answering right now (${res.status}). Try again in a minute.`)
  // A private league can also answer 200 with ESPN's login page.
  if (!/json/i.test(res.headers.get('content-type') ?? 'application/json'))
    throw new EspnError('private', res.status, `ESPN league ${leagueId} is private. ${ESPN_PRIVATE_HELP}`)
  try {
    return await res.json()
  } catch {
    throw new EspnError('private', res.status, `ESPN sent a page instead of league data; league ${leagueId} is probably private. ${ESPN_PRIVATE_HELP}`)
  }
}

// ---------- Raw shapes (only the fields read here) ----------

type RawStat = { scoringPeriodId?: number; statSourceId?: number; statSplitTypeId?: number; appliedTotal?: number }
type RawPlayer = {
  id: number
  fullName?: string
  firstName?: string
  lastName?: string
  defaultPositionId?: number
  proTeamId?: number
  stats?: RawStat[]
}
type RawEntry = {
  playerId: number
  lineupSlotId: number
  playerPoolEntry?: { id?: number; appliedStatTotal?: number; player?: RawPlayer } | null
}
type RawSide = {
  teamId: number
  totalPoints?: number
  pointsByScoringPeriod?: Record<string, number> | null
  rosterForCurrentScoringPeriod?: { entries?: RawEntry[] } | null
}
type RawGame = { id?: number; matchupPeriodId: number; home?: RawSide | null; away?: RawSide | null; winner?: string }
type RawTeam = {
  id: number
  abbrev?: string
  location?: string
  nickname?: string
  name?: string
  logo?: string
  owners?: string[]
  primaryOwner?: string
  divisionId?: number
  record?: { overall?: { wins?: number; losses?: number; ties?: number; pointsFor?: number; pointsAgainst?: number } }
  roster?: { entries?: RawEntry[] } | null
  transactionCounter?: { acquisitionBudgetSpent?: number } | null
}
type RawMember = { id: string; displayName?: string; firstName?: string; lastName?: string }
export type EspnScoringItem = { statId: number; points: number; pointsOverrides?: Record<string, number> | null; isReverseItem?: boolean }
type RawTx = {
  id?: string
  type?: string
  status?: string
  scoringPeriodId?: number
  proposedDate?: number
  processDate?: number
  bidAmount?: number
  items?: { playerId: number; type?: string; fromTeamId?: number; toTeamId?: number }[]
}
export type EspnRawLeague = {
  id: number
  seasonId: number
  scoringPeriodId?: number
  status?: {
    currentMatchupPeriod?: number
    latestScoringPeriod?: number
    finalScoringPeriod?: number
    firstScoringPeriod?: number
    isActive?: boolean
    previousSeasons?: number[]
  }
  settings?: {
    name?: string
    size?: number
    rosterSettings?: { lineupSlotCounts?: Record<string, number> }
    scoringSettings?: { scoringType?: string; scoringItems?: EspnScoringItem[] }
    scheduleSettings?: {
      matchupPeriodCount?: number
      playoffTeamCount?: number
      playoffMatchupPeriodLength?: number
      matchupPeriods?: Record<string, number[]>
    }
    acquisitionSettings?: { acquisitionBudget?: number; isUsingAcquisitionBudget?: boolean; minimumBid?: number }
    draftSettings?: { type?: string; keeperCount?: number }
  }
  members?: RawMember[]
  teams?: RawTeam[]
  schedule?: RawGame[]
  draftDetail?: { drafted?: boolean; picks?: { overallPickNumber?: number; playerId: number; teamId?: number; bidAmount?: number }[] }
  transactions?: RawTx[]
}

// ---------- Trimmed shapes (what is cached) ----------

/** One rostered player as ESPN has him: enough to find him in Sleeper's list, and his points that week when known. */
export type EspnEntry = { pid: number; slot: number; name: string; pos: number; team: number; pts: number | null }
type EspnSide = { teamId: number; total: number; byWeek: Record<string, number>; entries: EspnEntry[] | null }
type EspnGame = { period: number; home: EspnSide | null; away: EspnSide | null }
type EspnTx = { id: string; type: string; status: string; week: number; at: number; bid: number | null; items: { pid: number; type: string; from: number; to: number }[] }
export type EspnTeam = {
  id: number
  name: string
  abbrev: string
  logo: string | null
  owner: string
  ownerId: string | null
  wins: number
  losses: number
  ties: number
  pf: number
  pa: number
  faabSpent: number
  division: number | null
  entries: EspnEntry[]
}
export type EspnLeague = {
  id: string
  season: number
  /** ESPN's current scoring period, which is the NFL week. */
  week: number
  name: string
  size: number
  slots: Record<string, number>
  scoringType: string
  scoring: EspnScoringItem[]
  matchupPeriodCount: number
  playoffTeams: number
  playoffPeriodLength: number
  matchupPeriods: Record<string, number[]>
  faab: { budget: number; min: number } | null
  keepers: number
  draftType: string
  active: boolean
  finalWeek: number
  previousSeasons: number[]
  teams: EspnTeam[]
  games: EspnGame[]
  drafted: boolean
  picks: { overall: number; pid: number; team: number; bid: number | null }[]
}
export type EspnWeek = { week: number; games: EspnGame[]; transactions: EspnTx[] }

const entryPoints = (e: RawEntry, week?: number): number | null => {
  const pe = e.playerPoolEntry
  if (typeof pe?.appliedStatTotal === 'number') return pe.appliedStatTotal
  if (week == null) return null
  // Actual (source 0), single-week (split 1) line for that week.
  const line = pe?.player?.stats?.find((s) => s.scoringPeriodId === week && (s.statSourceId ?? 0) === 0 && (s.statSplitTypeId ?? 1) === 1)
  return typeof line?.appliedTotal === 'number' ? line.appliedTotal : null
}

const trimEntry = (e: RawEntry, week?: number): EspnEntry => {
  const p = e.playerPoolEntry?.player
  return {
    pid: e.playerId,
    slot: e.lineupSlotId,
    name: p?.fullName ?? [p?.firstName, p?.lastName].filter(Boolean).join(' '),
    pos: p?.defaultPositionId ?? 0,
    team: p?.proTeamId ?? 0,
    pts: entryPoints(e, week),
  }
}

const trimSide = (s: RawSide | null | undefined, week?: number): EspnSide | null =>
  s && typeof s.teamId === 'number'
    ? {
        teamId: s.teamId,
        total: s.totalPoints ?? 0,
        byWeek: s.pointsByScoringPeriod ?? {},
        entries: s.rosterForCurrentScoringPeriod?.entries?.length ? s.rosterForCurrentScoringPeriod.entries.map((e) => trimEntry(e, week)) : null,
      }
    : null

const memberName = (m: RawMember | undefined) =>
  m ? m.displayName || [m.firstName, m.lastName].filter(Boolean).join(' ') || 'Manager' : 'Unowned'

/** A team's name as ESPN shows it: the newer single `name`, else location and nickname, else the abbreviation. */
const teamName = (t: RawTeam) => t.name?.trim() || [t.location, t.nickname].filter(Boolean).join(' ').trim() || t.abbrev || `Team ${t.id}`

export const trimEspnLeague = (raw: EspnRawLeague): EspnLeague => {
  const s = raw.settings ?? {}
  const members = new Map((raw.members ?? []).map((m) => [m.id, m]))
  const acq = s.acquisitionSettings
  return {
    id: String(raw.id),
    season: raw.seasonId,
    week: raw.scoringPeriodId ?? raw.status?.latestScoringPeriod ?? 1,
    name: s.name ?? `ESPN league ${raw.id}`,
    size: s.size ?? raw.teams?.length ?? 0,
    slots: s.rosterSettings?.lineupSlotCounts ?? {},
    scoringType: s.scoringSettings?.scoringType ?? 'H2H_POINTS',
    scoring: s.scoringSettings?.scoringItems ?? [],
    matchupPeriodCount: s.scheduleSettings?.matchupPeriodCount ?? 14,
    playoffTeams: s.scheduleSettings?.playoffTeamCount ?? 0,
    playoffPeriodLength: s.scheduleSettings?.playoffMatchupPeriodLength ?? 1,
    matchupPeriods: s.scheduleSettings?.matchupPeriods ?? {},
    faab: acq?.isUsingAcquisitionBudget ? { budget: acq.acquisitionBudget ?? 100, min: acq.minimumBid ?? 0 } : null,
    keepers: s.draftSettings?.keeperCount ?? 0,
    draftType: s.draftSettings?.type ?? 'SNAKE',
    active: raw.status?.isActive ?? true,
    finalWeek: raw.status?.finalScoringPeriod ?? 17,
    previousSeasons: raw.status?.previousSeasons ?? [],
    teams: (raw.teams ?? []).map((t) => {
      const ownerId = t.primaryOwner ?? t.owners?.[0] ?? null
      const rec = t.record?.overall ?? {}
      return {
        id: t.id,
        name: teamName(t),
        abbrev: t.abbrev ?? '',
        logo: t.logo || null,
        owner: memberName(ownerId ? members.get(ownerId) : undefined),
        ownerId,
        wins: rec.wins ?? 0,
        losses: rec.losses ?? 0,
        ties: rec.ties ?? 0,
        pf: rec.pointsFor ?? 0,
        pa: rec.pointsAgainst ?? 0,
        faabSpent: t.transactionCounter?.acquisitionBudgetSpent ?? 0,
        division: t.divisionId ?? null,
        entries: (t.roster?.entries ?? []).map((e) => trimEntry(e)),
      }
    }),
    games: (raw.schedule ?? []).map((g) => ({ period: g.matchupPeriodId, home: trimSide(g.home), away: trimSide(g.away) })),
    drafted: raw.draftDetail?.drafted ?? true,
    picks: (raw.draftDetail?.picks ?? [])
      .filter((p) => p.playerId)
      .map((p) => ({ overall: p.overallPickNumber ?? 0, pid: p.playerId, team: p.teamId ?? 0, bid: p.bidAmount ?? null })),
  }
}

export const trimEspnWeek = (raw: EspnRawLeague, week: number): EspnWeek => ({
  week,
  // Only the games that carry that week's lineups; the rest of the season comes from the league payload.
  games: (raw.schedule ?? [])
    .map((g) => ({ period: g.matchupPeriodId, home: trimSide(g.home, week), away: trimSide(g.away, week) }))
    .filter((g) => g.home?.entries || g.away?.entries),
  transactions: (raw.transactions ?? []).map((t, i) => ({
    id: t.id ?? `${week}-${i}`,
    type: t.type ?? '',
    status: t.status ?? '',
    week: t.scoringPeriodId ?? week,
    at: t.processDate ?? t.proposedDate ?? 0,
    bid: typeof t.bidAmount === 'number' ? t.bidAmount : null,
    items: (t.items ?? []).map((x) => ({ pid: x.playerId, type: x.type ?? '', from: x.fromTeamId ?? -1, to: x.toTeamId ?? -1 })),
  })),
})

// ---------- Requests ----------

const leagueUrl = (leagueId: string, season: string) => `${ESPN_API}/seasons/${season}/segments/0/leagues/${encodeURIComponent(leagueId)}`

/** Settings, teams with rosters, members, the whole schedule's scores, status and the draft. */
export const getEspnLeague = (leagueId: string, season: string) =>
  cached(`espn:league:${leagueId}:${season}`, 10 * MINUTE, async () =>
    trimEspnLeague(
      (await espnFetch(
        `${leagueUrl(leagueId, season)}?view=mSettings&view=mTeam&view=mRoster&view=mMatchup&view=mStatus&view=mDraftDetail`,
        leagueId,
        season,
      )) as EspnRawLeague,
    ),
  )

/** One week's lineups with each player's points, plus that week's moves. A finished week never changes. */
export const getEspnWeek = (leagueId: string, season: string, week: number, isPast: boolean) =>
  cached(
    `espn:week:${leagueId}:${season}:${week}`,
    isPast ? 24 * HOUR : 5 * MINUTE,
    async () =>
      trimEspnWeek(
        (await espnFetch(
          `${leagueUrl(leagueId, season)}?scoringPeriodId=${week}&view=mMatchupScore&view=mScoreboard&view=mTransactions2`,
          leagueId,
          season,
        )) as EspnRawLeague,
        week,
      ),
    isPast,
  )

/** The teams to choose from during setup: name, manager and logo. */
export const espnTeamChoices = (l: EspnLeague) =>
  [...l.teams].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ id: t.id, name: t.name, owner: t.owner, logo: t.logo }))

// ---------- Lineup slots ----------

/** ESPN lineup slot id → Sleeper roster position. */
const SLOT: Record<number, string> = {
  0: 'QB',
  2: 'RB',
  3: 'WRRB_FLEX',
  4: 'WR',
  5: 'REC_FLEX',
  6: 'TE',
  7: 'SUPER_FLEX',
  8: 'DL',
  9: 'DL',
  10: 'LB',
  11: 'DL',
  12: 'DB',
  13: 'DB',
  14: 'DB',
  15: 'IDP_FLEX',
  16: 'DEF',
  17: 'K',
  20: 'BN',
  21: 'IR',
  23: 'FLEX',
}
/** Slots with no Sleeper counterpart, by the name ESPN shows. */
const SLOT_NAME: Record<number, string> = { 1: 'TQB', 18: 'P', 19: 'HC', 24: 'ER', 25: 'Rookie' }
/** Sleeper lists slots in this order, and a roster's `starters` follow it. */
const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'WRRB_FLEX', 'REC_FLEX', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'DL', 'LB', 'DB', 'IDP_FLEX', 'BN', 'IR']
const NOT_STARTING = new Set(['BN', 'IR'])

export const espnRosterPositions = (counts: Record<string, number>): { positions: string[]; unsupported: string[] } => {
  const n: Record<string, number> = {}
  const unsupported: string[] = []
  for (const id of Object.keys(counts)) {
    const c = counts[id] ?? 0
    if (c <= 0) continue
    const name = SLOT[Number(id)]
    if (name) n[name] = (n[name] ?? 0) + c
    else unsupported.push(`${SLOT_NAME[Number(id)] ?? `slot ${id}`}×${c}`)
  }
  return { positions: SLOT_ORDER.flatMap((s) => Array<string>(n[s] ?? 0).fill(s)), unsupported }
}

/**
 * A lineup in Sleeper's form: one id per starting slot in roster-position
 * order, '0' where the slot is empty. Players in a slot this app has no
 * counterpart for are left out.
 */
export const slotStarters = (positions: string[], lineup: { id: string; slot: number }[]): string[] => {
  const names = positions.filter((p) => !NOT_STARTING.has(p))
  const out = names.map(() => '0')
  for (const { id, slot } of lineup) {
    const name = SLOT[slot]
    if (!name || NOT_STARTING.has(name)) continue
    const i = names.findIndex((s, k) => s === name && out[k] === '0')
    if (i >= 0) out[i] = id
  }
  return out
}

// ---------- Scoring ----------

/**
 * ESPN scoring stat id → the Sleeper stat keys it scores. One ESPN rule can
 * stand for several Sleeper keys (ESPN's 0–39 yard field goal is Sleeper's
 * three shorter ranges). When two ESPN rules land on one key, the first one
 * listed here wins, and a difference between them is reported.
 */
const STAT_KEYS: [number, string[]][] = [
  [3, ['pass_yd']],
  [4, ['pass_td']],
  [0, ['pass_att']],
  [1, ['pass_cmp']],
  [2, ['pass_inc']],
  [15, ['pass_td_40p']],
  [16, ['pass_td_50p']],
  [19, ['pass_2pt']],
  [20, ['pass_int']],
  [64, ['pass_sack']],
  [24, ['rush_yd']],
  [25, ['rush_td']],
  [23, ['rush_att']],
  [26, ['rush_2pt']],
  [35, ['rush_td_40p']],
  [36, ['rush_td_50p']],
  [53, ['rec']],
  [42, ['rec_yd']],
  [43, ['rec_td']],
  [44, ['rec_2pt']],
  [45, ['rec_td_40p']],
  [46, ['rec_td_50p']],
  [58, ['rec_tgt']],
  [63, ['fum_rec_td']],
  [72, ['fum_lost']],
  [68, ['fum']],
  // Kicking. The specific 50–59 and 60+ rules, where a league has them, beat the older 50+ one.
  [198, ['fgm_50_59']],
  [201, ['fgm_60p']],
  [74, ['fgm_50_59', 'fgm_60p']],
  [77, ['fgm_40_49']],
  [80, ['fgm_0_19', 'fgm_20_29', 'fgm_30_39']],
  [83, ['fgm']],
  [84, ['fga']],
  [85, ['fgmiss']],
  [76, ['fgmiss_50_59', 'fgmiss_60p']],
  [79, ['fgmiss_40_49']],
  [82, ['fgmiss_0_19', 'fgmiss_20_29', 'fgmiss_30_39']],
  [86, ['xpm']],
  [87, ['xpa']],
  [88, ['xpmiss']],
  // Team defense and special teams.
  [95, ['int']],
  [96, ['fum_rec']],
  [97, ['blk_kick']],
  [98, ['safe']],
  [99, ['sack']],
  [106, ['ff']],
  [103, ['def_td']],
  [104, ['def_td']],
  [94, ['def_td']],
  [101, ['def_st_td']],
  [102, ['def_st_td']],
  [93, ['def_st_td']],
  [89, ['pts_allow_0']],
  [90, ['pts_allow_1_6']],
  [91, ['pts_allow_7_13']],
  // Sleeper's stat lines split points allowed at 14–20 and 21–27; ESPN at 14–17, 18–21 and 22–27.
  [92, ['pts_allow_14_20']],
  [121, ['pts_allow_14_20']],
  [122, ['pts_allow_21_27']],
  [123, ['pts_allow_28_34']],
  [124, ['pts_allow_35p']],
  [125, ['pts_allow_35p']],
  [128, ['yds_allow_0_100']],
  [129, ['yds_allow_100_199']],
  [130, ['yds_allow_200_299']],
  [131, ['yds_allow_300_349']],
  [132, ['yds_allow_350_399']],
  [133, ['yds_allow_400_449']],
  [134, ['yds_allow_450_499']],
  [135, ['yds_allow_500_549']],
  [136, ['yds_allow_550p']],
]

/** "Every N yards" rules, scored per yard here: Sleeper has no rounding down, so it is a close fit, not an exact one. */
const PER_YARDS: Record<number, [string, number]> = {
  5: ['pass_yd', 5],
  6: ['pass_yd', 10],
  7: ['pass_yd', 20],
  8: ['pass_yd', 25],
  9: ['pass_yd', 50],
  10: ['pass_yd', 100],
  27: ['rush_yd', 5],
  28: ['rush_yd', 10],
  29: ['rush_yd', 20],
  30: ['rush_yd', 25],
  31: ['rush_yd', 50],
  32: ['rush_yd', 100],
  47: ['rec_yd', 5],
  48: ['rec_yd', 10],
  49: ['rec_yd', 20],
  50: ['rec_yd', 25],
  51: ['rec_yd', 50],
  52: ['rec_yd', 100],
}

/**
 * Big-game bonuses. ESPN's ranges do not overlap (300–399, then 400+); Sleeper
 * sets a flag at each threshold passed, so a 400-yard game carries both. The
 * higher Sleeper key therefore scores the difference.
 */
const BONUS: [number, number | null, string, string | null][] = [
  [17, 18, 'bonus_pass_yd_300', 'bonus_pass_yd_400'],
  [37, 38, 'bonus_rush_yd_100', 'bonus_rush_yd_200'],
  [56, 57, 'bonus_rec_yd_100', 'bonus_rec_yd_200'],
]

/** Reception bonuses by position: ESPN sets them as a per-slot override on its reception rule. */
const REC_BONUS: Record<string, string> = { '2': 'bonus_rec_rb', '4': 'bonus_rec_wr', '6': 'bonus_rec_te' }

const round4 = (x: number) => Math.round(x * 10000) / 10000

export const espnScoring = (items: EspnScoringItem[]): { scoring: Record<string, number>; unmapped: number[]; notes: string[] } => {
  const byId = new Map<number, EspnScoringItem>()
  for (const it of items) if (it && typeof it.statId === 'number') byId.set(it.statId, it)
  const scoring: Record<string, number> = {}
  const from: Record<string, number> = {}
  const used = new Set<number>()
  const notes: string[] = []

  for (const [id, keys] of STAT_KEYS) {
    const it = byId.get(id)
    if (!it) continue
    used.add(id)
    for (const k of keys) {
      if (k in scoring) {
        if (scoring[k] !== it.points) notes.push(`ESPN stat ${id} (${it.points}) shares Sleeper's ${k} with stat ${from[k]}, which is used (${scoring[k]}).`)
        continue
      }
      scoring[k] = it.points
      from[k] = id
    }
  }
  for (const id of Object.keys(PER_YARDS).map(Number)) {
    const it = byId.get(id)
    if (!it) continue
    used.add(id)
    const [k, per] = PER_YARDS[id]
    scoring[k] = round4((scoring[k] ?? 0) + it.points / per)
  }
  for (const [lo, hi, kLo, kHi] of BONUS) {
    const a = byId.get(lo)
    const b = hi != null ? byId.get(hi) : undefined
    if (a) {
      used.add(lo)
      scoring[kLo] = a.points
    }
    if (b && kHi) {
      used.add(hi!)
      scoring[kHi] = round4(b.points - (a?.points ?? 0))
    }
  }
  // Position overrides: only the reception bonus has a Sleeper key; anything else is reported.
  for (const it of byId.values()) {
    const over = it.pointsOverrides ?? {}
    for (const slot of Object.keys(over)) {
      if (over[slot] === it.points) continue
      if (it.statId === 53 && REC_BONUS[slot]) scoring[REC_BONUS[slot]] = round4(over[slot] - it.points)
      else notes.push(`ESPN stat ${it.statId} scores ${over[slot]} for slot ${slot} rather than ${it.points}; it is scored ${it.points} for everyone here.`)
    }
  }
  const unmapped = [...byId.values()].filter((it) => !used.has(it.statId) && it.points !== 0).map((it) => it.statId)
  return { scoring, unmapped, notes }
}

// ---------- Player ids ----------

/** ESPN pro team id → the abbreviation Sleeper uses (Sleeper's team-defense ids are these too). */
export const ESPN_PRO_TEAM: Record<number, string> = {
  1: 'ATL',
  2: 'BUF',
  3: 'CHI',
  4: 'CIN',
  5: 'CLE',
  6: 'DAL',
  7: 'DEN',
  8: 'DET',
  9: 'GB',
  10: 'TEN',
  11: 'IND',
  12: 'KC',
  13: 'LV',
  14: 'LAR',
  15: 'MIA',
  16: 'MIN',
  17: 'NE',
  18: 'NO',
  19: 'NYG',
  20: 'NYJ',
  21: 'PHI',
  22: 'ARI',
  23: 'PIT',
  24: 'LAC',
  25: 'SF',
  26: 'SEA',
  27: 'TB',
  28: 'WAS',
  29: 'CAR',
  30: 'JAX',
  33: 'BAL',
  34: 'HOU',
}

/** ESPN default position id → the Sleeper positions it can match. */
const ESPN_POS: Record<number, string[]> = {
  1: ['QB'],
  2: ['RB'],
  3: ['WR'],
  4: ['TE'],
  5: ['K'],
  9: ['DL'],
  10: ['DL'],
  11: ['LB'],
  12: ['DB'],
  13: ['DB'],
  16: ['DEF'],
}
const DST = 16

export const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.'’`]/g, '')
    .replace(/-/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export type EspnIndex = { byEspn: Map<string, string>; byName: Map<string, TrimmedPlayer[]>; players: PlayerMap }

export const buildEspnIndex = (players: PlayerMap): EspnIndex => {
  const byEspn = new Map<string, string>()
  const byName = new Map<string, TrimmedPlayer[]>()
  for (const p of Object.values(players)) {
    if (p.espnId) byEspn.set(p.espnId, p.id)
    if (p.pos === 'DEF') continue
    const k = normName(p.name)
    const list = byName.get(k)
    if (list) list.push(p)
    else byName.set(k, [p])
  }
  return { byEspn, byName, players }
}

/**
 * The Sleeper id for an ESPN player: his ESPN id where Sleeper records it,
 * else name and position, using his NFL team to break a tie. Team defenses are
 * negative ids on ESPN (-16000 less the pro team id) and team abbreviations on
 * Sleeper. Null when nothing matches cleanly.
 */
export const matchEspnPlayer = (ix: EspnIndex, e: Pick<EspnEntry, 'pid' | 'name' | 'pos' | 'team'>): string | null => {
  if (e.pid < 0 || e.pos === DST) {
    const team = ESPN_PRO_TEAM[e.pid < 0 ? -e.pid - 16000 : e.team]
    return team && ix.players[team] ? team : null
  }
  const direct = ix.byEspn.get(String(e.pid))
  if (direct) return direct
  const all = ix.byName.get(normName(e.name)) ?? []
  if (!all.length) return null
  const team = ESPN_PRO_TEAM[e.team] ?? null
  const pos = ESPN_POS[e.pos]
  const samePos = pos ? all.filter((p) => p.fpos.some((f) => pos.includes(f)) || pos.includes(p.pos)) : all
  if (samePos.length === 1) return samePos[0].id
  const pick = (list: TrimmedPlayer[]) => {
    const onTeam = team ? list.filter((p) => p.team === team) : []
    return onTeam.length === 1 ? onTeam[0].id : null
  }
  // Several by that name: the one on his team. A listed position that differs (a QB who plays tight end) still matches on team.
  return (samePos.length ? pick(samePos) : null) ?? pick(all)
}

// ---------- The league in Sleeper's shapes ----------

export type EspnConverted = {
  league: SleeperLeague
  users: SleeperUser[]
  rosters: SleeperRoster[]
  matchupsByWeek: Record<number, SleeperMatchup[]>
  transactions: SleeperTransaction[]
  draft: DraftBoard | null
  warnings: string[]
}

/** NFL weeks in each matchup period; a period missing from the settings is the week of the same number. */
const periodWeeks = (l: EspnLeague, period: number): number[] => {
  const w = l.matchupPeriods[String(period)]
  return w?.length ? w : [period]
}

const splitPoints = (pts: number) => ({ whole: Math.floor(pts), decimal: Math.round((pts - Math.floor(pts)) * 100) })

export const convertEspnLeague = (l: EspnLeague, weeks: EspnWeek[], players: PlayerMap): EspnConverted => {
  const warnings: string[] = []
  const ix = buildEspnIndex(players)
  const ids = new Map<number, string | null>()
  const missed = new Map<number, string>()
  const idOf = (e: EspnEntry): string | null => {
    if (!ids.has(e.pid)) {
      const id = matchEspnPlayer(ix, e)
      ids.set(e.pid, id)
      if (!id) missed.set(e.pid, e.name || `ESPN player ${e.pid}`)
    }
    return ids.get(e.pid)!
  }
  /** Players as Sleeper ids, keeping each one's ESPN slot. */
  const mapped = (entries: EspnEntry[]) =>
    entries.flatMap((e) => {
      const id = idOf(e)
      return id ? [{ id, slot: e.slot, pts: e.pts }] : []
    })

  if (l.scoringType && !/POINTS/i.test(l.scoringType))
    warnings.push(`This ESPN league scores by categories (${l.scoringType}); the app reads it as a points league.`)

  const { positions, unsupported } = espnRosterPositions(l.slots)
  if (unsupported.length) warnings.push(`ESPN lineup slots with no counterpart here are left out: ${unsupported.join(', ')}.`)
  const { scoring, unmapped, notes } = espnScoring(l.scoring)
  if (unmapped.length) warnings.push(`${unmapped.length} ESPN scoring rule(s) have no match in Sleeper's stats and are left out of projections (stat ids ${unmapped.join(', ')}).`)
  warnings.push(...notes)

  const firstWeek = periodWeeks(l, 1)[0]
  const playoffStart = periodWeeks(l, l.matchupPeriodCount + 1)[0]
  const status = !l.drafted ? 'pre_draft' : !l.active && l.week >= l.finalWeek ? 'complete' : 'in_season'
  const league: SleeperLeague = {
    league_id: espnLeagueKey(l.id),
    name: l.name,
    season: String(l.season),
    status,
    sport: 'nfl',
    total_rosters: l.size || l.teams.length,
    roster_positions: positions,
    scoring_settings: scoring,
    settings: {
      start_week: firstWeek,
      playoff_week_start: playoffStart,
      playoff_teams: l.playoffTeams,
      num_teams: l.size || l.teams.length,
      // Every playoff round lasts the same number of weeks on ESPN; Sleeper's type 2 is "every round two weeks".
      playoff_round_type: l.playoffPeriodLength >= 2 ? 2 : 0,
      // ESPN's current scoring period is the week being played; the one before it is the last settled.
      last_scored_leg: status === 'complete' ? l.finalWeek : Math.max(0, l.week - 1),
      type: l.keepers > 0 ? 1 : 0,
      waiver_type: l.faab ? 2 : 0,
      waiver_budget: l.faab?.budget,
      waiver_bid_min: l.faab?.min,
    },
    previous_league_id: null,
    avatar: null,
  }

  const users: SleeperUser[] = l.teams.map((t) => ({
    user_id: espnUserId(t.id),
    display_name: t.owner,
    avatar: null,
    // A full logo URL is what the app treats metadata.avatar as.
    metadata: { team_name: t.name, ...(t.logo ? { avatar: t.logo } : {}) },
  }))

  const rosters: SleeperRoster[] = l.teams.map((t) => {
    const list = mapped(t.entries)
    const pf = splitPoints(t.pf)
    const pa = splitPoints(t.pa)
    return {
      roster_id: t.id,
      owner_id: espnUserId(t.id),
      players: list.map((p) => p.id),
      starters: slotStarters(positions, list),
      reserve: list.filter((p) => p.slot === 21).map((p) => p.id),
      settings: {
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        fpts: pf.whole,
        fpts_decimal: pf.decimal,
        fpts_against: pa.whole,
        fpts_against_decimal: pa.decimal,
        waiver_budget_used: t.faabSpent,
        ...(t.division != null ? { division: t.division } : {}),
      },
    }
  })

  // The schedule, every week of it, from the league payload: pairings and team scores.
  const matchupsByWeek: Record<number, SleeperMatchup[]> = {}
  const periods = new Map<number, EspnGame[]>()
  for (const g of l.games) {
    const list = periods.get(g.period)
    if (list) list.push(g)
    else periods.set(g.period, [g])
  }
  const lineups = new Map<string, EspnSide>()
  for (const wk of weeks) for (const g of wk.games) for (const s of [g.home, g.away]) if (s?.entries) lineups.set(`${wk.week}:${s.teamId}`, s)
  for (const [period, games] of periods) {
    const span = periodWeeks(l, period)
    for (const w of span) {
      const out: SleeperMatchup[] = []
      games.forEach((g, i) => {
        const paired = !!(g.home && g.away)
        for (const s of [g.home, g.away]) {
          if (!s) continue
          const byWeek = s.byWeek[String(w)]
          let points = typeof byWeek === 'number' ? byWeek : span.length === 1 ? s.total : 0
          const lineup = lineups.get(`${w}:${s.teamId}`)
          let players: string[] | null = null
          let starters: string[] | null = null
          let playersPoints: Record<string, number> | null = null
          if (lineup?.entries) {
            const list = mapped(lineup.entries)
            players = list.map((p) => p.id)
            starters = slotStarters(positions, list)
            playersPoints = {}
            for (const p of list) if (p.pts != null) playersPoints[p.id] = p.pts
            if (!points) {
              const on = new Set(starters)
              points = Math.round(list.filter((p) => on.has(p.id)).reduce((a, p) => a + (p.pts ?? 0), 0) * 100) / 100
            }
          }
          out.push({ roster_id: s.teamId, matchup_id: paired ? i + 1 : null, points, players, starters, players_points: playersPoints })
        }
      })
      matchupsByWeek[w] = out
    }
  }

  // Moves, from the weekly payloads. ESPN files a trade more than once as it moves through review; one copy each.
  const seen = new Set<string>()
  const transactions: SleeperTransaction[] = []
  for (const wk of weeks)
    for (const t of wk.transactions) {
      if (t.status !== 'EXECUTED') continue
      const type = t.type === 'FREEAGENT' ? 'free_agent' : t.type === 'WAIVER' ? 'waiver' : /TRADE/.test(t.type) ? 'trade' : null
      if (!type) continue
      const moves = t.items.filter((x) => x.type === 'ADD' || x.type === 'DROP' || x.type === 'TRADE')
      if (!moves.length) continue
      const sig = type === 'trade' ? `trade:${moves.map((x) => `${x.pid}>${x.to}`).sort().join(',')}` : `id:${t.id}`
      if (seen.has(sig)) continue
      seen.add(sig)
      const adds: Record<string, number> = {}
      const drops: Record<string, number> = {}
      const teams = new Set<number>()
      for (const x of moves) {
        const id = ids.has(x.pid) ? ids.get(x.pid) : matchEspnPlayer(ix, { pid: x.pid, name: '', pos: 0, team: 0 })
        if (!id) continue
        if ((x.type === 'ADD' || x.type === 'TRADE') && x.to > 0) {
          adds[id] = x.to
          teams.add(x.to)
        }
        if ((x.type === 'DROP' || x.type === 'TRADE') && x.from > 0) {
          drops[id] = x.from
          teams.add(x.from)
        }
      }
      if (!teams.size) continue
      transactions.push({
        type,
        status: 'complete',
        roster_ids: [...teams],
        adds: Object.keys(adds).length ? adds : null,
        drops: Object.keys(drops).length ? drops : null,
        picks: 0,
        created: t.at,
        leg: t.week,
        bid: type === 'waiver' ? t.bid : null,
        faab: null,
      })
    }

  let draft: DraftBoard | null = null
  if (l.picks.length) {
    const picks = l.picks.flatMap((p) => {
      const id = ids.has(p.pid) ? ids.get(p.pid) : matchEspnPlayer(ix, { pid: p.pid, name: '', pos: 0, team: 0 })
      return id ? [{ player_id: id, pick_no: p.overall, metadata: p.bid != null ? { amount: p.bid } : null }] : []
    })
    draft = draftBoard(picks, /AUCTION/i.test(l.draftType) ? 'auction' : 'snake')
  }

  if (missed.size) {
    const names = [...missed.values()]
    warnings.push(
      `${missed.size} ESPN player(s) could not be matched to Sleeper's player list and are left out: ${names.slice(0, 5).join(', ')}${names.length > 5 ? ', …' : ''}.`,
    )
  }
  return { league, users, rosters, matchupsByWeek, transactions, draft, warnings }
}
