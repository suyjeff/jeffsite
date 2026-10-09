import React from 'react'
import { benchIds } from '../../lib/fantasy/roster'
import { useFantasy } from './FantasyContext'
import PlayerName from './PlayerName'
import { Deciders, MatchupScore, SlotTable, decidedBy, useMatchups } from './matchup'
import { SheetBody, SheetContent, SheetHeader, SheetSection, useSheet } from './Sheet'
import { Avatar, Badge, fmt, fmtSigned, pct } from './ui'

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
            ) : m.started ? (
              <span className="text-ff-pos">live</span>
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
  // Each side's bench, best first: who could still be swapped in.
  const per = analysis.horizon.perWeek
  const benches = [
    { id: a, name: A?.name ?? '', ids: A ? benchIds(A).sort((x, y) => (per[y] ?? 0) - (per[x] ?? 0)) : [] },
    { id: b, name: B?.name ?? '', ids: B ? benchIds(B).sort((x, y) => (per[y] ?? 0) - (per[x] ?? 0)) : [] },
  ]

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
            { k: 'On the line', v: worth(stA) != null && worth(stB) != null ? `${worth(stA)} / ${worth(stB)}` : '…', s: 'playoff points at stake' },
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
          {deciding && m.deciders.length > 0 && <p className="mb-2 text-[12.5px] text-ff-text2">Comes down to {deciding}.</p>}
          <div className="-mx-4">
            <Deciders m={m} limit={5} inset="sheet" />
          </div>
        </SheetSection>
        <SheetSection title="Slot by slot" aside="green: left side ahead">
          <div className="-mx-4">
            <SlotTable m={m} compact inset="sheet" />
          </div>
        </SheetSection>
        {benches.some((s) => s.ids.length > 0) && (
          <SheetSection title="Benches" aside="pts/wk ahead">
            <div className="grid grid-cols-2 gap-x-4">
              {benches.map((s) => (
                <div key={s.id} className="min-w-0">
                  <div className="mb-1 truncate font-mono text-[10.5px] text-ff-muted">{s.name}</div>
                  {s.ids.length ? (
                    <ul className="divide-y divide-ff-line/60">
                      {s.ids.map((id) => (
                        <li key={id} className="flex h-8 items-center gap-2 text-[12.5px]">
                          <span className="min-w-0 flex-1">
                            <PlayerName player={data.players[id]} id={id} size={18} />
                          </span>
                          <span className="num shrink-0 text-ff-text2">{fmt(analysis.horizon.perWeek[id])}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12px] text-ff-muted">Nobody on the bench.</p>
                  )}
                </div>
              ))}
            </div>
          </SheetSection>
        )}
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
