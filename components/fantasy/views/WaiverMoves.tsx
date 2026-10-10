import React, { useMemo, useState } from 'react'
import type { Analysis } from '../../../lib/fantasy/analysis'
import { suggestBid, type BidAdvice } from '../../../lib/fantasy/faab'
import type { TradeTarget } from '../../../lib/fantasy/trades'
import type { LeagueData } from '../../../lib/fantasy/useLeagueData'
import { contextReasons } from '../ContextNotes'
import { useFantasy } from '../FantasyContext'
import PlayerName from '../PlayerName'
import { Badge, Empty, N, Panel, Reasons, Stat, StatGrid, Table, fmt, fmtSigned, usePhone, type Reason } from '../ui'
import { Callout } from '../Callout'
import { InsightMark } from '../InsightMark'
import { Disclosure } from '../Disclosure'

type Move = { target: TradeTarget; drop: string | null; bid: BidAdvice | null; why: Reason[]; rivals: number; alts: TradeTarget[] }

/** The hottest pickups on Sleeper that are still free here, with what each would do for you. */
export const TrendingFree = ({ data, analysis, adds }: { data: LeagueData; analysis: Analysis; adds: TradeTarget[] }) => {
  const players = data.players
  const gainById = useMemo(() => Object.fromEntries(adds.map((t) => [t.id, t.add])) as Record<string, number>, [adds])
  const trendingFA = useMemo(
    () =>
      data.trending
        .filter((t) => players[t.player_id] && analysis.rosteredBy[t.player_id] == null)
        .slice(0, 10)
        .map((t) => ({ id: t.player_id, count: t.count })),
    [data.trending, players, analysis.rosteredBy],
  )
  if (!trendingFA.length) return null
  return (
    <Panel title="Trending free agents" actions={<span>Sleeper adds, last 24h</span>} pad={false}>
        <Table
          rows={trendingFA}
          rowKey={(t) => t.id}
          defaultSort="adds"
          columns={[
            { key: 'p', label: 'Player', sticky: true, render: (t) => <PlayerName player={players[t.id]} id={t.id} size={24} /> },
            {
              key: 'adds',
              label: 'Adds',
              align: 'right',
              title: 'Sleeper managers, across all leagues, who added him in the last 24 hours',
              sort: (t) => t.count,
              render: (t) => t.count.toLocaleString(),
            },
            {
              key: 'ecr',
              label: 'FantasyPros',
              align: 'right',
              hideBelow: 'sm',
              title: 'FantasyPros consensus rank at his position, rest of season',
              sort: (t) => -(data.consensus?.byId[t.id]?.posRank ?? 999),
              render: (t) => {
                const r = data.consensus?.byId[t.id]?.posRank
                return r != null ? `${players[t.id]?.pos}${Math.round(r)}` : <span className="text-ff-muted">–</span>
              },
            },
            {
              key: 'exp',
              label: 'Exp/wk',
              align: 'right',
              hideBelow: 'sm',
              sort: (t) => analysis.horizon.perWeek[t.id] ?? 0,
              render: (t) => fmt(analysis.horizon.perWeek[t.id]),
            },
            {
              key: 'gain',
              label: 'For you',
              align: 'right',
              title: 'Points per week he would add to your best lineup over the horizon',
              sort: (t) => gainById[t.id] ?? 0,
              render: (t) => (gainById[t.id] ? <span className="text-ff-pos">{fmtSigned(gainById[t.id], 1)}</span> : <span className="text-ff-muted">bench</span>),
            },
          ]}
          canExpand={() => true}
          expand={(t) => {
            const items = contextReasons(data.context[t.id], players)
            const why: Reason[] = gainById[t.id] ? items : [{ text: 'Would not start for you: a stash or a block, not an upgrade', tone: 'neutral' }, ...items]
            return <Reasons items={why} />
          }}
        />
      </Panel>
  )
}

/**
 * The waiver moves worth making, ranked, each with the case for it: what it does to your lineup (Sleeper's projections, blended with
 * prop lines), what FantasyPros and the rest of Sleeper think of him, his role, and what to bid given how this league spends.
 */
const WaiverMoves = ({
  data,
  analysis,
  adds,
  trending,
  drop,
}: {
  data: LeagueData
  analysis: Analysis
  adds: TradeTarget[]
  trending: Record<string, number>
  drop: string | null
}) => {
  const { models } = useFantasy()
  const phone = usePhone()
  const faab = models.faab
  const me = analysis.myRosterId
  const players = data.players

  // Model rank at the position, by rest-of-season value, to set beside FantasyPros'.
  const modelRank = useMemo(() => {
    const out: Record<string, number> = {}
    const byPos: Record<string, string[]> = {}
    for (const id of Object.keys(analysis.market)) {
      const pos = players[id]?.pos
      if (pos) (byPos[pos] ??= []).push(id)
    }
    for (const ids of Object.values(byPos)) ids.sort((a, b) => analysis.market[b] - analysis.market[a]).forEach((id, i) => (out[id] = i + 1))
    return out
  }, [analysis.market, players])

  const moves: Move[] = useMemo(() => {
    if (me == null) return []
    const others = analysis.teams.map((t) => t.rosterId).filter((r) => r !== me)
    const mine = analysis.teamById[me]?.players ?? []
    // One move per position, the best; the next two at it ride along as alternatives.
    const byPos = new Map<string, TradeTarget[]>()
    for (const t of adds.filter((x) => x.add >= 0.3)) {
      const pos = players[t.id]?.pos ?? ''
      byPos.set(pos, [...(byPos.get(pos) ?? []), t])
    }
    return [...byPos.values()]
      .map((list) => ({ t: list[0], alts: list.slice(1, 3) }))
      .sort((a, b) => b.t.add - a.t.add)
      .slice(0, 5)
      .map(({ t, alts }) => {
        const p = players[t.id]
        const pos = p?.pos ?? ''
        // A kicker or defense replaces yours at the spot; anyone else costs your least valuable bench player.
        const sameSpot =
          pos === 'K' || pos === 'DEF'
            ? mine.filter((id) => players[id]?.pos === pos).sort((a, b) => (analysis.horizon.perWeek[a] ?? 0) - (analysis.horizon.perWeek[b] ?? 0))[0]
            : undefined
        // Teams whose weakest spot is his position: the likeliest to bid against you.
        const rivals = others.filter((r) => analysis.needs[r]?.worstPos === pos)
        const value = analysis.market[t.id] ?? 0
        const bid = faab ? suggestBid(faab, me, { gain: t.add, value, trending: trending[t.id] ?? 0, pos }) : null
        const ecr = data.consensus?.byId[t.id]
        const why: Reason[] = [
          {
            text: (
              <>
                Adds <N tone="pos">{fmtSigned(t.add, 1)}</N> pts/wk to your lineup{t.slot ? ` at ${t.slot.replace('SUPER_FLEX', 'SF')}` : ''}
              </>
            ),
            tone: 'pos',
          },
        ]
        if (ecr?.posRank != null) {
          const m = modelRank[t.id]
          const ahead = m != null && ecr.posRank < m - 3
          why.push({
            text: (
              <>
                FantasyPros ranks him{' '}
                <N>
                  {pos}
                  {Math.round(ecr.posRank)}
                </N>{' '}
                rest of season
                {m ? (
                  <>
                    {' '}
                    (this model:{' '}
                    <N>
                      {pos}
                      {m}
                    </N>
                    )
                  </>
                ) : null}
                {ahead ? ': experts like him more than projections do' : ''}
              </>
            ),
            tone: ahead ? 'pos' : 'neutral',
          })
        }
        if ((trending[t.id] ?? 0) >= 200)
          why.push({
            text: (
              <>
                <N>{trending[t.id].toLocaleString()}</N> Sleeper adds in the last day
              </>
            ),
            tone: trending[t.id] >= 5000 ? 'warn' : 'neutral',
          })
        if (rivals.length)
          why.push({
            text: `${rivals.length} other ${rivals.length === 1 ? 'team is' : 'teams are'} weakest at ${pos} and may bid`,
            tone: 'warn',
          })
        why.push(...contextReasons(data.context[t.id], players))
        if (bid) why.push(...bid.reasons.map((r) => ({ text: r.text, tone: r.tone })))
        return { target: t, drop: sameSpot ?? drop, bid, why, rivals: rivals.length, alts }
      })
  }, [adds, me, analysis, players, faab, trending, data.consensus, data.context, modelRank, drop])

  if (me == null) return null
  const mine = faab ? (faab.remaining[me] ?? 0) : 0
  const richer = faab ? Object.entries(faab.remaining).filter(([r, v]) => Number(r) !== me && v > mine).length : 0
  const rich = faab
    ? Object.entries(faab.remaining)
        .filter(([r]) => Number(r) !== me)
        .sort((a, b) => b[1] - a[1])[0]
    : null
  const best = moves[0]?.target.add ?? 0
  // The note below is about the best add and what to bid on him, so that move carries the mark.
  const lowValue = !!faab && best < 0.75 && moves.length > 0

  return (
    <div className="space-y-3">
      {faab && (
        <StatGrid>
          <Stat
            label="Your FAAB"
            value={`$${mine}`}
            meter={mine / faab.budget}
            sub={`of $${faab.budget} · ${richer === 0 ? 'most in the league' : `${richer} ${richer === 1 ? 'team has' : 'teams have'} more`}`}
          />
          <Stat
            label="League going rate"
            value={faab.going.n ? `$${faab.going.p50}` : '–'}
            sub={faab.going.n ? `median winning bid · top 25% $${faab.going.p75}+` : 'no winning bids yet'}
          />
          {!phone && <Stat label="Richest rival" value={rich ? `$${rich[1]}` : '–'} sub={rich ? (analysis.teamById[Number(rich[0])]?.name ?? '–') : '–'} />}
          {!phone && <Stat
            label="Weeks left"
            value={faab.weeksLeft}
            tone={faab.weeksLeft <= 3 ? 'warn' : undefined}
            sub={faab.weeksLeft <= 3 ? 'spend it: leftover FAAB is worth nothing' : `regular season · ~$${Math.round(mine / Math.max(1, faab.weeksLeft))} a week to spend`}
          />}
        </StatGrid>
      )}

      <Panel title="Recommended moves" actions={<span>ranked by gain to your lineup</span>} pad={false}>
        {moves.length === 0 ? (
          <div className="p-3">
            <Empty title="No add is worth making">
              Nobody on the wire beats your starters by enough to matter.{faab ? ' Hold your FAAB: the money is worth more after the next injury.' : ''}
            </Empty>
          </div>
        ) : (
          <ol className="divide-y divide-ff-line">
            {moves.map((m, i) => (
              <li key={m.target.id} className="px-3 py-3">
                <div className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-2 gap-y-2 sm:grid-cols-[20px_minmax(0,1fr)_auto]">
                  <span className="num pt-1 text-[11px] text-ff-muted">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <Badge tone="pos" className="w-11 justify-center">
                        ADD
                      </Badge>
                      <PlayerName player={players[m.target.id]} id={m.target.id} size={26} />
                      {lowValue && i === 0 && <InsightMark label="best add" title="The note below is about this add" />}
                    </div>
                    {m.drop && (
                      <div className="flex min-w-0 items-center gap-2">
                        <Badge tone="neg" className="w-11 justify-center">
                          DROP
                        </Badge>
                        <PlayerName player={players[m.drop]} id={m.drop} size={26} sub={`${fmtSigned(analysis.market[m.drop] ?? 0, 1)}/wk value`} />
                      </div>
                    )}
                  </div>
                  <div className="col-span-2 flex items-start gap-4 sm:col-span-1 sm:justify-end">
                    <div className="text-right leading-none">
                      <div className="ff-label">gain</div>
                      <div className="num mt-1 text-[20px] font-medium text-ff-pos">{fmtSigned(m.target.add, 1)}</div>
                    </div>
                    {m.bid && (
                      <div className="text-right leading-none" title={`League pays $${m.bid.low}–${m.bid.high} for this much value`}>
                        <div className="ff-label">bid</div>
                        <div className="num mt-1 text-[20px] font-medium text-ff-text">${m.bid.bid}</div>
                        <div className="num mt-0.5 text-[10.5px] text-ff-muted">
                          ${m.bid.low}–{m.bid.high}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="col-span-2 space-y-2 sm:col-span-3">
                    <MoveWhy items={m.why} />
                    {m.alts.length > 0 && (
                      <div className="flex items-baseline gap-x-3 text-[12px] text-ff-muted">
                        <span className="ff-label shrink-0">or</span>
                        {/* A wrapped alternative lines up under the first, not under "or". */}
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          {m.alts.map((a) => (
                            <span key={a.id} className="inline-flex items-baseline gap-1.5">
                              <PlayerName player={players[a.id]} id={a.id} avatar={false} />
                              <N tone="pos">{fmtSigned(a.add, 1)}</N>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      {!phone && <TrendingFree data={data} analysis={analysis} adds={adds} />}

      {lowValue && (
        <Callout kind="insight">
          The best add is worth under <N>0.75</N> pts/wk to you: bid the minimum or hold. FAAB buys the most right after injuries.
        </Callout>
      )}
      <Disclosure from="md" summary="How gain and bids work" className="text-[11.5px] leading-relaxed text-ff-muted">
        Gain: your lineup re-solved each week with him in and your weakest player out. Bids weigh his worth to you against what this league pays for similar value{faab ? `, at about $${Math.round(faab.rate)} per pt/wk${faab.rateN ? ` (${faab.rateN} of this season's bids)` : ' (a default until more bids land)'}` : ''}, and never go past $1 over the richest rival.
      </Disclosure>
    </div>
  )
}

/** The case for a move. A phone sees the first two reasons; the rest are a tap away. */
const MoveWhy = ({ items }: { items: Reason[] }) => {
  const phone = usePhone()
  const [open, setOpen] = useState(false)
  const long = phone && items.length > 3
  return (
    <>
      <Reasons items={long && !open ? items.slice(0, 2) : items} />
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="font-mono text-[11px] text-ff-accent hover:underline">
          {open ? 'fewer reasons' : `${items.length - 2} more reasons`}
        </button>
      )}
    </>
  )
}

export default WaiverMoves
