import { createContext, useCallback, useContext } from 'react'
import type { Adjustment, Adjustments } from '../../lib/fantasy/adjust'
import type { Analysis } from '../../lib/fantasy/analysis'
import type { Models } from '../../lib/fantasy/models'
import type { LeagueData } from '../../lib/fantasy/useLeagueData'
import type { SectionKey } from './Shell'
import { acceptRead, type AcceptRead } from '../../lib/fantasy/behavior'
import type { GradeRecord, Grades, Lessons } from '../../lib/fantasy/grades'
import type { TradeIdea } from '../../lib/fantasy/trades'

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
  /** Open a team's summary sheet. */
  openTeam: (rosterId: number) => void
  /** Open an NFL game's sheet, by its schedule key. */
  openGame: (key: string) => void
  /** Open a fantasy matchup's sheet. */
  openMatchup: (week: number, a: number, b: number) => void
  /** Your grades of suggested trades and what they teach the trade read (see lib/fantasy/grades). */
  grades: {
    all: Grades
    lessons: Lessons
    set: (idea: TradeIdea, rec: Omit<GradeRecord, 'partnerId' | 'give' | 'get' | 'at'> | null) => void
    /** A read with your grades applied. */
    apply: (read: AcceptRead, idea: TradeIdea) => AcceptRead
  }
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

/**
 * How a trade is likely to land for you: the trade read, with your grades applied unless `graded` is false
 * (the bare read is what a new grade is measured against).
 */
export const useTradeRead = () => {
  const { analysis, models, grades } = useFantasy()
  return useCallback(
    (idea: TradeIdea, graded = true) => {
      const base = acceptRead(idea, analysis.myRosterId ?? -1, models.behavior, models.perceived, analysis.currency, models.faab)
      return graded ? grades.apply(base, idea) : base
    },
    [analysis, models, grades],
  )
}
