import React, { useMemo } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import type { SlatePlayer } from '../../../lib/fantasy/slate'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { ContextNotes } from '../ContextNotes'
import PlayerName from '../PlayerName'
import { sectionCode } from '../Shell'
import { useSlate } from '../useSlate'
import { Avatar, Empty, PageHeader, Panel, Pts, PtsKey, Stat, StatGrid, cx, fmt, fmtSigned, pct, type PtsKind } from '../ui'

/** One player's score as it stands: final, live, or projected; a starter with no game this week scores nothing. */
const scoreOf = (p: SlatePlayer | undefined, proj: number): { value: number; kind: PtsKind; expect: number } =>
  !p
    ? { value: proj, kind: 'proj', expect: proj }
    : p.actual != null
      ? { value: p.actual, kind: 'final', expect: p.actual }
      : p.live != null
        ? { value: p.live, kind: 'live', expect: p.live + 0.5 * p.proj }
        : { value: p.proj, kind: 'proj', expect: p.proj }

/** A side's score: final once every starter has played, live once the week is under way, projected before. */
const sideKind = (left: number, started: boolean): PtsKind => (left === 0 ? 'final' : started ? 'live' : 'proj')

/** This week's head-to-head on one page: the score as it stands, the odds, and every slot against its opposite. */
const MatchupView = ({ data, analysis }: { data: LeagueData; analysis: Analysis }) => {
  const { slate, live, week, proj } = useSlate(data, analysis)
  const me = analysis.myRosterId
  const players = data.players
  const raw = data.matchupsByWeek[week] ?? []
  const match = slate.matchups.find((m) => m.a.rosterId === me || m.b.rosterId === me)
  const mine = match ? (match.a.rosterId === me ? match.a : match.b) : null
  const theirs = match ? (match.a.rosterId === me ? match.b : match.a) : null
  const p = match && mine ? (match.a === mine ? match.pA : 1 - match.pA) : 0.5
  const manager = me != null ? slate.managers[me] : null

  // Slot by slot, from Sleeper's own lineups (starters line up with the league's starting slots).
  const rows = useMemo(() => {
    if (!mine || !theirs) return []
    const a = raw.find((m) => m.roster_id === mine.rosterId)?.starters ?? mine.starters
    const b = raw.find((m) => m.roster_id === theirs.rosterId)?.starters ?? theirs.starters
    return analysis.slots.map((slot, i) => {
      const ia = a[i] && a[i] !== '0' ? a[i] : null
      const ib = b[i] && b[i] !== '0' ? b[i] : null
      const sa = ia ? scoreOf(slate.byId[ia], proj[ia] ?? 0) : null
      const sb = ib ? scoreOf(slate.byId[ib], proj[ib] ?? 0) : null
      return { slot: slot.name.replace('SUPER_FLEX', 'SF'), a: ia, b: ib, sa, sb, edge: (sa?.expect ?? 0) - (sb?.expect ?? 0) }
    })
  }, [mine, theirs, raw, analysis.slots, slate.byId, proj])

  const bench = useMemo(() => {
    if (!mine) return []
    const m = raw.find((x) => x.roster_id === mine.rosterId)
    const starting = new Set(m?.starters ?? mine.starters)
    return (m?.players ?? analysis.teamById[mine.rosterId]?.players ?? [])
      .filter((id) => !starting.has(id) && players[id])
      .map((id) => {
        // Sleeper posts zeros before kickoff, so the game's state decides what the number is, not the number.
        const state = slate.teamState[players[id].team ?? '']
        const posted = m?.players_points?.[id] ?? 0
        const kind: PtsKind = state === 'final' ? 'final' : state === 'live' ? 'live' : 'proj'
        return { id, value: kind === 'proj' ? (proj[id] ?? 0) : posted, kind }
      })
      .sort((x, y) => y.value - x.value)
      .slice(0, 7)
  }, [mine, raw, analysis.teamById, players, proj, slate.teamState])

  const deciders = useMemo(() => {
    if (!mine || !theirs) return []
    return [...mine.starters, ...theirs.starters]
      .map((id) => slate.byId[id])
      .filter((x): x is SlatePlayer => !!x && x.actual == null)
      .sort((x, y) => y.swing - x.swing)
      .slice(0, 6)
  }, [mine, theirs, slate.byId])

  if (!live || !match || !mine || !theirs) {
    return (
      <>
        <PageHeader code={sectionCode('matchup')} title="Matchup" />
        <div className="mt-4">
          <Empty title="No matchup this week">Your head-to-head shows here once Sleeper sets the week&apos;s pairings during the regular season.</Empty>
        </div>
      </>
    )
  }

  const team = (id: number) => analysis.teamById[id]
  const record = (id: number) => {
    const s = analysis.seasonById[id]
    return s ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}` : ''
  }
  // The week is under way once any NFL game is: from then on, scores are what has happened, not projections.
  const started = slate.games.some((g) => g.final || g.live)
  const maxEdge = Math.max(4, ...rows.map((r) => Math.abs(r.edge)))
  const stakes = manager?.stakes

  const Side = ({ s, align }: { s: typeof mine; align: 'left' | 'right' }) => {
    const t = team(s.rosterId)
    const kind = sideKind(s.left, started)
    return (
      <div className={cx('min-w-0', align === 'right' && 'text-right')}>
        <div className={cx('flex min-w-0 items-center gap-2', align === 'right' && 'flex-row-reverse')}>
          <Avatar src={t?.avatar ?? null} name={t?.name ?? ''} size={28} />
          <span className="min-w-0">
            <span className={cx('block truncate text-[14px] font-medium', s.rosterId === me ? 'text-ff-accent' : 'text-ff-text')}>{t?.name}</span>
            <span className="block font-mono text-[10.5px] text-ff-muted">{record(s.rosterId)}</span>
          </span>
        </div>
        <div className="mt-2 text-[34px] font-medium leading-none tracking-[-0.03em] sm:text-[42px]">
          <Pts value={started ? s.banked : s.mu} kind={started ? kind : 'proj'} />
        </div>
        <div className="mt-1 font-mono text-[11px] text-ff-muted">
          {started ? (
            <>
              heading for <Pts value={s.mu} kind="proj" /> · {s.left} to play
            </>
          ) : (
            'projected'
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <PageHeader code={sectionCode('matchup')} title="Matchup" meta={`week ${week}`} actions={<PtsKey className="hidden sm:inline-flex" />} />
      <div className="mt-4 space-y-3">
        <section className="border border-ff-line bg-ff-panel px-3 py-4 sm:px-5" aria-label="Score">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 sm:gap-6">
            <Side s={mine} align="left" />
            <span className="pt-12 font-mono text-[11px] text-ff-muted">vs</span>
            <Side s={theirs} align="right" />
          </div>
          <div className="mt-4 flex items-center gap-2" title={`Win odds: you ${pct(p)}, them ${pct(1 - p)}`}>
            <span className="num w-10 text-[13px] font-medium text-ff-text">{pct(p)}</span>
            <span className="flex h-2 flex-1 gap-px" aria-hidden>
              <span className="h-full bg-ff-s1" style={{ width: `${p * 100}%` }} />
              <span className="h-full flex-1 bg-ff-s2" />
            </span>
            <span className="num w-10 text-right text-[13px] font-medium text-ff-text">{pct(1 - p)}</span>
          </div>
          <div className="mt-1 text-center text-[11.5px] text-ff-text2">win odds, as the week stands</div>
        </section>

        <StatGrid>
          <Stat
            label="Win odds"
            value={pct(p)}
            badge={{ text: p >= 0.6 ? 'favored' : p <= 0.4 ? 'underdog' : 'toss-up', tone: p >= 0.6 ? 'pos' : p <= 0.4 ? 'neg' : 'warn' }}
            sub={`vs ${team(theirs.rosterId)?.name}`}
          />
          <Stat label="Projected margin" value={fmtSigned(mine.mu - theirs.mu)} tone={mine.mu >= theirs.mu ? 'pos' : 'neg'} sub="points, final scores expected" />
          <Stat label="Still to play" value={`${mine.left} – ${theirs.left}`} sub="your starters – theirs" />
          <Stat
            label="On the line"
            value={stakes ? `${((stakes.win.playoffs - stakes.loss.playoffs) * 100).toFixed(0)}pt` : '…'}
            sub={stakes ? `playoff odds: ${pct(stakes.win.playoffs)} with a win, ${pct(stakes.loss.playoffs)} without` : 'simulating the season both ways'}
          />
        </StatGrid>

        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
          <Panel title="Lineups, slot by slot" actions={<PtsKey className="sm:hidden" />} pad={false}>
            <div className="grid grid-cols-[minmax(0,1fr)_3.25rem_2.75rem_5rem_2.75rem_3.25rem_minmax(0,1fr)] items-center border-b border-ff-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ff-muted max-sm:hidden">
              <span>You</span>
              <span />
              <span className="text-right">pts</span>
              <span className="text-center">edge</span>
              <span>pts</span>
              <span />
              <span className="text-right">Them</span>
            </div>
            <ul>
              {rows.map((r, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-b border-ff-line/60 px-3 py-2 last:border-0 sm:grid-cols-[minmax(0,1fr)_3.25rem_2.75rem_5rem_2.75rem_3.25rem_minmax(0,1fr)] sm:gap-0"
                >
                  <span className="min-w-0">{r.a ? <PlayerName player={players[r.a]} id={r.a} size={24} /> : <span className="text-[12px] text-ff-neg">empty</span>}</span>
                  <span className="hidden sm:block" />
                  {/* Phones: one centre column holding both scores and the slot. */}
                  <span className="flex flex-col items-center gap-0.5 sm:hidden">
                    <span className="font-mono text-[10px] text-ff-muted">{r.slot}</span>
                    <span className="flex items-baseline gap-2 text-[13px]">
                      {r.sa ? <Pts value={r.sa.value} kind={r.sa.kind} /> : '–'}
                      <span className="text-ff-muted">·</span>
                      {r.sb ? <Pts value={r.sb.value} kind={r.sb.kind} /> : '–'}
                    </span>
                  </span>
                  <span className="hidden text-right text-[13px] sm:block">{r.sa ? <Pts value={r.sa.value} kind={r.sa.kind} /> : '–'}</span>
                  <span className="hidden flex-col items-center gap-1 sm:flex" title={`Edge ${fmtSigned(r.edge)}: expected points, yours minus theirs`}>
                    <span className="font-mono text-[10px] text-ff-muted">{r.slot}</span>
                    <span className="relative block h-1.5 w-14 bg-ff-sunken" aria-hidden>
                      <span className="absolute inset-y-0 left-1/2 w-px bg-ff-line2" />
                      <span
                        className={cx('absolute inset-y-0', r.edge >= 0 ? 'left-1/2 bg-ff-pos' : 'right-1/2 bg-ff-neg')}
                        style={{ width: `${(Math.min(Math.abs(r.edge), maxEdge) / maxEdge) * 50}%` }}
                      />
                    </span>
                  </span>
                  <span className="hidden text-[13px] sm:block">{r.sb ? <Pts value={r.sb.value} kind={r.sb.kind} /> : '–'}</span>
                  <span className="hidden sm:block" />
                  <span className="flex min-w-0 justify-end">
                    {r.b ? <PlayerName player={players[r.b]} id={r.b} size={24} className="flex-row-reverse text-right" /> : <span className="text-[12px] text-ff-neg">empty</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">Edge is expected points in that slot, yours against theirs: green yours, red theirs.</p>
          </Panel>

          <div className="space-y-3">
            <Panel title="Who decides it" actions={<span>± win odds, bad game to good</span>} pad={false}>
              {deciders.length ? (
                <ul>
                  {deciders.map((x) => (
                    <li key={x.id} className="flex items-center gap-2 border-b border-ff-line/60 px-3 py-1.5 last:border-0">
                      <span className="min-w-0 flex-1">
                        <PlayerName
                          player={players[x.id]}
                          id={x.id}
                          size={22}
                          sub={x.owner === me ? <span className="text-ff-accent">yours</span> : <span className="text-ff-neg">theirs</span>}
                        />
                      </span>
                      <span className="text-right text-[11.5px] leading-tight">
                        <Pts value={x.live ?? x.proj} kind={x.live != null ? 'live' : 'proj'} />
                        <span className="block font-mono text-[10px] text-ff-muted">
                          {fmt(x.low, 0)}–{fmt(x.high, 0)}
                        </span>
                      </span>
                      <span className="num w-9 text-right text-[12.5px] text-ff-text">±{((x.swing / 2) * 100).toFixed(0)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-3 text-[12px] text-ff-muted">Every starter&apos;s game is final.</p>
              )}
            </Panel>
            <Panel title="Your bench" pad={false}>
              <ul>
                {bench.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 border-b border-ff-line/60 px-3 py-1.5 last:border-0">
                    <span className="min-w-0 flex-1">
                      <PlayerName player={players[b.id]} id={b.id} size={22} />
                    </span>
                    <ContextNotes context={data.context[b.id]} players={players} max={1} />
                    <span className="w-12 text-right text-[12.5px]">
                      <Pts value={b.value} kind={b.kind} />
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>

        <Panel title="Around the league" pad={false}>
          <ul>
            {slate.matchups
              .filter((m) => m !== match)
              .map((m) => {
                const go = started
                const ka = sideKind(m.a.left, go)
                const kb = sideKind(m.b.left, go)
                return (
                  <li
                    key={`${m.a.rosterId}-${m.b.rosterId}`}
                    className="grid grid-cols-[minmax(0,1fr)_3rem_4.5rem_3rem_minmax(0,1fr)] items-center gap-2 border-b border-ff-line/60 px-3 py-2 text-[12.5px] last:border-0"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Avatar src={team(m.a.rosterId)?.avatar ?? null} name={team(m.a.rosterId)?.name ?? ''} size={18} />
                      <span className="truncate text-ff-text">{team(m.a.rosterId)?.name}</span>
                    </span>
                    <span className="text-right">
                      <Pts value={go ? m.a.banked : m.a.mu} kind={go ? ka : 'proj'} />
                    </span>
                    <span className="flex h-1.5 gap-px" title={`Win odds ${pct(m.pA)} – ${pct(1 - m.pA)}`} aria-label={`Win odds ${pct(m.pA)} to ${pct(1 - m.pA)}`}>
                      <span className="h-full bg-ff-s1" style={{ width: `${m.pA * 100}%` }} />
                      <span className="h-full flex-1 bg-ff-s2" />
                    </span>
                    <span>
                      <Pts value={go ? m.b.banked : m.b.mu} kind={go ? kb : 'proj'} />
                    </span>
                    <span className="flex min-w-0 items-center justify-end gap-1.5">
                      <span className="truncate text-ff-text">{team(m.b.rosterId)?.name}</span>
                      <Avatar src={team(m.b.rosterId)?.avatar ?? null} name={team(m.b.rosterId)?.name ?? ''} size={18} />
                    </span>
                  </li>
                )
              })}
          </ul>
        </Panel>
        {started && (
          <p className="text-[11.5px] leading-relaxed text-ff-muted">
            A game under way counts points so far plus half the projection, since Sleeper has no game clock. Scores update every few minutes.
          </p>
        )}
      </div>
    </>
  )
}

export default MatchupView
