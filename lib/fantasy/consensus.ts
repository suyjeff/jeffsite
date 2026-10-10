// Expert consensus rankings, matched to Sleeper players.
//
// The point of a second opinion here is not to replace the model. It is that
// the other owners in your league read these rankings. A deal your model likes
// and the consensus calls fair is one they can say yes to; a deal the
// consensus calls a fleecing gets declined on sight however good the numbers
// are. So consensus feeds two things: a disagreement view (where the model and
// the experts part ways) and the "perceived" side of how a trade looks.

import type { PlayerMap } from './types'
import { normName } from './names'

export type ConsensusEntry = {
  /** Overall rest-of-season rank among all positions. */
  rank: number | null
  /** Rank at his position, rest of season. */
  posRank: number | null
  /** Expert spread on the rest-of-season rank (standard deviation, best, worst). */
  sd: number | null
  best: number | null
  worst: number | null
  /** This week's rank at his position. */
  weekRank: number | null
}

export type Consensus = {
  /** Date FantasyPros was scraped. */
  date: string | null
  byId: Record<string, ConsensusEntry>
  /** Rows the matcher placed, and rows it could not. */
  matched: number
  unmatched: number
}

/** Rows kept from the CSV: what we use and nothing else, so the cache stays small. */
export type ConsensusRow = { page: string; name: string; pos: string; team: string; ecr: number; sd: number | null; best: number | null; worst: number | null; date: string }

const KEEP = /^(redraft|weekly)-(overall|qb|rb|wr|te|k|dst)$/

/** Minimal RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export const parseCsv = (text: string): string[][] => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.length > 1 || r[0])
}

const num = (s: string | undefined) => {
  if (s == null || s === '' || s === 'NA') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** The CSV reduced to the pages we read. Runs before caching. */
export const reduceConsensusCsv = (text: string): ConsensusRow[] => {
  const [header, ...rows] = parseCsv(text)
  if (!header) return []
  const col = (name: string) => header.indexOf(name)
  const iPage = col('page_type')
  const iName = col('player')
  const iPos = col('pos')
  const iTeam = col('team')
  const iEcr = col('ecr')
  const iSd = col('sd')
  const iBest = col('best')
  const iWorst = col('worst')
  const iDate = col('scrape_date')
  if ([iPage, iName, iPos, iEcr].some((i) => i < 0)) return []
  const out: ConsensusRow[] = []
  for (const r of rows) {
    const page = r[iPage]
    if (!KEEP.test(page)) continue
    const ecr = num(r[iEcr])
    if (ecr == null) continue
    out.push({ page, name: r[iName], pos: r[iPos], team: r[iTeam] ?? '', ecr, sd: num(r[iSd]), best: num(r[iBest]), worst: num(r[iWorst]), date: r[iDate] ?? '' })
  }
  return out
}

/** FantasyPros team codes that differ from Sleeper's. */
const TEAM_FIX: Record<string, string> = { JAC: 'JAX', WSH: 'WAS', LA: 'LAR' }

/**
 * Place each consensus row on a Sleeper player. Name and position must agree;
 * the team breaks ties between namesakes. Defenses match on team code.
 */
export const matchConsensus = (rows: ConsensusRow[], players: PlayerMap): Consensus => {
  const index = new Map<string, string[]>()
  for (const id of Object.keys(players)) {
    const p = players[id]
    const key = p.pos === 'DEF' ? `DEF|${id}` : `${p.pos}|${normName(p.name)}`
    const list = index.get(key)
    if (list) list.push(id)
    else index.set(key, [id])
  }
  const find = (r: ConsensusRow): string | null => {
    const team = TEAM_FIX[r.team] ?? r.team
    if (r.pos === 'DST') return index.get(`DEF|${team}`)?.[0] ?? null
    const ids = index.get(`${r.pos}|${normName(r.name)}`)
    if (!ids?.length) return null
    if (ids.length === 1) return ids[0]
    return ids.find((id) => players[id].team === team) ?? null
  }

  const byId: Record<string, ConsensusEntry> = {}
  const entry = (id: string) => (byId[id] ??= { rank: null, posRank: null, sd: null, best: null, worst: null, weekRank: null })
  let matched = 0
  let unmatched = 0
  let date: string | null = null
  for (const r of rows) {
    date ??= r.date || null
    const id = find(r)
    if (!id) {
      unmatched++
      continue
    }
    matched++
    const e = entry(id)
    if (r.page === 'redraft-overall') {
      e.rank = r.ecr
      e.sd = r.sd
      e.best = r.best
      e.worst = r.worst
    } else if (r.page.startsWith('redraft-')) e.posRank = r.ecr
    else if (r.page.startsWith('weekly-')) e.weekRank = r.ecr
  }
  return { date, byId, matched, unmatched }
}

/** Market values best first: the curve a rank is read against. */
export const valueCurve = (market: Record<string, number>): number[] =>
  Object.values(market)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a)

/** The value of the player ranked `rank` (1 is best) on a curve; fractional ranks (5.5) interpolate between neighbours. */
export const valueAtRank = (curve: number[], rank: number): number => {
  const lo = Math.max(0, Math.min(curve.length - 1, Math.floor(rank) - 1))
  const hi = Math.min(curve.length - 1, lo + 1)
  const t = rank - Math.floor(rank)
  return Math.max(0, curve[lo] * (1 - t) + curve[hi] * t)
}

/**
 * Consensus rank expressed in the model's own units. Take the model's market
 * values in descending order; the player the experts rank Nth is "perceived"
 * at the Nth best value. It answers: if the consensus order were right, what
 * would this player be worth per week?
 */
export const perceivedValues = (consensus: Consensus, market: Record<string, number>): Record<string, number> => {
  const curve = valueCurve(market)
  if (!curve.length) return {}
  const out: Record<string, number> = {}
  for (const id of Object.keys(consensus.byId)) {
    const rank = consensus.byId[id].rank
    if (rank == null) continue
    out[id] = valueAtRank(curve, rank)
  }
  return out
}
