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
//
// And two more habits shape what a player is worth in the room, before any of
// the above:
//
//   Reputation. Nobody prices a second-round pick by his last three games. The
//   room reads the consensus rankings and remembers where a player went in the
//   draft, so a star in a slump, or hurt, still fetches far more than his
//   projection says. The price is the model's value blended with both (see
//   `tradeMarket`); without that blend the search happily "buys" such a player
//   for a bench body, since by points alone he is one.
//
//   Stars are scarce. Two 4-point players are not worth one 8-point player,
//   because the second roster spot is not worth the first. Value is convex in
//   points (`starValue`), so a package of parts adds up to less than the whole.

import { valueAtRank, valueCurve, perceivedValues, type Consensus } from './consensus'
import { starterDemand } from './lineup'
import type { DraftBoard, PlayerMap, SleeperTransaction } from './types'

/** Positions nobody trades for: left out of the trade search. */
export const UNTRADED_POSITIONS = new Set(['K', 'DEF'])
/** Trade value per point for a streaming-tier player at each position. */
export const STREAM_FACTOR: Record<string, number> = { K: 0.1, DEF: 0.1, QB: 0.35 }
/** What a manager's own drafted (or kept) player costs, over his points. */
export const ATTACHMENT = 1.2
/**
 * How much each opinion counts toward a player's price. Judgement, not a fit: the model has the points, the
 * consensus has what the room believes, and the draft has what each manager paid and still remembers. The
 * draft's share fades as the season gives them something else to look at (`draftShare`).
 */
export const REPUTATION = { model: 0.5, consensus: 0.35, draft: 0.2 }
/**
 * Version of the trade-value scale. Anything stored in its units (a grade's recorded ask) is stamped with it, and
 * is read only against the same scale. 2: convex star value and reputation-blended prices.
 */
export const PRICING_VERSION = 2
/** Shape of the star premium: value = scale · (points / scale)^exp. Five points a week is worth five; ten, about twelve. */
export const STAR = { scale: 5, exp: 1.25 }

/** Convex trade value of a player worth `v` points a week above replacement: a star counts for more than his points. */
export const starValue = (v: number) => (v <= 0 ? 0 : STAR.scale * (v / STAR.scale) ** STAR.exp)

/** The draft's share of a price after `weeksPlayed` weeks: full at the start, a quarter of that by midseason. */
export const draftShare = (weeksPlayed: number) => Math.max(REPUTATION.draft * 0.25, REPUTATION.draft - 0.015 * Math.max(0, weeksPlayed))

/** Where each drafted player's slot in the order sits on the market curve: what that pick would be worth if the draft had been right. */
export const draftValues = (draft: DraftBoard, market: Record<string, number>): Record<string, number> => {
  const curve = valueCurve(market)
  if (!curve.length) return {}
  const out: Record<string, number> = {}
  for (const [id, rank] of Object.entries(draft.rank)) out[id] = valueAtRank(curve, rank)
  return out
}

/**
 * What each player is worth in a trade conversation, in points a week above replacement: the model's value
 * blended with the consensus reading and the draft slot, whichever of them exist for him. A player a source
 * does not cover is read at the other sources alone, never at zero, so a miss is not a bargain. (A model value of
 * zero or less is a reading, not a miss: it counts, as zero.)
 */
export const tradeMarket = (input: { market: Record<string, number>; consensus?: Consensus | null; draft?: DraftBoard | null; weeksPlayed?: number }): Record<string, number> => {
  const { market } = input
  const cons = input.consensus ? perceivedValues(input.consensus, market) : {}
  const drafted = input.draft ? draftValues(input.draft, market) : {}
  const draftWeight = draftShare(input.weeksPlayed ?? 0)
  const out: Record<string, number> = {}
  for (const id of new Set([...Object.keys(market), ...Object.keys(cons), ...Object.keys(drafted)])) {
    let num = 0
    let den = 0
    if (market[id] != null) {
      num += REPUTATION.model * Math.max(0, market[id])
      den += REPUTATION.model
    }
    if (cons[id] != null) {
      num += REPUTATION.consensus * cons[id]
      den += REPUTATION.consensus
    }
    if (drafted[id] != null) {
      num += draftWeight * drafted[id]
      den += draftWeight
    }
    out[id] = Math.round((num / den) * 100) / 100
  }
  return out
}

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

/** A set's trade value: its market value, as people price it (stars dear, streamers cheap). `owned` adds the owner's attachment. */
export const tradeValue = (ids: string[], market: Record<string, number>, currency: Currency | undefined, owned: boolean) =>
  ids.reduce((a, id) => {
    const v = starValue(Math.max(0, market[id] ?? 0)) * (currency?.factor[id] ?? 1)
    return a + (owned && currency?.attached.has(id) ? v * ATTACHMENT : v)
  }, 0)
