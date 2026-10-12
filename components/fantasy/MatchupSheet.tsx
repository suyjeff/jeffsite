import React from 'react'
import { useFantasy } from './FantasyContext'
import { Benches, Deciders, LineupDuel, decidedBy, useMatchups } from './matchup'
import { SheetBody, SheetContent, SheetHeader, SheetSection, useSheet } from './Sheet'
import { Avatar, Badge, pct } from './ui'

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
    <SheetHeader
      lead={
        <span aria-hidden className="flex items-center gap-1">
          <Avatar src={A?.avatar ?? null} name={A?.name ?? '?'} size={30} />
          <span className="font-mono text-[9px] uppercase text-ff-muted">vs</span>
          <Avatar src={B?.avatar ?? null} name={B?.name ?? '?'} size={30} />
        </span>
      }
      eyebrow={
        <>
          <span>wk {week}</span>
          {m?.close && <Badge tone="warn">close</Badge>}
          {m &&
            (m.kindA === 'final' && m.kindB === 'final' ? (
              <span className="text-ff-text2">final</span>
            ) : m.kindA === 'live' || m.kindB === 'live' ? (
              <span className="text-ff-pos">live</span>
            ) : m.started ? (
              <span className="text-ff-text2">under way</span>
            ) : (
              <span>projected</span>
            ))}
        </>
      }
      title={
        <>
          {A?.name} <span className="text-ff-muted">vs</span> {B?.name}
        </>
      }
    />
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
        <div className="border-t border-ff-line">
          <LineupDuel m={m} variant="sheet" />
        </div>
        <div className="border-y border-ff-line bg-ff-panel px-4 py-2.5 text-center">
          <span className="ff-label">On the line</span>{' '}
          <span className="num text-[15px] font-medium text-ff-text">{worth(stA) != null && worth(stB) != null ? `${worth(stA)} / ${worth(stB)}` : '…'}</span>
          <span className="ml-1.5 text-[10.5px] text-ff-muted">playoff points at stake</span>
        </div>
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
          {deciding && m.deciders.length > 0 && <p className="mb-2 text-[12.5px] text-ff-text2">Comes down to {deciding}.</p>}
          <div className="-mx-4">
            <Deciders m={m} limit={5} inset="sheet" />
          </div>
        </SheetSection>
        <SheetSection title="Benches" aside="this week">
          <div className="-mx-4">
            <Benches m={m} a={a} b={b} inset />
          </div>
        </SheetSection>
      </SheetBody>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-ff-line px-4 py-2.5">
        <span className="min-w-0 truncate text-[11.5px] text-ff-muted">Select a manager or player to open theirs.</span>
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
