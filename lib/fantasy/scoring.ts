import type { StatLine } from './types'

/**
 * Sleeper scores a stat line by multiplying each scoring_settings key by the
 * matching stat key. Stat lines already carry the derived flags Sleeper uses
 * (pts_allow_0, bonus_rec_te, fgm_40_49, ...), so a straight dot product is
 * exactly what the app does.
 */
export const scoreStatLine = (
  stats: StatLine | undefined | null,
  scoring: Record<string, number>,
): number => {
  if (!stats) return 0
  let total = 0
  for (const key of Object.keys(scoring)) {
    const weight = scoring[key]
    const value = stats[key]
    if (!weight || !value) continue
    total += weight * value
  }
  return Math.round(total * 100) / 100
}

/** A player "played" if Sleeper logged a game for them or they posted any counting stat. */
export const statLinePlayed = (stats: StatLine | undefined | null): boolean => {
  if (!stats) return false
  if (typeof stats.gp === 'number') return stats.gp > 0
  return Object.keys(stats).some((k) => !k.startsWith('pts_') && stats[k] !== 0)
}
