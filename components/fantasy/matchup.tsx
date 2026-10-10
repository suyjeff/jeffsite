import React, { useMemo } from 'react'
import type { Slate, SlateMatchup, SlatePlayer, SlateSide } from '../../lib/fantasy/slate'
import { useFantasy } from './FantasyContext'
import PlayerName from './PlayerName'
import TeamName from './TeamName'
import { BOX_LINE, Pts, ScoreState, WeekScore, WinBar, cx, fmt, fmtSigned, pct, type PtsKind } from './ui'
import { useSlate } from './useSlate'
import { boxScore, useWeekNow, type WeekNow } from './useWeekNow'

// The pieces every matchup view shares: the Matchups page, its sheet, and your matchup on Gameday.

/** One player's score as it stands: final, live, or projected; a starter with no game this week scores nothing. */
export const scoreOf = (p: SlatePlayer | undefined, proj: number): { value: number; kind: PtsKind; expect: number; proj: number } =>
  !p
    ? { value: 0, kind: 'final', expect: 0, proj: 0 }
    : p.actual != null
      ? { value: p.actual, kind: 'final', expect: p.actual, proj: p.proj }
      : p.live != null
        ? { value: p.live, kind: 'live', expect: p.live + 0.5 * p.proj, proj: p.proj }
        : { value: p.proj, kind: 'proj', expect: p.proj, proj: p.proj }

/** A side's starters by where their games stand: over, under way, still to come. Starters on a bye count in none. */
export type SideCount = { final: number; live: number; left: number }

/**
 * A side's score: final once every starter's game is; live while one of them is playing; between games, what it
 * has banked; projected before the week starts.
 */
export const sideKind = (c: SideCount, started: boolean): PtsKind =>
  !started ? 'proj' : c.live === 0 && c.left === 0 ? 'final' : c.live > 0 ? 'live' : 'banked'

/** "3 final · 1 live · 5 to play": a side's week in its starters, the parts that are not zero. */
export const countLine = (c: SideCount) =>
  [c.final && `${c.final} final`, c.live && `${c.live} live`, `${c.left} to play`].filter(Boolean).join(' · ')

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
  /** Each side's starters: games over, under way, still to come. */
  countA: SideCount
  countB: SideCount
  /** The week as played: game clocks and box scores. */
  now: WeekNow
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
  const now = useWeekNow(slate, proj)
  const read = useMemo(() => {
    const count = (rid: number): SideCount => {
      const c = { final: 0, live: 0, left: 0 }
      for (const id of lineupOf(rid)) {
        const st = id && id !== '0' ? slate.teamState[data.players[id]?.team ?? ''] : undefined
        if (st === 'final') c.final++
        else if (st === 'live') c.live++
        else if (st === 'pre') c.left++
      }
      return c
    }
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
      const countA = count(a.rosterId)
      const countB = count(b.rosterId)
      return {
        week,
        match,
        a,
        b,
        p,
        started,
        kindA: sideKind(countA, started),
        kindB: sideKind(countB, started),
        countA,
        countB,
        now,
        rows,
        deciders,
        close: Math.abs(a.mu - b.mu) < Math.max(8, Math.sqrt(a.sd ** 2 + b.sd ** 2) * 0.5),
      }
    }
  }, [slate, lineupOf, analysis.slots, proj, week, started, data.players, now])
  return { slate: slate as Slate, live, week, read, started, proj, totals, now }
}

/** The win-odds bar between two sides (ui WinBar). */
export const OddsBar = WinBar

/** A matchup's headline: both managers, their scores as they stand, where each is heading, and the odds. */
export const MatchupScore = ({ m, size = 'lg' }: { m: MatchupRead; size?: 'lg' | 'md' }) => {
  const { analysis } = useFantasy()
  const record = (id: number) => {
    const s = analysis.seasonById[id]
    return s ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}` : ''
  }
  const big = size === 'lg' ? 'text-[34px] sm:text-[42px]' : 'text-[28px]'
  const side = (s: SlateSide, kind: PtsKind, align: 'left' | 'right', c: SideCount) => (
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
            <span className={size === 'lg' ? 'hidden sm:inline' : 'hidden'}>heading for </span>
            <span className={size === 'lg' ? 'sm:hidden' : undefined}>→ </span>
            <Pts value={s.mu} kind="proj" />
            {/* The rest of the line is banked against still to come, in starters. */}
            <span className={cx('mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 max-sm:gap-x-2.5', align === 'right' && 'justify-end')}>
              {(['final', 'live'] as const).map((k) =>
                c[k] > 0 ? (
                  <React.Fragment key={k}>
                    <span className="inline-flex items-center gap-1">
                      <span className="num text-ff-text2">{c[k]}</span>
                      <ScoreState kind={k} />
                    </span>
                    <span aria-hidden className="max-sm:hidden">
                      ·
                    </span>
                  </React.Fragment>
                ) : null,
              )}
              <span>
                <span className="num text-ff-text2">{c.left}</span> to play
              </span>
            </span>
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
        {side(m.a, m.kindA, 'left', m.countA)}
        <span className={cx('font-mono text-[11px] text-ff-muted', size === 'lg' ? 'pt-12' : 'pt-10')}>vs</span>
        {side(m.b, m.kindB, 'right', m.countB)}
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

// Each side of a slot gets under a third of a phone's width: drop the portrait and let the name take two lines rather than cut it to a few letters.
const phoneName = 'max-md:[&_.ff-pn-av]:!hidden max-md:[&_.ff-pn-name]:overflow-visible max-md:[&_.ff-pn-name]:whitespace-normal max-md:[&_.ff-pn-name]:[text-overflow:clip]'

/** Every slot against its opposite, with the edge between them. */
export const SlotTable = ({ m, compact, inset }: { m: MatchupRead; compact?: boolean; inset?: 'sheet' }) => {
  const { data, openPlayer } = useFantasy()
  const maxEdge = Math.max(4, ...m.rows.map((r) => Math.abs(r.edge)))
  // Once his game has started, his line under his name: its state, then his box score.
  const played = (id: string, align: 'left' | 'right') => {
    const w = m.now.of(id)
    if (!w || w.kind === 'proj') return null
    const box = boxScore(w.line, data.players[id]?.pos ?? '').join(' · ')
    // Under the name, on its edge past the portrait; a phone drops the portrait and lets the line wrap.
    return (
      <span
        title={box || undefined}
        className={cx(
          'mt-0.5 block md:truncate',
          BOX_LINE,
          align === 'right' ? (compact ? 'md:pr-[28px]' : 'md:pr-[32px]') : compact ? 'md:pl-[28px]' : 'md:pl-[32px]',
        )}
      >
        <ScoreState kind={w.kind} clock={w.clock} className="mr-1 align-[1px]" />
        {box || (m.now.hasLines && w.kind === 'final' ? 'no stats' : '')}
      </span>
    )
  }
  // Each player is a cell of his own: it lights on hover, wherever the pointer is on it, and a click anywhere on it opens him.
  const name = (id: string | null, align: 'left' | 'right') =>
    id ? (
      <span className={cx('ff-pn-host relative -mx-1.5 flex min-w-0 flex-col justify-center self-stretch px-1.5 py-1.5 transition-colors hover:bg-ff-raised/60', align === 'right' && 'items-end text-right')}>
        <button type="button" tabIndex={-1} aria-hidden onClick={() => openPlayer(id)} className="absolute inset-0 cursor-pointer" />
        <PlayerName player={data.players[id]} id={id} size={compact ? 20 : 24} className={cx(phoneName, 'max-w-full', align === 'right' && 'flex-row-reverse text-right')} />
        {played(id, align)}
      </span>
    ) : (
      <span className="py-1.5 text-[12px] text-ff-neg">empty</span>
    )
  return (
    <ul>
      {m.rows.map((r, i) => (
        <li key={i} className={cx('grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 border-b border-ff-line/60 last:border-0', inset === 'sheet' ? 'px-4' : 'px-3')}>
          <span className="flex min-w-0 items-stretch">{name(r.a, 'left')}</span>
          <span className="flex w-[104px] flex-col items-center justify-center gap-0.5" title={`Edge ${fmtSigned(r.edge)}: expected points, left minus right`}>
            <span className="flex w-full items-baseline justify-between text-[12.5px]">
              <span>{r.sa ? <Pts value={r.sa.value} kind={r.sa.kind} className={r.sa.kind !== 'proj' ? 'font-medium' : undefined} /> : '–'}</span>
              <span className="font-mono text-[9.5px] text-ff-muted">{r.slot}</span>
              <span>{r.sb ? <Pts value={r.sb.value} kind={r.sb.kind} className={r.sb.kind !== 'proj' ? 'font-medium' : undefined} /> : '–'}</span>
            </span>
            <span className="relative block h-1 w-full bg-ff-sunken" aria-hidden>
              <span className="absolute inset-y-0 left-1/2 w-px bg-ff-line2" />
              {/* The bar grows toward the side that is ahead, as a tug of war: green pulls toward the left side, red away from it. */}
              <span
                className={cx('absolute inset-y-0', r.edge >= 0 ? 'right-1/2 bg-ff-pos' : 'left-1/2 bg-ff-neg')}
                style={{ width: `${(Math.min(Math.abs(r.edge), maxEdge) / maxEdge) * 50}%` }}
              />
            </span>
          </span>
          <span className="flex min-w-0 items-stretch justify-end">{name(r.b, 'right')}</span>
        </li>
      ))}
    </ul>
  )
}

/** The players still to play who move the odds most, each with whose he is and his range. */
export const Deciders = ({ m, limit = 6, inset }: { m: MatchupRead; limit?: number; inset?: 'sheet' }) => {
  const { data } = useFantasy()
  const xs = m.deciders.slice(0, limit)
  const px = inset === 'sheet' ? 'px-4' : 'px-3'
  if (!xs.length) return <p className={cx(px, 'py-3 text-[12px] text-ff-muted')}>Every starter&apos;s game is final.</p>
  return (
    <ul>
      {xs.map((x) => (
        <li key={x.id} className={cx('flex items-center gap-2 border-b border-ff-line/60 py-1.5 last:border-0', px)}>
          <span className="min-w-0 flex-1">
            <PlayerName player={data.players[x.id]} id={x.id} size={22} sub={<TeamName id={x.owner} avatar={false} plain className="text-[11px]" />} />
          </span>
          <span className="text-right text-[11.5px] leading-tight">
            {x.live != null && m.now.of(x.id) ? (
              <WeekScore s={m.now.of(x.id)!} short />
            ) : (
              <>
                <Pts value={x.proj} kind="proj" />
                <span className="block font-mono text-[10px] text-ff-muted">
                  {fmt(x.low, 0)}–{fmt(x.high, 0)}
                </span>
              </>
            )}
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
