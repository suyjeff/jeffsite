import React, { useMemo } from 'react'
import type { Slate, SlateMatchup, SlatePlayer, SlateSide } from '../../lib/fantasy/slate'
import { useFantasy } from './FantasyContext'
import PlayerName from './PlayerName'
import TeamName from './TeamName'
import { Pts, cx, fmt, fmtSigned, pct, type PtsKind } from './ui'
import { useSlate } from './useSlate'

// The pieces every matchup view shares: the Matchups page, its sheet, and your matchup on Gameday.

/** One player's score as it stands: final, live, or projected; a starter with no game this week scores nothing. */
export const scoreOf = (p: SlatePlayer | undefined, proj: number): { value: number; kind: PtsKind; expect: number } =>
  !p
    ? { value: 0, kind: 'final', expect: 0 }
    : p.actual != null
      ? { value: p.actual, kind: 'final', expect: p.actual }
      : p.live != null
        ? { value: p.live, kind: 'live', expect: p.live + 0.5 * p.proj }
        : { value: p.proj, kind: 'proj', expect: p.proj }

/** A side's score: final once every starter's game is, live once the week is under way, projected before. */
export const sideKind = (unfinished: number, started: boolean): PtsKind => (unfinished === 0 ? 'final' : started ? 'live' : 'proj')

export type SlotRow = { slot: string; a: string | null; b: string | null; sa: ReturnType<typeof scoreOf> | null; sb: ReturnType<typeof scoreOf> | null; edge: number }

/** A matchup read for display: both sides, their score kinds, slot by slot, and the players still to decide it. */
export type MatchupRead = {
  week: number
  match: SlateMatchup
  /** Ordered as asked: `a` is the side asked for first (you, on your matchup). */
  a: SlateSide
  b: SlateSide
  /** P(a wins). */
  p: number
  started: boolean
  kindA: PtsKind
  kindB: PtsKind
  rows: SlotRow[]
  deciders: SlatePlayer[]
  /** How far apart, in points expected at the end: under a game's spread, it is close. */
  close: boolean
}

/** Every matchup this week, read for display, from the shared slate. */
export const useMatchups = () => {
  const { data, analysis } = useFantasy()
  const { slate, live, week, proj, totals } = useSlate(data, analysis)
  const raw = data.matchupsByWeek[week] ?? []
  const lineupOf = useMemo(
    () => (rid: number) => {
      const set = raw.find((m) => m.roster_id === rid)?.starters
      return set?.length ? set : (analysis.needs[rid]?.slots.map((x) => x.starter ?? '0') ?? [])
    },
    [raw, analysis.needs],
  )
  const started = slate.games.some((g) => g.final || g.live)
  const read = useMemo(() => {
    const unfinished = (rid: number) => lineupOf(rid).filter((id) => id && id !== '0' && (slate.teamState[data.players[id]?.team ?? ''] ?? 'final') !== 'final').length
    return (aId: number, bId: number): MatchupRead | null => {
      const match = slate.matchups.find((m) => (m.a.rosterId === aId && m.b.rosterId === bId) || (m.a.rosterId === bId && m.b.rosterId === aId))
      if (!match) return null
      const flip = match.a.rosterId !== aId
      const a = flip ? match.b : match.a
      const b = flip ? match.a : match.b
      const la = lineupOf(a.rosterId)
      const lb = lineupOf(b.rosterId)
      const rows = analysis.slots.map((slot, i) => {
        const ia = la[i] && la[i] !== '0' ? la[i] : null
        const ib = lb[i] && lb[i] !== '0' ? lb[i] : null
        const sa = ia ? scoreOf(slate.byId[ia], proj[ia] ?? 0) : null
        const sb = ib ? scoreOf(slate.byId[ib], proj[ib] ?? 0) : null
        return { slot: slot.name.replace('SUPER_FLEX', 'SF'), a: ia, b: ib, sa, sb, edge: (sa?.expect ?? 0) - (sb?.expect ?? 0) }
      })
      const deciders = [...a.starters, ...b.starters]
        .map((id) => slate.byId[id])
        .filter((x): x is SlatePlayer => !!x && x.actual == null)
        .sort((x, y) => y.swing - x.swing)
      const p = flip ? 1 - match.pA : match.pA
      return {
        week,
        match,
        a,
        b,
        p,
        started,
        kindA: sideKind(unfinished(a.rosterId), started),
        kindB: sideKind(unfinished(b.rosterId), started),
        rows,
        deciders,
        close: Math.abs(a.mu - b.mu) < Math.max(8, Math.sqrt(a.sd ** 2 + b.sd ** 2) * 0.5),
      }
    }
  }, [slate, lineupOf, analysis.slots, proj, week, started, data.players])
  return { slate: slate as Slate, live, week, read, started, proj, totals }
}

/** The win-odds bar between two sides. */
export const OddsBar = ({ p, height = 'h-1.5' }: { p: number; height?: string }) => (
  <span className={cx('flex flex-1 gap-px', height)} role="img" aria-label={`Win odds ${pct(p)} to ${pct(1 - p)}`}>
    <span className="h-full bg-ff-s1 transition-[flex-basis] duration-300" style={{ flexBasis: `${p * 100}%` }} />
    <span className="h-full flex-1 bg-ff-s2" />
  </span>
)

/** A matchup's headline: both managers, their scores as they stand, where each is heading, and the odds. */
export const MatchupScore = ({ m, size = 'lg' }: { m: MatchupRead; size?: 'lg' | 'md' }) => {
  const { analysis } = useFantasy()
  const record = (id: number) => {
    const s = analysis.seasonById[id]
    return s ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}` : ''
  }
  const big = size === 'lg' ? 'text-[34px] sm:text-[42px]' : 'text-[28px]'
  const side = (s: SlateSide, kind: PtsKind, align: 'left' | 'right') => (
    <div className={cx('min-w-0', align === 'right' && 'text-right')}>
      <div className={cx('flex min-w-0', align === 'right' && 'justify-end')}>
        <TeamName id={s.rosterId} size={size === 'lg' ? 28 : 24} sub={record(s.rosterId)} reverse={align === 'right'} className="text-[14px] font-medium" />
      </div>
      <div className={cx('mt-2 font-medium leading-none tracking-[-0.03em]', big)}>
        <Pts value={m.started ? s.banked : s.mu} kind={m.started ? kind : 'proj'} />
      </div>
      <div className="mt-1 font-mono text-[11px] text-ff-muted">
        {m.started ? (
          <>
            {size === 'lg' ? 'heading for ' : '→ '}
            <Pts value={s.mu} kind="proj" /> · {s.left} {size === 'lg' ? 'to play' : 'left'}
          </>
        ) : (
          'projected'
        )}
      </div>
    </div>
  )
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 sm:gap-6">
        {side(m.a, m.kindA, 'left')}
        <span className={cx('font-mono text-[11px] text-ff-muted', size === 'lg' ? 'pt-12' : 'pt-10')}>vs</span>
        {side(m.b, m.kindB, 'right')}
      </div>
      <div className="mt-4 flex items-center gap-2" title={`Win odds ${pct(m.p)} – ${pct(1 - m.p)}`}>
        <span className="num w-10 text-[13px] font-medium text-ff-text">{pct(m.p)}</span>
        <OddsBar p={m.p} height="h-2" />
        <span className="num w-10 text-right text-[13px] font-medium text-ff-text">{pct(1 - m.p)}</span>
      </div>
      <div className="mt-1 text-center text-[11.5px] text-ff-text2">
        {m.close ? <span className="text-ff-warn">Close: </span> : null}
        win odds{m.started ? ', as the week stands' : ''} · margin {fmtSigned(m.a.mu - m.b.mu)} expected
      </div>
    </div>
  )
}

/** Every slot against its opposite, with the edge between them. */
export const SlotTable = ({ m, compact }: { m: MatchupRead; compact?: boolean }) => {
  const { data } = useFantasy()
  const maxEdge = Math.max(4, ...m.rows.map((r) => Math.abs(r.edge)))
  const name = (id: string | null, align: 'left' | 'right') =>
    id ? <PlayerName player={data.players[id]} id={id} size={compact ? 20 : 24} className={align === 'right' ? 'flex-row-reverse text-right' : undefined} /> : <span className="text-[12px] text-ff-neg">empty</span>
  return (
    <ul>
      {m.rows.map((r, i) => (
        <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-ff-line/60 px-3 py-1.5 last:border-0">
          <span className="min-w-0">{name(r.a, 'left')}</span>
          <span className="flex w-[104px] flex-col items-center gap-0.5" title={`Edge ${fmtSigned(r.edge)}: expected points, left minus right`}>
            <span className="flex w-full items-baseline justify-between text-[12.5px]">
              <span>{r.sa ? <Pts value={r.sa.value} kind={r.sa.kind} /> : '–'}</span>
              <span className="font-mono text-[9.5px] text-ff-muted">{r.slot}</span>
              <span>{r.sb ? <Pts value={r.sb.value} kind={r.sb.kind} /> : '–'}</span>
            </span>
            <span className="relative block h-1 w-full bg-ff-sunken" aria-hidden>
              <span className="absolute inset-y-0 left-1/2 w-px bg-ff-line2" />
              <span className={cx('absolute inset-y-0', r.edge >= 0 ? 'left-1/2 bg-ff-pos' : 'right-1/2 bg-ff-neg')} style={{ width: `${(Math.min(Math.abs(r.edge), maxEdge) / maxEdge) * 50}%` }} />
            </span>
          </span>
          <span className="flex min-w-0 justify-end">{name(r.b, 'right')}</span>
        </li>
      ))}
    </ul>
  )
}

/** The players still to play who move the odds most, each with whose he is and his range. */
export const Deciders = ({ m, limit = 6 }: { m: MatchupRead; limit?: number }) => {
  const { data } = useFantasy()
  const xs = m.deciders.slice(0, limit)
  if (!xs.length) return <p className="px-3 py-3 text-[12px] text-ff-muted">Every starter&apos;s game is final.</p>
  return (
    <ul>
      {xs.map((x) => (
        <li key={x.id} className="flex items-center gap-2 border-b border-ff-line/60 px-3 py-1.5 last:border-0">
          <span className="min-w-0 flex-1">
            <PlayerName player={data.players[x.id]} id={x.id} size={22} sub={<TeamName id={x.owner} avatar={false} plain className="text-[11px]" />} />
          </span>
          <span className="text-right text-[11.5px] leading-tight">
            <Pts value={x.live ?? x.proj} kind={x.live != null ? 'live' : 'proj'} />
            <span className="block font-mono text-[10px] text-ff-muted">
              {fmt(x.low, 0)}–{fmt(x.high, 0)}
            </span>
          </span>
          <span className="num w-10 text-right text-[12.5px] text-ff-text" title="Win odds his game moves, a bad game against a good one">
            ±{((x.swing / 2) * 100).toFixed(0)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** One sentence on what decides a matchup now: the biggest swing still to play on each side. */
export const decidedBy = (m: MatchupRead, name: (id: string) => string) => {
  const top = m.deciders[0]
  if (!top) return m.started ? 'All games final.' : null
  const other = m.deciders.find((x) => x.owner !== top.owner)
  return `${name(top.id)} (±${((top.swing / 2) * 100).toFixed(0)})${other ? ` and ${name(other.id)} (±${((other.swing / 2) * 100).toFixed(0)})` : ''}`
}
