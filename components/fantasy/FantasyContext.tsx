import { createContext, useContext } from 'react'
import type { Adjustment, Adjustments } from '../../lib/fantasy/adjust'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { Models } from '../../lib/fantasy/models'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import type { SectionKey } from './Shell'

/** What every view reads: the raw league, the core analysis, and the models built on it. */
export type FantasyCtx = {
  data: LeagueData
  analysis: Analysis
  models: Models
  /** Your nudges to player projections (see lib/fantasy/adjust). */
  adjust: { all: Adjustments; week: number | null; set: (id: string, a: Adjustment | null) => void }
  go: (section: SectionKey, sub?: string | null) => void
  /** Open a player's detail sheet. */
  openPlayer: (id: string) => void
}

const Ctx = createContext<FantasyCtx | null>(null)
export const FantasyProvider = Ctx.Provider

/** The context when there is one: for pieces like player names that also render outside a league view. */
export const useFantasyMaybe = () => useContext(Ctx)

export const useFantasy = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useFantasy outside FantasyProvider')
  return c
}
