// How this league actually trades, and what that says about a new offer.
//
// Kept deliberately light. Nothing here knows anyone's personality; it reads
// three things the transaction log does show:
//
//   engagement  waiver claims and free-agent pickups. A manager who never
//               touches his roster rarely answers a trade offer either.
//   history     trades made, this season and last (matched by owner), with
//               whom, in what shapes, and how lopsided accepted deals were at
//               today's values.
//   perception  owners judge offers by the public rankings, not by this
//               model. A deal the model likes that the consensus calls fair
//               is the one that gets accepted.

import type { LeagueHistory } from './useLeagueData'
import type { TradeIdea } from './trades'
import type { PlayerMap, SleeperTransaction } from './types'

export type TeamBehavior = {
  rosterId: number
  /** Completed waiver and free-agent adds this season. */
  moves: number
  trades: number
  tradesLast: number
  /** Trades with each other roster, both seasons. */
  partners: Record<number, number>
  /** Positions received and sent in trades. */
  bought: Record<string, number>
  sold: Record<string, number>
  /** Rank of `moves` in the league, 0 (least active) to 1 (most). */
  engagement: number
}

export type TradeRecord = {
  season: string
  week: number
  sides: { rosterId: number; got: string[] }[]
  picks: number
  shape: string
  /** |value one side got − value the other got| at today's market, this season's trades only. */
  gap: number | null
}

export type LeagueBehavior = {
  teams: Record<number, TeamBehavior>
  trades: TradeRecord[]
  /** Trades by shape, e.g. "2-for-1": 3. */
  shapes: Record<string, number>
  /** Median value gap of accepted trades this season, pts/wk at today's prices. */
  medianGap: number | null
  movesTotal: number
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const tradesFrom = (txs: SleeperTransaction[], season: string, map?: Record<number, number>): TradeRecord[] =>
  txs
    .filter((t) => t.type === 'trade' && t.status === 'complete')
    .map((t) => {
      const ids = t.roster_ids.map((r) => (map ? map[r] : r)).filter((r): r is number => r != null)
      const got: Record<number, string[]> = {}
      for (const [pid, rid] of Object.entries(t.adds ?? {})) {
        const r = map ? map[rid] : rid
        if (r != null) (got[r] ??= []).push(pid)
      }
      const sides = ids.map((rosterId) => ({ rosterId, got: got[rosterId] ?? [] }))
      const counts = sides.map((s) => s.got.length).sort((a, b) => b - a)
      const shape =
        counts.length !== 2 ? `${counts.length}-team` : counts[0] === 0 ? 'picks only' : counts[1] === 0 ? `${counts[0]}-for-picks` : `${counts[0]}-for-${counts[1]}`
      return { season, week: t.leg, sides, picks: t.picks, shape, gap: null }
    })

export const leagueBehavior = (input: {
  rosterIds: number[]
  season: string
  transactions: SleeperTransaction[]
  history: LeagueHistory | null
  players: PlayerMap
  market: Record<string, number>
}): LeagueBehavior => {
  const { rosterIds, players, market } = input
  const teams: Record<number, TeamBehavior> = {}
  for (const r of rosterIds) teams[r] = { rosterId: r, moves: 0, trades: 0, tradesLast: 0, partners: {}, bought: {}, sold: {}, engagement: 0.5 }

  let movesTotal = 0
  for (const t of input.transactions) {
    if (t.status !== 'complete' || (t.type !== 'waiver' && t.type !== 'free_agent')) continue
    for (const rid of Object.values(t.adds ?? {})) {
      if (teams[rid]) {
        teams[rid].moves++
        movesTotal++
      }
    }
  }
  // Engagement as a rank, ties sharing, so one hyperactive manager does not flatten everyone else.
  const sorted = [...rosterIds].sort((a, b) => teams[a].moves - teams[b].moves)
  for (const r of rosterIds) {
    const below = sorted.filter((x) => teams[x].moves < teams[r].moves).length
    const equal = sorted.filter((x) => teams[x].moves === teams[r].moves).length
    teams[r].engagement = rosterIds.length > 1 ? (below + (equal - 1) / 2) / (rosterIds.length - 1) : 0.5
  }

  const value = (ids: string[]) => ids.reduce((a, id) => a + Math.max(0, market[id] ?? 0), 0)
  const current = tradesFrom(input.transactions, input.season).map((t) => {
    // Only player-for-player deals have a gap we can price; picks have no value in this model.
    if (t.sides.length === 2 && t.sides.every((x) => x.got.length) && !t.picks) t.gap = Math.round(Math.abs(value(t.sides[0].got) - value(t.sides[1].got)) * 100) / 100
    return t
  })
  const last = input.history ? tradesFrom(input.history.transactions, input.history.season, input.history.rosterMap) : []
  for (const t of [...current, ...last]) {
    const isLast = t.season !== input.season
    for (const side of t.sides) {
      const team = teams[side.rosterId]
      if (!team) continue
      if (isLast) team.tradesLast++
      else team.trades++
      for (const other of t.sides) if (other.rosterId !== side.rosterId) team.partners[other.rosterId] = (team.partners[other.rosterId] ?? 0) + 1
      for (const pid of side.got) {
        const pos = players[pid]?.pos
        if (pos) team.bought[pos] = (team.bought[pos] ?? 0) + 1
      }
      for (const other of t.sides) {
        if (other.rosterId === side.rosterId) continue
        for (const pid of other.got) {
          const pos = players[pid]?.pos
          if (pos) team.sold[pos] = (team.sold[pos] ?? 0) + 1
        }
      }
    }
  }
  const shapes: Record<string, number> = {}
  for (const t of [...current, ...last]) shapes[t.shape] = (shapes[t.shape] ?? 0) + 1
  return {
    teams,
    trades: [...current, ...last].sort((a, b) => (a.season === b.season ? b.week - a.week : b.season.localeCompare(a.season))),
    shapes,
    medianGap: median(current.map((t) => t.gap).filter((g): g is number => g != null)),
    movesTotal,
  }
}

export type AcceptRead = {
  /** 0–100. A ranking index for "who is likeliest to say yes", not a calibrated probability. */
  index: number
  band: 'long shot' | 'possible' | 'likely'
  /** Value they give minus value they get, as the consensus rankings price it. */
  perceivedAsk: number | null
  reasons: string[]
}

const logistic = (x: number) => 1 / (1 + Math.exp(-x))

/**
 * How an offer is likely to land. The weights are judgment, not fit — there
 * are too few trades in one league to fit anything — and each term is small
 * enough that no single one decides the ranking:
 *
 *   their lineup gain     +0.9 per pt/wk (what a careful owner would check)
 *   perceived overpay     −0.45 per pt/wk they appear to give away, by consensus
 *   engagement            ±0.4 from the least to the most active manager
 *   trade history         +0.25 per trade, capped; +0.3 if they have traded with you
 *   extra bodies          −0.15 per player past a 1-for-1
 */
export const acceptRead = (idea: TradeIdea, me: number, behavior: LeagueBehavior | null, perceived: Record<string, number> | null): AcceptRead => {
  const reasons: string[] = []
  const perceivedAsk = perceived
    ? idea.get.reduce((a, id) => a + (perceived[id] ?? 0), 0) - idea.give.reduce((a, id) => a + (perceived[id] ?? 0), 0)
    : null
  const ask = perceivedAsk ?? idea.valueAsk
  let x = -0.1 + 0.9 * idea.theirGain - 0.45 * Math.max(0, ask) + 0.1 * Math.min(2, Math.max(0, -ask))
  if (perceivedAsk != null) {
    if (perceivedAsk > 1.5) reasons.push('looks like an overpay to them by consensus')
    else if (perceivedAsk < -0.5) reasons.push('consensus says they win it')
    else reasons.push('consensus calls it fair')
  }
  const team = behavior?.teams[idea.partnerId]
  if (team) {
    x += 0.8 * (team.engagement - 0.5)
    if (team.engagement >= 0.75) reasons.push('one of the most active managers')
    else if (team.engagement <= 0.25) reasons.push('rarely touches their roster')
    const history = team.trades + 0.5 * team.tradesLast
    x += 0.25 * Math.min(3, history)
    if (team.trades + team.tradesLast > 0) reasons.push(`${team.trades + team.tradesLast} trade${team.trades + team.tradesLast === 1 ? '' : 's'} on record`)
    if (team.partners[me]) {
      x += 0.3
      reasons.push('has traded with you before')
    }
  }
  x -= 0.15 * Math.max(0, idea.give.length + idea.get.length - 2)
  const index = Math.round(logistic(x) * 100)
  return { index, band: index >= 60 ? 'likely' : index >= 35 ? 'possible' : 'long shot', perceivedAsk: perceivedAsk == null ? null : Math.round(perceivedAsk * 100) / 100, reasons }
}
