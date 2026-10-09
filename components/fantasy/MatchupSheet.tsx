import React from 'react'
import { useFantasy } from './FantasyContext'
import { Deciders, MatchupScore, SlotTable, decidedBy, useMatchups } from './matchup'
import { SheetBody, SheetClose, SheetContent, SheetSection, useSheet } from './Sheet'
import { Avatar, Badge, fmtSigned, pct } from './ui'

/**
 * One fantasy matchup over the page: the score as it stands and where it is heading, what it is worth to each side,
 * the players still to decide it, and every slot against its opposite. Managers and players open their own sheets.
 */
const MatchupSheet = ({ week, a, b }: { week: number; a: number; b: number }) => {
  const { data, analysis, go } = useFantasy()
  const { close } = useSheet()
  const { read, slate } = useMatchups()
  const m = read(a, b)
  const A = analysis.teamById[a]
  const B = analysis.teamById[b]
  const surname = (id: string) => data.players[id]?.name.split(' ').slice(-1)[0] ?? id

  const header = (
    <header className="flex items-start gap-3 px-4 pb-3 pt-4">
      <span aria-hidden className="flex shrink-0 items-center gap-1">
        <Avatar src={A?.avatar ?? null} name={A?.name ?? '?'} size={30} />
        <span className="font-mono text-[9px] uppercase text-ff-muted">vs</span>
        <Avatar src={B?.avatar ?? null} name={B?.name ?? '?'} size={30} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ff-muted">
          <span>wk {week}</span>
          {m?.close && <Badge tone="warn">close</Badge>}
          {m && (m.kindA === 'final' && m.kindB === 'final' ? <span className="text-ff-text2">final</span> : m.started ? <span className="text-ff-warn">live</span> : <span>projected</span>)}
        </div>
        <h2 className="mt-0.5 truncate text-[17px] font-medium leading-tight tracking-[-0.01em] text-ff-text">
          {A?.name} <span className="text-ff-muted">vs</span> {B?.name}
        </h2>
      </div>
      <SheetClose />
    </header>
  )

  if (!m)
    return (
      <SheetContent>
        {header}
        <p className="border-t border-ff-line px-4 py-4 text-[12.5px] text-ff-muted">This matchup is not on this week&apos;s slate.</p>
      </SheetContent>
    )

  const stA = slate.managers[a]?.stakes
  const stB = slate.managers[b]?.stakes
  const worth = (s: typeof stA) => (s ? Math.round((s.win.playoffs - s.loss.playoffs) * 100) : null)
  const deciding = decidedBy(m, surname)

  return (
    <SheetContent>
      {header}
      <SheetBody>
        <div className="border-y border-ff-line px-4 py-4">
          <MatchupScore m={m} size="md" />
        </div>
        <dl className="grid grid-cols-3 gap-px border-b border-ff-line bg-ff-line text-center">
          {[
            { k: 'Margin', v: fmtSigned(m.a.mu - m.b.mu), s: 'expected, left side' },
            { k: 'To play', v: `${m.a.left}–${m.b.left}`, s: 'starters left' },
            { k: 'On the line', v: worth(stA) != null && worth(stB) != null ? `${worth(stA)} / ${worth(stB)}` : '…', s: 'playoff odds pts, each' },
          ].map((c) => (
            <div key={c.k} className="bg-ff-panel px-2 py-2.5">
              <dt className="ff-label">{c.k}</dt>
              <dd className="num mt-1 text-[17px] font-medium leading-none text-ff-text">{c.v}</dd>
              <dd className="mt-1 text-[10.5px] text-ff-muted">{c.s}</dd>
            </div>
          ))}
        </dl>
        {(stA || stB) && (
          <p className="px-4 py-3 text-[12.5px] leading-[1.5] text-ff-text2">
            {stA && (
              <>
                A win takes <b className="font-medium text-ff-text">{A?.name}</b> to {pct(stA.win.playoffs)} for the playoffs, a loss to {pct(stA.loss.playoffs)}.{' '}
              </>
            )}
            {stB && (
              <>
                For <b className="font-medium text-ff-text">{B?.name}</b>: {pct(stB.win.playoffs)} or {pct(stB.loss.playoffs)}.
              </>
            )}
          </p>
        )}
        <SheetSection title="What decides it" aside="± win odds, bad game to good">
          {deciding && <p className="mb-2 text-[12.5px] text-ff-text2">Comes down to {deciding}.</p>}
          <div className="-mx-4">
            <Deciders m={m} limit={5} />
          </div>
        </SheetSection>
        <SheetSection title="Slot by slot" aside="green: left side ahead">
          <div className="-mx-4">
            <SlotTable m={m} compact />
          </div>
        </SheetSection>
      </SheetBody>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-ff-line px-4 py-2.5">
        <span className="min-w-0 truncate text-[11.5px] text-ff-muted">Click a manager or player for theirs.</span>
        <button
          type="button"
          onClick={() => {
            close()
            go('matchups')
          }}
          className="shrink-0 font-mono text-[11px] text-ff-text2 hover:text-ff-text"
        >
          All matchups →
        </button>
      </footer>
    </SheetContent>
  )
}

export default MatchupSheet
