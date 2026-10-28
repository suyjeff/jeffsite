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

// ---------- Projection lines ----------
//
// Sleeper's projection lines carry less detail than its stat lines, and sometimes the older shape of a key. Scored
// with a straight dot product against a league's settings, a few of what the league scores would come out zero though
// the projection does carry them in another form. Measured over every projection line of 2026 weeks 1–8 against both
// leagues' settings:
//
//   fgm_50p          Projections count 50+ yard field goals as one bucket. A league on Sleeper's current kicking
//                    settings (fgm_50_59 and fgm_60p, no fgm_50p) would score them at nothing: Brandon Aubrey,
//                    week 8, 7.61 instead of 9.93. They are scored as fgm_50_59, the only 50+ bucket a projection can
//                    fill (60-yarders are a few percent of 50+ makes, and Sleeper's own projected points pay them as
//                    the 50+ bucket).
//   pts_allow_*,     Defense lines carry the bucket their projected points or yards allowed fall in. A line with only
//   yds_allow_*      the total gets its bucket from it.
//
// Left as Sleeper scores them, on purpose:
//
//   fgmiss           Projections carry missed field goals only as distance buckets (fgmiss_30_39, ...), and
//                    Sleeper's projected points do not count them: its default half-PPR settings score fgmiss at −1,
//                    yet pts_half_ppr on every projected kicker equals his makes alone (to the line's rounding). The
//                    misses stay unscored so a projection here reads what it reads in Sleeper.
//   bonus_*          Yardage and reception bonuses are thresholds on a single game; a projection's means cannot say
//                    whether they are crossed, and Sleeper does not project them.

/** Points-allowed buckets, as Sleeper names them, by their upper bound. */
const PTS_ALLOW: [string, number][] = [
  ['pts_allow_0', 0],
  ['pts_allow_1_6', 6],
  ['pts_allow_7_13', 13],
  ['pts_allow_14_20', 20],
  ['pts_allow_21_27', 27],
  ['pts_allow_28_34', 34],
  ['pts_allow_35p', Infinity],
]
const YDS_ALLOW: [string, number][] = [
  ['yds_allow_0_100', 99],
  ['yds_allow_100_199', 199],
  ['yds_allow_200_299', 299],
  ['yds_allow_300_349', 349],
  ['yds_allow_350_399', 399],
  ['yds_allow_400_449', 449],
  ['yds_allow_450_499', 499],
  ['yds_allow_500_549', 549],
  ['yds_allow_550p', Infinity],
]
const bucket = (table: [string, number][], v: number) => table.find(([, hi]) => Math.round(v) <= hi)![0]

/**
 * A projection line in the shape a league's settings read: the keys the league scores that the line carries in
 * another form, filled from it (see above). Keys the line already has are never touched.
 */
export const deriveProjectionLine = (line: StatLine, scoring: Record<string, number>): StatLine => {
  const out: StatLine = { ...line }
  if (out.fgm_50p != null && out.fgm_50_59 == null && out.fgm_60p == null && !scoring.fgm_50p && scoring.fgm_50_59) out.fgm_50_59 = out.fgm_50p
  if (out.pts_allow != null && !PTS_ALLOW.some(([k]) => out[k] != null)) out[bucket(PTS_ALLOW, out.pts_allow)] = 1
  if (out.yds_allow != null && !YDS_ALLOW.some(([k]) => out[k] != null)) out[bucket(YDS_ALLOW, out.yds_allow)] = 1
  return out
}

/** A Sleeper projection line in a league's scoring: derived to the league's keys, then scored like any stat line. */
export const scoreProjectionLine = (line: StatLine | undefined | null, scoring: Record<string, number>) =>
  line ? scoreStatLine(deriveProjectionLine(line, scoring), scoring) : 0

/** A bucketed key's family and range: "fgm_50p" → fgm, 50 to ∞; "fgm_50_59" → fgm, 50 to 59. Null if not bucketed. */
const rangeOf = (k: string): { family: string; lo: number; hi: number } | null => {
  const m = /^(.*)_(\d+)(?:_(\d+)|p)$/.exec(k)
  return m ? { family: m[1], lo: Number(m[2]), hi: m[3] != null ? Number(m[3]) : Infinity } : null
}

/**
 * League-scored keys a projection line carries in another form that the derivation did not fill: should be empty for
 * every line. Two ways a key goes missing are checked. A bucket the line carries but the league does not score
 * (fgm_50p) overlapping one the league does (fgm_50_59, fgm_60p) that the derived line still lacks; and a total
 * (pts_allow, yds_allow) whose buckets the league scores with none of them on the line. Keys left unscored on
 * purpose, as Sleeper leaves them (fgmiss from its buckets, bonuses: see above), are not listed.
 */
export const unscoredProjectionKeys = (line: StatLine, scoring: Record<string, number>): string[] => {
  const d = deriveProjectionLine(line, scoring)
  const out: string[] = []
  const scoredKeys = Object.keys(scoring).filter((k) => scoring[k])
  for (const k of Object.keys(line)) {
    if (!line[k] || scoring[k]) continue
    const r = rangeOf(k)
    if (!r) continue
    // The league's buckets this one overlaps: it is covered if any of them was filled.
    const overlapping = scoredKeys.filter((j) => {
      const q = rangeOf(j)
      return !!q && q.family === r.family && q.lo <= r.hi && r.lo <= q.hi
    })
    if (overlapping.length && !overlapping.some((j) => d[j] != null)) out.push(k)
  }
  if (d.pts_allow != null && PTS_ALLOW.some(([k]) => scoring[k]) && !PTS_ALLOW.some(([k]) => d[k] != null)) out.push('pts_allow')
  if (d.yds_allow != null && YDS_ALLOW.some(([k]) => scoring[k]) && !YDS_ALLOW.some(([k]) => d[k] != null)) out.push('yds_allow')
  return out
}

/** Sleeper's default half-PPR settings, as its projected pts_half_ppr reads them (checked line by line, weeks 1–8). */
export const SLEEPER_HALF_PPR: Record<string, number> = {
  pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2,
  rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
  rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2,
  fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, xpm: 1, xpmiss: -1, fgmiss: -1,
  sack: 1, int: 2, fum_rec: 2, def_td: 6, st_td: 6, safe: 2, blk_kick: 2, ff: 1,
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_21_27: 0, pts_allow_28_34: -1, pts_allow_35p: -4,
}

/** How far a score of a published line can sit from Sleeper's own: each stat is rounded to 0.01 in the line. */
export const roundingTolerance = (line: StatLine, scoring: Record<string, number>) =>
  0.005 + Object.keys(line).reduce((a, k) => a + Math.abs(scoring[k] ?? 0) * 0.005, 0)
