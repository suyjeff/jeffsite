import { describe, expect, it } from 'vitest'
import { deriveProjectionLine, roundingTolerance, scoreProjectionLine, scoreStatLine, SLEEPER_HALF_PPR, unscoredProjectionKeys } from '../scoring'

// Sleeper projection lines, week 8 of 2026, as /v1/projections/nfl/regular/2026/8 serves them (ADP keys dropped).
const AUBREY = { fga: 2.7, fgm: 2.34, fgm_20_29: 0.4, fgm_30_39: 0.51, fgm_40_49: 0.51, fgm_50p: 0.46, fgm_yds: 79.74, fgmiss_30_39: 0.04, fgmiss_40_49: 0.04, fgmiss_50p: 0.13, gp: 1, pts_half_ppr: 9.93, pts_ppr: 9.93, pts_std: 9.93, xpa: 3.12, xpm: 2.98, xpmiss: 0.14 }
const DAL = { blk_kick: 0.06, def_kr_td: 0.06, def_kr_yd: 107.95, def_pr_td: 0.06, def_pr_yd: 122.15, def_td: 0.06, ff: 0.57, fum_rec: 0.51, gp: 1, int: 0.68, pass_int_td: 0.06, pr_yd: 14.2, pts_allow: 24, pts_allow_21_27: 1, pts_half_ppr: 6.14, pts_ppr: 6.14, pts_std: 6.14, sack: 2.39, st_td: 0.06, tkl_loss: 3.86, yds_allow: 349.02, yds_allow_300_349: 1 }
const GOFF = { bonus_rush_td_qb: 0.05, cmp_pct: 65.94, fum: 0.47, fum_lost: 0.21, gp: 1, pass_2pt: 0.13, pass_att: 34.46, pass_cmp: 22.72, pass_cmp_40p: 0.47, pass_fd: 24.87, pass_inc: 11.74, pass_int: 0.55, pass_sack: 2.87, pass_td: 1.57, pass_yd: 248.68, pts_half_ppr: 16.28, pts_ppr: 16.28, pts_std: 16.28, rush_2pt: 0, rush_40p: 0.02, rush_att: 1.71, rush_fd: 0.42, rush_td: 0.05, rush_yd: 4.19 }
const MCBRIDE = { bonus_rec_te: 7.92, fum: 0.07, fum_lost: 0.03, gp: 1, pts_half_ppr: 15.36, pts_ppr: 19.32, pts_std: 11.4, rec: 7.92, rec_0_4: 1.58, rec_10_19: 2.38, rec_20_29: 1.58, rec_2pt: 0.03, rec_30_39: 0.79, rec_40p: 0.79, rec_5_9: 1.58, rec_fd: 7.01, rec_td: 0.71, rec_tgt: 9.7, rec_yd: 70.14, rush_att: 0.11, rush_fd: 0.05, rush_td: 0.01, rush_yd: 0.55 }

// The scoring both 2026 leagues use, nonzero keys only. NYC is on Sleeper's current kicking keys (fgm_50_59, fgm_60p);
// MFL still scores fgm_50p, with fgm_60p on top and fgm_50_59 at zero.
const COMMON = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
  fum_lost: -2, fum_rec_td: 6, fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_60p: 6, fgmiss: -1, xpm: 1, xpmiss: -1,
  sack: 1, int: 2, fum_rec: 2, def_td: 6, st_td: 6, def_st_td: 6, safe: 2, blk_kick: 2, def_2pt: 2, def_st_ff: 1, def_st_fum_rec: 1, st_ff: 1, st_fum_rec: 1,
  pts_allow_0: 10, pts_allow_1_6: 7, pts_allow_7_13: 4, pts_allow_14_20: 1, pts_allow_28_34: -1, pts_allow_35p: -4,
}
const NYC = { ...COMMON, fgm_50_59: 5 }
const MFL = { ...COMMON, fgm_50p: 5, fgm_50_59: 0 }

describe('projection lines in league scoring', () => {
  it('scores 50+ yard field goals for a league on the split kicking keys', () => {
    // A straight dot product loses his 0.46 projected 50-yarders: 7.61, where Sleeper reads 9.93.
    expect(scoreStatLine(AUBREY, NYC)).toBeCloseTo(7.61, 2)
    expect(deriveProjectionLine(AUBREY, NYC).fgm_50_59).toBe(0.46)
    expect(scoreProjectionLine(AUBREY, NYC)).toBeCloseTo(9.91, 2)
    expect(unscoredProjectionKeys(AUBREY, NYC)).toEqual([])
  })
  it('leaves a league that scores fgm_50p as it is', () => {
    expect(deriveProjectionLine(AUBREY, MFL).fgm_50_59).toBeUndefined()
    expect(scoreProjectionLine(AUBREY, MFL)).toBeCloseTo(9.91, 2)
  })
  it('flags a bucket the league scores in a shape nothing fills', () => {
    // A league paying only 60+ makes: the projection's 50+ bucket overlaps it, and no derivation can split it.
    expect(unscoredProjectionKeys(AUBREY, { fgm_60p: 6 })).toEqual(['fgm_50p'])
  })
  it('leaves missed kicks unscored, as Sleeper does', () => {
    // Its default settings score fgmiss at −1, yet his pts_half_ppr is his makes alone: the fgmiss_* buckets are not
    // read. Scoring them here would read lower than Sleeper.
    expect(deriveProjectionLine(AUBREY, NYC).fgmiss).toBeUndefined()
    expect(Math.abs(scoreStatLine(AUBREY, SLEEPER_HALF_PPR) - AUBREY.pts_half_ppr)).toBeLessThanOrEqual(roundingTolerance(AUBREY, SLEEPER_HALF_PPR))
  })
  it('fills a defense’s points and yards allowed bucket from the total when the line has only that', () => {
    const bare = { pts_allow: 24, yds_allow: 349.02, sack: 2 }
    const d = deriveProjectionLine(bare, NYC)
    expect(d.pts_allow_21_27).toBe(1)
    expect(d.yds_allow_300_349).toBe(1)
    expect(deriveProjectionLine({ pts_allow: 17 }, NYC).pts_allow_14_20).toBe(1)
    expect(deriveProjectionLine({ pts_allow: 0 }, NYC).pts_allow_0).toBe(1)
    expect(deriveProjectionLine({ pts_allow: 41 }, NYC).pts_allow_35p).toBe(1)
    expect(scoreProjectionLine({ pts_allow: 17, sack: 2 }, NYC)).toBe(3)
    // A line that carries its bucket keeps it.
    expect(deriveProjectionLine(DAL, NYC)).toEqual(DAL)
  })
  it('scores Sleeper’s default half-PPR to its own pts_half_ppr, to the line’s rounding', () => {
    for (const line of [AUBREY, DAL, GOFF, MCBRIDE]) {
      expect(Math.abs(scoreStatLine(line, SLEEPER_HALF_PPR) - line.pts_half_ppr)).toBeLessThanOrEqual(roundingTolerance(line, SLEEPER_HALF_PPR))
    }
  })
  it('explains every gap to Sleeper’s default by the league’s own weights', () => {
    // NYC and MFL take 2 for an interception thrown (default 1) and do not score a defense's forced fumbles (default 1).
    expect(scoreProjectionLine(GOFF, NYC) - scoreStatLine(GOFF, SLEEPER_HALF_PPR)).toBeCloseTo(-0.55, 2)
    expect(scoreProjectionLine(DAL, NYC) - scoreStatLine(DAL, SLEEPER_HALF_PPR)).toBeCloseTo(-0.57, 2)
    expect(scoreProjectionLine(MCBRIDE, NYC)).toBeCloseTo(scoreStatLine(MCBRIDE, SLEEPER_HALF_PPR), 2)
  })
})
