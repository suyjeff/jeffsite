import React from 'react'
import type { SlateGame, SlatePlayer } from '../../lib/fantasy/slate'
import { useFantasy } from './FantasyContext'
import PlayerName from './PlayerName'
import Sheet, { SheetBody, SheetClose, SheetSection } from './Sheet'
import { ManagerTag, RangeBar, dayOf, pts } from './slateBits'
import { Badge, Pts, cx, fmt, fmtSigned } from './ui'
import { useSlate } from './useSlate'

/** One league starter in the game: who has him, what he projects or scored, his range and what rides on him. */
const Row = ({ p, max, me, opp }: { p: SlatePlayer; max: number; me: number | null; opp: number | null }) => {
  const { data } = useFantasy()
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1.5">
      <PlayerName player={data.players[p.id]} id={p.id} size={22} sub={<ManagerTag id={p.owner} me={me} opp={opp} />} />
      <span className="flex flex-col items-end leading-tight">
        {p.actual != null ? (
          <>
            <Pts value={p.actual} kind="final" className="text-[13px]" />
            <span className={cx('num text-[10px]', p.actual >= p.proj ? 'text-ff-pos' : 'text-ff-neg')}>{fmtSigned(p.actual - p.proj)}</span>
          </>
        ) : p.live != null ? (
          <>
            <Pts value={p.live} kind="live" className="text-[13px]" />
            <span className="num text-[10px] text-ff-muted">of {fmt(p.proj)}</span>
          </>
        ) : (
          <>
            <Pts value={p.proj} kind="proj" className="text-[13px]" />
            <span className="num text-[10px] text-ff-muted">
              {fmt(p.low, 0)}–{fmt(p.high, 0)}
            </span>
          </>
        )}
      </span>
      <span className="flex w-[92px] flex-col items-end gap-0.5">
        <RangeBar p={p} max={max} />
        <span className="num text-[10.5px] text-ff-text2" title="How far his game moves his manager's win odds">
          {p.realized != null ? pts(p.realized, true) : `±${pts(p.swing / 2)}`} <span className="text-ff-muted">win</span>
        </span>
      </span>
    </li>
  )
}

/**
 * One NFL game, read for this league, over the page: its state and projected score, then every league starter in it
 * by team, with what each game moves. It summarises; Gameday holds the full breakdown.
 */
const GameSheet = ({ gameKey, onClose }: { gameKey: string; onClose: () => void }) => {
  const { data, analysis, go } = useFantasy()
  const { slate } = useSlate(data, analysis)
  const g: SlateGame | undefined = slate.games.find((x) => x.key === gameKey)
  if (!g) return null
  const me = analysis.myRosterId
  const mine = me != null ? slate.managers[me] : null
  const opp = mine?.opponent ?? null
  const forMe = mine?.games.find((x) => x.key === g.key)
  const max = Math.max(10, ...g.players.map((p) => Math.max(p.high, p.actual ?? 0)))
  const side = (team: string) => g.players.filter((p) => p.team === team)
  const total = (t: SlateGame['totals']['home']) => (t ? fmt(t.pts) : '–')
  const source = g.totals.home?.source === 'market' || g.totals.away?.source === 'market' ? 'betting lines' : "Sleeper's projections"

  return (
    <Sheet label={`${g.away} at ${g.home}`} onClose={onClose} width={480}>
      {({ close, phone }) => (
        <>
          <header className="flex items-start gap-3 px-4 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ff-muted">
                <span>wk {g.week}</span>
                <span aria-hidden>·</span>
                {g.final ? <span className="text-ff-text2">Final</span> : g.live ? <span className="text-ff-warn">Live</span> : <span>{dayOf(g.date)}</span>}
                {mine?.games[0]?.key === g.key && <Badge tone="accent">decides your week</Badge>}
              </div>
              <h2 className="mt-1 font-mono text-[20px] font-semibold leading-tight tracking-[-0.01em] text-ff-text">
                {g.away} <span className="font-normal text-ff-muted">@</span> {g.home}
              </h2>
            </div>
            <SheetClose phone={phone} onClick={close} />
          </header>

          <SheetBody phone={phone}>
            <div className="grid grid-cols-3 gap-px border-y border-ff-line bg-ff-line text-center">
              {[
                { k: g.away, v: total(g.totals.away), s: g.final ? 'pre-game total' : 'projected' },
                { k: 'League', v: String(g.players.length), s: g.players.length === 1 ? 'starter in it' : 'starters in it' },
                { k: g.home, v: total(g.totals.home), s: g.final ? 'pre-game total' : 'projected' },
              ].map((c, i) => (
                <div key={i} className="bg-ff-panel px-2 py-2.5">
                  <div className="ff-label">{c.k}</div>
                  <div className="num mt-1 text-[20px] font-medium leading-none text-ff-text">{c.v}</div>
                  <div className="mt-1 text-[10.5px] text-ff-muted">{c.s}</div>
                </div>
              ))}
            </div>

            <p className="px-4 py-3 text-[12.5px] leading-[1.5] text-ff-text2">
              {g.final ? (
                <>Final. Rows show what each starter scored against his projection and what that did to his manager&apos;s week.</>
              ) : (
                <>
                  Moves win odds <span className="num text-ff-text">±{pts(g.swing / 2)}</span> across the league&apos;s matchups
                  {forMe ? (
                    <>
                      , and yours <span className="num text-ff-text">±{pts(forMe.swing / 2)}</span>
                    </>
                  ) : null}
                  . Team totals from {source}.
                </>
              )}
            </p>

            {g.players.length === 0 ? (
              <p className="border-t border-ff-line px-4 py-3 text-[12.5px] text-ff-muted">No one in this league starts a player in this game.</p>
            ) : (
              [g.away, g.home].map((team) =>
                side(team).length ? (
                  <SheetSection key={team} title={team} aside={`${side(team).length} league starter${side(team).length === 1 ? '' : 's'}`}>
                    <ul className="divide-y divide-ff-line/60">
                      {side(team).map((p) => (
                        <Row key={p.id} p={p} max={max} me={me} opp={opp} />
                      ))}
                    </ul>
                  </SheetSection>
                ) : null,
              )
            )}
          </SheetBody>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-ff-line px-4 py-2.5">
            <span className="min-w-0 truncate text-[11.5px] text-ff-muted">Ranges are each starter&apos;s 20th to 80th percentile game.</span>
            <button
              type="button"
              onClick={() => {
                close()
                go('slate', 'week')
              }}
              className="shrink-0 font-mono text-[11px] text-ff-text2 hover:text-ff-text"
            >
              Your week →
            </button>
          </footer>
        </>
      )}
    </Sheet>
  )
}

export default GameSheet
