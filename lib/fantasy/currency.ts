// What players are worth in a trade conversation, as people actually price
// them, rather than the points they add.
//
// The lineup model is right that a better defense adds a point or two a week.
// But nobody in a league hands over a receiver they drafted for a defense and
// a streaming quarterback, and an offer built that way reads as a joke. Two
// human habits are priced here:
//
//   Streamable positions. Kickers and defenses are picked up and dropped
//   weekly, so they carry almost no trade value; they are also left out of
//   the trade search entirely. Quarterbacks past the league's starting demand
//   (QB13 and down in a 12-team, one-QB league) are streamers too, easing to
//   about a third of their points by QB18. The rank is the consensus one, since
//   reputation is what people trade on: an injured franchise quarterback
//   whose rest-of-season points have dipped is still nobody's streamer.
//
//   Attachment. Managers hold the players they drafted above what they would
//   pay for them (the endowment effect), and hold this season's waiver pickups
//   loosely. Prying away a drafted player costs a modest premium. The size is
//   a judgement, not a measurement: a fifth over the points, small enough
//   that a clearly better offer still clears it.

import type { Consensus } from './consensus'
import { starterDemand } from './lineup'
import type { PlayerMap, SleeperTransaction } from './types'

/** Positions nobody trades for: left out of the trade search. */
export const UNTRADED_POSITIONS = new Set(['K', 'DEF'])
/** Trade value per point for a streaming-tier player at each position. */
export const STREAM_FACTOR: Record<string, number> = { K: 0.1, DEF: 0.1, QB: 0.35 }
/** What a manager's own drafted (or kept) player costs, over his points. */
export const ATTACHMENT = 1.2

export type Currency = {
  /** Trade value per point of market value, by player. */
  factor: Record<string, number>
  /** Players their manager did not pick up off waivers this season. */
  attached: Set<string>
}

/**
 * Per-player trade value factors for the league. Streaming tier is set by the
 * league's own starter demand: in a superflex league far more quarterbacks
 * are starters, and none of them stream.
 */
export const tradeCurrency = (input: {
  players: PlayerMap
  market: Record<string, number>
  rosterPositions: string[]
  numTeams: number
  rosters: { rosterId: number; players: string[] }[]
  transactions: SleeperTransaction[]
  consensus?: Consensus | null
}): Currency => {
  const { players, market } = input
  const demand = starterDemand(input.rosterPositions, input.numTeams)
  const factor: Record<string, number> = {}
  // Quarterbacks past starting demand are streamers: by consensus rank where
  // there is one, else by this model's rest-of-season value.
  const qbStarters = Math.round(demand.QB ?? input.numTeams)
  const byMarket = Object.keys(market)
    .filter((id) => players[id]?.pos === 'QB')
    .sort((a, b) => (market[b] ?? 0) - (market[a] ?? 0))
  // A ramp, not a cliff: full value through the starter line, easing to the
  // streamer price by half again past it (QB12 → QB18 in a 12-team league).
  byMarket.forEach((id, i) => {
    const ecr = input.consensus?.byId[id]?.posRank
    const rank = ecr != null ? ecr : i + 1
    const t = Math.min(1, Math.max(0, (rank - qbStarters) / (qbStarters / 2)))
    if (t > 0) factor[id] = 1 - t * (1 - STREAM_FACTOR.QB)
  })
  // Only players a trade can price: anyone with a market value, and anyone on a roster.
  const priced = new Set([...Object.keys(market), ...input.rosters.flatMap((r) => r.players)])
  for (const id of priced) {
    const pos = players[id]?.pos
    if (pos && UNTRADED_POSITIONS.has(pos)) factor[id] = STREAM_FACTOR[pos] ?? 0
  }

  // Who picked up whom this season: the last add of each player, by the roster that holds him now.
  const addedBy: Record<string, number> = {}
  const waiverAdd: Record<string, boolean> = {}
  for (const t of [...input.transactions].filter((x) => x.status === 'complete').sort((a, b) => a.created - b.created)) {
    for (const [id, rid] of Object.entries(t.adds ?? {})) {
      addedBy[id] = rid
      waiverAdd[id] = t.type === 'waiver' || t.type === 'free_agent'
    }
  }
  const attached = new Set<string>()
  for (const r of input.rosters) {
    for (const id of r.players) {
      const pickedUp = addedBy[id] === r.rosterId && waiverAdd[id]
      if (!pickedUp) attached.add(id)
    }
  }
  return { factor, attached }
}

/** A set's trade value: its market value, as people price it. `owned` adds the owner's attachment. */
export const tradeValue = (ids: string[], market: Record<string, number>, currency: Currency | undefined, owned: boolean) =>
  ids.reduce((a, id) => {
    const v = Math.max(0, market[id] ?? 0) * (currency?.factor[id] ?? 1)
    return a + (owned && currency?.attached.has(id) ? v * ATTACHMENT : v)
  }, 0)
