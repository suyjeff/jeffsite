// Lineup slots, eligibility, and an exact optimal-lineup solver.

const FLEX_SLOTS: Record<string, string[]> = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['WR', 'RB'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB'],
}

const NON_STARTING = new Set(['BN', 'IR', 'TAXI'])

/** Positions a roster slot accepts, or null for bench/IR/taxi. */
export const slotEligibility = (slot: string): string[] | null => {
  if (NON_STARTING.has(slot)) return null
  if (FLEX_SLOTS[slot]) return FLEX_SLOTS[slot]
  return [slot]
}

export type Slot = { name: string; eligible: string[] }

export const startingSlots = (rosterPositions: string[]): Slot[] =>
  rosterPositions
    .map((name) => ({ name, eligible: slotEligibility(name) }))
    .filter((s): s is Slot => s.eligible !== null)

export const benchSize = (rosterPositions: string[]) =>
  rosterPositions.filter((p) => p === 'BN').length

/**
 * How the flex slots typically get used, by position. Used only to translate
 * roster settings into "how many players at each position start league-wide".
 */
const FLEX_SHARE: Record<string, Record<string, number>> = {
  FLEX: { RB: 0.45, WR: 0.45, TE: 0.1 },
  WRRB_FLEX: { RB: 0.5, WR: 0.5 },
  REC_FLEX: { WR: 0.8, TE: 0.2 },
  SUPER_FLEX: { QB: 0.75, RB: 0.1, WR: 0.1, TE: 0.05 },
  IDP_FLEX: { DL: 0.34, LB: 0.33, DB: 0.33 },
}

/** League-wide starter demand per position (e.g. 12 teams x (2 RB + 0.45 flex) = 29.4 RBs). */
export const starterDemand = (rosterPositions: string[], numTeams: number) => {
  const demand: Record<string, number> = {}
  for (const slot of rosterPositions) {
    if (NON_STARTING.has(slot)) continue
    const share = FLEX_SHARE[slot]
    if (share) {
      for (const pos of Object.keys(share)) demand[pos] = (demand[pos] ?? 0) + share[pos] * numTeams
    } else {
      demand[slot] = (demand[slot] ?? 0) + numTeams
    }
  }
  return demand
}

export type LineupPlayer = { id: string; fpos: string[]; pts: number }

const BIG = 1e9

/** Kuhn-Munkres on a rectangular cost matrix (rows <= cols). Returns col index per row. */
const hungarian = (cost: number[][]): number[] => {
  const n = cost.length
  const m = cost[0]?.length ?? 0
  const INF = Number.POSITIVE_INFINITY
  const u = new Array(n + 1).fill(0)
  const v = new Array(m + 1).fill(0)
  const p = new Array(m + 1).fill(0)
  const way = new Array(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array(m + 1).fill(INF)
    const used = new Array(m + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = INF
      let j1 = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0)
  }
  const ans = new Array(n).fill(-1)
  for (let j = 1; j <= m; j++) if (p[j] > 0) ans[p[j] - 1] = j - 1
  return ans
}

export type Lineup = { total: number; assignments: (LineupPlayer | null)[] }

/**
 * Exact maximum-points lineup by assignment (Kuhn-Munkres). Correct for any
 * slot layout, including flex slots whose eligibility overlaps without nesting
 * (REC_FLEX next to WRRB_FLEX), where filling slots greedily goes wrong.
 */
export const optimalLineupExact = (slots: Slot[], players: LineupPlayer[]): Lineup => {
  if (slots.length === 0) return { total: 0, assignments: [] }
  const cols = Math.max(players.length, slots.length)
  const cost: number[][] = slots.map((slot) =>
    Array.from({ length: cols }, (_, j) => {
      const pl = players[j]
      if (!pl) return BIG
      const ok = pl.fpos.some((p) => slot.eligible.includes(p))
      return ok ? -pl.pts : BIG
    }),
  )
  const assign = hungarian(cost)
  let total = 0
  const assignments = slots.map((_, i) => {
    const j = assign[i]
    if (j < 0 || cost[i][j] >= BIG) return null
    const pl = players[j]
    total += pl.pts
    return pl
  })
  return { total: Math.round(total * 100) / 100, assignments }
}

type GreedyPlan = { dedicated: Record<string, number[]>; flex: number[] }
const plans = new WeakMap<Slot[], GreedyPlan | null>()

/**
 * When every flex slot's eligible positions sit inside the next one's (FLEX
 * inside SUPER_FLEX, say), filling the single-position slots with each
 * position's best players and then the flex slots narrowest-first is optimal:
 * any lineup that does otherwise can swap its way here without losing points.
 * Returns null for layouts where that argument fails.
 */
const greedyPlan = (slots: Slot[]): GreedyPlan | null => {
  if (plans.has(slots)) return plans.get(slots)!
  const dedicated: Record<string, number[]> = {}
  const flex: number[] = []
  slots.forEach((slot, i) => {
    if (slot.eligible.length === 1) (dedicated[slot.eligible[0]] ??= []).push(i)
    else flex.push(i)
  })
  flex.sort((a, b) => slots[a].eligible.length - slots[b].eligible.length)
  let plan: GreedyPlan | null = { dedicated, flex }
  for (let k = 0; k + 1 < flex.length; k++) {
    const wider = slots[flex[k + 1]].eligible
    if (!slots[flex[k]].eligible.every((p) => wider.includes(p))) {
      plan = null
      break
    }
  }
  plans.set(slots, plan)
  return plan
}

/**
 * Exact maximum-points lineup for the given starting slots. Players with no
 * points still count as zero, and a slot nobody is eligible for stays empty.
 *
 * Standard layouts take a sort-and-fill path that is roughly ten times faster
 * than the assignment solve and gives the same total; the trade search runs
 * this tens of thousands of times per click. Anything the fast path cannot
 * prove optimal — overlapping flex slots, or a player eligible at two
 * positions — goes to the assignment solver.
 */
export const optimalLineup = (slots: Slot[], players: LineupPlayer[]): Lineup => {
  if (slots.length === 0) return { total: 0, assignments: [] }
  const plan = greedyPlan(slots)
  if (!plan || players.some((p) => p.fpos.length !== 1)) return optimalLineupExact(slots, players)

  const byPos: Record<string, LineupPlayer[]> = {}
  for (const p of players) (byPos[p.fpos[0]] ??= []).push(p)
  for (const pos of Object.keys(byPos)) byPos[pos].sort((a, b) => b.pts - a.pts)
  const next: Record<string, number> = {}
  const assignments: (LineupPlayer | null)[] = slots.map(() => null)
  let total = 0
  for (const pos of Object.keys(plan.dedicated)) {
    const list = byPos[pos] ?? []
    let k = 0
    for (const i of plan.dedicated[pos]) {
      if (k >= list.length) break
      assignments[i] = list[k]
      total += list[k].pts
      k++
    }
    next[pos] = k
  }
  for (const i of plan.flex) {
    let bestPos: string | null = null
    let best = -Infinity
    for (const pos of slots[i].eligible) {
      const list = byPos[pos]
      const k = next[pos] ?? 0
      if (list && k < list.length && list[k].pts > best) {
        best = list[k].pts
        bestPos = pos
      }
    }
    if (bestPos === null) continue
    const k = next[bestPos] ?? 0
    assignments[i] = byPos[bestPos][k]
    next[bestPos] = k + 1
    total += best
  }
  return { total: Math.round(total * 100) / 100, assignments }
}

/**
 * Starters who cannot score: an empty slot, or a player with no projection
 * (on bye, or ruled out) who did not score either. Managers fix these before
 * kickoff far more often than not, so the models read them as a lineup not set
 * yet rather than as the team's real expectation.
 */
export const deadStarters = (
  slots: Slot[],
  slotted: string[] | undefined,
  proj: Record<string, number>,
  scored: Record<string, number> = {},
): { slot: Slot; id: string | null }[] => {
  if (!slotted?.length) return []
  const out: { slot: Slot; id: string | null }[] = []
  slots.forEach((slot, i) => {
    const id = slotted[i]
    if (!id || id === '0') out.push({ slot, id: null })
    else if (!((proj[id] ?? 0) > 0) && !((scored[id] ?? 0) > 0)) out.push({ slot, id })
  })
  return out
}

/** What a dead slot would have scored with a replacement-level body in it. */
export const deadSlotFill = (dead: { slot: Slot }[], floor: Record<string, number>) =>
  dead.reduce((a, d) => a + Math.max(0, ...d.slot.eligible.map((pos) => floor[pos] ?? 0)), 0)
