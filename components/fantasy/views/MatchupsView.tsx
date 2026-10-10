import React, { useEffect, useState } from 'react'
import { useFantasy } from '../FantasyContext'
import { Deciders, MatchupScore, OddsBar, decidedBy, useMatchups, type MatchupRead } from '../matchup'
import TeamName from '../TeamName'
import { Badge, Button, Empty, PageHeader, Panel, Pts, PtsKey, RowCover, Segmented, cx, pct, usePhone } from '../ui'

type View = 'list' | 'grid'

const Score = ({ m, side }: { m: MatchupRead; side: 'a' | 'b' }) => {
  const s = side === 'a' ? m.a : m.b
  return <Pts value={m.started ? s.banked : s.mu} kind={m.started ? (side === 'a' ? m.kindA : m.kindB) : 'proj'} />
}

/** One matchup as a list row: both managers, the scores, the odds between them, and who decides it. Phones stack the two sides. */
const Row = ({ m, surname, open }: { m: MatchupRead; surname: (id: string) => string; open: () => void }) => {
  const { analysis } = useFantasy()
  const by = decidedBy(m, surname)
  const label = `Open ${analysis.teamById[m.a.rosterId]?.name} vs ${analysis.teamById[m.b.rosterId]?.name}`
  const side = (k: 'a' | 'b') => {
    const s = k === 'a' ? m.a : m.b
    const p = k === 'a' ? m.p : 1 - m.p
    return (
      <span className="flex items-center gap-2">
        <span className="relative flex min-w-0 flex-1">
          <TeamName id={s.rosterId} size={20} className="text-[13px]" />
        </span>
        <span className="num w-9 text-right text-[10.5px] text-ff-muted">{pct(p)}</span>
        <span className="w-12 text-right text-[14px] font-medium">
          <Score m={m} side={k} />
        </span>
      </span>
    )
  }
  return (
    <li className="relative px-3 py-2 hover:bg-ff-raised/50">
      <RowCover label={label} onClick={open} />
      {/* Phones: the two sides stacked, the odds between them. */}
      <div className="space-y-1.5 sm:hidden">
        {side('a')}
        <OddsBar p={m.p} height="h-1" />
        {side('b')}
        {(m.close || by) && (
          <div className="flex items-center gap-1.5 text-[11px] text-ff-muted">
            {m.close && <Badge tone="warn">close</Badge>}
            <span className="truncate">{by ? (m.deciders.length ? `on ${by}` : by) : ''}</span>
          </div>
        )}
      </div>
      <div className="hidden grid-cols-[minmax(0,1fr)_3.25rem_minmax(56px,7rem)_3.25rem_minmax(0,1fr)] items-center gap-2 sm:grid lg:grid-cols-[minmax(0,1fr)_3.5rem_8rem_3.5rem_minmax(0,1fr)_minmax(0,14rem)]">
        <span className="relative flex min-w-0">
          <TeamName id={m.a.rosterId} size={20} className="text-[13px]" />
        </span>
        <span className="text-right text-[13.5px] font-medium">
          <Score m={m} side="a" />
        </span>
        <span className="flex items-center gap-1.5">
          <span className="num w-8 text-right text-[10.5px] text-ff-muted">{pct(m.p)}</span>
          <OddsBar p={m.p} />
          <span className="num w-8 text-[10.5px] text-ff-muted">{pct(1 - m.p)}</span>
        </span>
        <span className="text-[13.5px] font-medium">
          <Score m={m} side="b" />
        </span>
        <span className="relative flex min-w-0 justify-end">
          <TeamName id={m.b.rosterId} size={20} reverse className="text-[13px]" />
        </span>
        <span className="hidden min-w-0 items-center gap-1.5 truncate pl-2 text-[11.5px] text-ff-muted lg:flex">
          {m.close && <Badge tone="warn">close</Badge>}
          <span className="truncate">{by ? (m.deciders.length ? `on ${by}` : by) : ''}</span>
        </span>
      </div>
    </li>
  )
}

/** One matchup as a card: the two sides stacked, the odds, and what decides it. */
const Card = ({ m, mine, surname, open }: { m: MatchupRead; mine: boolean; surname: (id: string) => string; open: () => void }) => {
  const { analysis } = useFantasy()
  const by = decidedBy(m, surname)
  const line = (side: 'a' | 'b') => {
    const s = side === 'a' ? m.a : m.b
    const p = side === 'a' ? m.p : 1 - m.p
    return (
      <div className="flex items-center gap-2">
        <span className="relative flex min-w-0 flex-1">
          <TeamName id={s.rosterId} size={22} className="text-[13px]" />
        </span>
        <span className="num w-9 text-right text-[10.5px] text-ff-muted">{pct(p)}</span>
        <span className={cx('w-14 text-right text-[16px] font-medium', p >= 0.5 ? 'text-ff-text' : 'text-ff-text2')}>
          <Score m={m} side={side} />
        </span>
      </div>
    )
  }
  return (
    <li className={cx('relative flex flex-col gap-2 border bg-ff-panel px-3 py-2.5 transition-colors hover:border-ff-line2', mine ? 'border-ff-accent/50' : 'border-ff-line')}>
      <RowCover label={`Open ${analysis.teamById[m.a.rosterId]?.name} vs ${analysis.teamById[m.b.rosterId]?.name}`} onClick={open} />
      {line('a')}
      <OddsBar p={m.p} height="h-1" />
      {line('b')}
      <div className="flex min-h-[18px] items-center gap-1.5 text-[11px] text-ff-muted">
        {m.close && <Badge tone="warn">close</Badge>}
        <span className="truncate">{by ? (m.deciders.length ? `Decided by ${by}` : by) : ''}</span>
      </div>
    </li>
  )
}

/**
 * Every head-to-head this week. Yours sits on top in full; the rest are a list or a grid, each opening a sheet with
 * the detail. Close ones are flagged with the players still to decide them.
 */
const MatchupsView = () => {
  const { analysis, data, go, openMatchup } = useFantasy()
  const { slate, live, week, read, started } = useMatchups()
  const phone = usePhone()
  const [view, setView] = useState<View>('list')
  useEffect(() => {
    try {
      if (window.localStorage.getItem('ff:matchups:view') === 'grid') setView('grid')
    } catch {
      // Storage blocked: the list it is.
    }
  }, [])
  const pickView = (v: View) => {
    setView(v)
    try {
      window.localStorage.setItem('ff:matchups:view', v)
    } catch {
      // Storage blocked: the choice lasts this visit.
    }
  }
  const me = analysis.myRosterId
  const surname = (id: string) => data.players[id]?.name.split(' ').slice(-1)[0] ?? id

  if (!live || !slate.matchups.length)
    return (
      <>
        <PageHeader title="Matchups" />
        <div className="mt-4">
          <Empty title="No matchups this week">They show here once Sleeper sets the week&apos;s pairings during the regular season.</Empty>
        </div>
      </>
    )

  const all = slate.matchups
    .map((x) => {
      // Your side first on yours; otherwise the favorite first.
      const mineHere = x.a.rosterId === me || x.b.rosterId === me
      const first = mineHere ? me! : x.pA >= 0.5 ? x.a.rosterId : x.b.rosterId
      return read(first, first === x.a.rosterId ? x.b.rosterId : x.a.rosterId)
    })
    .filter((x): x is MatchupRead => !!x)
  const mine = all.find((m) => m.a.rosterId === me) ?? null
  // Gameday lists Lineups as a page only when you have a matchup to read there.
  const slotsHere = me != null && slate.managers[me]?.opponent != null
  // Closest first among the rest, so the games still in doubt lead.
  const rest = all.filter((m) => m !== mine).sort((x, y) => Math.abs(x.p - 0.5) - Math.abs(y.p - 0.5))
  const close = all.filter((m) => m.close).length
  const open = (m: MatchupRead) => openMatchup(week, m.a.rosterId, m.b.rosterId)

  return (
    <>
      <PageHeader title="Matchups" meta={`week ${week}${close ? ` · ${close} close` : ''}`} actions={<PtsKey className="hidden sm:inline-flex" />} />
      <div className="mt-4 space-y-4">
        {mine && (
          <section aria-label="Your matchup" className="border border-ff-accent/40 bg-ff-panel">
            <header className="flex h-9 items-center justify-between gap-3 border-b border-ff-line px-3">
              <span className="ff-label text-ff-text2">Your matchup</span>
              <span className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => open(mine)}>
                  Open matchup
                </Button>
                <Button size="sm" variant="ghost" onClick={() => go('slate', phone && slotsHere ? 'lineups' : 'week')}>
                  Slot by slot on Gameday →
                </Button>
              </span>
            </header>
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
              <div className="px-3 py-4 sm:px-5">
                <MatchupScore m={mine} />
              </div>
              <div className="border-t border-ff-line lg:border-l lg:border-t-0">
                <div className="ff-label flex justify-between px-3 pb-1 pt-2.5">
                  <span>Who decides it</span>
                  <span>± win odds</span>
                </div>
                <Deciders m={mine} limit={4} />
              </div>
            </div>
          </section>
        )}

        <Panel
          title={mine ? 'Around the league' : 'This week'}
          pad={false}
          actions={
            <Segmented<View>
              size="sm"
              label="Matchups view"
              value={view}
              onChange={pickView}
              options={[
                { key: 'list', label: 'List', title: 'One row per matchup' },
                { key: 'grid', label: 'Grid', title: 'A card per matchup' },
              ]}
            />
          }
        >
          {view === 'list' ? (
            <ul className="divide-y divide-ff-line/60">
              {(mine ? rest : all).map((m) => (
                <Row key={`${m.a.rosterId}-${m.b.rosterId}`} m={m} surname={surname} open={() => open(m)} />
              ))}
            </ul>
          ) : (
            <ul className="grid grid-cols-1 gap-2 p-2 sm:grid-cols-2 xl:grid-cols-3">
              {(mine ? rest : all).map((m) => (
                <Card key={`${m.a.rosterId}-${m.b.rosterId}`} m={m} mine={false} surname={surname} open={() => open(m)} />
              ))}
            </ul>
          )}
          <p className="border-t border-ff-line px-3 py-2 text-[11.5px] text-ff-muted">
            Closest first.
            <span className="max-sm:hidden">
              {' '}
              {started ? 'Scores so far; a game under way counts half its projection still to come. ' : 'Projected scores. '}
              &ldquo;Close&rdquo; means the expected margin is inside a normal week&apos;s swing.
            </span>
          </p>
        </Panel>
      </div>
    </>
  )
}

export default MatchupsView
