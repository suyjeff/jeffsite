import type { Analysis } from './analysis'
import { optimalLineup, type LineupPlayer, type Slot } from './lineup'
import { waiverTargets } from './search'
import type { PlayerMap } from './types'
import type { LeagueData } from './useLeagueData'

/**
 * The short list of things to do with a roster right now, ranked: lineup fixes for this week first (they cost nothing
 * and lock at kickoff), then cover for starters who may sit, holes the next bye week opens, the best adds, and role
 * changes or fresh news on starters that are easy to miss. Every move carries the number it is ranked by.
 */
export type MoveKind = 'start' | 'fill' | 'cover' | 'bye' | 'add' | 'role' | 'news'

export type Move = {
  kind: MoveKind
  key: string
  /** The NFL week the move is for; null for a rest-of-season move. */
  week: number | null
  /** Expected points it is worth: that week for weekly moves, per week for adds. */
  gain: number
  /** 2: before this week's kickoff. 1: before next week. 0: roster upkeep. */
  urgency: 0 | 1 | 2
  /** Who goes in (start, add or pick up) and who comes out (bench or drop). */
  inId?: string | null
  outId?: string | null
  slot?: string
  /** Cover: the starter's chance to play and the bench player who would replace him. */
  play?: number
  status?: string
  backup?: string | null
  /** Role: opportunities a game before and in the last game. */
  prior?: number
  last?: number
  /** News: when Sleeper flagged it. */
  at?: number
  /** Points behind the gain: the in and out players' projections for the week. */
  inPts?: number
  outPts?: number
  /** Cover: the backup's projection, when the move is a pickup instead. */
  benchPts?: number
}

const lp = (data: LeagueData, ids: string[], pts: Record<string, number>): LineupPlayer[] =>
  ids.filter((id) => data.players[id]).map((id) => ({ id, fpos: data.players[id].fpos, pts: pts[id] ?? 0 }))

const slotLabel = (s: Slot) => s.name.replace('SUPER_FLEX', 'SF')

// Free agents by position, best first, for one week's points and one set of rosters. One sort per week's numbers
// and rosters, shared by every slot (and every component) that asks.
const faIndex = new WeakMap<Record<string, number>, WeakMap<Record<string, number>, Record<string, string[]>>>()
export const freeAgentsByPos = (players: PlayerMap, rosteredBy: Record<string, number>, pts: Record<string, number>) => {
  let byRosters = faIndex.get(pts)
  if (!byRosters) faIndex.set(pts, (byRosters = new WeakMap()))
  let out = byRosters.get(rosteredBy)
  if (!out) {
    out = {}
    for (const [id, v] of Object.entries(pts)) {
      const p = players[id]
      if (!p || rosteredBy[id] != null || !(v > 0)) continue
      for (const pos of p.fpos ?? [p.pos]) (out[pos] ??= []).push(id)
    }
    for (const ids of Object.values(out)) ids.sort((a, b) => (pts[b] ?? 0) - (pts[a] ?? 0))
    byRosters.set(rosteredBy, out)
  }
  return out
}

/** The best free agent at any of a slot's positions in a week, passing over anyone in `skip`. */
export const bestFreeAgent = (players: PlayerMap, rosteredBy: Record<string, number>, eligible: string[], pts: Record<string, number>, skip?: Set<string>) => {
  const lists = freeAgentsByPos(players, rosteredBy, pts)
  let best: string | null = null
  for (const pos of eligible) {
    const top = (lists[pos] ?? []).find((id) => !skip?.has(id))
    if (top && (best == null || (pts[top] ?? 0) > (pts[best] ?? 0))) best = top
  }
  return best
}

const bestFree = (data: LeagueData, analysis: Analysis, eligible: string[], pts: Record<string, number>, skip: Set<string>) =>
  bestFreeAgent(data.players, analysis.rosteredBy, eligible, pts, skip)

/**
 * Bench players to cut for an add, first to go first: lowest value, with the consensus price as a floor so an injured star the
 * experts still rank is never the one to go.
 */
export const dropCandidates = (analysis: Analysis, rosterId: number, perceived?: Record<string, number> | null) => {
  const team = analysis.teamById[rosterId]
  if (!team) return []
  const lineup = new Set(analysis.needs[rosterId]?.slots.map((s) => s.starter).filter(Boolean) ?? [])
  const keep = (id: string) => {
    const market = analysis.market[id] ?? -99
    return market + Math.max(0, (perceived?.[id] ?? 0) - Math.max(0, market))
  }
  return [...team.players].filter((id) => !lineup.has(id)).sort((a, b) => keep(a) - keep(b))
}

export const dropCandidate = (analysis: Analysis, rosterId: number, perceived?: Record<string, number> | null) => dropCandidates(analysis, rosterId, perceived)[0] ?? null

export const findMoves = (data: LeagueData, analysis: Analysis, rosterId: number, opts: { perceived?: Record<string, number> | null; limit?: number } = {}): Move[] => {
  const team = analysis.teamById[rosterId]
  const h0 = data.horizon[0]
  if (!team || !h0) return []
  const slots = analysis.slots
  const week = h0.week
  // Sleeper's own projection for this week where it has one (what the lineup decision is made on), else the horizon's.
  const proj = data.projectionWeek === week && data.projections ? data.projections : h0.pts
  const roster = team.players
  const moves: Move[] = []
  const used = new Set<string>()

  // ---- This week's lineup: the set lineup against the best one ----
  const set = (team.roster.starters ?? []).map((id) => (id && id !== '0' ? id : null))
  const best = optimalLineup(slots, lp(data, roster, proj))
  const bestIds = new Set(best.assignments.filter(Boolean).map((p) => p!.id))
  const setIds = new Set(set.filter(Boolean) as string[])
  // Pair each player who should start with the set starter he replaces: the weakest one he can play for.
  const benched = set.map((id, i) => ({ id, i })).filter((x) => !x.id || !bestIds.has(x.id))
  const starting = [...bestIds].filter((id) => !setIds.has(id)).sort((a, b) => (proj[b] ?? 0) - (proj[a] ?? 0))
  for (const id of starting) {
    const fpos = data.players[id]?.fpos ?? []
    const k = benched.filter((b) => slots[b.i]?.eligible.some((pos) => fpos.includes(pos))).sort((a, b) => (a.id ? (proj[a.id] ?? 0) : -1) - (b.id ? (proj[b.id] ?? 0) : -1))[0]
    if (k) benched.splice(benched.indexOf(k), 1)
    const outPts = k?.id ? (proj[k.id] ?? 0) : 0
    const gain = (proj[id] ?? 0) - outPts
    if (gain < 0.3) continue
    moves.push({
      kind: 'start',
      key: `start:${id}`,
      week,
      gain,
      urgency: 2,
      inId: id,
      outId: k?.id ?? null,
      slot: k ? slotLabel(slots[k.i]) : undefined,
      inPts: proj[id] ?? 0,
      outPts,
    })
    used.add(id)
  }

  // ---- Slots even the best lineup cannot fill this week: pick someone up ----
  const weekPts = h0.pts
  const added: string[] = []
  best.assignments.forEach((p, i) => {
    if (p && p.pts > 0) return
    const fa = bestFree(data, analysis, slots[i].eligible, weekPts, used)
    if (!fa) return
    used.add(fa)
    added.push(fa)
    const who = p?.id ?? set[i] ?? null
    moves.push({ kind: 'fill', key: `fill:${i}`, week, gain: weekPts[fa] ?? 0, urgency: 2, inId: fa, outId: who, slot: slotLabel(slots[i]), inPts: weekPts[fa] ?? 0, outPts: 0 })
  })

  // ---- Starters who may sit: who covers if they do ----
  best.assignments.forEach((p, i) => {
    if (!p) return
    const note = data.context[p.id]?.notes.find((n) => n.kind === 'status' && n.week === week)
    if (!note || note.kind !== 'status' || note.play >= 0.95) return
    const risk = (1 - note.play) * p.pts
    if (risk < 1) return
    const bench = roster
      .filter((id) => !bestIds.has(id) && (proj[id] ?? 0) > 0 && (data.players[id]?.fpos ?? []).some((pos) => slots[i].eligible.includes(pos)))
      .sort((a, b) => (proj[b] ?? 0) - (proj[a] ?? 0))[0]
    // Bench and free agent compared on the same numbers, the week's expected points.
    const benchPts = bench ? (weekPts[bench] ?? 0) : 0
    // A bench player close to the free-agent best is cover enough; otherwise the cover is a pickup.
    const fa = bestFree(data, analysis, slots[i].eligible, weekPts, used)
    const faPts = fa ? (weekPts[fa] ?? 0) : 0
    const pickup = fa && faPts > benchPts + 1.5 ? fa : null
    if (!pickup && !bench) return
    if (pickup) {
      used.add(pickup)
      added.push(pickup)
    }
    moves.push({
      kind: 'cover',
      key: `cover:${p.id}`,
      week,
      gain: (1 - note.play) * (pickup ? faPts : benchPts),
      urgency: 2,
      inId: pickup,
      outId: p.id,
      backup: bench ?? null,
      play: note.play,
      status: note.status,
      slot: slotLabel(slots[i]),
      inPts: pickup ? faPts : benchPts,
      outPts: p.pts,
      benchPts,
    })
  })

  // ---- Next week: holes a bye or an absence opens that the bench cannot fill ----
  const h1 = data.horizon.find((h) => h.week === week + 1)
  if (h1) {
    // This week's pickups count: a hole they already cover is not a second move.
    const next = optimalLineup(slots, lp(data, [...roster, ...added], h1.pts))
    next.assignments.forEach((p, i) => {
      if (p && p.pts > 0) return
      // Who is missing: the player the lineup is left with there, else this week's starter in the slot.
      const regular = p?.id ?? best.assignments[i]?.id ?? null
      const fa = bestFree(data, analysis, slots[i].eligible, h1.pts, used)
      if (!fa) return
      used.add(fa)
      moves.push({ kind: 'bye', key: `bye:${i}`, week: week + 1, gain: h1.pts[fa] ?? 0, urgency: 1, inId: fa, outId: regular, slot: slotLabel(slots[i]), inPts: h1.pts[fa] ?? 0 })
    })
  }

  // ---- The best adds for the rest of the season ----
  if (rosterId === analysis.myRosterId) {
    // Each add costs a different bench player, so two adds read as two moves you can make together.
    const drops = dropCandidates(analysis, rosterId, opts.perceived)
    const byPos = new Set<string>()
    for (const t of waiverTargets(data, analysis, { pool: 120, limit: 12 })) {
      if (t.add < 0.5 || used.has(t.id)) continue
      const pos = data.players[t.id]?.pos ?? ''
      if (byPos.has(pos)) continue
      byPos.add(pos)
      used.add(t.id)
      // A kicker or defense replaces yours; anyone else costs the weakest bench player.
      const same =
        pos === 'K' || pos === 'DEF'
          ? roster.filter((id) => data.players[id]?.pos === pos).sort((a, b) => (analysis.horizon.perWeek[a] ?? 0) - (analysis.horizon.perWeek[b] ?? 0))[0]
          : undefined
      const drop = same ?? drops.find((id) => !used.has(id)) ?? null
      if (drop) used.add(drop)
      moves.push({ kind: 'add', key: `add:${t.id}`, week: null, gain: t.add, urgency: 0, inId: t.id, outId: drop, slot: t.slot ?? undefined })
      if (byPos.size >= 2) break
    }
  }

  // ---- Role changes on starters, and news on them since the player file's last day ----
  const newsAsOf = Object.values(data.players).reduce((a, p) => Math.max(a, p.newsAt ?? 0), 0)
  for (const p of best.assignments) {
    if (!p) continue
    const usage = data.context[p.id]?.notes.find((n) => n.kind === 'usage')
    if (usage && usage.kind === 'usage' && usage.prior >= 4 && usage.last < usage.prior * 0.65) {
      // What the drop costs if it holds, at about a point per lost touch, scaled by how much such swings carry over.
      const gain = (usage.prior - usage.last) * usage.carryover
      moves.push({ kind: 'role', key: `role:${p.id}`, week: null, gain, urgency: 0, outId: p.id, prior: usage.prior, last: usage.last })
      continue
    }
    const at = data.players[p.id]?.newsAt ?? 0
    const noted = data.context[p.id]?.notes.some((n) => n.kind === 'status' || n.kind === 'returns')
    if (newsAsOf && at > newsAsOf - 24 * 3600_000 && !noted) moves.push({ kind: 'news', key: `news:${p.id}`, week, gain: 0, urgency: 1, outId: p.id, at })
  }
  // Bench players whose work jumped: worth a look before the waiver run.
  for (const id of roster) {
    if (bestIds.has(id)) continue
    const usage = data.context[id]?.notes.find((n) => n.kind === 'usage')
    // Only someone who can play this week: a jump just before an injury is no reason to start him.
    if (!((proj[id] ?? 0) > 0)) continue
    if (usage && usage.kind === 'usage' && usage.last >= 8 && usage.last > usage.prior * 1.5)
      moves.push({ kind: 'role', key: `role:${id}`, week: null, gain: (usage.last - usage.prior) * usage.carryover, urgency: 0, inId: id, prior: usage.prior, last: usage.last })
  }

  return moves.sort((a, b) => b.urgency - a.urgency || b.gain - a.gain).slice(0, opts.limit ?? 8)
}
