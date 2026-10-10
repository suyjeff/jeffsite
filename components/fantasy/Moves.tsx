import React, { useMemo } from 'react'
import { findMoves, type Move, type MoveKind } from '../../lib/fantasy/moves'
import { useFantasy } from './FantasyContext'
import { providerName } from '../../lib/fantasy/useLeagueData'
import { Badge, Empty, Panel, PlayerAvatar, ago, cx, fmt, fmtSigned } from './ui'

const KIND: Record<MoveKind, { label: string; tone: 'pos' | 'warn' | 'neg' | 'accent' | 'neutral' }> = {
  start: { label: 'START', tone: 'pos' },
  fill: { label: 'PICK UP', tone: 'neg' },
  cover: { label: 'COVER', tone: 'warn' },
  bye: { label: 'BYE', tone: 'warn' },
  add: { label: 'ADD', tone: 'accent' },
  role: { label: 'ROLE', tone: 'neutral' },
  news: { label: 'NEWS', tone: 'neutral' },
}

/** A player inside a sentence: his face and name, opening his sheet. */
const Who = ({ id }: { id: string | null | undefined }) => {
  const { data, openPlayer } = useFantasy()
  if (!id) return <span className="text-ff-muted">nobody</span>
  const p = data.players[id]
  return (
    <button type="button" onClick={() => openPlayer(id)} className="inline-flex max-w-full items-baseline gap-1 align-baseline font-medium text-ff-text hover:underline">
      {p && <PlayerAvatar player={p} id={id} size={16} className="translate-y-[2px] self-start" />}
      <span className="truncate">{p?.name ?? id}</span>
    </button>
  )
}

/** Where the league lives, for "read it in …": a manager reads news where they set lineups. */
const Platform = () => <>{providerName(useFantasy().data.provider)}</>

const Pts = ({ v }: { v: number | undefined }) => (v != null ? <span className="num text-ff-muted"> {fmt(v)}</span> : null)

/** One sentence per move: what to do, then the fact that makes it worth doing. */
const Sentence = ({ m }: { m: Move }) => {
  switch (m.kind) {
    case 'start':
      return (
        <>
          Start <Who id={m.inId} />
          <Pts v={m.inPts} />{' '}
          {m.outId ? (
            <>
              over <Who id={m.outId} />
              <Pts v={m.outPts} />
            </>
          ) : (
            <>in the empty spot</>
          )}
          {m.slot && <span className="text-ff-muted"> at {m.slot}</span>}
        </>
      )
    case 'fill':
      return (
        <>
          Pick up <Who id={m.inId} />
          <Pts v={m.inPts} />{' '}
          {m.outId ? (
            <>
              for <Who id={m.outId} />, who can&apos;t score this week
            </>
          ) : (
            <>for the empty {m.slot} slot</>
          )}
        </>
      )
    case 'cover':
      return (
        <>
          <Who id={m.outId} /> is {m.status}, <span className="num">{Math.round((m.play ?? 0) * 100)}%</span> to play.{' '}
          {m.inId ? (
            <>
              {m.backup ? (
                <>
                  Your best {m.slot} backup, <Who id={m.backup} />
                  <Pts v={m.benchPts} />, is thin: pick up <Who id={m.inId} />
                </>
              ) : (
                <>
                  Nobody on your bench plays {m.slot}: pick up <Who id={m.inId} />
                </>
              )}
              <Pts v={m.inPts} />
            </>
          ) : (
            <>
              If he sits, start <Who id={m.backup} />
              <Pts v={m.inPts} />
            </>
          )}
        </>
      )
    case 'bye':
      return (
        <>
          Week {m.week}:{' '}
          {m.outId ? (
            <>
              <Who id={m.outId} /> is off
            </>
          ) : (
            <>{m.slot} is empty</>
          )}{' '}
          and nobody on your bench plays {m.slot}. Pick up <Who id={m.inId} />
          <Pts v={m.inPts} />
        </>
      )
    case 'add':
      return (
        <>
          Add <Who id={m.inId} />
          {m.outId && (
            <>
              , drop <Who id={m.outId} />
            </>
          )}
          {m.slot && <span className="text-ff-muted">: starts at {m.slot.replace('SUPER_FLEX', 'SF')}</span>}
        </>
      )
    case 'role':
      return m.inId ? (
        <>
          <Who id={m.inId} />
          &apos;s work jumped{' '}
          <span className="num">
            {fmt(m.prior, 0)}→{m.last}
          </span>{' '}
          touches last game: worth a start?
        </>
      ) : (
        <>
          <Who id={m.outId} />
          &apos;s work fell{' '}
          <span className="num">
            {fmt(m.prior, 0)}→{m.last}
          </span>{' '}
          touches last game. Check why before you start him.
        </>
      )
    case 'news':
      return (
        <>
          News on <Who id={m.outId} /> {m.at ? `${ago(m.at)} ago` : 'today'}, with nothing on his status yet. Read it in <Platform /> before kickoff.
        </>
      )
  }
}

/** The number a move is ranked by, and what it counts. */
const Worth = ({ m }: { m: Move }) => {
  if (m.kind === 'news') return <span className="font-mono text-[10.5px] text-ff-muted">check</span>
  if (m.kind === 'role')
    return (
      <span className="text-right leading-none">
        <span className={cx('num block text-[15px] font-medium', m.inId ? 'text-ff-pos' : 'text-ff-warn')}>{fmtSigned((m.last ?? 0) - (m.prior ?? 0), 0)}</span>
        <span className="mt-0.5 block font-mono text-[10px] text-ff-muted">touches</span>
      </span>
    )
  return (
    <span className="text-right leading-none" title={m.week != null ? `Expected points this move is worth in week ${m.week}` : 'Points per week it adds to your best lineup'}>
      <span className="num block text-[15px] font-medium text-ff-pos">{fmtSigned(m.gain, 1)}</span>
      <span className="mt-0.5 block font-mono text-[10px] text-ff-muted">{m.week != null ? `wk ${m.week}` : 'per wk'}</span>
    </span>
  )
}

export const useMoves = (rosterId: number | null, limit?: number) => {
  const { data, analysis, models } = useFantasy()
  return useMemo(() => (rosterId == null ? [] : findMoves(data, analysis, rosterId, { perceived: models.perceived, limit })), [data, analysis, models.perceived, rosterId, limit])
}

/**
 * The kind tag sits above its sentence, not beside it, so every sentence starts on the list's own left edge, under the
 * heading above it, and wraps back to that edge too. In a sheet the heading sits a step further in, and so do the rows.
 */
export const MoveList = ({ moves, compact }: { moves: Move[]; compact?: boolean }) => (
  <ol className="divide-y divide-ff-line/70">
    {moves.map((m) => (
      <li key={m.key} className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-3 [[data-sheet]_&]:px-4', compact ? 'py-2 text-[12px]' : 'py-2.5 text-[13px]')}>
        <div className="min-w-0">
          <Badge tone={KIND[m.kind].tone}>
            {KIND[m.kind].label}
          </Badge>
          <p className="mt-1 leading-[1.45] text-ff-text2">
            <Sentence m={m} />
          </p>
        </div>
        <Worth m={m} />
      </li>
    ))}
  </ol>
)

/**
 * The few moves worth making on a roster, ahead of everything else on the page: the lineup fixes that lock at kickoff,
 * cover for starters who may sit, the hole next week's byes open, the best adds, and changes easy to miss.
 */
const MovesPanel = ({ rosterId }: { rosterId: number }) => {
  const { data, go, analysis } = useFantasy()
  const moves = useMoves(rosterId)
  const now = moves.filter((m) => m.urgency === 2).length
  const week = data.horizon[0]?.week
  const mine = rosterId === analysis.myRosterId
  return (
    <Panel
      title="Moves to make"
      pad={false}
      actions={
        <span>
          {now > 0 ? (
            <span className="text-ff-warn">
              {now} before wk {week} kickoff
            </span>
          ) : (
            'ranked by points'
          )}
        </span>
      }
    >
      {moves.length === 0 ? (
        <div className="p-3">
          <Empty title="Nothing to do">Your lineup is the best one, no starter is in doubt, and no free agent adds half a point a week.</Empty>
        </div>
      ) : (
        <MoveList moves={moves} />
      )}
      {mine && (
        <div className="flex items-center justify-between gap-3 border-t border-ff-line px-3 py-1.5 text-[11.5px] text-ff-muted">
          <span>Lineup moves use Sleeper&apos;s projections for week {week}; adds use the pricing horizon.</span>
          <button type="button" onClick={() => go('waivers', 'moves')} className="shrink-0 font-mono text-[11px] text-ff-text2 hover:text-ff-text">
            Waivers →
          </button>
        </div>
      )}
    </Panel>
  )
}

export default MovesPanel
