import React from 'react'
import type { SlatePlayer } from '../../lib/fantasy/slate'
import TeamName from './TeamName'
import { cx, pct } from './ui'

// Pieces Gameday's views and the NFL game sheet share.

/** Win-odds points, signed: "+12". */
export const pts = (x: number, signed = false) => `${signed && x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(0)}`
export const DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
export const dayOf = (date: string | null) => (date ? DAY.format(new Date(`${date}T12:00:00Z`)) : 'TBD')
export const odds = (p: number) => (p >= 0.995 ? '>99%' : p <= 0.005 ? '<1%' : pct(p))

/** A player's game as a band: 20th to 80th percentile, his projection as a tick, and what he scored once it is final. */
export const RangeBar = ({ p, max }: { p: SlatePlayer; max: number }) => {
  const x = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  const tone = p.actual == null ? '' : p.actual >= p.proj ? 'bg-ff-pos' : 'bg-ff-neg'
  return (
    <span className="relative block h-3 w-full min-w-[48px] max-w-[140px]" aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px bg-ff-line" />
      <span className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-ff-accent/25" style={{ left: x(p.low), width: `calc(${x(p.high)} - ${x(p.low)})` }} />
      <span className="absolute top-0 h-3 w-px bg-ff-text2" style={{ left: x(p.proj) }} />
      {p.actual != null && <span className={cx('absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2', tone)} style={{ left: x(p.actual) }} />}
    </span>
  )
}

/** A manager as a compact tag: the app's one team name. Your opponent reads in the negative tone. */
export const ManagerTag = ({ id, opp, avatar }: { id: number; me?: number | null; opp?: number | null; avatar?: boolean }) =>
  id === opp ? (
    <span className="inline-flex min-w-0 items-center [&_.truncate]:text-ff-neg">
      <TeamName id={id} avatar={!!avatar} size={16} />
    </span>
  ) : (
    <TeamName id={id} avatar={!!avatar} size={16} />
  )
