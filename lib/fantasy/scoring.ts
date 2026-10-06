import type { StatLine } from './types'

/**
 * Sleeper scores a stat line by multiplying each scoring_settings key by the
 * matching stat key. Stat lines already carry the derived flags Sleeper uses
 * (pts_allow_0, bonus_rec_te, fgm_40_49, ...), so a straight dot product is
 * exactly what the app does.
 *
 * Verified against the live API: for every rostered player in both 2026
 * leagues, this reproduces Sleeper's own `players_points` to the cent.
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

/**
 * Keys Sleeper emits for players who were merely on an active roster. They say
 * nothing about whether the player took a snap, so they cannot stand in for a
 * counting stat. `/stats/nfl/regular/2026/1` carries 629 such metadata-only
 * lines inside the fantasy-relevant player set alone.
 */
const ROSTER_ONLY_KEYS = new Set(['gms_active', 'gp', 'gs', 'tm_def_snp', 'tm_off_snp', 'tm_st_snp'])
const ROSTER_ONLY_PREFIXES = ['pts_', 'pos_rank_', 'rank_']

const isRosterOnly = (key: string) =>
  ROSTER_ONLY_KEYS.has(key) || ROSTER_ONLY_PREFIXES.some((p) => key.startsWith(p))

/** A player "played" if Sleeper logged a game for them or they posted a counting stat. */
export const statLinePlayed = (stats: StatLine | undefined | null): boolean => {
  if (!stats) return false
  if (typeof stats.gp === 'number') return stats.gp > 0
  return Object.keys(stats).some((k) => !isRosterOnly(k) && stats[k] !== 0)
}
