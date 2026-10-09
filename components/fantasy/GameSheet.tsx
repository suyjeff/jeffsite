import React from 'react'
import type { SlateGame, SlatePlayer } from '../../lib/fantasy/slate'
import { useFantasy } from './FantasyContext'
import PlayerName from './PlayerName'
import { SheetBody, SheetClose, SheetContent, SheetHeader, SheetSection, useSheet } from './Sheet'
import { ManagerTag, RangeBar, dayOf, pts } from './slateBits'
import { Badge, Pts, cx, fmt, fmtSigned } from './ui'
import { useSlate } from './useSlate'
import { useBroadcasts } from './useBroadcasts'
import { teamColor, teamLogo } from '../../lib/fantasy/nfl'
import { Callout } from './Callout'

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
const GameSheet = ({ gameKey }: { gameKey: string }) => {
  const { data, analysis, go } = useFantasy()
  const { close } = useSheet()
  const { slate, week } = useSlate(data, analysis)
  const casts = useBroadcasts(data.league.season, week)
  const g: SlateGame | undefined = slate.games.find((x) => x.key === gameKey)
  if (!g)
    return (
      <SheetContent>
        <SheetHeader title={gameKey.split(':')[1]?.replace('@', ' @ ') ?? 'Game'} eyebrow={<span>not on this week&apos;s slate</span>} />
        <div className="border-t border-ff-line px-4 py-4">
          <Callout kind="instruction">This game is not in the current week. Open it from Gameday instead.</Callout>
        </div>
      </SheetContent>
    )
  const me = analysis.myRosterId
  const mine = me != null ? slate.managers[me] : null
  const opp = mine?.opponent ?? null
  const forMe = mine?.games.find((x) => x.key === g.key)
  const max = Math.max(10, ...g.players.map((p) => Math.max(p.high, p.actual ?? 0)))
  const side = (team: string) => g.players.filter((p) => p.team === team)
  const total = (t: SlateGame['totals']['home']) => (t ? fmt(t.pts) : '–')
  const cast = casts[`${g.away}@${g.home}`]
  // ESPN's score only once ESPN itself has the game under way or over, and only for a game Sleeper agrees has started.
  const played = (g.final || g.live) && (cast?.state === 'in' || cast?.state === 'post') && cast?.away != null && cast?.home != null
  const source = g.totals.home?.source === 'market' || g.totals.away?.source === 'market' ? 'betting lines' : "Sleeper's projections"

  return (
    <SheetContent>
        <>
          {/* The two clubs' colors meet in a hairline across the top. */}
          <div aria-hidden className="flex h-[3px] shrink-0">
            <span className="flex-1" style={{ background: teamColor(g.away) }} />
            <span className="flex-1" style={{ background: teamColor(g.home) }} />
          </div>
          <header className="flex items-start gap-3 px-4 pb-3 pt-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-ff-muted">
                <span>wk {g.week}</span>
                <span aria-hidden>·</span>
                {g.final ? <span className="text-ff-text2">Final</span> : g.live ? <span className="text-ff-pos">Live</span> : <span>{dayOf(g.date)}</span>}
                {cast?.networks.length ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="text-ff-text2" title="Where to watch">
                      {cast.networks.join(' / ')}
                    </span>
                  </>
                ) : null}
                {mine?.games[0]?.key === g.key && <Badge tone="accent">decides your week</Badge>}
              </div>
            </div>
            <SheetClose />
          </header>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4 pb-4">
            {[g.away, g.home].map((t, i) => (
              <React.Fragment key={t}>
                {i === 1 && <span className="font-mono text-[12px] text-ff-muted">@</span>}
                <span className={cx('flex min-w-0 items-center gap-2.5', i === 1 && 'flex-row-reverse text-right')}>
                  <img src={teamLogo(t)} alt="" width={40} height={40} className="h-10 w-10 shrink-0 object-contain" loading="lazy" />
                  <span className="min-w-0 leading-tight">
                    <span className="block font-mono text-[20px] font-semibold tracking-[-0.01em] text-ff-text">{t}</span>
                    {played ? (
                      <span className="num block text-[15px] text-ff-text">{i === 0 ? cast!.away : cast!.home}</span>
                    ) : (
                      <span className="num block text-[11px] text-ff-muted">{total(i === 0 ? g.totals.away : g.totals.home)} proj</span>
                    )}
                  </span>
                </span>
              </React.Fragment>
            ))}
          </div>

          <SheetBody>
            <p className="border-t border-ff-line px-4 py-3 text-[12.5px] leading-[1.5] text-ff-text2">
              <span className="num text-ff-text">{g.players.length}</span> league starter{g.players.length === 1 ? '' : 's'} in it; totals from {source}.{' '}
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
                  .
                </>
              )}
            </p>

            {g.players.length === 0 ? (
              <p className="border-t border-ff-line px-4 py-3 text-[12.5px] text-ff-muted">No one in this league starts a player in this game.</p>
            ) : (
              [g.away, g.home].map((team) =>
                side(team).length ? (
                  <SheetSection key={team} title={team} aside={`${side(team).length} league starter${side(team).length === 1 ? '' : 's'}`}>
                    <ul className="divide-y divide-ff-line/60 border-l-2 pl-2.5" style={{ borderLeftColor: teamColor(team) }}>
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
    </SheetContent>
  )
}

export default GameSheet
