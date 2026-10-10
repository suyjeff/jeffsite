import type { LineupPlayer, Slot } from './lineup'

export type Swap = {
  /** Index into the starting slots. */
  slot: number
  /** The starter being sat, or null when the slot is empty. */
  out: string | null
  /** The player who takes the slot. Always eligible for it. */
  in: string
}

export type SwapPlan = {
  swaps: Swap[]
  /**
   * Players the best lineup starts that no open slot could take as it stands: it also moves a kept starter between
   * slots. `slot` is where the best lineup seats him.
   */
  unplaced: { id: string; slot: number }[]
  /** Slots whose starter the best lineup sits but that nobody coming in is eligible for. */
  stuck: { slot: number; out: string | null }[]
  /** Everyone the best lineup brings in, placed or not: the number of changes to make. */
  count: number
}

/**
 * Pair each starter the best lineup sits (or empty slot) with a player coming in who can really play that slot.
 * The optimiser's own assignment decides first: if the player it puts in slot i is a newcomer, he takes slot i.
 * What is left is matched by eligibility, best projection first, so a RB is never offered for a WR slot. Because
 * every swap respects its slot, making all of them leaves a legal lineup holding exactly the best set of players.
 */
export const pairSwaps = (slots: Slot[], set: (string | null | undefined)[], best: (LineupPlayer | null)[]): SwapPlan => {
  const slotted = slots.map((_, i) => (set[i] && set[i] !== '0' ? (set[i] as string) : null))
  const setIds = new Set(slotted.filter((id): id is string => id != null))
  const bestIds = new Set(best.filter((p): p is LineupPlayer => p != null).map((p) => p.id))
  const coming = best.filter((p): p is LineupPlayer => p != null && !setIds.has(p.id))
  const open = slots.map((_, i) => i).filter((i) => slotted[i] == null || !bestIds.has(slotted[i]!))

  const takenBy = new Map<number, LineupPlayer>()
  const placed = new Set<string>()
  // The optimiser's slot first.
  for (const i of open) {
    const p = best[i]
    if (p && !setIds.has(p.id)) {
      takenBy.set(i, p)
      placed.add(p.id)
    }
  }

  // The rest by eligibility: augmenting paths, so one awkward slot cannot strand a player another could have taken.
  const rest = coming.filter((p) => !placed.has(p.id)).sort((a, b) => b.pts - a.pts)
  const fits = (p: LineupPlayer, i: number) => p.fpos.some((pos) => slots[i].eligible.includes(pos))
  const free = open.filter((i) => !takenBy.has(i))
  const holder = new Map<number, LineupPlayer>()
  const place = (p: LineupPlayer, seen: Set<number>): boolean => {
    for (const i of free) {
      if (seen.has(i) || !fits(p, i)) continue
      seen.add(i)
      const cur = holder.get(i)
      if (!cur || place(cur, seen)) {
        holder.set(i, p)
        return true
      }
    }
    return false
  }
  const unplaced: SwapPlan['unplaced'] = []
  for (const p of rest) if (!place(p, new Set())) unplaced.push({ id: p.id, slot: best.findIndex((b) => b?.id === p.id) })
  holder.forEach((p, i) => takenBy.set(i, p))

  const swaps: Swap[] = []
  const stuck: SwapPlan['stuck'] = []
  for (const i of open) {
    const p = takenBy.get(i)
    if (p) swaps.push({ slot: i, out: slotted[i], in: p.id })
    else if (slotted[i] != null) stuck.push({ slot: i, out: slotted[i] })
  }
  return { swaps, unplaced, stuck, count: coming.length }
}
