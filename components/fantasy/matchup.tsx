import React, { useMemo } from 'react'
import type { Slate, SlateGame, SlateMatchup, SlatePlayer, SlateSide } from '../../lib/fantasy/slate'
import { benchIds } from '../../lib/fantasy/roster'
import { useFantasy } from './FantasyContext'
import PlayerName from './PlayerName'
import TeamName from './TeamName'
import { dayOf } from './slateBits'
import { BOX_LINE, Pts, ScoreState, WeekScore, WinBar, cx, fmt, fmtSigned, pct, usePhone, type PtsKind } from './ui'
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
        ? { value: p.live, kind: 'live', expect: p.expect, proj: p.proj }
        : { value: p.proj, kind: 'proj', expect: p.proj, proj: p.proj }

/** A side's starters by where their games stand: over, under way, still to come. Starters on a bye or ruled out count in none. */
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
  /** A team's game this week, for its opponent and kickoff day (none on a bye). */
  gameOf: (team: string) => SlateGame | undefined
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
    const gameOf = (team: string) => slate.games.find((g) => g.home === team || g.away === team)
    const count = (rid: number): SideCount => {
      const c = { final: 0, live: 0, left: 0 }
      for (const id of lineupOf(rid)) {
        const st = id && id !== '0' ? slate.teamState[data.players[id]?.team ?? ''] : undefined
        if (st === 'final') c.final++
        else if (st === 'live') c.live++
        // Still to play only if he is expected to: a starter ruled out (projected at nothing) has no game coming.
        else if (st === 'pre' && (slate.byId[id]?.proj ?? proj[id] ?? 0) > 0) c.left++
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
        gameOf,
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

/** What a matchup's headline reads: a full MatchupRead has it, and so can a forecast for a week not yet on the slate. */
export type MatchupHead = Pick<MatchupRead, 'a' | 'b' | 'p' | 'started' | 'kindA' | 'kindB' | 'countA' | 'countB' | 'close'>

/** A matchup's headline: both managers, their scores as they stand, where each is heading, and the odds. */
export const MatchupScore = ({ m, size = 'lg' }: { m: MatchupHead; size?: 'lg' | 'md' }) => {
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

/** How a lineup is drawn: `full` on the Matchups page, `sheet` in the matchup sheet, `dense` in the dashboard widget. Phones always take the narrow form. */
export type DuelVariant = 'full' | 'sheet' | 'dense'

/** What the slot rows need; `now` and `gameOf` are missing for a week that is not on the slate yet, which is all projections. */
export type SlotSource = Pick<MatchupRead, 'rows'> & Partial<Pick<MatchupRead, 'now' | 'gameOf'>>

/**
 * Every slot against its opposite, QB against QB: each starter with his game (opponent and day, then the score as
 * it stands or his projection), the two scores meeting at the centre over a bar that grows toward the side ahead in
 * that slot. A starter in a live game is lit; box lines show wide, and fold away on a phone, where a name opens him.
 */
export const SlotTable = ({ m, variant = 'full', empty }: { m: SlotSource; variant?: DuelVariant; empty?: (i: number, side: 'a' | 'b') => React.ReactNode }) => {
  const { data, openPlayer } = useFantasy()
  const phone = usePhone()
  // Wide: each score carries its game line (state, delta or heading) and the name its box score. Narrow: the score
  // with a state tag under it, no portrait where two names must share a few hundred pixels.
  const rich = !phone && variant !== 'dense'
  const box = !phone && variant === 'full'
  const portrait = !phone && variant !== 'dense'
  const scoreW = rich ? (variant === 'full' ? 'w-[100px]' : 'w-[76px]') : 'w-[44px]'
  const pad = variant === 'sheet' ? 'px-4' : variant === 'dense' ? 'px-2' : 'px-3'
  const maxEdge = Math.max(4, ...m.rows.map((r) => Math.abs(r.edge)))

  // His box score under his name once his game has started.
  const played = (id: string, align: 'left' | 'right') => {
    const w = m.now?.of(id)
    if (!box || !m.now || !w || w.kind === 'proj') return null
    const line = boxScore(w.line, data.players[id]?.pos ?? '').join(' · ') || (m.now.hasLines && w.kind === 'final' ? 'no stats' : '')
    if (!line) return null
    return (
      <span title={line} className={cx('mt-0.5 block truncate', BOX_LINE, align === 'right' ? 'pr-[40px]' : 'pl-[40px]')}>
        {line}
      </span>
    )
  }
  // Each player is a cell of his own: it lights on hover, wherever the pointer is on it, and a click anywhere on it opens him.
  const name = (id: string | null, i: number, align: 'left' | 'right') => {
    if (!id) return <span className="flex items-center py-2 text-[12px] text-ff-neg">{empty?.(i, align === 'left' ? 'a' : 'b') ?? 'empty'}</span>
    const p = data.players[id]
    const w = m.now?.of(id)
    const g = p?.team ? m.gameOf?.(p.team) : undefined
    // His game: against whom, and which day while it is still to come.
    const sub = [w?.game ? `${w.game.home ? 'vs' : '@'} ${w.game.opp}` : m.now ? 'bye' : null, g && !g.final && !g.live ? dayOf(g.date).split(',')[0] : null].filter(Boolean).join(' · ')
    return (
      <span
        className={cx(
          'ff-pn-host relative -mx-1.5 flex min-w-0 flex-1 flex-col justify-center self-stretch px-1.5 transition-colors',
          variant === 'dense' ? 'py-1' : 'py-1.5',
          'hover:bg-ff-raised/60',
          align === 'right' && 'items-end text-right',
          w?.kind === 'live' && 'bg-ff-pos/[0.06]',
        )}
      >
        <button type="button" tabIndex={-1} aria-hidden onClick={() => openPlayer(id)} className="absolute inset-0 cursor-pointer" />
        <PlayerName
          player={p}
          id={id}
          size={variant === 'full' ? 32 : 22}
          sub={sub || undefined}
          className={cx('max-w-full', !portrait && '[&_.ff-pn-av]:!hidden', align === 'right' && 'flex-row-reverse text-right')}
        />
        {played(id, align)}
      </span>
    )
  }
  const score = (id: string | null, sc: SlotRow['sa'], align: 'left' | 'right') => {
    if (!id || !sc) return <span className="num text-[12.5px] text-ff-muted">–</span>
    const w = m.now?.of(id)
    if (m.now && !w) return <span className="font-mono text-[10px] text-ff-muted">bye</span>
    if (rich && w) return <WeekScore s={w} short={variant !== 'full'} align={align} className="text-[14px]" />
    return (
      <span className={cx('inline-flex flex-col leading-tight', align === 'right' ? 'items-end' : 'items-start')}>
        <Pts value={sc.value} kind={sc.kind} quiet className={cx('text-[13px]', sc.kind !== 'proj' && 'font-medium')} />
        {/* The dashboard folds FINAL away: solid ink says it, and only a game on keeps its tag. */}
        {w && (variant !== 'dense' || sc.kind === 'live') && <ScoreState kind={sc.kind} clock={w.clock} className="mt-0.5" />}
      </span>
    )
  }
  return (
    <ul>
      {m.rows.map((r, i) => (
        <li key={i} className={cx('border-b border-ff-line/60 last:border-0', pad)}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-x-2">
            <span className="flex min-w-0 items-stretch">{name(r.a, i, 'left')}</span>
            <span className="flex flex-col items-center justify-center py-1.5" title={`${r.slot}: edge ${fmtSigned(r.edge)}, expected points, left minus right`}>
              <span className="flex w-full items-center">
                <span className={cx('flex shrink-0 justify-end', scoreW)}>{score(r.a, r.sa, 'right')}</span>
                <span className={cx('shrink-0 text-center font-mono text-[9.5px] text-ff-muted', rich && variant === 'full' ? 'w-10' : 'w-8')}>{r.slot}</span>
                <span className={cx('flex shrink-0 justify-start', scoreW)}>{score(r.b, r.sb, 'left')}</span>
              </span>
              <span className="relative mt-1 block h-1 w-full bg-ff-sunken" aria-hidden>
                <span className="absolute inset-y-0 left-1/2 w-px bg-ff-line2" />
                {/* The bar grows toward the side that is ahead, as a tug of war: green pulls toward the left side, red away from it. */}
                <span
                  className={cx('absolute inset-y-0', r.edge >= 0 ? 'right-1/2 bg-ff-pos' : 'left-1/2 bg-ff-neg')}
                  style={{ width: `${(Math.min(Math.abs(r.edge), maxEdge) / maxEdge) * 50}%` }}
                />
              </span>
            </span>
            <span className="flex min-w-0 items-stretch justify-end">{name(r.b, i, 'right')}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Each side's bench, with what the week has made of him: his score once his game is on, his projection before. */
export const Benches = ({ m, a, b, inset }: { m: Pick<MatchupRead, 'now'>; a: number; b: number; inset?: boolean }) => {
  const { data, analysis } = useFantasy()
  const per = analysis.horizon.perWeek
  const sides = [a, b].map((id) => {
    const team = analysis.teamById[id]
    const ids = team ? benchIds(team) : []
    const at = (x: string) => m.now.of(x)?.value ?? per[x] ?? 0
    return { id, name: team?.name ?? '', ids: ids.sort((x, y) => at(y) - at(x)) }
  })
  if (!sides.some((s) => s.ids.length)) return <p className={cx('py-2 text-[12px] text-ff-muted', inset ? 'px-4' : 'px-3')}>Nobody on either bench.</p>
  return (
    <div className={cx('grid grid-cols-2 gap-x-4 py-2', inset ? 'px-4' : 'px-3')}>
      {sides.map((s) => (
        <div key={s.id} className="min-w-0">
          <div className="mb-1 truncate font-mono text-[10.5px] text-ff-muted">{s.name}</div>
          {s.ids.length ? (
            <ul className="divide-y divide-ff-line/60">
              {s.ids.map((id) => {
                const w = m.now.of(id)
                return (
                  <li key={id} className="flex h-8 items-center gap-2 text-[12.5px]">
                    <span className="min-w-0 flex-1">
                      <PlayerName player={data.players[id]} id={id} size={18} className="max-sm:[&_.ff-pn-av]:!hidden" />
                    </span>
                    {w ? <Pts value={w.value} kind={w.kind} quiet={false} className="shrink-0 text-[12.5px]" /> : <span className="shrink-0 font-mono text-[10px] text-ff-muted">bye</span>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-[12px] text-ff-muted">Nobody on the bench.</p>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * The head-to-head, the one view of a matchup on the Matchups page, in its sheet and on the dashboard: both
 * managers' totals and odds on top, every slot against its opposite below.
 */
export const LineupDuel = ({
  m,
  variant = 'full',
  empty,
  between,
}: {
  m: MatchupHead & SlotSource
  variant?: DuelVariant
  empty?: (i: number, side: 'a' | 'b') => React.ReactNode
  /** Notes between the totals and the slots. */
  between?: React.ReactNode
}) => (
  <div>
    <div className={variant === 'full' ? 'px-3 py-4 sm:px-5' : variant === 'sheet' ? 'px-4 py-4' : 'px-3 pb-3 pt-3'}>
      <MatchupScore m={m} size={variant === 'full' ? 'lg' : 'md'} />
    </div>
    {between}
    <div className="border-t border-ff-line">
      <SlotTable m={m} variant={variant} empty={empty} />
    </div>
  </div>
)

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
