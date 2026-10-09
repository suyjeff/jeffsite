import type { TeamInfo } from './analysis'

export type RosterRow = {
  /** The player's id; an empty starting slot gets a stand-in, `empty-<slot index>`, so rows stay keyed. */
  id: string
  slot: string
  starter: boolean
  /** Position in Sleeper's order, to sort back to it. */
  n: number
  /** A starting slot Sleeper has no one in. */
  empty?: boolean
}

const NON_START = new Set(['BN', 'IR', 'TAXI'])

/** Sleeper marks an empty starting slot '0'. */
const isPlayer = (id: string | null | undefined): id is string => !!id && id !== '0'

/** A team's players as Sleeper has them set: starters in slot order (empty slots kept), then bench, IR and taxi. */
export const rosterRows = (team: TeamInfo, rosterPositions: string[] | undefined): RosterRow[] => {
  // Index slots on the unfiltered list: an empty slot ('0') still holds its place.
  const slotted = team.roster.starters ?? []
  const starterSet = new Set(slotted.filter(isPlayer))
  const slotNames = (rosterPositions ?? []).filter((p) => !NON_START.has(p))
  const out: Omit<RosterRow, 'n'>[] = slotted.map((id, i) => {
    const slot = (slotNames[i] ?? 'ST').replace('SUPER_FLEX', 'SF')
    return isPlayer(id) ? { id, slot, starter: true } : { id: `empty-${i}`, slot, starter: true, empty: true }
  })
  const reserve = new Set(team.roster.reserve ?? [])
  const taxi = new Set(team.roster.taxi ?? [])
  for (const id of team.players) {
    if (starterSet.has(id)) continue
    out.push({ id, slot: reserve.has(id) ? 'IR' : taxi.has(id) ? 'TX' : 'BN', starter: false })
  }
  return out.map((r, n) => ({ ...r, n }))
}

/** A team's bench: rostered, not starting, not on IR or taxi. */
export const benchIds = (team: TeamInfo): string[] => {
  const away = new Set([...(team.roster.starters ?? []), ...(team.roster.reserve ?? []), ...(team.roster.taxi ?? [])])
  return team.players.filter((id) => !away.has(id))
}
